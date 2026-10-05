/** 풀/네트워크 통계 (API와 엔진이 공유). */
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { ASSET, config } from '../config.js';
import { big } from '../db/pool.js';
import { expectedMining, sellLimit } from '../core/miningFutures.js';
import { hashrateFromShares } from '../core/pplns.js';
import { KEYS } from './redis.js';
import type { Settings } from './settings.js';

export interface NetworkInfo {
  height: number;
  difficulty: number;
  networkHashps: number;
  blockReward: string; // 1e-8 단위 정수 문자열
  updatedAt: number;
}

export async function getNetworkInfo(redis: Redis): Promise<NetworkInfo | null> {
  const raw = await redis.get(KEYS.POOL_NETWORK);
  return raw ? (JSON.parse(raw) as NetworkInfo) : null;
}

/** 기간 내 쉐어 난이도 합으로 해시레이트 추정. */
export async function userHashrate(db: pg.Pool | pg.PoolClient, userId: string, seconds: number, worker?: string): Promise<number> {
  const params: unknown[] = [userId, `${seconds} seconds`];
  let sql = `SELECT COALESCE(SUM(difficulty), 0) AS d FROM pool_shares WHERE user_id = $1 AND created_at > now() - $2::interval`;
  if (worker) { sql += ' AND worker = $3'; params.push(worker); }
  const { rows } = await db.query<{ d: number }>(sql, params);
  return hashrateFromShares(Number(rows[0].d), seconds);
}

/** 채굴량 선물 매도 가능 한도 계산에 필요한 값. */
export async function mfSellCapacity(db: pg.Pool | pg.PoolClient, redis: Redis, settings: Settings, userId: string, expiry: Date) {
  // 트랜잭션 클라이언트에서도 쓰이므로 쿼리는 순차 실행
  const bal = await db.query<{ available: string }>('SELECT available FROM balances WHERE user_id = $1 AND asset = $2', [userId, ASSET.COIN]);
  const committed = await db.query<{ c: string; o: string }>(
    `SELECT
       (SELECT COALESCE(SUM(qty), 0) FROM mf_contracts WHERE seller_id = $1 AND status = 'open') AS c,
       (SELECT COALESCE(SUM(o.remaining), 0) FROM orders o JOIN markets m ON m.id = o.market_id
         WHERE o.user_id = $1 AND o.status = 'open' AND o.side = 'sell' AND m.kind = 'mining_future') AS o`, [userId]);
  const net = await getNetworkInfo(redis);
  const hash7d = await userHashrate(db, userId, 7 * 86400);
  const confirmed = big(bal.rows[0]?.available);
  const committedQty = big(committed.rows[0].c) + big(committed.rows[0].o);
  const expected = net
    ? expectedMining({
        userHashrate: hash7d,
        networkHashrate: net.networkHashps,
        blockReward: BigInt(net.blockReward),
        blockTimeSec: config.coin.blockTimeSec,
        seconds: Math.max(0, (expiry.getTime() - Date.now()) / 1000),
        poolFeeBps: BigInt(settings.pool_fee_bps),
      })
    : 0n;
  const limit = sellLimit(confirmed, expected, BigInt(settings.mf_sell_limit_factor_bps), committedQty);
  return { confirmed, expected, committed: committedQty, limit, hashrate7d: hash7d };
}

/** 현물 매도/출금 시 채굴량 선물 인도 의무만큼은 묶어 둔다. */
export async function deliveryObligation(db: pg.Pool | pg.PoolClient, userId: string): Promise<bigint> {
  const { rows } = await db.query<{ q: string }>(
    `SELECT COALESCE(SUM(qty), 0) AS q FROM mf_contracts WHERE seller_id = $1 AND status = 'open'`, [userId]);
  return big(rows[0].q);
}
