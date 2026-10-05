/** 관리자: 상장 전환, 마켓 정지, 출금 승인, 파라미터 수정, 사용자 플래그, 알림, 감사 로그. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ASSET, MARKET, SYSTEM_USERS } from '../../config.js';
import { big, withTx } from '../../db/pool.js';
import { fromUnits, toUnits } from '../../core/units.js';
import { audit } from '../../lib/audit.js';
import { adjustBalance, UserError } from '../../lib/ledger.js';
import { KEYS } from '../../lib/redis.js';
import { EDITABLE_SETTINGS, loadSettings, saveSetting, type SettingKey } from '../../lib/settings.js';
import { checkTotp, ip, requireAdmin, type Ctx } from '../context.js';

const f = (v: string | null) => (v === null ? null : fromUnits(BigInt(v)));

export default async function adminRoutes(app: FastifyInstance, { db, redis, engine }: Ctx) {
  app.get('/api/admin/overview', async (req) => {
    await requireAdmin(req);
    const [s, markets, pending, alerts, ins, insPos, users, hot] = await Promise.all([
      loadSettings(db),
      db.query('SELECT id, kind, status, paused, expiry_at FROM markets ORDER BY kind, expiry_at NULLS FIRST'),
      db.query(`SELECT COUNT(*) AS n FROM withdrawals WHERE status = 'pending'`),
      db.query('SELECT id, kind, message, details, created_at FROM alerts WHERE NOT acknowledged ORDER BY id DESC LIMIT 50'),
      db.query('SELECT available FROM balances WHERE user_id = $1 AND asset = $2', [SYSTEM_USERS.INSURANCE, ASSET.QUOTE]),
      db.query('SELECT qty, entry_price FROM positions WHERE user_id = $1 AND market_id = $2', [SYSTEM_USERS.INSURANCE, MARKET.PERP]),
      db.query(`SELECT COUNT(*) FILTER (WHERE role <> 'system') AS n FROM users`),
      redis.get(KEYS.HOTWALLET),
    ]);
    return {
      coinStatus: s.coin_status, auctionEndAt: s.auction_end_at, settings: s,
      markets: markets.rows, pendingWithdrawals: Number(pending.rows[0].n), alerts: alerts.rows,
      insuranceFund: { balance: fromUnits(big(ins.rows[0]?.available)), position: insPos.rows[0] ? { qty: f(insPos.rows[0].qty), entryPrice: f(insPos.rows[0].entry_price) } : null },
      users: Number(users.rows[0].n), hotWallet: hot ? JSON.parse(hot) : null,
    };
  });

  app.post('/api/admin/listing/start', async (req) => {
    const admin = await requireAdmin(req);
    return engine.send('start_listing', {}, { actorId: admin.id, ip: ip(req) });
  });

  app.post('/api/admin/listing/end-auction', async (req) => {
    const admin = await requireAdmin(req);
    return engine.send('end_auction', { force: true }, { actorId: admin.id, ip: ip(req) });
  });

  app.post('/api/admin/markets/:id/pause', async (req) => {
    const admin = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const { paused } = z.object({ paused: z.boolean() }).parse(req.body);
    return engine.send('set_market_paused', { marketId: id, paused }, { actorId: admin.id, ip: ip(req) });
  });

  app.get('/api/admin/withdrawals', async (req) => {
    await requireAdmin(req);
    const { status } = z.object({ status: z.string().default('pending') }).parse(req.query);
    const { rows } = await db.query(
      `SELECT w.*, u.username, u.email FROM withdrawals w JOIN users u ON u.id = w.user_id WHERE w.status = $1 ORDER BY w.id LIMIT 200`, [status]);
    return rows.map((r) => ({ id: Number(r.id), user: r.username, email: r.email, address: r.address, amount: f(r.amount), fee: f(r.fee), status: r.status, txid: r.txid, error: r.error, time: r.created_at }));
  });

  /** 승인하면 worker 프로세스가 sendtoaddress로 전송한다. 관리자도 2FA 코드가 필요하다(설정된 경우). */
  app.post('/api/admin/withdrawals/:id/approve', async (req) => {
    const admin = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const { totp } = z.object({ totp: z.string().optional() }).parse(req.body ?? {});
    await checkTotp(db, admin.id, totp, false);
    const { rows } = await db.query(
      `UPDATE withdrawals SET status = 'approved', reviewed_by = $2, updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING user_id`, [id, admin.id]);
    if (!rows[0]) throw new UserError('대기 중인 출금이 아닙니다');
    await audit(db, { action: 'admin.withdraw_approve', actorId: admin.id, userId: rows[0].user_id, ip: ip(req), details: { id } });
    return { ok: true };
  });

  app.post('/api/admin/withdrawals/:id/reject', async (req) => {
    const admin = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const { note } = z.object({ note: z.string().max(500).default('') }).parse(req.body ?? {});
    await withTx(db, async (c) => {
      const { rows } = await c.query(`SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE`, [id]);
      if (!rows[0] || !['pending', 'failed'].includes(rows[0].status)) throw new UserError('거절할 수 없는 상태입니다');
      if (rows[0].status === 'pending') {
        const total = big(rows[0].amount) + big(rows[0].fee);
        await adjustBalance(c, rows[0].user_id, ASSET.COIN, total, -total, 'withdraw_rejected', id);
      }
      await c.query(`UPDATE withdrawals SET status = 'rejected', reviewed_by = $2, review_note = $3, updated_at = now() WHERE id = $1`, [id, admin.id, note]);
      await audit(c, { action: 'admin.withdraw_reject', actorId: admin.id, userId: rows[0].user_id, ip: ip(req), details: { id, note } });
    });
    return { ok: true };
  });

  app.get('/api/admin/settings', async (req) => {
    await requireAdmin(req);
    return { settings: await loadSettings(db), editable: EDITABLE_SETTINGS };
  });

  app.put('/api/admin/settings', async (req) => {
    const admin = await requireAdmin(req);
    const body = z.record(z.string(), z.union([z.number(), z.string()])).parse(req.body);
    const before = await loadSettings(db);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, raw] of Object.entries(body)) {
      const rule = EDITABLE_SETTINGS[key as SettingKey];
      if (!rule) throw new UserError(`수정할 수 없는 설정입니다: ${key}`);
      const n = Number(raw);
      if (!Number.isFinite(n) || (rule.kind === 'int' && !Number.isInteger(n))) throw new UserError(`${key} 값이 올바르지 않습니다`);
      if ((rule.min !== undefined && n < rule.min) || (rule.max !== undefined && n > rule.max)) throw new UserError(`${key} 허용 범위: ${rule.min ?? '-'} ~ ${rule.max ?? '-'}`);
      const value = rule.kind === 'int' ? n : typeof before[key as SettingKey] === 'string' ? (toUnits(String(raw)), String(raw)) : n;
      changes[key] = { from: before[key as SettingKey], to: value };
      await saveSetting(db, key as SettingKey, value);
    }
    await audit(db, { action: 'admin.settings_update', actorId: admin.id, ip: ip(req), details: changes });
    await engine.send('reload_settings', {}, { actorId: admin.id });
    return { ok: true, changes };
  });

  app.get('/api/admin/users', async (req) => {
    await requireAdmin(req);
    const { q } = z.object({ q: z.string().default('') }).parse(req.query);
    const { rows } = await db.query(
      `SELECT id, email, username, role, email_verified, totp_enabled, is_operator, trading_banned, kyc_status, created_at FROM users
       WHERE role <> 'system' AND (email ILIKE $1 OR username ILIKE $1) ORDER BY created_at DESC LIMIT 100`, [`%${q}%`]);
    return rows;
  });

  app.patch('/api/admin/users/:id', async (req) => {
    const admin = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const body = z.object({
      is_operator: z.boolean().optional(), trading_banned: z.boolean().optional(),
      kyc_status: z.enum(['none', 'pending', 'approved', 'rejected']).optional(),
    }).parse(req.body);
    const sets: string[] = []; const vals: unknown[] = [id];
    for (const [k, v] of Object.entries(body)) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
    if (!sets.length) throw new UserError('변경할 항목이 없습니다');
    const { rows } = await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1 AND role <> 'system' RETURNING id`, vals);
    if (!rows[0]) throw new UserError('사용자를 찾을 수 없습니다', 404);
    await audit(db, { action: 'admin.user_update', actorId: admin.id, userId: id, ip: ip(req), details: body });
    return { ok: true };
  });

  app.post('/api/admin/alerts/:id/ack', async (req) => {
    const admin = await requireAdmin(req);
    const { id } = req.params as { id: string };
    await db.query('UPDATE alerts SET acknowledged = true WHERE id = $1', [id]);
    await audit(db, { action: 'admin.alert_ack', actorId: admin.id, details: { id } });
    return { ok: true };
  });

  app.get('/api/admin/audit', async (req) => {
    await requireAdmin(req);
    const q = z.object({ userId: z.string().uuid().optional(), action: z.string().optional(), limit: z.coerce.number().max(500).default(200) }).parse(req.query);
    const params: unknown[] = [];
    const where: string[] = [];
    if (q.userId) { params.push(q.userId); where.push(`(user_id = $${params.length} OR actor_id = $${params.length})`); }
    if (q.action) { params.push(`${q.action}%`); where.push(`action LIKE $${params.length}`); }
    params.push(q.limit);
    const { rows } = await db.query(
      `SELECT id, actor_id, user_id, action, details, ip, created_at FROM audit_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY id DESC LIMIT $${params.length}`, params);
    return rows;
  });
}
