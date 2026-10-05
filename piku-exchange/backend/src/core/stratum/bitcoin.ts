/** 비트코인 계열(SHA-256d) 블록/트랜잭션 직렬화 유틸. */
import { createHash } from 'node:crypto';

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest();
export const sha256d = (b: Buffer) => sha256(sha256(b));

/** 바이트 순서 뒤집기 (표시용 해시 ↔ 내부 바이트 순서). */
export const reverse = (b: Buffer) => Buffer.from(b).reverse();
export const hexReverse = (hex: string) => reverse(Buffer.from(hex, 'hex')).toString('hex');

/** 4바이트 단위로 각 워드의 바이트 순서를 뒤집는다 (Stratum prevhash 형식). */
export function swapWords(b: Buffer): Buffer {
  const out = Buffer.alloc(b.length);
  for (let i = 0; i < b.length; i += 4) {
    out[i] = b[i + 3]; out[i + 1] = b[i + 2]; out[i + 2] = b[i + 1]; out[i + 3] = b[i];
  }
  return out;
}

export function varInt(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b; }
  if (n <= 0xffffffff) { const b = Buffer.alloc(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b; }
  const b = Buffer.alloc(9); b[0] = 0xff; b.writeBigUInt64LE(BigInt(n), 1); return b;
}

export const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
export const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };

/** BIP34: coinbase scriptSig 맨 앞에 블록 높이를 최소 길이 숫자 push로 넣는다. */
export function serializeHeight(height: number): Buffer {
  if (height >= 1 && height <= 16) return Buffer.from([0x50 + height]); // OP_1..OP_16
  if (height === 0) return Buffer.from([0x00]);
  const bytes: number[] = [];
  let n = height;
  while (n > 0) { bytes.push(n & 0xff); n >>= 8; }
  if (bytes[bytes.length - 1] & 0x80) bytes.push(0); // 부호 비트 회피
  return Buffer.from([bytes.length, ...bytes]);
}

/** nBits(compact) → 목표값. */
export function bitsToTarget(bitsHex: string): bigint {
  const bits = parseInt(bitsHex, 16);
  const exp = bits >>> 24;
  const mant = BigInt(bits & 0x007fffff);
  return exp <= 3 ? mant >> BigInt(8 * (3 - exp)) : mant << BigInt(8 * (exp - 3));
}

/** 난이도 1의 목표값 (비트코인 pdiff 기준). */
export const DIFF1_TARGET = 0x00000000ffff0000000000000000000000000000000000000000000000000000n;

export function difficultyToTarget(diff: number): bigint {
  const scaled = BigInt(Math.max(1, Math.round(diff * 1e8)));
  return (DIFF1_TARGET * 100_000_000n) / scaled;
}

export function targetToDifficulty(target: bigint): number {
  if (target <= 0n) return Infinity;
  return Number((DIFF1_TARGET * 100_000_000n) / target) / 1e8;
}

/** 해시(내부 바이트 순서)를 256비트 정수로 (리틀엔디언 해석). */
export function hashToBigInt(hashInternal: Buffer): bigint {
  return BigInt('0x' + reverse(hashInternal).toString('hex'));
}

/** 머클 브랜치: 코인베이스를 제외한 트랜잭션 해시들로부터 계산 (Stratum mining.notify 용). */
export function merkleBranches(txHashesInternal: Buffer[]): Buffer[] {
  const steps: Buffer[] = [];
  let level: (Buffer | null)[] = [null, ...txHashesInternal];
  while (level.length > 1) {
    steps.push(level[1]!);
    if (level.length % 2) level.push(level[level.length - 1]);
    const next: (Buffer | null)[] = [null];
    for (let i = 2; i < level.length; i += 2) next.push(sha256d(Buffer.concat([level[i]!, level[i + 1]!])));
    level = next;
  }
  return steps;
}

/** 코인베이스 해시와 머클 브랜치로 머클 루트 계산. */
export function merkleRootFromBranches(coinbaseHash: Buffer, branches: Buffer[]): Buffer {
  return branches.reduce((acc, b) => sha256d(Buffer.concat([acc, b])), coinbaseHash);
}

/** 전체 트랜잭션 해시 목록으로 머클 루트 계산 (검증/테스트용). */
export function merkleRoot(hashes: Buffer[]): Buffer {
  let level = hashes;
  while (level.length > 1) {
    if (level.length % 2) level = [...level, level[level.length - 1]];
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256d(Buffer.concat([level[i], level[i + 1]])));
    level = next;
  }
  return level[0];
}

export interface HeaderFields {
  version: number;
  prevHashInternal: Buffer;
  merkleRootInternal: Buffer;
  time: number;
  bits: number;
  nonce: number;
}

/** 80바이트 블록 헤더 직렬화. */
export function serializeHeader(h: HeaderFields): Buffer {
  return Buffer.concat([
    u32le(h.version), h.prevHashInternal, h.merkleRootInternal, u32le(h.time), u32le(h.bits), u32le(h.nonce),
  ]);
}
