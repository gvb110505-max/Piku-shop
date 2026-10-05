/**
 * 콜옥션(단일가 매매): 일정 시간 주문을 모은 뒤 하나의 가격으로 한 번에 체결.
 * 상장 직후 첫 가격을 정할 때 사용한다.
 */
import { OrderBook, type BookOrder, type Fill } from './orderbook.js';
import { absBig, minBig } from './units.js';

export interface ClearingResult { price: bigint; volume: bigint; demand: bigint; supply: bigint }

/**
 * 단일 체결가 결정 규칙 (거래소 표준 방식):
 *  1) 체결 수량이 최대인 가격
 *  2) 동률이면 미체결 잔량(|매수수요-매도공급|)이 최소인 가격
 *  3) 그래도 동률이면 매수 초과면 높은 가격, 매도 초과면 낮은 가격
 *  4) 그래도 동률이면 기준가(refPrice)에 가장 가까운 가격, 없으면 낮은 가격
 */
export function findClearingPrice(buys: BookOrder[], sells: BookOrder[], refPrice?: bigint): ClearingResult | null {
  const prices = [...new Set([...buys, ...sells].map((o) => o.price))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const candidates: ClearingResult[] = [];
  for (const p of prices) {
    const demand = buys.filter((o) => o.price >= p).reduce((s, o) => s + o.remaining, 0n);
    const supply = sells.filter((o) => o.price <= p).reduce((s, o) => s + o.remaining, 0n);
    const volume = minBig(demand, supply);
    if (volume <= 0n) continue;
    candidates.push({ price: p, volume, demand, supply });
  }
  if (candidates.length === 0) return null;
  const maxVol = candidates.reduce((m, c) => (c.volume > m ? c.volume : m), 0n);
  let pool = candidates.filter((c) => c.volume === maxVol);
  const minImb = pool.reduce((m, c) => { const i = absBig(c.demand - c.supply); return m === null || i < m ? i : m; }, null as bigint | null)!;
  pool = pool.filter((c) => absBig(c.demand - c.supply) === minImb);
  if (pool.length > 1) {
    if (pool.every((c) => c.demand > c.supply)) pool = [pool[pool.length - 1]];
    else if (pool.every((c) => c.supply > c.demand)) pool = [pool[0]];
  }
  if (pool.length > 1 && refPrice !== undefined) {
    const d = (c: ClearingResult) => absBig(c.price - refPrice);
    const minD = pool.reduce((m, c) => (d(c) < m ? d(c) : m), d(pool[0]));
    pool = pool.filter((c) => d(c) === minD);
  }
  return pool[0];
}

/**
 * 호가창에 모인 주문을 단일가로 체결. 체결 순서는 가격-시간 우선.
 * 체결 후 남은 주문은 그대로 호가창에 남아 연속 매매로 이어진다.
 */
export function uncross(book: OrderBook, refPrice?: bigint): { clearing: ClearingResult | null; fills: Fill[] } {
  const buys = book.orders('buy');
  const sells = book.orders('sell');
  const clearing = findClearingPrice(buys, sells, refPrice);
  if (!clearing) return { clearing: null, fills: [] };
  const eligibleBuys = buys.filter((o) => o.price >= clearing.price);
  const eligibleSells = sells.filter((o) => o.price <= clearing.price);
  const fills: Fill[] = [];
  let left = clearing.volume;
  let bi = 0, si = 0;
  const buyLeft = new Map(eligibleBuys.map((o) => [o.id, o.remaining]));
  const sellLeft = new Map(eligibleSells.map((o) => [o.id, o.remaining]));
  while (left > 0n && bi < eligibleBuys.length && si < eligibleSells.length) {
    const b = eligibleBuys[bi], s = eligibleSells[si];
    if (b.userId === s.userId) {
      // 자전거래는 건너뛴다: 나중에 들어온 쪽을 다음 상대와 매칭
      if (b.seq > s.seq) bi++; else si++;
      continue;
    }
    const qty = minBig(minBig(buyLeft.get(b.id)!, sellLeft.get(s.id)!), left);
    // 콜옥션은 메이커/테이커 구분이 없으므로 나중에 들어온 주문을 테이커로 기록
    const [maker, taker] = b.seq < s.seq ? [b, s] : [s, b];
    fills.push({
      makerOrderId: maker.id, makerUserId: maker.userId,
      takerOrderId: taker.id, takerUserId: taker.userId, takerSide: taker.side,
      price: clearing.price, qty,
    });
    left -= qty;
    buyLeft.set(b.id, buyLeft.get(b.id)! - qty);
    sellLeft.set(s.id, sellLeft.get(s.id)! - qty);
    if (buyLeft.get(b.id) === 0n) bi++;
    if (sellLeft.get(s.id) === 0n) si++;
  }
  // 호가창에 반영
  for (const [id, rem] of [...buyLeft, ...sellLeft]) {
    const o = book.get(id)!;
    if (rem === 0n) book.cancel(id); else o.remaining = rem;
  }
  return { clearing, fills };
}

/**
 * 콜옥션 이후에도 호가가 교차해 있으면(자전거래 건너뛰기 등) 접수 순서대로 다시 넣어
 * 연속 매매 규칙으로 정리한다.
 */
export function resolveCrossed(book: OrderBook): { fills: Fill[]; canceled: BookOrder[] } {
  const fills: Fill[] = [];
  const canceled: BookOrder[] = [];
  if (!book.isCrossed()) return { fills, canceled };
  const all = [...book.orders('buy'), ...book.orders('sell')].sort((a, b) => a.seq - b.seq);
  for (const o of all) book.cancel(o.id);
  for (const o of all) {
    if (canceled.some((c) => c.id === o.id)) continue;
    const r = book.match({ id: o.id, userId: o.userId, side: o.side, type: 'limit', price: o.price, qty: o.remaining, seq: o.seq });
    fills.push(...r.fills);
    canceled.push(...r.selfTradeCanceled);
    // 호가창에 다시 올라간 객체와 원래 객체의 잔량을 동기화
    if (r.rested) o.remaining = r.rested.remaining;
  }
  return { fills, canceled };
}
