import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { EngineClient } from '../lib/engineClient.js';
import type { KycProvider } from '../lib/kyc.js';
import { UserError } from '../lib/ledger.js';
import { verifyTotp } from '../lib/totp.js';

export interface Ctx {
  db: pg.Pool;
  redis: Redis;
  engine: EngineClient;
  kyc: KycProvider;
}

export interface AuthUser { id: string; role: 'user' | 'admin' | 'system' }

declare module '@fastify/jwt' {
  interface FastifyJWT { payload: { sub: string; role: AuthUser['role'] }; user: { sub: string; role: AuthUser['role'] } }
}

export async function requireUser(req: FastifyRequest): Promise<AuthUser> {
  try {
    await req.jwtVerify();
  } catch {
    throw new UserError('로그인이 필요합니다', 401);
  }
  return { id: req.user.sub, role: req.user.role };
}

export async function requireAdmin(req: FastifyRequest): Promise<AuthUser> {
  const u = await requireUser(req);
  if (u.role !== 'admin') throw new UserError('관리자 권한이 필요합니다', 403);
  return u;
}

/** 2FA 코드 확인 (재사용 방지 카운터 갱신 포함). required=true면 2FA 미설정 계정은 거부. */
export async function checkTotp(db: pg.Pool, userId: string, code: unknown, required: boolean): Promise<void> {
  const { rows } = await db.query('SELECT totp_secret, totp_enabled, totp_last_counter FROM users WHERE id = $1', [userId]);
  const u = rows[0];
  if (!u?.totp_enabled) {
    if (required) throw new UserError('2단계 인증(OTP)을 먼저 설정하세요', 403);
    return;
  }
  const counter = verifyTotp(u.totp_secret, String(code ?? ''), Number(u.totp_last_counter));
  if (counter === null) throw new UserError('OTP 코드가 올바르지 않습니다', 401);
  await db.query('UPDATE users SET totp_last_counter = $2 WHERE id = $1', [userId, counter]);
}

export const ip = (req: FastifyRequest) => req.ip;

export function sendError(reply: FastifyReply, e: unknown) {
  if (e instanceof UserError) return reply.status(e.status).send({ error: e.message });
  throw e;
}
