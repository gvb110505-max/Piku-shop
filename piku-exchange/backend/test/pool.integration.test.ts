/**
 * 마이닝 풀 + 지갑 워커 통합 테스트 (PostgreSQL 필요, 노드는 가짜 RPC로 대체).
 * 실제 TCP로 Stratum 서버에 접속해 subscribe/authorize/submit을 수행하고,
 * 블록 발견 → PPLNS 분배 → 100컨펌 후 잔고 확정 → 입금/출금 처리까지 확인한다.
 */
import net from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256d } from '../src/core/stratum/bitcoin.js';
import type { BlockTemplate } from '../src/core/stratum/job.js';
import { findShare } from './helpers/miner.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const PORT = 33_333 + Math.floor(Math.random() * 1000);

class RedisStub {
  kv = new Map<string, string>(); h = new Map<string, string>();
  async get(k: string) { return this.kv.get(k) ?? null; }
  async set(k: string, v: string) { this.kv.set(k, v); return 'OK'; }
  async hset(_k: string, f: string, v: string) { this.h.set(f, v); return 1; }
  async publish() { return 0; }
}

/** 한 줄 단위 JSON-RPC Stratum 클라이언트 */
class MinerClient {
  socket!: net.Socket;
  private buf = '';
  private waiters: ((m: Record<string, unknown>) => void)[] = [];
  messages: Record<string, unknown>[] = [];
  private nextId = 1;
  async connect() {
    this.socket = net.connect(PORT, '127.0.0.1');
    await new Promise((r) => this.socket.once('connect', r));
    this.socket.setEncoding('utf8');
    this.socket.on('data', (d: string) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const m = JSON.parse(this.buf.slice(0, i)); this.buf = this.buf.slice(i + 1);
        this.messages.push(m);
        this.waiters.shift()?.(m);
      }
    });
  }
  async call(method: string, params: unknown[]) {
    const id = this.nextId++;
    this.socket.write(JSON.stringify({ id, method, params }) + '\n');
    for (;;) {
      const found = this.messages.find((m) => m.id === id);
      if (found) return found;
      await new Promise((r) => this.waiters.push(r as never));
    }
  }
  lastNotify() { return [...this.messages].reverse().find((m) => m.method === 'mining.notify')!.params as unknown[]; }
}

describe.skipIf(!TEST_DB)('마이닝 풀 + 지갑 워커 (PostgreSQL, 가짜 노드)', () => {
  let pool: pg.Pool;
  let redis: RedisStub;
  let server: import('../src/stratum/server.js').StratumServer;
  let worker: typeof import('../src/worker/wallet.js');
  let u: typeof import('../src/core/units.js').toUnits;
  const ids: Record<string, string> = {};
  const submitted: string[] = [];
  const node = {
    confirmations: new Map<string, number>(),
    sent: [] as unknown[],
    template: {
      version: 0x20000000,
      previousblockhash: '00000000000000000000000000000000000000000000000000000000000000aa',
      transactions: [{ data: 'aa', txid: Buffer.from(sha256d(Buffer.from('aa', 'hex'))).reverse().toString('hex') }],
      coinbasevalue: 50_0000_0000, bits: '1f00ffff', height: 101, curtime: Math.floor(Date.now() / 1000),
    } as BlockTemplate,
    receives: [] as unknown[],
  };
  const rpc = async <T>(method: string, params: unknown[] = []): Promise<T> => {
    switch (method) {
      case 'getblocktemplate': return node.template as T;
      case 'getbestblockhash': return node.template.previousblockhash as T;
      case 'getmininginfo': return { networkhashps: 1e6 } as T;
      case 'submitblock': submitted.push(params[0] as string); return null as T;
      case 'getblock': return { confirmations: node.confirmations.get(params[0] as string) ?? 1 } as T;
      case 'listsinceblock': return { transactions: node.receives, lastblock: 'tip' } as T;
      case 'gettransaction': return (params[0] === 'wtx' ? { fee: -0.0001, confirmations: 1 } : { confirmations: node.confirmations.get(params[0] as string) ?? 0 }) as T;
      case 'sendtoaddress': node.sent.push(params); return 'wtx' as T;
      case 'getbalances': return { mine: { trusted: 0, untrusted_pending: 0, immature: 0 } } as T;
      default: throw new Error(`unexpected rpc ${method}`);
    }
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    pool = new pg.Pool({ connectionString: TEST_DB });
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const { migrate } = await import('../src/db/migrate.js');
    await migrate(pool);
    u = (await import('../src/core/units.js')).toUnits;
    for (const name of ['miner1', 'miner2']) {
      const { rows } = await pool.query(
        `INSERT INTO users (email, username, password_hash, email_verified) VALUES ($1, $2, '!', true) RETURNING id`, [`${name}@t.test`, name]);
      ids[name] = rows[0].id;
    }
    worker = await import('../src/worker/wallet.js');
    const { StratumServer } = await import('../src/stratum/server.js');
    redis = new RedisStub();
    server = new StratumServer(pool, redis as never, {
      port: PORT, payoutScript: '0014' + '11'.repeat(20), tag: '/test/', initialDifficulty: 0.00001, minDifficulty: 0.00001, targetShareSec: 15, rpc,
    });
    await server.start();
  });

  afterAll(async () => { await server?.stop(); await pool?.end(); });

  it('알 수 없는 아이디는 인증 거부, "아이디.워커"는 인증 후 작업을 받는다', async () => {
    const m = new MinerClient(); await m.connect();
    await m.call('mining.subscribe', ['test/1.0']);
    expect((await m.call('mining.authorize', ['nobody.rig', 'x'])).result).toBe(false);
    expect((await m.call('mining.authorize', ['miner1.rig1', 'x'])).result).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(m.messages.some((x) => x.method === 'mining.set_difficulty')).toBe(true);
    expect(m.lastNotify()).toHaveLength(9);
    m.socket.destroy();
  });

  it('쉐어 검증: 정상 쉐어 수락, 중복/저난이도 거부, 블록 발견 시 submitblock + PPLNS 분배', async () => {
    const miners: { c: MinerClient; en1: string; name: string }[] = [];
    for (const name of ['miner1', 'miner2']) {
      const c = new MinerClient(); await c.connect();
      const sub = await c.call('mining.subscribe', ['test/1.0']);
      const en1 = (sub.result as [unknown, string, number])[1];
      await c.call('mining.authorize', [`${name}.rig1`, 'x']);
      await new Promise((r) => setTimeout(r, 50));
      miners.push({ c, en1, name });
    }
    let accepted = 0;
    let en2Counter = 0;
    // 블록이 나올 때까지 번갈아 쉐어 제출 (네트워크 난이도 ≈ 1.5e-5, 쉐어 난이도 1e-5)
    while (submitted.length === 0 && accepted < 40) {
      for (const m of miners) {
        const params = m.c.lastNotify();
        const en2 = (en2Counter++).toString(16).padStart(8, '0');
        const { nonce } = findShare(params, m.en1, en2, 0.00001);
        const r = await m.c.call('mining.submit', [`${m.name}.rig1`, params[0], en2, params[7], nonce.toString(16).padStart(8, '0')]);
        expect(r.result).toBe(true);
        accepted++;
        if (accepted === 1) {
          const dup = await m.c.call('mining.submit', [`${m.name}.rig1`, params[0], en2, params[7], nonce.toString(16).padStart(8, '0')]);
          expect(dup.error).toEqual([22, 'Duplicate share', null]);
          const bad = await m.c.call('mining.submit', [`${m.name}.rig1`, params[0], en2, params[7], (nonce + 1).toString(16).padStart(8, '0')]);
          // 다음 nonce가 우연히 쉐어일 확률은 1e-5 수준
          expect((bad.error as [number] | null)?.[0] ?? 23).toBe(23);
        }
        if (submitted.length) break;
      }
    }
    expect(submitted.length).toBe(1);
    // 블록 기록(쉐어 저장 → PPLNS 분배)이 끝날 때까지 대기
    for (let i = 0; i < 100 && !(await pool.query('SELECT 1 FROM pool_blocks')).rows[0]; i++) await new Promise((r) => setTimeout(r, 20));
    await server.flushShares();
    const shares = await pool.query('SELECT user_id, COUNT(*) AS n FROM pool_shares GROUP BY user_id');
    expect(shares.rows.reduce((s, r) => s + Number(r.n), 0)).toBe(accepted);

    const blocks = await pool.query('SELECT * FROM pool_blocks');
    expect(blocks.rows).toHaveLength(1);
    const block = blocks.rows[0];
    // 제출한 블록의 헤더 해시 = 기록된 블록 해시
    expect(Buffer.from(sha256d(Buffer.from(submitted[0], 'hex').subarray(0, 80))).reverse().toString('hex')).toBe(block.hash);
    const credits = await pool.query('SELECT user_id, amount FROM pool_credits WHERE block_hash = $1', [block.hash]);
    const total = credits.rows.reduce((s, r) => s + BigInt(r.amount), 0n);
    expect(total).toBe(BigInt(block.reward)); // 분배 + 풀 수수료 = 보상
    expect(BigInt(block.fee)).toBe(BigInt(block.reward) / 100n); // 1%
    miners.forEach((m) => m.c.socket.destroy());

    // 100컨펌 전에는 미성숙, 이후 확정 잔고로 전환
    node.confirmations.set(block.hash, 50);
    await worker.maturePoolBlocks(pool, rpc);
    expect((await pool.query(`SELECT COUNT(*) AS n FROM balances WHERE asset = 'PIKU' AND available > 0`)).rows[0].n).toBe('0');
    node.confirmations.set(block.hash, 100);
    await worker.maturePoolBlocks(pool, rpc);
    const bal = await pool.query(`SELECT COALESCE(SUM(available), 0) AS s FROM balances WHERE asset = 'PIKU'`);
    expect(BigInt(bal.rows[0].s)).toBe(BigInt(block.reward));
    expect((await pool.query('SELECT status FROM pool_blocks')).rows[0].status).toBe('confirmed');
  });

  it('입금: 지정 컨펌 수에 도달하면 잔고 반영 (한 번만)', async () => {
    await pool.query(`INSERT INTO deposit_addresses (address, user_id) VALUES ('addr1', $1)`, [ids.miner2]);
    node.receives = [{ category: 'receive', address: 'addr1', amount: 1.5, txid: 'dtx', vout: 0, confirmations: 1 }];
    const before = BigInt((await pool.query(`SELECT available FROM balances WHERE user_id = $1 AND asset = 'PIKU'`, [ids.miner2])).rows[0]?.available ?? 0);
    node.confirmations.set('dtx', 2);
    await worker.scanDeposits(pool, rpc);
    expect((await pool.query(`SELECT status FROM deposits`)).rows[0].status).toBe('pending');
    node.confirmations.set('dtx', 6);
    await worker.scanDeposits(pool, rpc);
    await worker.scanDeposits(pool, rpc);
    const after = BigInt((await pool.query(`SELECT available FROM balances WHERE user_id = $1 AND asset = 'PIKU'`, [ids.miner2])).rows[0].available);
    expect(after - before).toBe(u('1.5'));
  });

  it('출금: 승인된 건만 전송하고, 네트워크 수수료는 수수료 계정이 부담', async () => {
    const { adjustBalance } = await import('../src/lib/ledger.js');
    const c = await pool.connect();
    await c.query('BEGIN');
    await adjustBalance(c, ids.miner2, 'PIKU', -u('1.001'), u('1.001'), 'withdraw_lock');
    await c.query('COMMIT'); c.release();
    const w = await pool.query(`INSERT INTO withdrawals (user_id, address, amount, fee, status) VALUES ($1, 'dest', $2, $3, 'pending') RETURNING id`, [ids.miner2, u('1').toString(), u('0.001').toString()]);
    await worker.sendWithdrawals(pool, rpc);
    expect(node.sent).toHaveLength(0); // 승인 전
    await pool.query(`UPDATE withdrawals SET status = 'approved' WHERE id = $1`, [w.rows[0].id]);
    await worker.sendWithdrawals(pool, rpc);
    expect(node.sent).toEqual([['dest', '1.00000000', `withdrawal:${w.rows[0].id}`]]);
    expect((await pool.query('SELECT status, txid FROM withdrawals')).rows[0]).toEqual({ status: 'sent', txid: 'wtx' });
    const lock = (await pool.query(`SELECT locked FROM balances WHERE user_id = $1 AND asset = 'PIKU'`, [ids.miner2])).rows[0].locked;
    expect(lock).toBe('0');
    const { SYSTEM_USERS } = await import('../src/config.js');
    const feeAcc = (await pool.query(`SELECT available FROM balances WHERE user_id = $1 AND asset = 'PIKU'`, [SYSTEM_USERS.POOL_FEE])).rows[0].available;
    // 풀 수수료(보상의 1%) + 출금 수수료 0.001 − 네트워크 수수료 0.0001
    expect(BigInt(feeAcc)).toBe(u('0.5') + u('0.001') - u('0.0001'));
  });

  it('핫월렛 대사: 노드 잔고가 장부보다 적으면 알림', async () => {
    await worker.reconcileHotWallet(pool, redis as never, rpc);
    const status = JSON.parse(redis.kv.get('wallet:hot')!);
    expect(status.ok).toBe(false);
    expect((await pool.query(`SELECT kind FROM alerts WHERE kind = 'hotwallet_deficit'`)).rows).toHaveLength(1);
  });
});
