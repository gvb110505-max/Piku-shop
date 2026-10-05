/** 입금 주소 발급, 입출금 내역, 출금 요청 (2FA 필수 → 관리자 승인 큐). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ASSET, config } from '../../config.js';
import { big, withTx } from '../../db/pool.js';
import { fromUnits, toUnits } from '../../core/units.js';
import { audit } from '../../lib/audit.js';
import { adjustBalance, getBalance, UserError } from '../../lib/ledger.js';
import { deliveryObligation } from '../../lib/poolStats.js';
import { rpc } from '../../lib/rpc.js';
import { loadSettings } from '../../lib/settings.js';
import { checkTotp, ip, requireUser, type Ctx } from '../context.js';

const f = (v: string | null) => (v === null ? null : fromUnits(BigInt(v)));

export default async function walletRoutes(app: FastifyInstance, { db }: Ctx) {
  app.get('/api/wallet/address', async (req) => {
    const me = await requireUser(req);
    const existing = await db.query('SELECT address FROM deposit_addresses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [me.id]);
    if (existing.rows[0]) return { address: existing.rows[0].address };
    let address: string;
    try {
      address = await rpc<string>('getnewaddress', [`user:${me.id}`]);
    } catch (e) {
      throw new UserError(`코인 노드에 연결할 수 없습니다: ${(e as Error).message}`, 503);
    }
    await db.query('INSERT INTO deposit_addresses (address, user_id) VALUES ($1, $2)', [address, me.id]);
    await audit(db, { action: 'wallet.address_created', userId: me.id, ip: ip(req), details: { address } });
    return { address };
  });

  app.get('/api/wallet/deposits', async (req) => {
    const me = await requireUser(req);
    const { rows } = await db.query('SELECT * FROM deposits WHERE user_id = $1 ORDER BY id DESC LIMIT 100', [me.id]);
    return rows.map((r) => ({ id: Number(r.id), txid: r.txid, address: r.address, amount: f(r.amount), confirmations: r.confirmations, status: r.status, time: r.created_at }));
  });

  app.get('/api/wallet/withdrawals', async (req) => {
    const me = await requireUser(req);
    const { rows } = await db.query('SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY id DESC LIMIT 100', [me.id]);
    return rows.map((r) => ({ id: Number(r.id), address: r.address, amount: f(r.amount), fee: f(r.fee), status: r.status, txid: r.txid, note: r.review_note, time: r.created_at }));
  });

  app.post('/api/wallet/withdrawals', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const me = await requireUser(req);
    const body = z.object({ address: z.string().min(10).max(120), amount: z.string(), totp: z.string() }).parse(req.body);
    await checkTotp(db, me.id, body.totp, true); // 출금 시 2FA 필수
    const s = await loadSettings(db);
    const amount = toUnits(body.amount);
    const fee = toUnits(s.withdraw_fee);
    if (amount < toUnits(s.withdraw_min)) throw new UserError(`최소 출금 수량은 ${s.withdraw_min} ${ASSET.COIN} 입니다`);
    const u = await db.query('SELECT kyc_status, email_verified, trading_banned FROM users WHERE id = $1', [me.id]);
    if (!u.rows[0].email_verified) throw new UserError('이메일 인증이 필요합니다', 403);
    if (config.realMoney && u.rows[0].kyc_status !== 'approved') throw new UserError('KYC 인증 후 출금할 수 있습니다', 403);

    let valid = false;
    try { valid = (await rpc<{ isvalid: boolean }>('validateaddress', [body.address])).isvalid; } catch (e) {
      throw new UserError(`코인 노드에 연결할 수 없습니다: ${(e as Error).message}`, 503);
    }
    if (!valid) throw new UserError('올바르지 않은 주소입니다');

    const id = await withTx(db, async (c) => {
      const bal = await getBalance(c, me.id, ASSET.COIN, true);
      const obligation = await deliveryObligation(c, me.id);
      if (bal.available - obligation < amount + fee) {
        throw new UserError(`출금 가능 수량 부족 (가용 ${fromUnits(bal.available)}, 선물 인도 예정 ${fromUnits(obligation)}, 수수료 ${fromUnits(fee)})`);
      }
      const { rows } = await c.query(
        `INSERT INTO withdrawals (user_id, address, amount, fee, status) VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
        [me.id, body.address, amount.toString(), fee.toString()]);
      await adjustBalance(c, me.id, ASSET.COIN, -(amount + fee), amount + fee, 'withdraw_lock', rows[0].id);
      await audit(c, { action: 'wallet.withdraw_request', userId: me.id, ip: ip(req), details: { id: rows[0].id, address: body.address, amount, fee } });
      return Number(rows[0].id);
    });
    return { id, status: 'pending', message: '관리자 승인 후 전송됩니다' };
  });

  app.post('/api/wallet/withdrawals/:id/cancel', async (req) => {
    const me = await requireUser(req);
    const { id } = req.params as { id: string };
    await withTx(db, async (c) => {
      const { rows } = await c.query(`SELECT * FROM withdrawals WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, me.id]);
      if (!rows[0] || rows[0].status !== 'pending') throw new UserError('취소할 수 없는 출금입니다');
      const total = big(rows[0].amount) + big(rows[0].fee);
      await adjustBalance(c, me.id, ASSET.COIN, total, -total, 'withdraw_cancel', id);
      await c.query(`UPDATE withdrawals SET status = 'rejected', review_note = '사용자 취소', updated_at = now() WHERE id = $1`, [id]);
      await audit(c, { action: 'wallet.withdraw_cancel', userId: me.id, ip: ip(req), details: { id } });
    });
    return { ok: true };
  });
}
