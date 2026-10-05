/**
 * 무기한 선물 계산 로직 (순수 함수).
 * qty는 부호 있는 수량(롱 +, 숏 -), 가격/증거금은 1e-8 단위 정수.
 */
import { absBig, BPS, minBig, mulDivCeil, notional, PPM, SCALE, signBig } from './units.js';

export type MarginMode = 'isolated' | 'cross';

export interface Position {
  qty: bigint;
  entryPrice: bigint;
  margin: bigint;   // 포지션에 할당된 증거금
  leverage: number;
  mode: MarginMode;
}

export const emptyPosition = (leverage: number, mode: MarginMode): Position =>
  ({ qty: 0n, entryPrice: 0n, margin: 0n, leverage, mode });

/** 미실현 손익 = 수량 × (마크가 − 진입가). */
export function unrealizedPnl(pos: Position, mark: bigint): bigint {
  return (pos.qty * (mark - pos.entryPrice)) / SCALE;
}

/** 유지증거금 = 마크가 기준 명목가치 × 유지증거금률. */
export function maintenanceMargin(pos: Position, mark: bigint, mmrBps: bigint): bigint {
  return mulDivCeil(notional(mark, absBig(pos.qty)), mmrBps, BPS);
}

/** 개시증거금 = 명목가치 / 레버리지 (올림). */
export function initialMargin(price: bigint, qty: bigint, leverage: number): bigint {
  return mulDivCeil(notional(price, absBig(qty)), 1n, BigInt(leverage));
}

/**
 * 격리 마진 청산가: 증거금 + 미실현손익 = 유지증거금 이 되는 마크 가격.
 *  롱:  p = (q·e − m·S) / (q·(1 − mmr))
 *  숏:  p = (q·e + m·S) / (q·(1 + mmr))
 * 롱의 결과가 0 이하이면 사실상 청산되지 않으므로 0을 반환.
 */
export function liquidationPrice(pos: Position, mmrBps: bigint, extraCollateral = 0n): bigint {
  if (pos.qty === 0n) return 0n;
  const q = absBig(pos.qty);
  const m = pos.margin + extraCollateral;
  if (pos.qty > 0n) {
    const num = (q * pos.entryPrice - m * SCALE) * BPS;
    if (num <= 0n) return 0n;
    return num / (q * (BPS - mmrBps));
  }
  return mulDivCeil(q * pos.entryPrice + m * SCALE, BPS, q * (BPS + mmrBps));
}

export interface FillEffect {
  position: Position;
  realizedPnl: bigint;      // 청산(감소)된 부분의 실현 손익
  releasedMargin: bigint;   // 감소분에 비례해 풀려난 증거금
  addedMargin: bigint;      // 새로 연 부분에 필요한 개시증거금
  closedQty: bigint;
  openedQty: bigint;
}

/**
 * 체결을 포지션에 반영. signedQty는 매수 +, 매도 −.
 * 반대 방향 체결은 먼저 기존 포지션을 줄이고(실현손익 발생), 남는 수량으로 반대 포지션을 연다.
 */
export function applyFill(pos: Position, signedQty: bigint, price: bigint): FillEffect {
  const p = { ...pos };
  let realizedPnl = 0n, releasedMargin = 0n, addedMargin = 0n, closedQty = 0n;
  let openQty = signedQty;

  if (p.qty !== 0n && signBig(p.qty) !== signBig(signedQty)) {
    closedQty = minBig(absBig(signedQty), absBig(p.qty));
    const dir = signBig(p.qty);
    realizedPnl = (closedQty * (price - p.entryPrice) * dir) / SCALE;
    releasedMargin = (p.margin * closedQty) / absBig(p.qty);
    if (closedQty === absBig(p.qty)) releasedMargin = p.margin; // 전량 청산 시 반올림 잔여 없이 모두 반환
    p.margin -= releasedMargin;
    p.qty -= dir * closedQty;
    if (p.qty === 0n) p.entryPrice = 0n;
    openQty = signedQty + dir * closedQty; // 남은 (반대 방향) 수량
  }

  if (openQty !== 0n) {
    const oldAbs = absBig(p.qty), addAbs = absBig(openQty);
    p.entryPrice = (oldAbs * p.entryPrice + addAbs * price) / (oldAbs + addAbs);
    p.qty += openQty;
    addedMargin = initialMargin(price, addAbs, p.leverage);
    p.margin += addedMargin;
  }
  return { position: p, realizedPnl, releasedMargin, addedMargin, closedQty, openedQty: absBig(openQty) };
}

/** 격리 포지션 청산 조건: 증거금 + 미실현손익 < 유지증거금. */
export function isolatedNeedsLiquidation(pos: Position, mark: bigint, mmrBps: bigint): boolean {
  if (pos.qty === 0n) return false;
  return pos.margin + unrealizedPnl(pos, mark) < maintenanceMargin(pos, mark, mmrBps);
}

/** 교차 계정 청산 조건: 가용잔고 + Σ증거금 + Σ미실현손익 < Σ유지증거금. */
export function crossNeedsLiquidation(available: bigint, positions: Position[], mark: bigint, mmrBps: bigint): boolean {
  const open = positions.filter((p) => p.qty !== 0n);
  if (open.length === 0) return false;
  const equity = available + open.reduce((s, p) => s + p.margin + unrealizedPnl(p, mark), 0n);
  const mm = open.reduce((s, p) => s + maintenanceMargin(p, mark, mmrBps), 0n);
  return equity < mm;
}

export interface LiquidationResult {
  equity: bigint;          // 마크가 기준 포지션 가치 (증거금 + 미실현손익)
  fee: bigint;             // 보험기금으로 가는 청산 수수료
  userReturn: bigint;      // 사용자에게 돌려줄 금액
  insuranceDelta: bigint;  // 보험기금 증감 (수수료 수입 − 파산 손실 보전)
  takeover: { qty: bigint; price: bigint }; // 보험기금이 인수하는 포지션
}

/**
 * 강제청산: 보험기금이 마크가로 포지션을 인수한다.
 * - 남은 가치(equity)가 있으면 청산 수수료를 떼어 보험기금에 넣고 나머지는 사용자에게 반환
 * - 가치가 음수(파산)면 그 손실을 보험기금이 메운다
 */
export function liquidate(pos: Position, mark: bigint, liqFeeBps: bigint): LiquidationResult {
  const equity = pos.margin + unrealizedPnl(pos, mark);
  const maxFee = (notional(mark, absBig(pos.qty)) * liqFeeBps) / BPS;
  const fee = equity > 0n ? minBig(maxFee, equity) : 0n;
  const userReturn = equity > 0n ? equity - fee : 0n;
  const insuranceDelta = equity > 0n ? fee : equity;
  return { equity, fee, userReturn, insuranceDelta, takeover: { qty: pos.qty, price: mark } };
}

/** 마크 가격 = 현물 (최우선 매수호가, 최우선 매도호가, 최근 체결가)의 중앙값. */
export function markPrice(bid: bigint | null, ask: bigint | null, last: bigint | null): bigint | null {
  const xs = [bid, ask, last].filter((x): x is bigint => x !== null).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (xs.length === 0) return null;
  if (xs.length === 2) return (xs[0] + xs[1]) / 2n;
  return xs[Math.floor(xs.length / 2)];
}

/** 펀딩비율(ppm) = clamp((선물 가격 − 마크가) / 마크가, ±cap). 양수면 롱이 숏에게 지불. */
export function fundingRatePpm(perpPrice: bigint | null, mark: bigint, capPpm: bigint): bigint {
  if (perpPrice === null || mark <= 0n) return 0n;
  const premium = ((perpPrice - mark) * PPM) / mark;
  return premium > capPpm ? capPpm : premium < -capPpm ? -capPpm : premium;
}

/** 포지션 하나의 펀딩 지급액. 양수 = 이 포지션이 낸다, 음수 = 받는다. */
export function fundingPayment(pos: Position, mark: bigint, ratePpm: bigint): bigint {
  const value = notional(mark, absBig(pos.qty));
  const amount = (value * absBig(ratePpm)) / PPM;
  const pays = (pos.qty > 0n) === (ratePpm > 0n);
  return pays ? amount : -amount;
}
