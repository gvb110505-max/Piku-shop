/**
 * 가격-시간 우선 매칭 엔진 (순수 인메모리, 부수효과 없음).
 * 엔진 프로세스가 Redis 스트림의 명령을 하나씩 순서대로 넣어 호출하므로
 * 이 클래스는 동시성 제어를 하지 않는다.
 */
import { minBig, notional, SCALE } from './units.js';

export type Side = 'buy' | 'sell';

export interface BookOrder {
  id: string;
  userId: string;
  side: Side;
  price: bigint;
  remaining: bigint;
  seq: number; // 접수 순서 (시간 우선)
}

export interface IncomingOrder {
  id: string;
  userId: string;
  side: Side;
  type: 'limit' | 'market';
  seq: number;
  price?: bigint;        // 지정가
  qty?: bigint;          // 수량 (시장가 매수는 quoteBudget 대신 쓸 수 있음)
  quoteBudget?: bigint;  // 시장가 매수: 쓸 수 있는 최대 대금
  protectPrice?: bigint; // 시장가 보호 가격 (매수는 이보다 비싸게, 매도는 이보다 싸게 체결하지 않음)
}

export interface Fill {
  makerOrderId: string;
  makerUserId: string;
  takerOrderId: string;
  takerUserId: string;
  takerSide: Side;
  price: bigint;
  qty: bigint;
}

export interface MatchResult {
  fills: Fill[];
  rested: BookOrder | null;    // 지정가 잔량이 호가창에 올라간 경우
  selfTradeCanceled: BookOrder[]; // 자전거래 방지로 취소된 내 메이커 주문
  remaining: bigint;           // 체결되지 못한 잔량 (시장가는 취소됨)
  quoteSpent: bigint;          // 테이커가 주고받은 총 대금
}

export interface DepthLevel { price: bigint; qty: bigint; count: number }

interface Level { price: bigint; orders: BookOrder[] }

export class OrderBook {
  private bids: Level[] = []; // 가격 내림차순
  private asks: Level[] = []; // 가격 오름차순
  private byId = new Map<string, BookOrder>();

  get size() { return this.byId.size; }
  has(id: string) { return this.byId.has(id); }
  get(id: string) { return this.byId.get(id); }

  bestBid(): bigint | null { return this.bids[0]?.price ?? null; }
  bestAsk(): bigint | null { return this.asks[0]?.price ?? null; }

  /** 매칭 없이 호가창에 올린다 (재시작 복원, 콜옥션 접수 기간). */
  add(order: BookOrder): void {
    if (this.byId.has(order.id)) throw new Error(`중복 주문 ${order.id}`);
    const levels = order.side === 'buy' ? this.bids : this.asks;
    const better = order.side === 'buy'
      ? (a: bigint, b: bigint) => a > b
      : (a: bigint, b: bigint) => a < b;
    // 이진 탐색으로 가격 레벨 위치 찾기
    let lo = 0, hi = levels.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (levels[mid].price === order.price) { lo = mid; hi = -1; break; }
      if (better(levels[mid].price, order.price)) lo = mid + 1; else hi = mid;
    }
    if (hi === -1) {
      const q = levels[lo].orders;
      // 같은 가격 안에서는 seq 오름차순(시간 우선) 유지
      let i = q.length;
      while (i > 0 && q[i - 1].seq > order.seq) i--;
      q.splice(i, 0, order);
    } else {
      levels.splice(lo, 0, { price: order.price, orders: [order] });
    }
    this.byId.set(order.id, order);
  }

  /** 주문 취소. 호가창에 없으면 null. */
  cancel(id: string): BookOrder | null {
    const order = this.byId.get(id);
    if (!order) return null;
    const levels = order.side === 'buy' ? this.bids : this.asks;
    const li = levels.findIndex((l) => l.price === order.price);
    const level = levels[li];
    level.orders.splice(level.orders.indexOf(order), 1);
    if (level.orders.length === 0) levels.splice(li, 1);
    this.byId.delete(id);
    return order;
  }

  /**
   * 들어온 주문을 반대편 호가와 가격-시간 우선으로 체결한다.
   * - 체결 가격은 항상 메이커(먼저 있던 주문)의 가격
   * - 같은 사용자의 주문끼리는 체결하지 않고 기존 메이커 주문을 취소 (자전거래 방지)
   * - 지정가 잔량은 호가창에 올리고, 시장가 잔량은 버린다
   */
  match(o: IncomingOrder): MatchResult {
    const fills: Fill[] = [];
    const selfTradeCanceled: BookOrder[] = [];
    const opposite = o.side === 'buy' ? this.asks : this.bids;
    let remaining = o.qty ?? 0n;
    let budget = o.quoteBudget ?? -1n; // -1 = 대금 제한 없음
    const byBudget = o.type === 'market' && o.side === 'buy' && o.quoteBudget !== undefined && o.qty === undefined;
    let quoteSpent = 0n;

    const crosses = (price: bigint) => {
      if (o.type === 'limit') return o.side === 'buy' ? price <= o.price! : price >= o.price!;
      if (o.protectPrice === undefined) return true;
      return o.side === 'buy' ? price <= o.protectPrice : price >= o.protectPrice;
    };

    while (opposite.length > 0) {
      if (!byBudget && remaining <= 0n) break;
      if (byBudget && budget <= 0n) break;
      const level = opposite[0];
      if (!crosses(level.price)) break;
      const maker = level.orders[0];

      if (maker.userId === o.userId) {
        this.cancel(maker.id);
        selfTradeCanceled.push(maker);
        continue;
      }

      let qty = byBudget ? (budget * SCALE) / level.price : remaining;
      qty = minBig(qty, maker.remaining);
      if (qty <= 0n) break; // 남은 대금으로 최소 단위도 못 삼
      const quote = notional(level.price, qty);

      fills.push({
        makerOrderId: maker.id, makerUserId: maker.userId,
        takerOrderId: o.id, takerUserId: o.userId, takerSide: o.side,
        price: level.price, qty,
      });
      quoteSpent += quote;
      if (byBudget) budget -= quote; else remaining -= qty;
      maker.remaining -= qty;
      if (maker.remaining === 0n) {
        level.orders.shift();
        this.byId.delete(maker.id);
        if (level.orders.length === 0) opposite.shift();
      }
    }

    let rested: BookOrder | null = null;
    if (o.type === 'limit' && remaining > 0n) {
      rested = { id: o.id, userId: o.userId, side: o.side, price: o.price!, remaining, seq: o.seq };
      this.add(rested);
    }
    return { fills, rested, selfTradeCanceled, remaining: byBudget ? 0n : remaining, quoteSpent };
  }

  /** 호가창 집계 (가격별 잔량 합). */
  depth(limit = 20): { bids: DepthLevel[]; asks: DepthLevel[] } {
    const agg = (levels: Level[]) => levels.slice(0, limit).map((l) => ({
      price: l.price,
      qty: l.orders.reduce((s, x) => s + x.remaining, 0n),
      count: l.orders.length,
    }));
    return { bids: agg(this.bids), asks: agg(this.asks) };
  }

  /** 모든 주문 (우선순위 순). 콜옥션/스냅샷용. */
  orders(side: Side): BookOrder[] {
    return (side === 'buy' ? this.bids : this.asks).flatMap((l) => l.orders);
  }

  isCrossed(): boolean {
    const b = this.bestBid(), a = this.bestAsk();
    return b !== null && a !== null && b >= a;
  }
}
