/** 감사 로그 기록 (거래/입출금/관리자 조작 전부). audit_logs는 DB 트리거로 수정/삭제가 막혀 있다. */
import type pg from 'pg';
import { toJson } from './json.js';

export interface AuditEntry {
  action: string;
  userId?: string | null;
  actorId?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

export async function audit(db: pg.Pool | pg.PoolClient, e: AuditEntry): Promise<void> {
  await db.query(
    'INSERT INTO audit_logs (actor_id, user_id, action, details, ip) VALUES ($1, $2, $3, $4, $5)',
    [e.actorId ?? e.userId ?? null, e.userId ?? null, e.action, toJson(e.details ?? {}), e.ip ?? null],
  );
}
