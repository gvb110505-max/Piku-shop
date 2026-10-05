/** 공개 시세 API: 설정, 마켓, 호가, 체결, 캔들. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config, MARKET } from '../../config.js';
import { fromUnits } from '../../core/units.js';
import { loadSettings } from '../../lib/settings.js';
import { UserError } from '../../lib/ledger.js';
import type { Ctx } from '../context.js';

const INTERVALS: Record<string, string> = { '1m': '1 minute', '5m': '5 minutes', '15m': '15 minutes', '1h': '1 hour', '4h': '4 hours', '1d': '1 day' };

export default async function marketRoutes(app: FastifyInstance, { db, redis }: Ctx) {
  app.get('/api/config', async () => {
    const s = await loadSettings(db);
    return {
      coin: config.coin, quote: config.quote, testMode: !config.realMoney,
      coinStatus: s.coin_status, auctionEndAt: s.auction_end_at,
      markets: { spot: MARKET.SPOT, perp: MARKET.PERP },
      stratum: { host: config.stratum.host, port: config.stratum.port },
      perp: { maxLeverage: s.perp_max_leverage, mmrBps: s.perp_mmr_bps, liqFeeBps: s.perp_liq_fee_bps, fundingIntervalHours: s.perp_funding_interval_hours },
      miningFutures: { buyerMarginBps: s.mf_buyer_margin_bps, sellerMarginBps: s.mf_seller_margin_bps, sellLimitFactorBps: s.mf_sell_limit_factor_bps },
      pool: { feeBps: s.pool_fee_bps, maturity: s.pool_maturity_confirmations },
      wallet: { withdrawFee: s.withdraw_fee, withdrawMin: s.withdraw_min, depositConfirmations: s.deposit_confirmations },
    };
  });

  app.get('/api/markets', async () => {
    const { rows } = await db.query(
      `SELECT m.id, m.kind, m.base, m.quote, m.status, m.paused, m.expiry_at,
         (SELECT price FROM trades t WHERE t.market_id = m.id ORDER BY id DESC LIMIT 1) AS last,
         (SELECT price FROM trades t WHERE t.market_id = m.id AND t.created_at <= now() - interval '24 hours' ORDER BY id DESC LIMIT 1) AS prev24h,
         (SELECT COALESCE(SUM(qty), 0) FROM trades t WHERE t.market_id = m.id AND t.created_at > now() - interval '24 hours') AS volume24h,
         (SELECT COALESCE(SUM(qty), 0) FROM mf_contracts c WHERE c.market_id = m.id AND c.status = 'open') AS open_interest
       FROM markets m ORDER BY m.kind, m.expiry_at NULLS FIRST`);
    return rows.map((r) => ({
      id: r.id, kind: r.kind, base: r.base, quote: r.quote, status: r.status, paused: r.paused, expiryAt: r.expiry_at,
      last: r.last ? fromUnits(BigInt(r.last)) : null,
      change24h: r.last && r.prev24h ? Number(BigInt(r.last) - BigInt(r.prev24h)) / Number(BigInt(r.prev24h)) : null,
      volume24h: fromUnits(BigInt(r.volume24h)),
      openInterest: r.kind === 'mining_future' ? fromUnits(BigInt(r.open_interest)) : null,
    }));
  });

  app.get('/api/markets/:id/orderbook', async (req) => {
    const { id } = req.params as { id: string };
    const raw = await redis.get(`book:${id}`);
    if (!raw) throw new UserError('호가 정보가 없습니다 (엔진이 실행 중인지 확인하세요)', 404);
    return JSON.parse(raw);
  });

  app.get('/api/markets/:id/trades', async (req) => {
    const { id } = req.params as { id: string };
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) }).parse(req.query);
    const { rows } = await db.query(
      'SELECT id, price, qty, taker_side, kind, created_at FROM trades WHERE market_id = $1 ORDER BY id DESC LIMIT $2', [id, limit]);
    return rows.map((r) => ({ id: Number(r.id), price: fromUnits(BigInt(r.price)), qty: fromUnits(BigInt(r.qty)), side: r.taker_side, kind: r.kind, time: r.created_at }));
  });

  /** 캔들: 체결 내역을 date_bin으로 집계 (1분~1일). */
  app.get('/api/markets/:id/candles', async (req) => {
    const { id } = req.params as { id: string };
    const q = z.object({ interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('1m'), limit: z.coerce.number().int().min(1).max(1000).default(300) }).parse(req.query);
    const { rows } = await db.query(
      `WITH b AS (
         SELECT date_bin($2::interval, created_at, TIMESTAMPTZ '2000-01-01') AS bucket, id, price, qty FROM trades
         WHERE market_id = $1 AND created_at > now() - ($2::interval * $3)
       )
       SELECT bucket,
         (array_agg(price ORDER BY id ASC))[1] AS open, MAX(price) AS high, MIN(price) AS low,
         (array_agg(price ORDER BY id DESC))[1] AS close, SUM(qty) AS volume
       FROM b GROUP BY bucket ORDER BY bucket`,
      [id, INTERVALS[q.interval], q.limit]);
    return rows.map((r) => ({
      time: Math.floor(new Date(r.bucket).getTime() / 1000),
      open: fromUnits(BigInt(r.open)), high: fromUnits(BigInt(r.high)), low: fromUnits(BigInt(r.low)),
      close: fromUnits(BigInt(r.close)), volume: fromUnits(BigInt(r.volume)),
    }));
  });

  app.get('/api/perp/mark', async () => JSON.parse((await redis.get('perp:mark')) ?? '{"mark":null}'));
}
