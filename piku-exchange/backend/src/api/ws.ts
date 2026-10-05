/**
 * WebSocket 허브. 엔진/풀이 Redis 'events' 채널에 발행한 이벤트를 구독자에게 전달한다.
 * 클라이언트: {"op":"sub","channels":["book:PIKU-KRW","trades:PIKU-KRW","mark","status"]}
 * 로그인 토큰을 ?token= 으로 주면 자기 계정 채널(user:<id>)이 자동 구독된다.
 */
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import { KEYS } from '../lib/redis.js';

interface Client { ws: WebSocket; channels: Set<string>; userId: string | null }

export async function registerWs(app: FastifyInstance, sub: Redis) {
  const clients = new Set<Client>();
  await sub.subscribe(KEYS.EVENTS);
  sub.on('message', (ch, msg) => {
    if (ch !== KEYS.EVENTS) return;
    const { ch: channel } = JSON.parse(msg) as { ch: string };
    for (const c of clients) {
      const allowed = channel.startsWith('user:') ? channel === `user:${c.userId}` : c.channels.has(channel);
      if (allowed && c.ws.readyState === c.ws.OPEN) c.ws.send(msg);
    }
  });

  app.get('/ws', { websocket: true }, (socket, req) => {
    const token = (req.query as { token?: string }).token;
    let userId: string | null = null;
    if (token) { try { userId = (app.jwt.verify(token) as { sub: string }).sub; } catch { /* 공개 채널만 */ } }
    const client: Client = { ws: socket, channels: new Set(), userId };
    clients.add(client);
    socket.on('message', (raw: Buffer) => {
      try {
        const m = JSON.parse(raw.toString()) as { op: string; channels?: string[] };
        const chans = (m.channels ?? []).filter((x) => typeof x === 'string' && !x.startsWith('user:')).slice(0, 50);
        if (m.op === 'sub') chans.forEach((x) => client.channels.add(x));
        if (m.op === 'unsub') chans.forEach((x) => client.channels.delete(x));
        if (m.op === 'ping') socket.send('{"op":"pong"}');
      } catch { /* 무시 */ }
    });
    socket.on('close', () => clients.delete(client));
  });
}
