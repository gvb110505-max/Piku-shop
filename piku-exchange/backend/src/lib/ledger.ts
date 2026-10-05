/** 잔고 변경은 반드시 이 함수를 거친다: 잔고 갱신 + 원장 기록을 같은 트랜잭션에서 수행. */
import type pg from 'pg';
import { big } from '../db/pool.js';

export class InsufficientFunds extends Error {
  constructor(public asset: string) { super(`${asset} 잔고가 부족합니다`); }
}

export class UserError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function adjustBalance(
  c: pg.PoolClient, userId: string, asset: string, dAvail: bigint, dLocked: bigint, reason: string, ref?: string | number | null,
): Promise<void> {
  if (dAvail === 0n && dLocked === 0n) return;
  await c.query('SAVEPOINT adj');
  try {
    // INSERT ... ON CONFLICT는 충돌 처리 전에 '삽입하려는 행'으로 CHECK를 검사하므로
    // 음수 증분이 거부된다. 그래서 UPDATE를 먼저 시도하고, 행이 없을 때만 INSERT 한다.
    const params = [userId, asset, dAvail.toString(), dLocked.toString()];
    const upd = await c.query(
      `UPDATE balances SET available = available + $3, locked = locked + $4, updated_at = now() WHERE user_id = $1 AND asset = $2`, params);
    if (upd.rowCount === 0) {
      const ins = await c.query(
        `INSERT INTO balances (user_id, asset, available, locked) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, asset) DO NOTHING`, params);
      if (ins.rowCount === 0) {
        await c.query(`UPDATE balances SET available = available + $3, locked = locked + $4, updated_at = now() WHERE user_id = $1 AND asset = $2`, params);
      }
    }
    await c.query('RELEASE SAVEPOINT adj');
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT adj');
    if ((e as { code?: string }).code === '23514') throw new InsufficientFunds(asset);
    throw e;
  }
  await c.query(
    'INSERT INTO ledger_entries (user_id, asset, delta_available, delta_locked, reason, ref) VALUES ($1, $2, $3, $4, $5, $6)',
    [userId, asset, dAvail.toString(), dLocked.toString(), reason, ref === undefined || ref === null ? null : String(ref)],
  );
}

export async function getBalance(c: pg.PoolClient | pg.Pool, userId: string, asset: string, forUpdate = false) {
  const { rows } = await c.query<{ available: string; locked: string }>(
    `SELECT available, locked FROM balances WHERE user_id = $1 AND asset = $2${forUpdate ? ' FOR UPDATE' : ''}`, [userId, asset],
  );
  return { available: big(rows[0]?.available), locked: big(rows[0]?.locked) };
}
