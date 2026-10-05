/** API 서버 진입점 (Fastify + WebSocket). */
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { assertModeSafety, config } from '../config.js';
import { createPool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { EngineClient } from '../lib/engineClient.js';
import { ManualKycProvider } from '../lib/kyc.js';
import { InsufficientFunds, UserError } from '../lib/ledger.js';
import { createRedis } from '../lib/redis.js';
import type { Ctx } from './context.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import marketRoutes from './routes/market.js';
import poolRoutes from './routes/pool.js';
import tradingRoutes from './routes/trading.js';
import walletRoutes from './routes/wallet.js';
import { registerWs } from './ws.js';

export async function buildApp() {
  assertModeSafety();
  const db = createPool();
  await migrate(db);
  const redis = createRedis();
  const engine = new EngineClient(redis, createRedis());
  await engine.start();
  const ctx: Ctx = { db, redis, engine, kyc: new ManualKycProvider(!config.realMoney) };

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true });
  await app.register(cors, { origin: config.realMoney ? config.appUrl : true });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(websocket);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof UserError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof InsufficientFunds) return reply.status(400).send({ error: err.message });
    if (err instanceof ZodError) return reply.status(400).send({ error: err.issues.map((i) => i.message).join(', ') });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
    app.log.error(err);
    return reply.status(500).send({ error: '서버 오류' });
  });

  app.get('/api/health', async () => ({ ok: true, mode: config.realMoney ? 'real' : 'test' }));
  for (const routes of [authRoutes, marketRoutes, tradingRoutes, walletRoutes, poolRoutes, adminRoutes]) {
    await app.register(async (scope) => routes(scope, ctx));
  }
  await registerWs(app, createRedis());
  return app;
}

if (process.argv[1]?.endsWith('main.ts') || process.argv[1]?.endsWith('main.js')) {
  buildApp()
    .then((app) => app.listen({ port: config.apiPort, host: '0.0.0.0' }))
    .then(() => console.log(`[api] :${config.apiPort} (${config.realMoney ? '실자금' : '테스트'} 모드)`))
    .catch((e) => { console.error(e); process.exit(1); });
}
