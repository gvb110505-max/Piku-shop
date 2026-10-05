/** Stratum(마이닝 풀) 프로세스 진입점. */
import { assertModeSafety, config } from '../config.js';
import { createPool } from '../db/pool.js';
import { createRedis } from '../lib/redis.js';
import { rpc } from '../lib/rpc.js';
import { StratumServer } from './server.js';

/** 블록 보상을 받을 풀 주소의 scriptPubKey. POOL_ADDRESS가 없으면 노드 지갑에서 새로 만들어 저장. */
async function payoutScript(db: ReturnType<typeof createPool>): Promise<string> {
  let address = config.stratum.poolAddress;
  if (!address) {
    const { rows } = await db.query(`SELECT value FROM kv WHERE key = 'pool_address'`);
    address = rows[0]?.value;
    if (!address) {
      address = await rpc<string>('getnewaddress', ['pool']);
      await db.query(`INSERT INTO kv (key, value) VALUES ('pool_address', $1)`, [address]);
    }
  }
  const info = await rpc<{ scriptPubKey: string }>('getaddressinfo', [address]).catch(() => rpc<{ scriptPubKey: string }>('validateaddress', [address]));
  console.log(`[stratum] 풀 지급 주소 ${address}`);
  return info.scriptPubKey;
}

async function main() {
  assertModeSafety();
  const db = createPool();
  const redis = createRedis();
  let script: string | null = null;
  while (!script) {
    try { script = await payoutScript(db); } catch (e) {
      console.error(`[stratum] 노드(${config.rpc.host}:${config.rpc.port}) 연결 대기 중: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  const server = new StratumServer(db, redis, {
    port: config.stratum.port, payoutScript: script, tag: config.stratum.tag,
    initialDifficulty: config.stratum.initialDifficulty, minDifficulty: config.stratum.minDifficulty,
    targetShareSec: config.stratum.targetShareSec, rpc,
  });
  await server.start();
  const stop = async () => { await server.stop(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => { console.error(e); process.exit(1); });
