/**
 * 금액 단위 유틸.
 * 모든 자산 수량·가격은 1e-8 단위 정수(bigint)로 다룬다. 부동소수점 오차가 없어야
 * 잔고 합계가 정확히 맞는다(체결/정산 테스트도 이 전제를 검증한다).
 */
export const SCALE = 100_000_000n;
export const DECIMALS = 8;
export const BPS = 10_000n;
export const PPM = 1_000_000n;

/** "12.5" 같은 10진 문자열 → 1e-8 단위 bigint. 형식 오류/소수 9자리 이상은 예외. */
export function toUnits(value: string | number): bigint {
  const s = typeof value === 'number' ? value.toFixed(DECIMALS) : value.trim();
  const m = /^(-)?(\d+)(?:\.(\d{1,8}))?$/.exec(s);
  if (!m) throw new Error(`잘못된 수량 형식: ${value}`);
  const [, neg, int, frac = ''] = m;
  const units = BigInt(int) * SCALE + BigInt(frac.padEnd(DECIMALS, '0'));
  return neg ? -units : units;
}

/** 1e-8 단위 bigint → 10진 문자열 (불필요한 0 제거). */
export function fromUnits(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const int = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${int}${frac ? '.' + frac : ''}`;
}

/** 가격 × 수량 → 대금 (내림). price, qty 모두 1e-8 단위. */
export function notional(price: bigint, qty: bigint): bigint {
  return (price * qty) / SCALE;
}

/** a × b / c 올림 (증거금처럼 '모자라면 안 되는' 값에 사용). */
export function mulDivCeil(a: bigint, b: bigint, c: bigint): bigint {
  const n = a * b;
  return n % c === 0n ? n / c : n / c + (n > 0n ? 1n : 0n);
}

export const absBig = (x: bigint) => (x < 0n ? -x : x);
export const minBig = (a: bigint, b: bigint) => (a < b ? a : b);
export const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);
export const signBig = (x: bigint) => (x > 0n ? 1n : x < 0n ? -1n : 0n);
