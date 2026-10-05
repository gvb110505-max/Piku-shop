/** 주문 / 포지션 / 계약 / 잔고 API. 상태 변경은 모두 매칭 엔진으로 보낸다. */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ASSET, config, MARKET, SYSTEM_USERS } from '../../config.js';
import { big } from '../../db/pool.js';
import { liquidationPrice, maintenanceMargin, unrealizedPnl, type Position } from '../../core/perp.js';
import { fromUnits, toUnits } from '../../core/units.js';
import { audit } from '../../lib/audit.js';
import { adjustBalance, UserError } from '../../lib/ledger.js';
import { deliveryObligation, mfSellCapacity } from '../../lib/poolStats.js';
import { loadSettings } from '../../lib/settings.js';
import { withTx } from '../../db/pool.js';
import { ip, requireUser, type Ctx } from '../context.js';

const orderSchema = z.object({
  marketId: z.string(),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['limit', 'market']),
  price: z.string().optional(),
  qty: z.string().optional(),
  quoteAmount: z.string().optional(),
  leverage: z.number().int().optional(),
  marginMode: z.enum(['isolated', 'cross']).optional(),
  reduceOnly: z.boolean().optional(),
});

const f = (v: string | null) => (v === null ? null : fromUnits(BigInt(v)));

export default async function tradingRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, redis, engine } = ctx;

  app.get('/api/balances', async (req) => {
    const me = await requireUser(req);
    const [bal, immature, obligation] = await Promise.all([
      db.query('SELECT asset, available, locked FROM balances WHERE user_id = $1 ORDER BY asset', [me.id]),
      db.query(`SELECT COALESCE(SUM(amount), 0) AS a FROM pool_credits WHERE user_id = $1 AND status = 'immature'`, [me.id]),
      deliveryObligation(db, me.id),
    ]);
    const map = new Map(bal.rows.map((r) => [r.asset, r]));
    return [ASSET.COIN, ASSET.QUOTE].map((asset) => ({
      asset,
      available: fromUnits(big(map.get(asset)?.available)),
      locked: fromUnits(big(map.get(asset)?.locked)),
      ...(asset === ASSET.COIN ? { immatureMining: fromUnits(big(immature.rows[0].a)), deliveryObligation: fromUnits(obligation) } : {}),
      virtual: asset === ASSET.QUOTE && !config.realMoney,
    }));
  });

  /** 테스트 모드 전용: 가상 KRW 충전. */
  app.post('/api/faucet', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
    if (config.realMoney) throw new UserError('실자금 모드에서는 사용할 수 없습니다', 403);
    const me = await requireUser(req);
    await withTx(db, async (c) => {
      await adjustBalance(c, me.id, ASSET.QUOTE, toUnits('10000000'), 0n, 'test_faucet');
      await audit(c, { action: 'wallet.faucet', userId: me.id, ip: ip(req), details: { amount: '10000000' } });
    });
    return { ok: true, amount: '10000000' };
  });

  app.post('/api/orders', { config: { rateLimit: { max: 60, timeWindow: '10 seconds' } } }, async (req) => {
    const me = await requireUser(req);
    const body = orderSchema.parse(req.body);
    return engine.send('place_order', { ...body, orderId: randomUUID(), userId: me.id }, { actorId: me.id, ip: ip(req) });
  });

  app.delete('/api/orders/:id', async (req) => {
    const me = await requireUser(req);
    const { id } = req.params as { id: string };
    return engine.send('cancel_order', { userId: me.id, orderId: id }, { actorId: me.id, ip: ip(req) });
  });

  app.delete('/api/orders', async (req) => {
    const me = await requireUser(req);
    const { marketId } = z.object({ marketId: z.string().optional() }).parse(req.query);
    return engine.send('cancel_all', { userId: me.id, marketId }, { actorId: me.id, ip: ip(req) });
  });

  app.get('/api/orders', async (req) => {
    const me = await requireUser(req);
    const q = z.object({ marketId: z.string().optional(), status: z.enum(['open', 'history']).default('open') }).parse(req.query);
    const params: unknown[] = [me.id];
    let where = 'user_id = $1';
    if (q.marketId) { params.push(q.marketId); where += ` AND market_id = $${params.length}`; }
    where += q.status === 'open' ? ` AND status = 'open'` : ` AND status <> 'open'`;
    const { rows } = await db.query(
      `SELECT id, market_id, side, type, price, qty, quote_budget, remaining, filled_qty, quote_filled, status, cancel_reason,
         leverage, margin_mode, reduce_only, created_at FROM orders WHERE ${where} ORDER BY seq DESC LIMIT 200`, params);
    return rows.map((r) => ({
      id: r.id, marketId: r.market_id, side: r.side, type: r.type, price: f(r.price), qty: f(r.qty), quoteAmount: f(r.quote_budget),
      remaining: f(r.remaining), filledQty: f(r.filled_qty), quoteFilled: f(r.quote_filled), status: r.status,
      cancelReason: r.cancel_reason, leverage: r.leverage, marginMode: r.margin_mode, reduceOnly: r.reduce_only, createdAt: r.created_at,
      avgPrice: BigInt(r.filled_qty) > 0n ? fromUnits((BigInt(r.quote_filled) * 100_000_000n) / BigInt(r.filled_qty)) : null,
    }));
  });

  app.get('/api/trades/mine', async (req) => {
    const me = await requireUser(req);
    const { marketId } = z.object({ marketId: z.string().optional() }).parse(req.query);
    const { rows } = await db.query(
      `SELECT id, market_id, price, qty, taker_side, maker_user_id, taker_user_id, kind, created_at FROM trades
       WHERE (maker_user_id = $1 OR taker_user_id = $1) ${marketId ? 'AND market_id = $2' : ''} ORDER BY id DESC LIMIT 200`,
      marketId ? [me.id, marketId] : [me.id]);
    return rows.map((r) => ({
      id: Number(r.id), marketId: r.market_id, price: f(r.price), qty: f(r.qty), kind: r.kind, time: r.created_at,
      side: r.taker_user_id === me.id ? r.taker_side : r.taker_side === 'buy' ? 'sell' : 'buy',
      role: r.taker_user_id === me.id ? 'taker' : 'maker',
    }));
  });

  // ---------- 무기한 선물 ----------
  app.get('/api/perp/positions', async (req) => {
    const me = await requireUser(req);
    const s = await loadSettings(db);
    const mark = JSON.parse((await redis.get('perp:mark')) ?? '{}').mark as string | null;
    const markU = mark ? toUnits(mark) : null;
    const { rows } = await db.query(
      `SELECT market_id, qty, entry_price, margin, leverage, margin_mode, realized_pnl FROM positions WHERE user_id = $1 AND market_id = $2`,
      [me.id, MARKET.PERP]);
    const bal = await db.query(`SELECT available FROM balances WHERE user_id = $1 AND asset = $2`, [me.id, ASSET.QUOTE]);
    const available = big(bal.rows[0]?.available);
    return rows.map((r) => {
      const pos: Position = { qty: big(r.qty), entryPrice: big(r.entry_price), margin: big(r.margin), leverage: r.leverage, mode: r.margin_mode };
      const mmr = BigInt(s.perp_mmr_bps);
      const upnl = markU ? unrealizedPnl(pos, markU) : 0n;
      return {
        marketId: r.market_id, side: pos.qty > 0n ? 'long' : pos.qty < 0n ? 'short' : 'flat',
        qty: fromUnits(pos.qty), entryPrice: fromUnits(pos.entryPrice), margin: fromUnits(pos.margin),
        leverage: pos.leverage, marginMode: pos.mode, markPrice: mark,
        unrealizedPnl: fromUnits(upnl),
        roe: pos.margin > 0n ? Number((upnl * 10000n) / pos.margin) / 100 : 0,
        maintenanceMargin: markU ? fromUnits(maintenanceMargin(pos, markU, mmr)) : null,
        // 교차 마진은 가용잔고까지 담보로 계산
        liquidationPrice: pos.qty === 0n ? null : fromUnits(liquidationPrice(pos, mmr, pos.mode === 'cross' ? available : 0n)),
        realizedPnl: fromUnits(big(r.realized_pnl)),
      };
    });
  });

  app.get('/api/perp/funding', async (req) => {
    const me = await requireUser(req);
    const { rows } = await db.query(
      `SELECT e.funding_time, e.rate_ppm, e.mark_price, p.amount FROM funding_events e
       LEFT JOIN funding_payments p ON p.funding_event_id = e.id AND p.user_id = $1
       ORDER BY e.funding_time DESC LIMIT 50`, [me.id]);
    return rows.map((r) => ({ time: r.funding_time, rate: Number(r.rate_ppm) / 1e6, mark: f(r.mark_price), payment: f(r.amount) }));
  });

  app.get('/api/insurance', async () => {
    const [bal, pos] = await Promise.all([
      db.query('SELECT available FROM balances WHERE user_id = $1 AND asset = $2', [SYSTEM_USERS.INSURANCE, ASSET.QUOTE]),
      db.query('SELECT qty, entry_price FROM positions WHERE user_id = $1 AND market_id = $2', [SYSTEM_USERS.INSURANCE, MARKET.PERP]),
    ]);
    return { balance: fromUnits(big(bal.rows[0]?.available)), position: pos.rows[0] ? { qty: f(pos.rows[0].qty), entryPrice: f(pos.rows[0].entry_price) } : null };
  });

  // ---------- 채굴량 선물 ----------
  app.get('/api/mf/capacity', async (req) => {
    const me = await requireUser(req);
    const { marketId } = z.object({ marketId: z.string() }).parse(req.query);
    const m = await db.query(`SELECT expiry_at FROM markets WHERE id = $1 AND kind = 'mining_future'`, [marketId]);
    if (!m.rows[0]) throw new UserError('월물을 찾을 수 없습니다', 404);
    const s = await loadSettings(db);
    const cap = await mfSellCapacity(db, redis, s, me.id, m.rows[0].expiry_at);
    return {
      confirmed: fromUnits(cap.confirmed), expectedMining: fromUnits(cap.expected), committed: fromUnits(cap.committed),
      factor: s.mf_sell_limit_factor_bps / 10000, sellLimit: fromUnits(cap.limit), hashrate7d: cap.hashrate7d,
    };
  });

  app.get('/api/mf/contracts', async (req) => {
    const me = await requireUser(req);
    const { rows } = await db.query(
      `SELECT c.*, m.expiry_at FROM mf_contracts c JOIN markets m ON m.id = c.market_id
       WHERE c.buyer_id = $1 OR c.seller_id = $1 ORDER BY c.id DESC LIMIT 200`, [me.id]);
    return rows.map((r) => ({
      id: Number(r.id), marketId: r.market_id, expiryAt: r.expiry_at, role: r.buyer_id === me.id ? 'buyer' : 'seller',
      qty: f(r.qty), price: f(r.price), margin: f(r.buyer_id === me.id ? r.buyer_margin : r.seller_margin),
      status: r.status, deliveredQty: f(r.delivered_qty), paid: f(r.paid), forfeited: f(r.forfeited), settledAt: r.settled_at,
    }));
  });

  app.get('/api/ledger', async (req) => {
    const me = await requireUser(req);
    const { rows } = await db.query(
      'SELECT asset, delta_available, delta_locked, reason, ref, created_at FROM ledger_entries WHERE user_id = $1 ORDER BY id DESC LIMIT 200', [me.id]);
    return rows.map((r) => ({ asset: r.asset, available: f(r.delta_available), locked: f(r.delta_locked), reason: r.reason, ref: r.ref, time: r.created_at }));
  });

  app.get('/api/audit/mine', async (req) => {
    const me = await requireUser(req);
    const { rows } = await db.query('SELECT action, details, ip, created_at FROM audit_logs WHERE user_id = $1 ORDER BY id DESC LIMIT 100', [me.id]);
    return rows;
  });
}
