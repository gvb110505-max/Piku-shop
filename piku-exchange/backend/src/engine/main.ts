/**
 * 매칭 엔진 프로세스 진입점.
 * Redis 스트림(engine:commands)을 컨슈머 그룹으로 읽어 명령을 하나씩 처리하고,
 * 결과를 요청한 API 인스턴스의 응답 채널로 보낸다.
 * 반드시 1개 인스턴스만 실행해야 순서가 보장된다 (Redis 락으로 강제).
 */
import { hostname } from 'node:os';
import { assertModeSafety } from '../config.js';
import { createPool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { toJson } from '../lib/json.js';
import { createRedis, KEYS } from '../lib/redis.js';
import { Engine, type Command } from './engine.js';

const LOCK_KEY = 'engine:leader';
const CONSUMER = `${hostname()}-${process.pid}`;

async function main() {
  assertModeSafety();
  const db = createPool();
  await migrate(db);
  const redis = createRedis();
  const pub = createRedis();

  // 단일 인스턴스 보장
  const got = await redis.set(LOCK_KEY, CONSUMER, 'EX', 15, 'NX');
  if (!got) throw new Error('다른 엔진 인스턴스가 실행 중입니다 (engine:leader)');
  const lockTimer = setInterval(async () => {
    // 내가 주인이면 연장, 비어 있으면 다시 획득, 다른 인스턴스가 잡았으면 즉시 종료 (이중 엔진 방지)
    const owner = await redis.get(LOCK_KEY);
    if (owner === CONSUMER) await redis.expire(LOCK_KEY, 15);
    else if (owner === null && (await redis.set(LOCK_KEY, CONSUMER, 'EX', 15, 'NX'))) return;
    else { console.error(`[engine] 다른 엔진(${owner})이 리더 락을 가졌습니다. 종료합니다.`); process.exit(1); }
  }, 5000);

  await redis.xgroup('CREATE', KEYS.ENGINE_STREAM, KEYS.ENGINE_GROUP, '0', 'MKSTREAM').catch((e: Error) => {
    if (!/BUSYGROUP/.test(e.message)) throw e;
  });

  const engine = new Engine(db, pub);
  await engine.init();
  const timers = engine.startTimers();
  console.log(`[engine] 시작 (consumer=${CONSUMER})`);

  const handle = async (id: string, fields: string[]) => {
    const raw = fields[fields.indexOf('data') + 1];
    let cmd: Command & { replyTo?: string };
    try { cmd = JSON.parse(raw); } catch { await redis.xack(KEYS.ENGINE_STREAM, KEYS.ENGINE_GROUP, id); return; }
    const res = await engine.execute(cmd);
    if (cmd.replyTo) await pub.publish(cmd.replyTo, toJson({ cmdId: cmd.cmdId, ...res }));
    await redis.xack(KEYS.ENGINE_STREAM, KEYS.ENGINE_GROUP, id);
  };

  // 1) 이전에 받았지만 처리 확인(ACK)하지 못한 명령부터 처리 (주문 ID로 멱등)
  let pending = true;
  let stopping = false;
  const shutdown = async () => {
    stopping = true;
    timers.forEach(clearInterval);
    clearInterval(lockTimer);
    await engine.serial(async () => {});
    // 내 락일 때만 삭제 (이미 새 인스턴스가 잡은 락을 지우지 않도록 비교 후 삭제)
    await redis.eval(`if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`, 1, LOCK_KEY, CONSUMER);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  while (!stopping) {
    const res = (await redis.xreadgroup(
      'GROUP', KEYS.ENGINE_GROUP, CONSUMER, 'COUNT', 50, 'BLOCK', pending ? 1 : 5000,
      'STREAMS', KEYS.ENGINE_STREAM, pending ? '0' : '>',
    )) as [string, [string, string[]][]][] | null;
    const entries = res?.[0]?.[1] ?? [];
    if (pending && entries.length === 0) { pending = false; continue; }
    for (const [id, fields] of entries) await handle(id, fields);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
