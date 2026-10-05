import { describe, expect, it } from 'vitest';
import { OrderBook, type IncomingOrder } from '../src/core/orderbook.js';
import { toUnits as u } from '../src/core/units.js';

let seq = 0;
const limit = (id: string, userId: string, side: 'buy' | 'sell', price: string, qty: string): IncomingOrder =>
  ({ id, userId, side, type: 'limit', price: u(price), qty: u(qty), seq: ++seq });

describe('매칭 엔진: 가격-시간 우선', () => {
  it('교차하지 않는 지정가는 호가창에 쌓인다', () => {
    const b = new OrderBook();
    b.match(limit('b1', 'A', 'buy', '100', '1'));
    b.match(limit('s1', 'B', 'sell', '101', '1'));
    expect(b.bestBid()).toBe(u('100'));
    expect(b.bestAsk()).toBe(u('101'));
    expect(b.isCrossed()).toBe(false);
  });

  it('더 좋은 가격이 먼저, 같은 가격이면 먼저 들어온 주문이 먼저 체결된다', () => {
    const b = new OrderBook();
    b.match(limit('s1', 'A', 'sell', '101', '1'));
    b.match(limit('s2', 'B', 'sell', '100', '1'));
    b.match(limit('s3', 'C', 'sell', '100', '1'));
    const r = b.match(limit('b1', 'D', 'buy', '101', '2.5'));
    expect(r.fills.map((f) => [f.makerOrderId, f.price, f.qty])).toEqual([
      ['s2', u('100'), u('1')],
      ['s3', u('100'), u('1')],
      ['s1', u('101'), u('0.5')],
    ]);
    expect(r.rested).toBeNull();
    expect(b.get('s1')!.remaining).toBe(u('0.5'));
  });

  it('체결 가격은 메이커 가격이고 남은 지정가 잔량은 호가창에 올라간다', () => {
    const b = new OrderBook();
    b.match(limit('s1', 'A', 'sell', '99', '1'));
    const r = b.match(limit('b1', 'B', 'buy', '105', '3'));
    expect(r.fills[0].price).toBe(u('99'));
    expect(r.quoteSpent).toBe(u('99'));
    expect(r.rested?.remaining).toBe(u('2'));
    expect(b.bestBid()).toBe(u('105'));
  });

  it('시장가 매수는 대금 한도 안에서 체결되고 잔량은 버려진다', () => {
    const b = new OrderBook();
    b.match(limit('s1', 'A', 'sell', '100', '1'));
    b.match(limit('s2', 'A', 'sell', '200', '1'));
    const r = b.match({ id: 'm1', userId: 'B', side: 'buy', type: 'market', quoteBudget: u('200'), seq: ++seq });
    expect(r.fills.map((f) => f.qty)).toEqual([u('1'), u('0.5')]);
    expect(r.quoteSpent).toBe(u('200'));
    expect(r.rested).toBeNull();
    expect(b.size).toBe(1);
  });

  it('시장가 매도는 보호 가격 아래로 체결하지 않는다', () => {
    const b = new OrderBook();
    b.match(limit('b1', 'A', 'buy', '100', '1'));
    b.match(limit('b2', 'A', 'buy', '80', '1'));
    const r = b.match({ id: 'm1', userId: 'B', side: 'sell', type: 'market', qty: u('2'), protectPrice: u('90'), seq: ++seq });
    expect(r.fills).toHaveLength(1);
    expect(r.remaining).toBe(u('1'));
    expect(b.bestBid()).toBe(u('80'));
  });

  it('자전거래는 체결하지 않고 내 기존 주문을 취소한다', () => {
    const b = new OrderBook();
    b.match(limit('s1', 'A', 'sell', '100', '1'));
    b.match(limit('s2', 'B', 'sell', '100', '1'));
    const r = b.match(limit('b1', 'A', 'buy', '100', '1'));
    expect(r.selfTradeCanceled.map((o) => o.id)).toEqual(['s1']);
    expect(r.fills).toEqual([expect.objectContaining({ makerOrderId: 's2', makerUserId: 'B' })]);
  });

  it('취소하면 호가창에서 사라진다', () => {
    const b = new OrderBook();
    b.match(limit('b1', 'A', 'buy', '100', '1'));
    b.match(limit('b2', 'A', 'buy', '100', '2'));
    expect(b.cancel('b1')?.id).toBe('b1');
    expect(b.cancel('b1')).toBeNull();
    expect(b.depth().bids).toEqual([{ price: u('100'), qty: u('2'), count: 1 }]);
  });

  it('체결 수량의 합은 주문 수량과 정확히 일치한다 (보존)', () => {
    const b = new OrderBook();
    let total = 0n;
    for (let i = 0; i < 50; i++) {
      const q = u(String(1 + (i % 7))) / 3n;
      total += q;
      b.match({ id: `s${i}`, userId: `M${i % 5}`, side: 'sell', type: 'limit', price: u(String(100 + (i % 10))), qty: q, seq: ++seq });
    }
    const r = b.match({ id: 't', userId: 'T', side: 'buy', type: 'limit', price: u('1000'), qty: total, seq: ++seq });
    expect(r.fills.reduce((s, f) => s + f.qty, 0n)).toBe(total);
    expect(b.size).toBe(0);
  });
});
