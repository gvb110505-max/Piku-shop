/** 백그라운드 워커 진입점: 입출금, 풀 보상 성숙, 핫월렛 대사. */
import { assertModeSafety } from '../config.js';
import { createPool } from '../db/pool.js';
import { createRedis } from '../lib/redis.js';
import { rpc } from '../lib/rpc.js';
import { maturePoolBlocks, reconcileHotWallet, scanDeposits, sendWithdrawals } from './wallet.js';

function loop(name: string, everyMs: number, fn: () => Promise<void>) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await fn(); } catch (e) { console.error(`[worker:${name}] ${(e as Error).message}`); } finally { running = false; }
  };
  tick();
  return setInterval(tick, everyMs);
}

async function main() {
  assertModeSafety();
  const db = createPool();
  const redis = createRedis();
  const timers = [
    loop('deposits', 15_000, () => scanDeposits(db, rpc)),
    loop('withdrawals', 10_000, () => sendWithdrawals(db, rpc)),
    loop('pool-maturity', 60_000, () => maturePoolBlocks(db, rpc)),
    loop('hot-wallet', 60_000, () => reconcileHotWallet(db, redis, rpc)),
  ];
  console.log('[worker] 시작');
  const stop = () => { timers.forEach(clearInterval); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => { console.error(e); process.exit(1); });
