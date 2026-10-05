/** 마이닝 풀 대시보드 API. */
import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { big } from '../../db/pool.js';
import { BPS, fromUnits } from '../../core/units.js';
import { getNetworkInfo, userHashrate } from '../../lib/poolStats.js';
import { KEYS } from '../../lib/redis.js';
import { loadSettings } from '../../lib/settings.js';
import { hashrateFromShares } from '../../core/pplns.js';
import { requireUser, type Ctx } from '../context.js';

export default async function poolRoutes(app: FastifyInstance, { db, redis }: Ctx) {
  app.get('/api/pool/stats', async () => {
    const [net, pool, blocks, miners] = await Promise.all([
      getNetworkInfo(redis),
      db.query(`SELECT COALESCE(SUM(difficulty), 0) AS d FROM pool_shares WHERE created_at > now() - interval '10 minutes'`),
      db.query('SELECT hash, height, reward, status, confirmations, created_at FROM pool_blocks ORDER BY created_at DESC LIMIT 20'),
      db.query(`SELECT COUNT(DISTINCT user_id) AS n FROM pool_shares WHERE created_at > now() - interval '10 minutes'`),
    ]);
    return {
      network: net,
      poolHashrate: hashrateFromShares(Number(pool.rows[0].d), 600),
      activeMiners: Number(miners.rows[0].n),
      blocks: blocks.rows.map((b) => ({ ...b, reward: fromUnits(BigInt(b.reward)) })),
    };
  });

  app.get('/api/pool/me', async (req) => {
    const me = await requireUser(req);
    const s = await loadSettings(db);
    const [net, h10m, h1h, h24h, totals, credits, workersRaw] = await Promise.all([
      getNetworkInfo(redis),
      userHashrate(db, me.id, 600), userHashrate(db, me.id, 3600), userHashrate(db, me.id, 86400),
      db.query(`SELECT status, COALESCE(SUM(amount), 0) AS a FROM pool_credits WHERE user_id = $1 GROUP BY status`, [me.id]),
      db.query(`SELECT c.block_hash, c.amount, c.status, b.height, b.confirmations, b.created_at FROM pool_credits c
                JOIN pool_blocks b ON b.hash = c.block_hash WHERE c.user_id = $1 ORDER BY b.created_at DESC LIMIT 30`, [me.id]),
      db.query(`SELECT worker, SUM(difficulty) FILTER (WHERE created_at > now() - interval '10 minutes') AS d10, MAX(created_at) AS last
                FROM pool_shares WHERE user_id = $1 AND created_at > now() - interval '24 hours' GROUP BY worker ORDER BY worker`, [me.id]),
    ]);
    const live = await redis.hgetall(KEYS.POOL_WORKERS);
    const byStatus = Object.fromEntries(totals.rows.map((r) => [r.status, big(r.a)]));
    // 예상 일일 채굴량 = (내 해시레이트 / 네트워크 해시레이트) × 하루 블록 수 × 블록 보상 × (1 − 풀 수수료)
    let estimatedDaily = 0n;
    if (net && net.networkHashps > 0) {
      const blocksPerDay = 86400 / config.coin.blockTimeSec;
      const reward = (BigInt(net.blockReward) * (BPS - BigInt(s.pool_fee_bps))) / BPS;
      estimatedDaily = BigInt(Math.floor(Number(reward) * blocksPerDay * Math.min(1, h1h / net.networkHashps)));
    }
    return {
      hashrate: { m10: h10m, h1: h1h, h24: h24h },
      workers: workersRaw.rows.map((w) => {
        const liveInfo = live[`${me.id}:${w.worker}`] ? JSON.parse(live[`${me.id}:${w.worker}`]) : null;
        const last = new Date(w.last).getTime();
        return {
          name: w.worker, hashrate: hashrateFromShares(Number(w.d10 ?? 0), 600), lastShareAt: w.last,
          online: Date.now() - last < 5 * 60_000, difficulty: liveInfo?.difficulty ?? null,
          accepted: liveInfo?.accepted ?? null, rejected: liveInfo?.rejected ?? null,
        };
      }),
      estimatedDaily: fromUnits(estimatedDaily),
      totalMined: fromUnits(byStatus.confirmed ?? 0n),
      immature: fromUnits(byStatus.immature ?? 0n),
      network: net,
      feeBps: s.pool_fee_bps,
      maturity: s.pool_maturity_confirmations,
      credits: credits.rows.map((r) => ({ blockHash: r.block_hash, height: r.height, amount: fromUnits(BigInt(r.amount)), status: r.status, confirmations: r.confirmations, time: r.created_at })),
    };
  });
}
