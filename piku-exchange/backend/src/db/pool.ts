import pg from 'pg';
import { config } from '../config.js';

// NUMERIC/BIGINT은 문자열로 받아 정밀도 손실 없이 BigInt로 변환한다.
pg.types.setTypeParser(1700, (v) => v);
pg.types.setTypeParser(20, (v) => v);

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(): pg.Pool {
  return new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
}

/** 트랜잭션 실행. 예외 시 롤백. */
export async function withTx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export const big = (v: string | null | undefined): bigint => (v === null || v === undefined ? 0n : BigInt(v));
