/**
 * Stratum V1 서버 (SHA-256d, 비트코인 코어 호환 노드).
 *
 * 흐름: getblocktemplate → 작업(job) 생성 → mining.notify 로 채굴기에 전달
 *       → mining.submit 으로 쉐어 수신 → 해시 검증 → 쉐어 저장(PPLNS용)
 *       → 네트워크 난이도까지 만족하면 submitblock → 블록 기록 + PPLNS 분배(미성숙)
 * 접속 ID: "거래소아이디.워커이름" (비밀번호는 무시)
 */
import net from 'node:net';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { SYSTEM_USERS } from '../config.js';
import { withTx } from '../db/pool.js';
import { pplnsDistribute } from '../core/pplns.js';
import { bitsToTarget, targetToDifficulty } from '../core/stratum/bitcoin.js';
import {
  buildBlockHex, checkShare, createJob, EXTRANONCE1_SIZE, EXTRANONCE2_SIZE, notifyParams, type BlockTemplate, type Job,
} from '../core/stratum/job.js';
import { audit } from '../lib/audit.js';
import { toJson } from '../lib/json.js';
import { KEYS } from '../lib/redis.js';
import { loadSettings } from '../lib/settings.js';

export interface StratumOptions {
  port: number;
  payoutScript: string;
  tag: string;
  initialDifficulty: number;
  minDifficulty: number;
  targetShareSec: number;
  rpc: <T>(method: string, params?: unknown[]) => Promise<T>;
}

interface Client {
  id: number;
  socket: net.Socket;
  extranonce1: string;
  subscribed: boolean;
  workers: Map<string, { userId: string; worker: string }>; // "user.worker" → 인증 정보
  difficulty: number;
  prevDifficulty: number;
  diffChangedAt: number;
  versionMask: number;
  shareTimes: number[];
  accepted: number;
  rejected: number;
  buffer: string;
}

const VERSION_ROLLING_MASK = 0x1fffe000;

export class StratumServer {
  private server: net.Server | null = null;
  private clients = new Set<Client>();
  private jobs = new Map<string, Job>();
  private current: Job | null = null;
  private jobCounter = 0;
  private clientCounter = 0;
  private extranonceCounter = Math.floor(Date.now() / 1000) & 0xffff;
  private seen = new Map<string, Set<string>>(); // jobId → 제출된 쉐어 (중복 방지)
  private shareBuffer: { userId: string; worker: string; difficulty: number }[] = [];
  private timers: NodeJS.Timeout[] = [];
  private userCache = new Map<string, { id: string; at: number } | null>();

  constructor(private db: pg.Pool, private redis: Redis, private opt: StratumOptions) {}

  async start(): Promise<void> {
    await this.refreshTemplate(true).catch((e) => console.error('[stratum] 템플릿 실패:', e.message));
    this.server = net.createServer((s) => this.onConnection(s));
    await new Promise<void>((res) => this.server!.listen(this.opt.port, '0.0.0.0', res));
    let polling = false;
    this.timers.push(
      setInterval(async () => {
        if (polling) return;
        polling = true;
        try {
          const best = await this.opt.rpc<string>('getbestblockhash');
          if (!this.current || best !== this.current.template.previousblockhash) await this.refreshTemplate(true);
        } catch (e) { console.error('[stratum] 노드 폴링 실패:', (e as Error).message); }
        finally { polling = false; }
      }, 1000),
      setInterval(() => this.refreshTemplate(false).catch(() => {}), 30_000), // 새 트랜잭션 반영
      setInterval(() => this.flushShares().catch((e) => console.error('[stratum] 쉐어 저장 실패', e)), 2000),
      setInterval(() => this.retargetAll(), 30_000),
    );
    console.log(`[stratum] :${this.opt.port} 대기 중`);
  }

  async stop(): Promise<void> {
    this.timers.forEach(clearInterval);
    for (const c of this.clients) c.socket.destroy();
    await this.flushShares();
    await new Promise<void>((res) => (this.server ? this.server.close(() => res()) : res()));
  }

  // ---------------- 작업 관리 ----------------
  async refreshTemplate(newBlock: boolean): Promise<void> {
    const t = await this.opt.rpc<BlockTemplate>('getblocktemplate', [{ rules: ['segwit'] }]);
    const clean = !this.current || t.previousblockhash !== this.current.template.previousblockhash;
    const job = createJob((++this.jobCounter).toString(16), t, this.opt.payoutScript, this.opt.tag);
    if (clean) { this.jobs.clear(); this.seen.clear(); }
    this.jobs.set(job.id, job);
    this.seen.set(job.id, new Set());
    this.current = job;
    // 오래된 작업 정리 (같은 이전 블록 위 작업은 최근 10개까지 유효)
    if (this.jobs.size > 10) {
      const oldest = this.jobs.keys().next().value!;
      this.jobs.delete(oldest); this.seen.delete(oldest);
    }
    const params = notifyParams(job, clean || newBlock);
    for (const c of this.clients) if (c.subscribed) this.send(c, null, 'mining.notify', params);

    let networkHashps = 0;
    try { networkHashps = (await this.opt.rpc<{ networkhashps: number }>('getmininginfo')).networkhashps; } catch { /* 선택 */ }
    await this.redis.set(KEYS.POOL_NETWORK, JSON.stringify({
      height: t.height, difficulty: targetToDifficulty(bitsToTarget(t.bits)), networkHashps,
      blockReward: String(t.coinbasevalue), updatedAt: Date.now(),
    }));
  }

  // ---------------- 연결 / 프로토콜 ----------------
  private onConnection(socket: net.Socket) {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 60_000);
    socket.setTimeout(10 * 60_000, () => socket.destroy());
    const client: Client = {
      id: ++this.clientCounter, socket,
      extranonce1: ((++this.extranonceCounter) >>> 0).toString(16).padStart(EXTRANONCE1_SIZE * 2, '0').slice(-EXTRANONCE1_SIZE * 2),
      subscribed: false, workers: new Map(), difficulty: this.opt.initialDifficulty, prevDifficulty: this.opt.initialDifficulty,
      diffChangedAt: 0, versionMask: 0, shareTimes: [], accepted: 0, rejected: 0, buffer: '',
    };
    this.clients.add(client);
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      client.buffer += chunk;
      if (client.buffer.length > 64 * 1024) { socket.destroy(); return; }
      let i: number;
      while ((i = client.buffer.indexOf('\n')) >= 0) {
        const line = client.buffer.slice(0, i).trim();
        client.buffer = client.buffer.slice(i + 1);
        if (line) this.onMessage(client, line).catch((e) => console.error('[stratum] 처리 오류', e));
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => this.clients.delete(client));
  }

  private send(c: Client, id: unknown, method: string, params: unknown[]) {
    if (!c.socket.destroyed) c.socket.write(JSON.stringify({ id, method, params }) + '\n');
  }
  private reply(c: Client, id: unknown, result: unknown, error: [number, string] | null = null) {
    if (!c.socket.destroyed) c.socket.write(JSON.stringify({ id, result, error: error ? [error[0], error[1], null] : null }) + '\n');
  }

  private async onMessage(c: Client, line: string) {
    let msg: { id: unknown; method: string; params: unknown[] };
    try { msg = JSON.parse(line); } catch { c.socket.destroy(); return; }
    const p = Array.isArray(msg.params) ? msg.params : [];
    switch (msg.method) {
      case 'mining.subscribe':
        c.subscribed = true;
        return this.reply(c, msg.id, [[['mining.set_difficulty', String(c.id)], ['mining.notify', String(c.id)]], c.extranonce1, EXTRANONCE2_SIZE]);
      case 'mining.extranonce.subscribe':
        return this.reply(c, msg.id, true);
      case 'mining.configure': {
        const exts = (p[0] as string[]) ?? [];
        const res: Record<string, unknown> = {};
        if (exts.includes('version-rolling')) {
          const requested = parseInt(((p[1] as Record<string, string>)?.['version-rolling.mask'] ?? 'ffffffff'), 16);
          c.versionMask = (requested & VERSION_ROLLING_MASK) >>> 0;
          res['version-rolling'] = true;
          res['version-rolling.mask'] = c.versionMask.toString(16).padStart(8, '0');
        }
        return this.reply(c, msg.id, res);
      }
      case 'mining.suggest_difficulty': {
        const d = Number(p[0]);
        if (Number.isFinite(d) && d > 0) this.setDifficulty(c, Math.max(this.opt.minDifficulty, d));
        return this.reply(c, msg.id, true);
      }
      case 'mining.authorize': return this.authorize(c, msg.id, String(p[0] ?? ''));
      case 'mining.submit': return this.submit(c, msg.id, p.map(String));
      default:
        return this.reply(c, msg.id, null, [20, 'Unsupported method']);
    }
  }

  /** "아이디.워커" 형식 인증. 아이디는 거래소 사용자명. */
  private async authorize(c: Client, id: unknown, login: string) {
    const [username, ...rest] = login.split('.');
    const worker = (rest.join('.') || 'default').slice(0, 32).replace(/[^a-zA-Z0-9_-]/g, '_');
    const user = await this.findUser(username);
    if (!user) return this.reply(c, id, false, [24, `Unknown exchange user: ${username}`]);
    c.workers.set(login, { userId: user, worker });
    this.reply(c, id, true);
    this.send(c, null, 'mining.set_difficulty', [c.difficulty]);
    if (this.current) this.send(c, null, 'mining.notify', notifyParams(this.current, true));
  }

  private async findUser(username: string): Promise<string | null> {
    const key = username.toLowerCase();
    const cached = this.userCache.get(key);
    if (cached && Date.now() - cached.at < 60_000) return cached.id;
    const { rows } = await this.db.query(
      `SELECT id FROM users WHERE lower(username) = $1 AND role <> 'system' AND NOT trading_banned`, [key]);
    const idv = rows[0]?.id ?? null;
    this.userCache.set(key, idv ? { id: idv, at: Date.now() } : null);
    return idv;
  }

  private async submit(c: Client, id: unknown, p: string[]) {
    const [login, jobId, en2, ntime, nonce, versionBits] = p;
    const auth = c.workers.get(login);
    const reject = (code: number, reason: string) => { c.rejected++; this.updateWorkerStats(c, auth); return this.reply(c, id, false, [code, reason]); };
    if (!auth) return reject(24, 'Unauthorized worker');
    const job = this.jobs.get(jobId);
    if (!job) return reject(21, 'Job not found (stale)');
    if (!/^[0-9a-f]+$/i.test(en2) || en2.length !== EXTRANONCE2_SIZE * 2) return reject(20, 'Bad extranonce2');
    if (!/^[0-9a-f]{8}$/i.test(ntime) || !/^[0-9a-f]{8}$/i.test(nonce)) return reject(20, 'Bad ntime/nonce');
    const t = parseInt(ntime, 16);
    if (t < (job.template.mintime ?? 0) || t > Math.floor(Date.now() / 1000) + 7200) return reject(20, 'ntime out of range');
    if (versionBits && !/^[0-9a-f]{8}$/i.test(versionBits)) return reject(20, 'Bad version bits');
    if (versionBits && (parseInt(versionBits, 16) & ~c.versionMask) !== 0) return reject(20, 'Version bits outside mask');

    const key = `${c.extranonce1}:${en2}:${ntime}:${nonce}:${versionBits ?? ''}`.toLowerCase();
    const seen = this.seen.get(jobId)!;
    if (seen.has(key)) return reject(22, 'Duplicate share');
    seen.add(key);

    // 난이도 변경 직후 잠시는 이전 난이도도 인정
    const diff = Date.now() - c.diffChangedAt < 10_000 ? Math.min(c.difficulty, c.prevDifficulty) : c.difficulty;
    const check = checkShare(job, { extranonce1: c.extranonce1, extranonce2: en2, ntime, nonce, versionMask: c.versionMask, versionBits }, diff);
    if (!check.meetsShare) return reject(23, 'Low difficulty share');

    c.accepted++;
    c.shareTimes.push(Date.now());
    this.shareBuffer.push({ userId: auth.userId, worker: auth.worker, difficulty: diff });
    this.reply(c, id, true);
    this.updateWorkerStats(c, auth);
    if (c.shareTimes.length >= 20) this.retarget(c);

    if (check.meetsNetwork) await this.submitBlock(job, check, auth);
  }

  private updateWorkerStats(c: Client, auth?: { userId: string; worker: string }) {
    if (!auth) return;
    this.redis.hset(KEYS.POOL_WORKERS, `${auth.userId}:${auth.worker}`, JSON.stringify({
      difficulty: c.difficulty, accepted: c.accepted, rejected: c.rejected, lastShareAt: Date.now(),
    })).catch(() => {});
  }

  // ---------------- 가변 난이도 (vardiff) ----------------
  private setDifficulty(c: Client, d: number) {
    if (d === c.difficulty) return;
    c.prevDifficulty = c.difficulty;
    c.difficulty = d;
    c.diffChangedAt = Date.now();
    this.send(c, null, 'mining.set_difficulty', [d]);
  }

  /** 목표: 쉐어 1개당 targetShareSec초. 한 번에 최대 4배까지만 조정. */
  private retarget(c: Client) {
    const times = c.shareTimes;
    if (times.length < 2) return;
    const avg = (times[times.length - 1] - times[0]) / 1000 / (times.length - 1);
    c.shareTimes = [];
    if (avg <= 0) return;
    const ratio = Math.min(4, Math.max(0.25, this.opt.targetShareSec / avg));
    if (ratio > 0.7 && ratio < 1.4) return;
    this.setDifficulty(c, Math.max(this.opt.minDifficulty, Number((c.difficulty * ratio).toPrecision(4))));
  }

  private retargetAll() {
    for (const c of this.clients) {
      // 30초 동안 쉐어가 거의 없으면 난이도를 낮춘다
      if (c.workers.size && c.shareTimes.length < 2 && Date.now() - c.diffChangedAt > 60_000) {
        this.setDifficulty(c, Math.max(this.opt.minDifficulty, Number((c.difficulty / 2).toPrecision(4))));
      } else this.retarget(c);
    }
  }

  // ---------------- 쉐어 저장 / 블록 처리 ----------------
  private flushChain: Promise<void> = Promise.resolve();

  /**
   * 쉐어 일괄 저장. 직렬화되어 있어서, 블록 발견 시 호출하면 진행 중이던 저장까지 모두 끝난 뒤
   * 반환된다 (PPLNS 계산이 직전 쉐어를 빠뜨리지 않도록).
   */
  flushShares(): Promise<void> {
    const run = this.flushChain.then(() => this.flushNow());
    this.flushChain = run.catch(() => undefined);
    return run;
  }

  private async flushNow(): Promise<void> {
    if (!this.shareBuffer.length) return;
    const batch = this.shareBuffer.splice(0, this.shareBuffer.length);
    const values: unknown[] = [];
    const rows = batch.map((s, i) => { values.push(s.userId, s.worker, s.difficulty); return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`; });
    await this.db.query(`INSERT INTO pool_shares (user_id, worker, difficulty) VALUES ${rows.join(',')}`, values);
  }

  private async submitBlock(job: Job, check: ReturnType<typeof checkShare>, finder: { userId: string; worker: string }) {
    const hex = buildBlockHex(job, check);
    let result: string | null;
    try { result = await this.opt.rpc<string | null>('submitblock', [hex]); } catch (e) { result = (e as Error).message; }
    if (result !== null && result !== 'duplicate') {
      console.error(`[stratum] 블록 거부됨 ${check.hashHex}: ${result}`);
      await this.db.query(`INSERT INTO alerts (kind, message, details) VALUES ('block_rejected', $1, $2)`, [`블록 제출 거부: ${result}`, toJson({ hash: check.hashHex, height: job.template.height })]);
      return;
    }
    console.log(`[stratum] 블록 발견! 높이 ${job.template.height} ${check.hashHex} by ${finder.worker}`);
    await this.flushShares();
    await this.recordBlock(job, check.hashHex, finder);
    await this.refreshTemplate(true).catch(() => {});
  }

  /** 블록 기록 + PPLNS 분배 (미성숙 상태. worker가 100컨펌 후 잔고로 확정). */
  async recordBlock(job: Job, hash: string, finder: { userId: string; worker: string }) {
    const s = await loadSettings(this.db);
    const reward = BigInt(job.template.coinbasevalue);
    const networkDiff = targetToDifficulty(job.networkTarget);
    const { rows } = await this.db.query<{ user_id: string; difficulty: number }>(
      'SELECT user_id, difficulty FROM pool_shares ORDER BY id DESC LIMIT 1000000');
    const dist = pplnsDistribute(rows.map((r) => ({ userId: r.user_id, difficulty: Number(r.difficulty) })), networkDiff * s.pplns_window_factor, reward, BigInt(s.pool_fee_bps));
    await withTx(this.db, async (c) => {
      await c.query(
        `INSERT INTO pool_blocks (hash, height, reward, fee, finder_id, finder_worker, network_difficulty) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (hash) DO NOTHING`,
        [hash, job.template.height, reward.toString(), dist.fee.toString(), finder.userId, finder.worker, networkDiff]);
      for (const [userId, amount] of dist.payouts) {
        await c.query('INSERT INTO pool_credits (block_hash, user_id, amount) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [hash, userId, amount.toString()]);
      }
      if (dist.fee > 0n) {
        await c.query('INSERT INTO pool_credits (block_hash, user_id, amount) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [hash, SYSTEM_USERS.POOL_FEE, dist.fee.toString()]);
      }
      await audit(c, { action: 'pool.block_found', userId: finder.userId, details: { hash, height: job.template.height, reward, fee: dist.fee, miners: dist.payouts.size } });
    });
    await this.redis.publish(KEYS.EVENTS, JSON.stringify({ ch: 'pool', data: { type: 'block', hash, height: job.template.height } }));
  }
}
