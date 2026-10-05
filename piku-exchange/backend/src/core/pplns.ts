/**
 * PPLNS (Pay Per Last N Shares) 보상 분배.
 * 블록을 찾은 시점에서 최근 N(난이도 합 기준)만큼의 쉐어에 비례해 보상을 나눈다.
 * 블록을 찾기 직전에만 접속하는 '풀 호핑'으로 이득을 보기 어렵게 만든다.
 */
import { BPS } from './units.js';

export interface Share { userId: string; difficulty: number }

export interface PplnsResult { payouts: Map<string, bigint>; fee: bigint; windowUsed: number }

/**
 * @param sharesNewestFirst 최신 쉐어부터 정렬된 목록
 * @param windowDifficulty  N: 포함할 쉐어 난이도 합 (보통 네트워크 난이도 × 2)
 * @param reward            블록 보상 (1e-8 단위)
 * @param feeBps            풀 수수료 (100 = 1%)
 * 분배 후 남는 반올림 잔액은 수수료에 더해 총합이 항상 reward와 같다.
 */
export function pplnsDistribute(sharesNewestFirst: Share[], windowDifficulty: number, reward: bigint, feeBps: bigint): PplnsResult {
  const weights = new Map<string, number>();
  let used = 0;
  for (const s of sharesNewestFirst) {
    if (used >= windowDifficulty) break;
    const w = Math.min(s.difficulty, windowDifficulty - used); // 경계의 쉐어는 일부만 반영
    weights.set(s.userId, (weights.get(s.userId) ?? 0) + w);
    used += w;
  }
  const distributable = (reward * (BPS - feeBps)) / BPS;
  const payouts = new Map<string, bigint>();
  if (used <= 0) return { payouts, fee: reward, windowUsed: 0 };

  // 가중치를 정수로 바꿔 bigint로 계산 (난이도는 소수일 수 있으므로 1e6 배)
  const intWeights = [...weights].map(([u, w]) => [u, BigInt(Math.round(w * 1e6))] as const);
  const total = intWeights.reduce((s, [, w]) => s + w, 0n);
  let paid = 0n;
  for (const [u, w] of intWeights) {
    const amount = total === 0n ? 0n : (distributable * w) / total;
    if (amount > 0n) payouts.set(u, amount);
    paid += amount;
  }
  return { payouts, fee: reward - paid, windowUsed: used };
}

/** 쉐어 난이도 합 → 해시레이트(H/s). 난이도 1 쉐어 ≈ 2^32 해시. */
export function hashrateFromShares(sumDifficulty: number, seconds: number): number {
  return seconds > 0 ? (sumDifficulty * 2 ** 32) / seconds : 0;
}
