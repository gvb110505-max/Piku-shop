/**
 * 지갑/풀 백그라운드 작업 (노드 RPC 사용):
 *  - 입금 감지 및 컨펌 처리
 *  - 관리자가 승인한 출금 전송 (sendtoaddress)
 *  - 풀 블록 성숙(100컨펌) 확인 → 채굴 보상 확정 잔고로 전환
 *  - 핫월렛 잔고 vs 사용자 잔고 합계 대사(불일치 시 알림)
 */
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { ASSET, SYSTEM_USERS } from '../config.js';
import { big, withTx } from '../db/pool.js';
import { absBig, fromUnits, toUnits } from '../core/units.js';
import { audit } from '../lib/audit.js';
import { toJson } from '../lib/json.js';
import { adjustBalance } from '../lib/ledger.js';
import { KEYS } from '../lib/redis.js';
import { coinToUnits, unitsToCoin } from '../lib/rpc.js';
import { loadSettings } from '../lib/settings.js';

type Rpc = <T>(method: string, params?: unknown[]) => Promise<T>;

async function alert(db: pg.Pool | pg.PoolClient, kind: string, message: string, details: Record<string, unknown>) {
  // 같은 종류의 미확인 알림이 1시간 안에 있으면 중복 생성하지 않는다
  const dup = await db.query(`SELECT 1 FROM alerts WHERE kind = $1 AND NOT acknowledged AND created_at > now() - interval '1 hour'`, [kind]);
  if (dup.rows[0]) return;
  await db.query('INSERT INTO alerts (kind, message, details) VALUES ($1, $2, $3)', [kind, message, toJson(details)]);
  console.warn(`[alert] ${kind}: ${message}`);
}

async function getKv(db: pg.Pool, key: string) {
  return (await db.query(`SELECT value FROM kv WHERE key = $1`, [key])).rows[0]?.value as string | undefined;
}
async function setKv(db: pg.Pool, key: string, value: string) {
  await db.query(`INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, value]);
}

/** 입금 감지: listsinceblock으로 새 입금을 찾고, 대기 중 입금은 gettransaction으로 컨펌 수를 갱신. */
export async function scanDeposits(db: pg.Pool, rpc: Rpc): Promise<void> {
  const s = await loadSettings(db);
  const last = await getKv(db, 'wallet_last_block');
  const res = await rpc<{ transactions: { category: string; address: string; amount: number; txid: string; vout: number; confirmations: number }[]; lastblock: string }>(
    'listsinceblock', last ? [last, 1, false] : []);
  for (const tx of res.transactions) {
    if (tx.category !== 'receive') continue;
    const owner = await db.query('SELECT user_id FROM deposit_addresses WHERE address = $1', [tx.address]);
    if (!owner.rows[0]) continue;
    const r = await db.query(
      `INSERT INTO deposits (user_id, txid, vout, address, amount, confirmations) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (txid, vout) DO NOTHING RETURNING id`,
      [owner.rows[0].user_id, tx.txid, tx.vout, tx.address, coinToUnits(tx.amount).toString(), Math.max(0, tx.confirmations)]);
    if (r.rows[0]) await audit(db, { action: 'wallet.deposit_detected', userId: owner.rows[0].user_id, details: { txid: tx.txid, vout: tx.vout, amount: tx.amount } });
  }
  await setKv(db, 'wallet_last_block', res.lastblock);

  const pending = await db.query(`SELECT id, txid, user_id, amount FROM deposits WHERE status = 'pending'`);
  for (const d of pending.rows) {
    const tx = await rpc<{ confirmations: number }>('gettransaction', [d.txid]).catch(() => null);
    if (!tx) continue;
    if (tx.confirmations < 0) {
      await db.query(`UPDATE deposits SET status = 'orphaned', confirmations = $2 WHERE id = $1`, [d.id, tx.confirmations]);
      await audit(db, { action: 'wallet.deposit_orphaned', userId: d.user_id, details: { id: d.id, txid: d.txid } });
      continue;
    }
    if (tx.confirmations < s.deposit_confirmations) {
      await db.query('UPDATE deposits SET confirmations = $2 WHERE id = $1', [d.id, tx.confirmations]);
      continue;
    }
    await withTx(db, async (c) => {
      const upd = await c.query(
        `UPDATE deposits SET status = 'credited', confirmations = $2, credited_at = now() WHERE id = $1 AND status = 'pending' RETURNING id`, [d.id, tx.confirmations]);
      if (!upd.rows[0]) return;
      await adjustBalance(c, d.user_id, ASSET.COIN, big(d.amount), 0n, 'deposit', d.id);
      await audit(c, { action: 'wallet.deposit_credited', userId: d.user_id, details: { id: d.id, txid: d.txid, amount: d.amount } });
    });
  }
}

/**
 * 승인된 출금 전송. 'sending'으로 먼저 바꾼 뒤 전송하므로, 전송 도중 프로세스가 죽으면
 * 'sending'에 남아 관리자가 노드에서 직접 확인해야 한다 (이중 전송 방지가 우선).
 */
export async function sendWithdrawals(db: pg.Pool, rpc: Rpc): Promise<void> {
  const stuck = await db.query(`SELECT id FROM withdrawals WHERE status = 'sending' AND updated_at < now() - interval '10 minutes'`);
  if (stuck.rows.length) await alert(db, 'withdrawal_stuck', `전송 확인이 안 된 출금 ${stuck.rows.length}건 (수동 확인 필요)`, { ids: stuck.rows.map((r) => r.id) });

  for (;;) {
    const w = await withTx(db, async (c) => {
      const { rows } = await c.query(`SELECT * FROM withdrawals WHERE status = 'approved' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`);
      if (!rows[0]) return null;
      await c.query(`UPDATE withdrawals SET status = 'sending', updated_at = now() WHERE id = $1`, [rows[0].id]);
      return rows[0];
    });
    if (!w) return;
    const amount = big(w.amount), fee = big(w.fee);
    try {
      const txid = await rpc<string>('sendtoaddress', [w.address, unitsToCoin(amount), `withdrawal:${w.id}`]);
      const tx = await rpc<{ fee?: number }>('gettransaction', [txid]).catch(() => ({ fee: 0 }));
      const networkFee = absBig(coinToUnits(tx.fee ?? 0));
      await withTx(db, async (c) => {
        await c.query(`UPDATE withdrawals SET status = 'sent', txid = $2, updated_at = now() WHERE id = $1`, [w.id, txid]);
        await adjustBalance(c, w.user_id, ASSET.COIN, 0n, -(amount + fee), 'withdraw_sent', w.id);
        // 사용자에게 받은 수수료는 수수료 계정에, 실제 네트워크 수수료는 수수료 계정이 부담
        await adjustBalance(c, SYSTEM_USERS.POOL_FEE, ASSET.COIN, fee - networkFee, 0n, 'withdraw_fee_net', w.id);
        await audit(c, { action: 'wallet.withdraw_sent', userId: w.user_id, details: { id: w.id, txid, amount, fee, networkFee } });
      });
    } catch (e) {
      const msg = (e as Error).message;
      await withTx(db, async (c) => {
        await c.query(`UPDATE withdrawals SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [w.id, msg]);
        await adjustBalance(c, w.user_id, ASSET.COIN, amount + fee, -(amount + fee), 'withdraw_failed', w.id);
        await audit(c, { action: 'wallet.withdraw_failed', userId: w.user_id, details: { id: w.id, error: msg } });
      });
      await alert(db, 'withdrawal_failed', `출금 #${w.id} 전송 실패: ${msg}`, { id: w.id });
    }
  }
}

/** 풀이 찾은 블록의 컨펌 수 확인 → 성숙하면 PPLNS 분배분을 확정 잔고로 전환, 고아 블록이면 취소. */
export async function maturePoolBlocks(db: pg.Pool, rpc: Rpc): Promise<void> {
  const s = await loadSettings(db);
  const { rows } = await db.query(`SELECT hash, height FROM pool_blocks WHERE status = 'immature' ORDER BY height`);
  for (const b of rows) {
    const info = await rpc<{ confirmations: number }>('getblock', [b.hash]).catch(() => null);
    if (!info) continue;
    if (info.confirmations < 0) {
      await withTx(db, async (c) => {
        await c.query(`UPDATE pool_blocks SET status = 'orphaned', confirmations = $2 WHERE hash = $1`, [b.hash, info.confirmations]);
        await c.query(`UPDATE pool_credits SET status = 'orphaned' WHERE block_hash = $1`, [b.hash]);
        await audit(c, { action: 'pool.block_orphaned', details: { hash: b.hash, height: b.height } });
      });
      continue;
    }
    if (info.confirmations < s.pool_maturity_confirmations) {
      await db.query('UPDATE pool_blocks SET confirmations = $2 WHERE hash = $1', [b.hash, info.confirmations]);
      continue;
    }
    await withTx(db, async (c) => {
      const upd = await c.query(`UPDATE pool_blocks SET status = 'confirmed', confirmations = $2 WHERE hash = $1 AND status = 'immature' RETURNING hash`, [b.hash, info.confirmations]);
      if (!upd.rows[0]) return;
      const credits = await c.query(`UPDATE pool_credits SET status = 'confirmed' WHERE block_hash = $1 AND status = 'immature' RETURNING user_id, amount`, [b.hash]);
      for (const cr of credits.rows) {
        await adjustBalance(c, cr.user_id, ASSET.COIN, big(cr.amount), 0n, 'mining_reward', b.hash);
      }
      await audit(c, { action: 'pool.block_matured', details: { hash: b.hash, height: b.height, credits: credits.rows.length } });
    });
  }
}

/**
 * 핫월렛 대사: 노드 지갑 잔고(확정+미확정+미성숙)와 장부상 기대치를 비교.
 * 기대치 = 모든 계정의 PIKU 잔고 + 아직 반영 안 된 입금 + 미성숙 풀 블록 보상
 */
export async function reconcileHotWallet(db: pg.Pool, redis: Redis, rpc: Rpc): Promise<void> {
  const s = await loadSettings(db);
  const b = await rpc<{ mine: { trusted: number; untrusted_pending: number; immature: number } }>('getbalances');
  const node = coinToUnits(b.mine.trusted) + coinToUnits(b.mine.untrusted_pending) + coinToUnits(b.mine.immature);
  const { rows } = await db.query(
    `SELECT
       (SELECT COALESCE(SUM(available + locked), 0) FROM balances WHERE asset = $1) AS ledger,
       (SELECT COALESCE(SUM(amount), 0) FROM deposits WHERE status = 'pending') AS pending_deposits,
       (SELECT COALESCE(SUM(reward), 0) FROM pool_blocks WHERE status = 'immature') AS immature_blocks`, [ASSET.COIN]);
  const ledger = big(rows[0].ledger), pendingDeposits = big(rows[0].pending_deposits), immature = big(rows[0].immature_blocks);
  const expected = ledger + pendingDeposits + immature;
  const diff = node - expected;
  const tolerance = toUnits(s.hotwallet_tolerance);
  const status = {
    node: fromUnits(node), userLiabilities: fromUnits(ledger), pendingDeposits: fromUnits(pendingDeposits),
    immaturePoolRewards: fromUnits(immature), expected: fromUnits(expected), difference: fromUnits(diff),
    ok: absBig(diff) <= tolerance, checkedAt: new Date().toISOString(),
  };
  await redis.set(KEYS.HOTWALLET, JSON.stringify(status));
  if (diff < -tolerance) await alert(db, 'hotwallet_deficit', `노드 잔고가 장부보다 ${fromUnits(-diff)} ${ASSET.COIN} 부족합니다`, status);
  else if (diff > tolerance) await alert(db, 'hotwallet_surplus', `노드 잔고가 장부보다 ${fromUnits(diff)} ${ASSET.COIN} 많습니다 (미확인 입금/외부 송금 확인)`, status);
}
