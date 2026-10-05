/** 코인 노드 JSON-RPC 클라이언트 (비트코인 코어 호환). */
import { config } from '../config.js';

export class RpcError extends Error {
  constructor(message: string, public code?: number) { super(message); }
}

let idCounter = 0;

export async function rpc<T = unknown>(method: string, params: unknown[] = [], timeoutMs = 30_000): Promise<T> {
  const { host, port, user, pass, wallet } = config.rpc;
  const path = wallet ? `/wallet/${encodeURIComponent(wallet)}` : '/';
  const res = await fetch(`http://${host}:${port}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
    },
    body: JSON.stringify({ jsonrpc: '1.0', id: ++idCounter, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let body: { result?: T; error?: { message: string; code: number } | null };
  try { body = JSON.parse(text); } catch { throw new RpcError(`RPC 응답 파싱 실패 (HTTP ${res.status}): ${text.slice(0, 200)}`); }
  if (body.error) throw new RpcError(body.error.message, body.error.code);
  return body.result as T;
}

/** 코인 금액(10진 숫자) → 1e-8 단위. 노드는 float로 주므로 문자열 변환 후 파싱. */
export function coinToUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 1e8));
}

/** 1e-8 단위 → 노드에 보낼 금액 문자열(소수 8자리). */
export function unitsToCoin(units: bigint): string {
  const neg = units < 0n; const a = neg ? -units : units;
  return `${neg ? '-' : ''}${a / 100_000_000n}.${(a % 100_000_000n).toString().padStart(8, '0')}`;
}
