/** API → 엔진 요청/응답 클라이언트. Redis 스트림에 명령을 넣고 응답 채널을 구독해 결과를 기다린다. */
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { UserError } from './ledger.js';
import { KEYS } from './redis.js';

type Reply = { cmdId: string; ok: boolean; result?: unknown; error?: string };

export class EngineClient {
  private instance = randomUUID();
  private pending = new Map<string, { resolve: (r: Reply) => void; timer: NodeJS.Timeout }>();

  constructor(private redis: Redis, private sub: Redis) {}

  async start(): Promise<void> {
    await this.sub.subscribe(KEYS.replyChannel(this.instance));
    this.sub.on('message', (ch, msg) => {
      if (ch !== KEYS.replyChannel(this.instance)) return;
      const reply = JSON.parse(msg) as Reply;
      const p = this.pending.get(reply.cmdId);
      if (p) { clearTimeout(p.timer); this.pending.delete(reply.cmdId); p.resolve(reply); }
    });
  }

  /** 명령 전송 후 결과 대기. 엔진이 거절하면 UserError. */
  async send<T = unknown>(type: string, payload: Record<string, unknown>, meta: { actorId?: string; ip?: string } = {}, timeoutMs = 15_000): Promise<T> {
    const cmdId = randomUUID();
    const reply = new Promise<Reply>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(cmdId);
        resolve({ cmdId, ok: false, error: '매칭 엔진 응답 시간 초과 (주문 상태를 확인하세요)' });
      }, timeoutMs);
      this.pending.set(cmdId, { resolve, timer });
    });
    await this.redis.xadd(KEYS.ENGINE_STREAM, 'MAXLEN', '~', '100000', '*', 'data',
      JSON.stringify({ cmdId, type, payload, actorId: meta.actorId, ip: meta.ip, replyTo: KEYS.replyChannel(this.instance) }));
    const r = await reply;
    if (!r.ok) throw new UserError(r.error ?? '엔진 오류');
    return r.result as T;
  }
}
