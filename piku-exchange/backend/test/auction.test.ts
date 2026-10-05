import { describe, expect, it } from 'vitest';
import { findClearingPrice, resolveCrossed, uncross } from '../src/core/auction.js';
import { OrderBook, type BookOrder } from '../src/core/orderbook.js';
import { toUnits as u } from '../src/core/units.js';

let seq = 0;
const o = (id: string, userId: string, side: 'buy' | 'sell', price: string, qty: string): BookOrder =>
  ({ id, userId, side, price: u(price), remaining: u(qty), seq: ++seq });

describe('콜옥션 단일가 결정', () => {
  it('체결 수량이 최대가 되는 가격을 고른다', () => {
    const buys = [o('b1', 'A', 'buy', '110', '10'), o('b2', 'B', 'buy', '100', '10'), o('b3', 'C', 'buy', '90', '10')];
    const sells = [o('s1', 'D', 'sell', '85', '5'), o('s2', 'E', 'sell', '95', '10'), o('s3', 'F', 'sell', '105', '10')];
    const r = findClearingPrice(buys, sells)!;
    // 95: 수요 20, 공급 15 → 15 / 100: 수요 20, 공급 15 → 15 / 105: 수요 10, 공급 25 → 10
    // 95와 100이 15로 동률, 잔량도 5로 동률, 둘 다 매수 초과 → 높은 가격
    expect(r.volume).toBe(u('15'));
    expect(r.price).toBe(u('100'));
  });

  it('주문이 교차하지 않으면 체결가가 없다', () => {
    expect(findClearingPrice([o('b', 'A', 'buy', '90', '1')], [o('s', 'B', 'sell', '100', '1')])).toBeNull();
  });

  it('동률이면 기준가에 가까운 가격을 고른다', () => {
    const buys = [o('b1', 'A', 'buy', '120', '10')];
    const sells = [o('s1', 'B', 'sell', '80', '10')];
    expect(findClearingPrice(buys, sells, u('115'))!.price).toBe(u('120'));
    expect(findClearingPrice(buys, sells, u('81'))!.price).toBe(u('80'));
  });

  it('모든 체결이 같은 가격에 일어나고 이후 호가창은 교차하지 않는다', () => {
    const book = new OrderBook();
    [o('b1', 'A', 'buy', '110', '10'), o('b2', 'B', 'buy', '100', '10'), o('s1', 'C', 'sell', '90', '12'), o('s2', 'D', 'sell', '105', '5')]
      .forEach((x) => book.add(x));
    expect(book.isCrossed()).toBe(true);
    const { clearing, fills } = uncross(book);
    expect(fills.every((f) => f.price === clearing!.price)).toBe(true);
    expect(fills.reduce((s, f) => s + f.qty, 0n)).toBe(clearing!.volume);
    expect(book.isCrossed()).toBe(false);
    // 가격 우선: 110 매수가 먼저 전량 체결
    expect(book.get('b1')).toBeUndefined();
  });

  it('같은 사용자끼리는 체결하지 않고 남은 교차는 연속매매 규칙으로 정리한다', () => {
    const book = new OrderBook();
    [o('b1', 'A', 'buy', '100', '1'), o('s1', 'A', 'sell', '100', '1')].forEach((x) => book.add(x));
    const { fills } = uncross(book);
    expect(fills).toHaveLength(0);
    const r = resolveCrossed(book);
    expect(r.fills).toHaveLength(0);
    expect(r.canceled.map((c) => c.id)).toEqual(['b1']);
    expect(book.isCrossed()).toBe(false);
  });
});
