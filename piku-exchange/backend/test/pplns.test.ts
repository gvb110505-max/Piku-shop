import { describe, expect, it } from 'vitest';
import { hashrateFromShares, pplnsDistribute } from '../src/core/pplns.js';
import { toUnits as u } from '../src/core/units.js';

describe('PPLNS', () => {
  it('최근 N 난이도만큼의 쉐어에 비례 분배하고 수수료 1%를 뗀다', () => {
    const shares = [
      { userId: 'A', difficulty: 30 }, { userId: 'B', difficulty: 10 }, { userId: 'A', difficulty: 10 },
      { userId: 'C', difficulty: 1000 }, // 창 밖 (오래된 쉐어)
    ];
    const r = pplnsDistribute(shares, 50, u('50'), 100n);
    expect(r.windowUsed).toBe(50);
    expect(r.payouts.get('A')).toBe(u('39.6'));
    expect(r.payouts.get('B')).toBe(u('9.9'));
    expect(r.payouts.has('C')).toBe(false);
    expect(r.fee).toBe(u('0.5'));
  });

  it('경계 쉐어는 일부만 반영되고 총합은 항상 보상과 같다', () => {
    const r = pplnsDistribute([{ userId: 'A', difficulty: 7 }, { userId: 'B', difficulty: 7 }, { userId: 'C', difficulty: 7 }], 10, 333_333_333n, 100n);
    const paid = [...r.payouts.values()].reduce((s, x) => s + x, 0n);
    expect(paid + r.fee).toBe(333_333_333n);
    expect(r.payouts.get('A')! > r.payouts.get('B')!).toBe(true);
  });

  it('쉐어 난이도 합으로 해시레이트 추정', () => {
    expect(hashrateFromShares(600, 600)).toBe(2 ** 32);
  });
});
