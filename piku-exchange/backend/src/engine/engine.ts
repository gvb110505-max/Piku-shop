/**
 * 매칭 엔진 프로세스의 본체.
 *
 * 순서 보장: 모든 상태 변경(주문, 취소, 콜옥션, 청산, 펀딩, 만기 정산)은 serial()을 통해
 * 하나씩 실행된다. Redis 스트림에서 오는 명령과 내부 타이머가 같은 직렬 큐를 공유하므로
 * 동시에 두 개의 명령이 호가창이나 잔고를 건드리는 일이 없다.
 *
 * 각 명령은 하나의 PostgreSQL 트랜잭션 안에서 처리된다. 실패하면 DB는 롤백되고
 * 메모리의 호가창은 DB에서 다시 읽어 일관성을 회복한다.
 */
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { resolveCrossed, uncross, findClearingPrice } from '../core/auction.js';
import { buyerMargin, miningFutureMarketId, settle, upcomingExpiries, type Contract, type Wallet } from '../core/miningFutures.js';
import { OrderBook, type Fill, type MatchResult, type Side } from '../core/orderbook.js';
import {
  applyFill, crossNeedsLiquidation, emptyPosition, fundingPayment, fundingRatePpm, initialMargin,
  isolatedNeedsLiquidation, liquidate, markPrice, type MarginMode, type Position,
} from '../core/perp.js';
import { absBig, BPS, fromUnits, minBig, notional, toUnits } from '../core/units.js';
import { ASSET, config, MARKET, SYSTEM_USERS } from '../config.js';
import { big, withTx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { toJson } from '../lib/json.js';
import { adjustBalance, getBalance, InsufficientFunds, UserError } from '../lib/ledger.js';
import { deliveryObligation, mfSellCapacity } from '../lib/poolStats.js';
import { KEYS } from '../lib/redis.js';
import { loadSettings, saveSetting, type Settings } from '../lib/settings.js';

export interface Market {
  id: string;
  kind: 'spot' | 'mining_future' | 'perp';
  base: string;
  quote: string;
  status: 'pre' | 'auction' | 'open' | 'settled';
  paused: boolean;
  expiryAt: Date | null;
}

export interface Ord {
  id: string;
  seq: number;
  marketId: string;
  userId: string;
  side: Side;
  type: 'limit' | 'market';
  price: bigint | null;
  qty: bigint | null;
  quoteBudget: bigint | null;
  remaining: bigint;
  filledQty: bigint;
  quoteFilled: bigint;
  lockAsset: string | null;
  locked: bigint;
  leverage: number | null;
  marginMode: MarginMode | null;
  reduceOnly: boolean;
  status: 'open' | 'filled' | 'canceled';
  cancelReason?: string | null;
}

export interface Command {
  cmdId: string;
  type: string;
  payload: Record<string, unknown>;
  actorId?: string;
  ip?: string;
}

type Event = { ch: string; data: unknown };

const OPEN_ORDER_COLUMNS = `id, seq, market_id, user_id, side, type, price, qty, quote_budget, remaining, filled_qty,
  quote_filled, lock_asset, locked, leverage, margin_mode, reduce_only, status, cancel_reason`;

function rowToOrd(r: Record<string, string | number | boolean | null>): Ord {
  const n = (v: unknown) => (v === null || v === undefined ? null : BigInt(v as string));
  return {
    id: r.id as string, seq: Number(r.seq), marketId: r.market_id as string, userId: r.user_id as string,
    side: r.side as Side, type: r.type as 'limit' | 'market', price: n(r.price), qty: n(r.qty), quoteBudget: n(r.quote_budget),
    remaining: BigInt(r.remaining as string), filledQty: BigInt(r.filled_qty as string), quoteFilled: BigInt(r.quote_filled as string),
    lockAsset: r.lock_asset as string | null, locked: BigInt(r.locked as string), leverage: r.leverage as number | null,
    marginMode: r.margin_mode as MarginMode | null, reduceOnly: Boolean(r.reduce_only), status: r.status as Ord['status'],
    cancelReason: r.cancel_reason as string | null,
  };
}

const parsePositive = (v: unknown, name: string): bigint => {
  if (typeof v !== 'string' && typeof v !== 'number') throw new UserError(`${name}을(를) 입력하세요`);
  let x: bigint;
  try { x = toUnits(String(v)); } catch { throw new UserError(`${name} 형식이 올바르지 않습니다 (소수점 8자리까지)`); }
  if (x <= 0n) throw new UserError(`${name}은(는) 0보다 커야 합니다`);
  return x;
};

export class Engine {
  books = new Map<string, OrderBook>();
  markets = new Map<string, Market>();
  lastPrice = new Map<string, bigint>();
  settings!: Settings;
  private chain: Promise<unknown> = Promise.resolve();
  private events: Event[] = [];
  private touched = new Set<string>();
  private orderCache = new Map<string, Ord>();
  /** 테스트에서 시간을 고정하기 위한 훅 */
  now: () => Date = () => new Date();

  constructor(private db: pg.Pool, private pub: Redis) {}

  // ================================================================
  // 초기화 / 직렬 실행
  // ================================================================
  async init(): Promise<void> {
    this.settings = await loadSettings(this.db);
    await this.loadMarkets();
    await this.serial(() => withTx(this.db, (c) => this.ensureMiningFutureMarkets(c)));
    for (const id of this.markets.keys()) await this.reloadBook(id);
    for (const id of this.markets.keys()) await this.publishBook(id);
    await this.publishMark();
  }

  /** 모든 상태 변경은 이 함수를 통해 한 번에 하나씩 실행된다. */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  async execute(cmd: Command): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
    return this.serial(async () => {
      this.events = [];
      this.touched.clear();
      this.orderCache.clear();
      try {
        const result = await withTx(this.db, (c) => this.dispatch(c, cmd));
        await this.flush();
        return { ok: true as const, result };
      } catch (e) {
        // DB는 롤백됨 → 메모리 상태를 DB 기준으로 복구
        for (const id of this.touched) await this.reloadBook(id).catch(() => {});
        this.settings = await loadSettings(this.db);
        await this.loadMarkets();
        const known = e instanceof UserError || e instanceof InsufficientFunds;
        if (!known) console.error(`[engine] ${cmd.type} 실패`, e);
        return { ok: false as const, error: known ? (e as Error).message : '처리 중 오류가 발생했습니다' };
      }
    });
  }

  private async dispatch(c: pg.PoolClient, cmd: Command): Promise<unknown> {
    const p = cmd.payload;
    switch (cmd.type) {
      case 'place_order': return this.placeOrder(c, p, cmd.ip);
      case 'cancel_order': return this.cancelOrder(c, String(p.userId), String(p.orderId), Boolean(p.admin));
      case 'cancel_all': return this.cancelAll(c, String(p.userId), p.marketId ? String(p.marketId) : undefined);
      case 'start_listing': return this.startListing(c, cmd.actorId!);
      case 'end_auction': return this.endAuction(c, Boolean(p.force), cmd.actorId);
      case 'set_market_paused': return this.setPaused(c, String(p.marketId), Boolean(p.paused), cmd.actorId!);
      case 'reload_settings': this.settings = await loadSettings(c); return { reloaded: true };
      case 'ensure_mf_markets': return this.ensureMiningFutureMarkets(c);
      case 'settle_mf': return this.settleMiningFuture(c, String(p.marketId));
      case 'liquidation_check': return this.liquidationCheck(c);
      case 'funding': return this.runFunding(c, new Date(String(p.fundingTime)));
      default: throw new UserError(`알 수 없는 명령: ${cmd.type}`);
    }
  }

  // ================================================================
  // 로딩 / 발행
  // ================================================================
  private async loadMarkets(): Promise<void> {
    const { rows } = await this.db.query('SELECT id, kind, base, quote, status, paused, expiry_at FROM markets');
    this.markets.clear();
    for (const r of rows) {
      this.markets.set(r.id, { id: r.id, kind: r.kind, base: r.base, quote: r.quote, status: r.status, paused: r.paused, expiryAt: r.expiry_at });
    }
  }

  async reloadBook(marketId: string): Promise<void> {
    const book = new OrderBook();
    const { rows } = await this.db.query(
      `SELECT ${OPEN_ORDER_COLUMNS} FROM orders WHERE market_id = $1 AND status = 'open' AND type = 'limit' AND remaining > 0 ORDER BY seq`, [marketId]);
    for (const r of rows) {
      const o = rowToOrd(r);
      book.add({ id: o.id, userId: o.userId, side: o.side, price: o.price!, remaining: o.remaining, seq: o.seq });
    }
    this.books.set(marketId, book);
    const last = await this.db.query<{ price: string }>('SELECT price FROM trades WHERE market_id = $1 ORDER BY id DESC LIMIT 1', [marketId]);
    if (last.rows[0]) this.lastPrice.set(marketId, BigInt(last.rows[0].price)); else this.lastPrice.delete(marketId);
  }

  private book(marketId: string): OrderBook {
    this.touched.add(marketId);
    let b = this.books.get(marketId);
    if (!b) { b = new OrderBook(); this.books.set(marketId, b); }
    return b;
  }

  private emit(ch: string, data: unknown) { this.events.push({ ch, data }); }
  private notifyUser(userId: string, what: string) { this.emit(`user:${userId}`, { type: what }); }

  private async flush(): Promise<void> {
    for (const id of this.touched) await this.publishBook(id);
    if (this.touched.has(MARKET.SPOT) || this.touched.has(MARKET.PERP)) await this.publishMark();
    const pipeline = this.pub.pipeline();
    for (const e of this.events) pipeline.publish(KEYS.EVENTS, toJson(e));
    await pipeline.exec();
    this.events = [];
  }

  async publishBook(marketId: string): Promise<void> {
    const book = this.books.get(marketId) ?? new OrderBook();
    const d = book.depth(30);
    const fmt = (l: { price: bigint; qty: bigint }) => [fromUnits(l.price), fromUnits(l.qty)];
    const snapshot: Record<string, unknown> = {
      market: marketId, bids: d.bids.map(fmt), asks: d.asks.map(fmt),
      last: this.lastPrice.has(marketId) ? fromUnits(this.lastPrice.get(marketId)!) : null,
      status: this.markets.get(marketId)?.status, paused: this.markets.get(marketId)?.paused,
    };
    if (this.markets.get(marketId)?.status === 'auction') {
      const ind = findClearingPrice(book.orders('buy'), book.orders('sell'));
      snapshot.indicative = ind ? { price: fromUnits(ind.price), volume: fromUnits(ind.volume) } : null;
      snapshot.auctionEndAt = this.settings.auction_end_at;
    }
    await this.pub.set(`book:${marketId}`, JSON.stringify(snapshot));
    await this.pub.publish(KEYS.EVENTS, JSON.stringify({ ch: `book:${marketId}`, data: snapshot }));
  }

  /** 현물 기반 마크 가격. */
  currentMark(): bigint | null {
    const spot = this.books.get(MARKET.SPOT);
    return markPrice(spot?.bestBid() ?? null, spot?.bestAsk() ?? null, this.lastPrice.get(MARKET.SPOT) ?? null);
  }

  private perpPrice(): bigint | null {
    const b = this.books.get(MARKET.PERP);
    const bid = b?.bestBid() ?? null, ask = b?.bestAsk() ?? null;
    if (bid !== null && ask !== null) return (bid + ask) / 2n;
    return this.lastPrice.get(MARKET.PERP) ?? null;
  }

  async publishMark(): Promise<void> {
    const mark = this.currentMark();
    const rate = mark === null ? 0n : fundingRatePpm(this.perpPrice(), mark, BigInt(this.settings.perp_funding_cap_ppm));
    const data = {
      mark: mark === null ? null : fromUnits(mark),
      perpPrice: this.perpPrice() === null ? null : fromUnits(this.perpPrice()!),
      estimatedFundingRate: Number(rate) / 1e6,
      nextFundingAt: this.nextFundingTime().toISOString(),
    };
    await this.pub.set('perp:mark', JSON.stringify(data));
    await this.pub.publish(KEYS.EVENTS, JSON.stringify({ ch: 'mark', data }));
  }

  // ================================================================
  // 주문 DB 입출력
  // ================================================================
  private async insertOrder(c: pg.PoolClient, o: Omit<Ord, 'seq'>): Promise<Ord> {
    const { rows } = await c.query<{ seq: string }>(
      `INSERT INTO orders (id, market_id, user_id, side, type, price, qty, quote_budget, remaining, lock_asset, locked,
         leverage, margin_mode, reduce_only, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'open') RETURNING seq`,
      [o.id, o.marketId, o.userId, o.side, o.type, o.price?.toString() ?? null, o.qty?.toString() ?? null,
        o.quoteBudget?.toString() ?? null, o.remaining.toString(), o.lockAsset, o.locked.toString(),
        o.leverage, o.marginMode, o.reduceOnly],
    );
    const ord = { ...o, seq: Number(rows[0].seq) };
    this.orderCache.set(ord.id, ord);
    return ord;
  }

  private async getOrd(c: pg.PoolClient, id: string): Promise<Ord> {
    const cached = this.orderCache.get(id);
    if (cached) return cached;
    const { rows } = await c.query(`SELECT ${OPEN_ORDER_COLUMNS} FROM orders WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows[0]) throw new Error(`주문 ${id} 없음`);
    const o = rowToOrd(rows[0]);
    this.orderCache.set(id, o);
    return o;
  }

  private async saveOrd(c: pg.PoolClient, o: Ord): Promise<void> {
    await c.query(
      `UPDATE orders SET remaining = $2, filled_qty = $3, quote_filled = $4, locked = $5, status = $6, cancel_reason = $7, updated_at = now()
       WHERE id = $1`,
      [o.id, o.remaining.toString(), o.filledQty.toString(), o.quoteFilled.toString(), o.locked.toString(), o.status, o.cancelReason ?? null],
    );
    this.notifyUser(o.userId, 'order');
  }

  private async release(c: pg.PoolClient, o: Ord, amount: bigint, reason = 'order_unlock'): Promise<void> {
    if (amount <= 0n || !o.lockAsset) return;
    await adjustBalance(c, o.userId, o.lockAsset, amount, -amount, reason, o.id);
    o.locked -= amount;
    this.notifyUser(o.userId, 'balance');
  }

  private async finish(c: pg.PoolClient, o: Ord, status: 'filled' | 'canceled', reason?: string): Promise<void> {
    await this.release(c, o, o.locked);
    o.status = status;
    o.cancelReason = reason ?? null;
    if (status === 'canceled' && this.books.get(o.marketId)?.has(o.id)) this.book(o.marketId).cancel(o.id);
    await this.saveOrd(c, o);
  }

  // ================================================================
  // 주문 접수
  // ================================================================
  private async loadUser(c: pg.PoolClient, userId: string) {
    const { rows } = await c.query(
      'SELECT id, role, is_operator, trading_banned, kyc_status, email_verified FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw new UserError('사용자를 찾을 수 없습니다', 404);
    return rows[0] as { id: string; role: string; is_operator: boolean; trading_banned: boolean; kyc_status: string; email_verified: boolean };
  }

  private async assertCanTrade(c: pg.PoolClient, userId: string, m: Market): Promise<void> {
    const u = await this.loadUser(c, userId);
    if (u.role === 'system') throw new UserError('시스템 계정은 주문할 수 없습니다');
    if (!u.email_verified) throw new UserError('이메일 인증 후 거래할 수 있습니다', 403);
    if (u.trading_banned) throw new UserError('거래가 제한된 계정입니다', 403);
    if (u.is_operator && m.base === ASSET.COIN) throw new UserError(`운영자 계정은 ${ASSET.COIN} 거래가 금지되어 있습니다`, 403);
    if (config.realMoney && u.kyc_status !== 'approved') throw new UserError('KYC 인증 후 거래할 수 있습니다', 403);
  }

  private async placeOrder(c: pg.PoolClient, p: Record<string, unknown>, ip?: string): Promise<unknown> {
    const orderId = String(p.orderId);
    const existing = await c.query('SELECT id, status FROM orders WHERE id = $1', [orderId]);
    if (existing.rows[0]) return { orderId, status: existing.rows[0].status, duplicate: true }; // 재처리(멱등)

    const m = this.markets.get(String(p.marketId));
    if (!m) throw new UserError('존재하지 않는 마켓입니다', 404);
    if (m.paused) throw new UserError('일시정지된 마켓입니다');
    const userId = String(p.userId);
    await this.assertCanTrade(c, userId, m);

    const side = p.side === 'buy' || p.side === 'sell' ? p.side : null;
    if (!side) throw new UserError('side는 buy 또는 sell 이어야 합니다');
    const type = p.type === 'market' ? 'market' : 'limit';

    let result: unknown;
    if (m.kind === 'spot') result = await this.placeSpot(c, m, orderId, userId, side, type, p);
    else if (m.kind === 'perp') result = await this.placePerp(c, m, orderId, userId, side, type, p);
    else result = await this.placeMiningFuture(c, m, orderId, userId, side, type, p);

    await audit(c, { action: 'order.place', userId, ip, details: { orderId, market: m.id, side, type, price: p.price, qty: p.qty, quoteAmount: p.quoteAmount } });
    return result;
  }

  private baseOrd(orderId: string, m: Market, userId: string, side: Side, type: 'limit' | 'market'): Omit<Ord, 'seq'> {
    return {
      id: orderId, marketId: m.id, userId, side, type, price: null, qty: null, quoteBudget: null, remaining: 0n,
      filledQty: 0n, quoteFilled: 0n, lockAsset: null, locked: 0n, leverage: null, marginMode: null, reduceOnly: false, status: 'open',
    };
  }

  private summary(o: Ord) {
    return {
      orderId: o.id, status: o.status, filledQty: fromUnits(o.filledQty), remaining: fromUnits(o.remaining),
      avgPrice: o.filledQty > 0n ? fromUnits((o.quoteFilled * 100_000_000n) / o.filledQty) : null, cancelReason: o.cancelReason ?? null,
    };
  }

  // ---------------- 현물 ----------------
  private async placeSpot(c: pg.PoolClient, m: Market, orderId: string, userId: string, side: Side, type: 'limit' | 'market', p: Record<string, unknown>) {
    if (m.status === 'pre') throw new UserError(`${ASSET.COIN}은(는) 상장 전입니다. 현물 거래는 상장 후 가능합니다`);
    if (m.status === 'auction' && type === 'market') throw new UserError('콜옥션 중에는 지정가 주문만 가능합니다');

    const o = this.baseOrd(orderId, m, userId, side, type);
    if (type === 'limit') {
      o.price = parsePositive(p.price, '가격');
      o.qty = parsePositive(p.qty, '수량');
    } else if (side === 'buy') {
      o.quoteBudget = parsePositive(p.quoteAmount, '주문 총액');
    } else {
      o.qty = parsePositive(p.qty, '수량');
    }
    o.remaining = o.qty ?? 0n;

    if (side === 'buy') {
      o.lockAsset = m.quote;
      o.locked = type === 'limit' ? notional(o.price!, o.qty!) : o.quoteBudget!;
      if (o.locked <= 0n) throw new UserError('주문 금액이 너무 작습니다');
    } else {
      o.lockAsset = m.base;
      o.locked = o.qty!;
      // 채굴량 선물 인도 의무만큼은 현물로 팔 수 없다
      const obligation = await deliveryObligation(c, userId);
      if (obligation > 0n) {
        const bal = await getBalance(c, userId, m.base, true);
        const free = bal.available - obligation;
        if (o.qty! > free) {
          throw new UserError(`채굴량 선물 인도 예정 수량(${fromUnits(obligation)})을 제외한 매도 가능 수량은 ${fromUnits(free > 0n ? free : 0n)}입니다`);
        }
      }
    }
    await adjustBalance(c, userId, o.lockAsset, -o.locked, o.locked, 'order_lock', orderId);
    const ord = await this.insertOrder(c, o);
    this.notifyUser(userId, 'balance');

    const book = this.book(m.id);
    if (m.status === 'auction') {
      book.add({ id: ord.id, userId, side, price: ord.price!, remaining: ord.remaining, seq: ord.seq });
      await this.saveOrd(c, ord);
      return this.summary(ord);
    }
    const r = book.match({
      id: ord.id, userId, side, type, seq: ord.seq, price: ord.price ?? undefined,
      qty: ord.quoteBudget !== null ? undefined : ord.qty!, quoteBudget: ord.quoteBudget ?? undefined,
    });
    await this.processMatch(c, m, ord, r, 'continuous');
    return this.summary(ord);
  }

  /** 매칭 결과를 DB/잔고에 반영. 모든 마켓 종류 공통. */
  private async processMatch(c: pg.PoolClient, m: Market, taker: Ord | null, r: Pick<MatchResult, 'fills' | 'selfTradeCanceled'>, kind: string): Promise<void> {
    for (const mk of r.selfTradeCanceled) await this.finish(c, await this.getOrd(c, mk.id), 'canceled', 'self_trade_prevention');
    const touchedOrders = new Map<string, Ord>();
    for (const f of r.fills) {
      const maker = await this.getOrd(c, f.makerOrderId);
      const tk = taker && taker.id === f.takerOrderId ? taker : await this.getOrd(c, f.takerOrderId);
      touchedOrders.set(maker.id, maker); touchedOrders.set(tk.id, tk);
      const tradeId = await this.insertTrade(c, m, f, kind);
      if (m.kind === 'spot') await this.settleSpotFill(c, m, f, maker, tk, tradeId);
      else if (m.kind === 'perp') await this.settlePerpFill(c, m, f, maker, tk, tradeId);
      else await this.settleMfFill(c, m, f, maker, tk, tradeId);
      this.lastPrice.set(m.id, f.price);
    }
    if (r.fills.length) {
      this.emit(`trades:${m.id}`, r.fills.map((f) => ({ price: fromUnits(f.price), qty: fromUnits(f.qty), side: f.takerSide, time: Date.now() })));
    }
    // 지정가 주문 후처리
    for (const o of touchedOrders.values()) if (o.type === 'limit' && o.status === 'open') await this.afterLimitFill(c, o);
    // 들어온 주문 마무리
    if (taker) {
      if (taker.type === 'market') {
        // 시장가 잔량은 버린다 (체결된 만큼은 filled로 기록)
        const filled = taker.filledQty > 0n;
        const reason = taker.quoteBudget === null && taker.remaining > 0n ? (filled ? 'partial_no_liquidity' : 'no_liquidity') : undefined;
        if (taker.quoteBudget === null) taker.remaining = 0n;
        await this.finish(c, taker, filled ? 'filled' : 'canceled', reason);
      } else if (!touchedOrders.has(taker.id)) {
        await this.saveOrd(c, taker);
      }
    }
  }

  private async afterLimitFill(c: pg.PoolClient, o: Ord): Promise<void> {
    if (o.remaining === 0n) return this.finish(c, o, 'filled');
    const m = this.markets.get(o.marketId)!;
    if (m.kind === 'spot' && o.side === 'buy') {
      // 더 싼 가격에 체결된 만큼 묶어둔 대금 중 초과분을 풀어준다
      const excess = o.locked - notional(o.price!, o.remaining);
      await this.release(c, o, excess);
    }
    await this.saveOrd(c, o);
  }

  private async insertTrade(c: pg.PoolClient, m: Market, f: Fill, kind: string): Promise<number> {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO trades (market_id, price, qty, taker_side, maker_order_id, taker_order_id, maker_user_id, taker_user_id, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [m.id, f.price.toString(), f.qty.toString(), f.takerSide, f.makerOrderId, f.takerOrderId, f.makerUserId, f.takerUserId, kind],
    );
    await audit(c, { action: 'trade', userId: f.takerUserId, details: { tradeId: rows[0].id, market: m.id, price: f.price, qty: f.qty, maker: f.makerUserId, taker: f.takerUserId, kind } });
    return Number(rows[0].id);
  }

  private fillOrd(o: Ord, qty: bigint, quote: bigint) {
    o.filledQty += qty;
    o.quoteFilled += quote;
    if (o.quoteBudget === null) o.remaining -= qty;
  }

  private async settleSpotFill(c: pg.PoolClient, m: Market, f: Fill, maker: Ord, taker: Ord, tradeId: number) {
    const buyer = f.takerSide === 'buy' ? taker : maker;
    const seller = f.takerSide === 'buy' ? maker : taker;
    const quote = notional(f.price, f.qty);
    await adjustBalance(c, buyer.userId, m.quote, 0n, -quote, 'trade_pay', tradeId);
    await adjustBalance(c, buyer.userId, m.base, f.qty, 0n, 'trade_receive', tradeId);
    await adjustBalance(c, seller.userId, m.base, 0n, -f.qty, 'trade_deliver', tradeId);
    await adjustBalance(c, seller.userId, m.quote, quote, 0n, 'trade_proceeds', tradeId);
    buyer.locked -= quote;
    seller.locked -= f.qty;
    this.fillOrd(buyer, f.qty, quote);
    this.fillOrd(seller, f.qty, quote);
    this.notifyUser(buyer.userId, 'balance');
    this.notifyUser(seller.userId, 'balance');
  }

  /** 체결 수량에 비례해 주문에 묶인 금액 일부를 가용으로 돌린다 (perp/채굴량 선물). */
  private async releaseProportional(c: pg.PoolClient, o: Ord, qty: bigint): Promise<bigint> {
    if (o.locked === 0n) return 0n;
    const part = qty >= o.remaining ? o.locked : (o.locked * qty) / o.remaining;
    await this.release(c, o, part, 'fill_unlock');
    return part;
  }

  // ---------------- 무기한 선물 ----------------
  private async placePerp(c: pg.PoolClient, m: Market, orderId: string, userId: string, side: Side, type: 'limit' | 'market', p: Record<string, unknown>) {
    if (m.status !== 'open') throw new UserError('무기한 선물은 상장 후 열립니다');
    const maxLev = this.settings.perp_max_leverage;
    const leverage = Number(p.leverage ?? 1);
    if (!Number.isInteger(leverage) || leverage < 1 || leverage > maxLev) throw new UserError(`레버리지는 1~${maxLev}배 정수입니다`);
    const marginMode: MarginMode = p.marginMode === 'cross' ? 'cross' : 'isolated';
    const reduceOnly = Boolean(p.reduceOnly);

    const pos = await this.loadPosition(c, userId, m.id);
    if (pos.qty !== 0n && (pos.leverage !== leverage || pos.mode !== marginMode)) {
      throw new UserError(`보유 포지션 설정(${pos.leverage}배, ${pos.mode === 'cross' ? '교차' : '격리'})과 같아야 합니다`);
    }

    const o = this.baseOrd(orderId, m, userId, side, type);
    o.leverage = leverage; o.marginMode = marginMode; o.reduceOnly = reduceOnly; o.lockAsset = m.quote;
    o.qty = parsePositive(p.qty, '수량');
    const mark = this.currentMark();
    const protect = BigInt(this.settings.perp_protect_bps);
    let protectPrice: bigint | undefined;
    if (type === 'limit') {
      o.price = parsePositive(p.price, '가격');
    } else {
      if (mark === null) throw new UserError('마크 가격이 없어 시장가 주문을 받을 수 없습니다');
      protectPrice = side === 'buy' ? (mark * (BPS + protect)) / BPS : (mark * (BPS - protect)) / BPS;
    }
    if (reduceOnly) {
      if (type !== 'market') throw new UserError('포지션 종료(reduce-only)는 시장가로만 가능합니다');
      const closing = (pos.qty > 0n && side === 'sell') || (pos.qty < 0n && side === 'buy');
      if (!closing) throw new UserError('줄일 포지션이 없습니다');
      o.qty = minBig(o.qty, absBig(pos.qty));
      o.locked = 0n;
    } else {
      o.locked = initialMargin(o.price ?? protectPrice!, o.qty, leverage);
    }
    o.remaining = o.qty;
    await adjustBalance(c, userId, m.quote, -o.locked, o.locked, 'order_lock', orderId);
    const ord = await this.insertOrder(c, o);
    const r = this.book(m.id).match({ id: ord.id, userId, side, type, seq: ord.seq, price: ord.price ?? undefined, qty: ord.qty!, protectPrice });
    await this.processMatch(c, m, ord, r, 'continuous');
    return this.summary(ord);
  }

  async loadPosition(c: pg.PoolClient, userId: string, marketId: string): Promise<Position & { realized: bigint }> {
    const { rows } = await c.query(
      'SELECT qty, entry_price, margin, leverage, margin_mode, realized_pnl FROM positions WHERE user_id = $1 AND market_id = $2 FOR UPDATE',
      [userId, marketId]);
    if (!rows[0]) return { ...emptyPosition(1, 'isolated'), realized: 0n };
    const r = rows[0];
    return { qty: big(r.qty), entryPrice: big(r.entry_price), margin: big(r.margin), leverage: r.leverage, mode: r.margin_mode, realized: big(r.realized_pnl) };
  }

  private async savePosition(c: pg.PoolClient, userId: string, marketId: string, p: Position, realized: bigint): Promise<void> {
    await c.query(
      `INSERT INTO positions (user_id, market_id, qty, entry_price, margin, leverage, margin_mode, realized_pnl, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (user_id, market_id) DO UPDATE SET qty = $3, entry_price = $4, margin = $5, leverage = $6, margin_mode = $7,
         realized_pnl = $8, updated_at = now()`,
      [userId, marketId, p.qty.toString(), p.entryPrice.toString(), p.margin.toString(), p.leverage, p.mode, realized.toString()],
    );
    this.notifyUser(userId, 'position');
  }

  private async settlePerpFill(c: pg.PoolClient, m: Market, f: Fill, maker: Ord, taker: Ord, tradeId: number) {
    for (const o of [maker, taker]) {
      const signed = o.side === 'buy' ? f.qty : -f.qty;
      await this.releaseProportional(c, o, f.qty);
      await this.applyPerpFill(c, m.id, o.userId, signed, f.price, o.leverage ?? 1, o.marginMode ?? 'isolated', tradeId);
      this.fillOrd(o, f.qty, notional(f.price, f.qty));
    }
  }

  /**
   * 포지션에 체결 반영 + 현금흐름 처리.
   * 가용잔고 변화 = 풀려난 증거금 + 실현손익 − 새로 필요한 증거금.
   * 사용자가 감당할 수 없는 손실(청산이 늦어진 경우)은 보험기금이 메운다.
   */
  private async applyPerpFill(c: pg.PoolClient, marketId: string, userId: string, signedQty: bigint, price: bigint, leverage: number, mode: MarginMode, ref: number | string) {
    const cur = await this.loadPosition(c, userId, marketId);
    const base: Position = cur.qty === 0n ? { ...emptyPosition(leverage, mode) } : cur;
    const eff = applyFill(base, signedQty, price);
    const pos = eff.position;
    const isInsurance = userId === SYSTEM_USERS.INSURANCE;
    let added = eff.addedMargin;
    if (isInsurance) { pos.margin -= added; added = 0n; } // 보험기금은 증거금 없이 인수 포지션을 보유

    let credit = eff.releasedMargin + eff.realizedPnl - added;
    if (credit < 0n && !isInsurance) {
      const bal = await getBalance(c, userId, ASSET.QUOTE, true);
      if (bal.available < -credit) {
        // 1) 새 포지션 증거금을 가능한 만큼만 채운다  2) 그래도 모자라면 보험기금이 보전
        let shortfall = -credit - bal.available;
        const cut = minBig(shortfall, added);
        pos.margin -= cut; credit += cut; shortfall -= cut;
        if (shortfall > 0n) {
          await adjustBalance(c, SYSTEM_USERS.INSURANCE, ASSET.QUOTE, -shortfall, 0n, 'insurance_cover', ref);
          credit += shortfall;
        }
      }
    }
    await adjustBalance(c, userId, ASSET.QUOTE, credit, 0n, eff.realizedPnl !== 0n ? 'perp_pnl' : 'perp_margin', ref);
    await this.savePosition(c, userId, marketId, pos, cur.realized + eff.realizedPnl);
    this.notifyUser(userId, 'balance');
  }

  // ---------------- 채굴량 선물 ----------------
  private async placeMiningFuture(c: pg.PoolClient, m: Market, orderId: string, userId: string, side: Side, type: 'limit' | 'market', p: Record<string, unknown>) {
    if (m.status !== 'open' || !m.expiryAt || m.expiryAt.getTime() <= this.now().getTime()) throw new UserError('거래가 종료된 월물입니다');
    if (type !== 'limit') throw new UserError('채굴량 선물은 지정가 주문만 가능합니다');
    const o = this.baseOrd(orderId, m, userId, side, type);
    o.price = parsePositive(p.price, '가격');
    o.qty = parsePositive(p.qty, '수량');
    o.remaining = o.qty;
    o.lockAsset = m.quote;
    if (side === 'buy') {
      o.locked = buyerMargin(o.price, o.qty, BigInt(this.settings.mf_buyer_margin_bps));
    } else {
      // 매도자 = 채굴자. 확정 잔고 + 예상 채굴량 × 70% − 기존 약정 이내에서만 매도 가능
      const cap = await mfSellCapacity(c, this.pub, this.settings, userId, m.expiryAt);
      if (o.qty > cap.limit) {
        throw new UserError(`매도 가능 한도 초과: 최대 ${fromUnits(cap.limit)} ${ASSET.COIN} (확정 ${fromUnits(cap.confirmed)} + 예상 채굴 ${fromUnits(cap.expected)} × ${this.settings.mf_sell_limit_factor_bps / 100}% − 약정 ${fromUnits(cap.committed)})`);
      }
      o.locked = buyerMargin(o.price, o.qty, BigInt(this.settings.mf_seller_margin_bps));
    }
    await adjustBalance(c, userId, m.quote, -o.locked, o.locked, 'order_lock', orderId);
    const ord = await this.insertOrder(c, o);
    const r = this.book(m.id).match({ id: ord.id, userId, side, type, seq: ord.seq, price: ord.price!, qty: ord.qty! });
    await this.processMatch(c, m, ord, r, 'continuous');
    return this.summary(ord);
  }

  /** 체결 1건 = 계약 1건. 양쪽 주문에 묶인 금액에서 체결가 기준 증거금을 계약으로 옮긴다. */
  private async settleMfFill(c: pg.PoolClient, m: Market, f: Fill, maker: Ord, taker: Ord, tradeId: number) {
    const buyer = f.takerSide === 'buy' ? taker : maker;
    const seller = f.takerSide === 'buy' ? maker : taker;
    const escrow = async (o: Ord, bps: number) => {
      await this.releaseProportional(c, o, f.qty);
      const need = buyerMargin(f.price, f.qty, BigInt(bps));
      const bal = await getBalance(c, o.userId, m.quote, true);
      const take = minBig(need, bal.available); // 매도자가 더 높은 가격에 체결되면 부족분이 생길 수 있음
      await adjustBalance(c, o.userId, m.quote, -take, 0n, 'mf_margin', tradeId);
      return take;
    };
    const bm = await escrow(buyer, this.settings.mf_buyer_margin_bps);
    const sm = await escrow(seller, this.settings.mf_seller_margin_bps);
    await c.query(
      `INSERT INTO mf_contracts (market_id, trade_id, buyer_id, seller_id, qty, price, buyer_margin, seller_margin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [m.id, tradeId, buyer.userId, seller.userId, f.qty.toString(), f.price.toString(), bm.toString(), sm.toString()],
    );
    const quote = notional(f.price, f.qty);
    this.fillOrd(buyer, f.qty, quote);
    this.fillOrd(seller, f.qty, quote);
    this.notifyUser(buyer.userId, 'contract');
    this.notifyUser(seller.userId, 'contract');
  }

  // ================================================================
  // 취소
  // ================================================================
  private async cancelOrder(c: pg.PoolClient, userId: string, orderId: string, admin = false) {
    const { rows } = await c.query(`SELECT ${OPEN_ORDER_COLUMNS} FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
    if (!rows[0] || (!admin && rows[0].user_id !== userId)) throw new UserError('주문을 찾을 수 없습니다', 404);
    const o = rowToOrd(rows[0]);
    if (o.status !== 'open') throw new UserError('이미 체결되었거나 취소된 주문입니다');
    this.orderCache.set(o.id, o);
    await this.finish(c, o, 'canceled', admin ? 'admin' : 'user');
    await audit(c, { action: 'order.cancel', userId: o.userId, actorId: userId, details: { orderId, admin } });
    return this.summary(o);
  }

  private async cancelAll(c: pg.PoolClient, userId: string, marketId?: string) {
    const { rows } = await c.query<{ id: string }>(
      `SELECT id FROM orders WHERE user_id = $1 AND status = 'open'${marketId ? ' AND market_id = $2' : ''}`,
      marketId ? [userId, marketId] : [userId]);
    for (const r of rows) await this.cancelOrder(c, userId, r.id);
    return { canceled: rows.length };
  }

  // ================================================================
  // 상장: PRE_LISTING → CALL_AUCTION(10분) → LISTED
  // ================================================================
  private async setMarketStatus(c: pg.PoolClient, id: string, status: Market['status']) {
    await c.query('UPDATE markets SET status = $2 WHERE id = $1', [id, status]);
    this.markets.get(id)!.status = status;
    this.touched.add(id);
  }

  private async startListing(c: pg.PoolClient, adminId: string) {
    if (this.settings.coin_status !== 'PRE_LISTING') throw new UserError('이미 상장 절차가 시작되었습니다');
    const endAt = new Date(this.now().getTime() + this.settings.auction_minutes * 60_000).toISOString();
    await saveSetting(c, 'coin_status', 'CALL_AUCTION');
    await saveSetting(c, 'auction_end_at', endAt);
    this.settings.coin_status = 'CALL_AUCTION';
    this.settings.auction_end_at = endAt;
    await this.setMarketStatus(c, MARKET.SPOT, 'auction');
    await audit(c, { action: 'admin.listing.start', actorId: adminId, details: { auctionEndAt: endAt } });
    this.emit('status', { coinStatus: 'CALL_AUCTION', auctionEndAt: endAt });
    return { coinStatus: 'CALL_AUCTION', auctionEndAt: endAt };
  }

  /** 콜옥션 종료: 단일가 체결 → 연속 매매 시작, 무기한 선물 오픈. */
  private async endAuction(c: pg.PoolClient, force: boolean, actorId?: string) {
    if (this.settings.coin_status !== 'CALL_AUCTION') throw new UserError('콜옥션 중이 아닙니다');
    if (!force && this.settings.auction_end_at && new Date(this.settings.auction_end_at).getTime() > this.now().getTime()) {
      throw new UserError('콜옥션 종료 시각 전입니다');
    }
    const m = this.markets.get(MARKET.SPOT)!;
    const book = this.book(m.id);
    const { clearing, fills } = uncross(book);
    await this.processMatch(c, m, null, { fills, selfTradeCanceled: [] }, 'auction');
    const rest = resolveCrossed(book);
    await this.processMatch(c, m, null, { fills: rest.fills, selfTradeCanceled: rest.canceled }, 'continuous');

    await saveSetting(c, 'coin_status', 'LISTED');
    this.settings.coin_status = 'LISTED';
    await this.setMarketStatus(c, MARKET.SPOT, 'open');
    await this.setMarketStatus(c, MARKET.PERP, 'open');
    const summary = { coinStatus: 'LISTED', openingPrice: clearing ? fromUnits(clearing.price) : null, volume: clearing ? fromUnits(clearing.volume) : '0' };
    await audit(c, { action: 'listing.auction_end', actorId: actorId ?? null, details: summary });
    this.emit('status', summary);
    return summary;
  }

  private async setPaused(c: pg.PoolClient, marketId: string, paused: boolean, adminId: string) {
    const m = this.markets.get(marketId);
    if (!m) throw new UserError('존재하지 않는 마켓입니다', 404);
    await c.query('UPDATE markets SET paused = $2 WHERE id = $1', [marketId, paused]);
    m.paused = paused;
    this.touched.add(marketId);
    await audit(c, { action: paused ? 'admin.market.pause' : 'admin.market.resume', actorId: adminId, details: { marketId } });
    return { marketId, paused };
  }

  // ================================================================
  // 채굴량 선물 월물 관리 / 만기 정산
  // ================================================================
  private async ensureMiningFutureMarkets(c: pg.PoolClient) {
    const created: string[] = [];
    for (const expiry of upcomingExpiries(this.now(), this.settings.mf_listed_months, this.settings.mf_expiry_hour_utc)) {
      const id = miningFutureMarketId(ASSET.COIN, expiry);
      const r = await c.query(
        `INSERT INTO markets (id, kind, base, quote, status, expiry_at) VALUES ($1, 'mining_future', $2, $3, 'open', $4)
         ON CONFLICT (id) DO NOTHING RETURNING id`, [id, ASSET.COIN, ASSET.QUOTE, expiry]);
      if (r.rows[0]) {
        created.push(id);
        this.markets.set(id, { id, kind: 'mining_future', base: ASSET.COIN, quote: ASSET.QUOTE, status: 'open', paused: false, expiryAt: expiry });
        this.books.set(id, new OrderBook());
      }
    }
    return { created };
  }

  /**
   * 만기 정산: 미체결 주문 취소 → 계약별로 코인 인도/대금 지급 → 부족분은 매도자 증거금 몰수로 보상.
   */
  async settleMiningFuture(c: pg.PoolClient, marketId: string) {
    const m = this.markets.get(marketId);
    if (!m || m.kind !== 'mining_future') throw new UserError('채굴량 선물 마켓이 아닙니다');
    if (m.status !== 'open') throw new UserError('이미 정산된 월물입니다');
    if (!m.expiryAt || m.expiryAt.getTime() > this.now().getTime()) throw new UserError('만기 전입니다');

    const open = await c.query<{ id: string }>(`SELECT id FROM orders WHERE market_id = $1 AND status = 'open'`, [marketId]);
    for (const r of open.rows) await this.finish(c, await this.getOrd(c, r.id), 'canceled', 'expired');

    const { rows } = await c.query(
      `SELECT id, buyer_id, seller_id, qty, price, buyer_margin, seller_margin FROM mf_contracts
       WHERE market_id = $1 AND status = 'open' ORDER BY id FOR UPDATE`, [marketId]);
    const contracts: Contract[] = rows.map((r) => ({
      id: String(r.id), buyerId: r.buyer_id, sellerId: r.seller_id, qty: big(r.qty), price: big(r.price),
      buyerMargin: big(r.buyer_margin), sellerMargin: big(r.seller_margin),
    }));
    const wallets = new Map<string, Wallet>();
    for (const uid of new Set(contracts.flatMap((x) => [x.buyerId, x.sellerId]))) {
      const coin = await getBalance(c, uid, m.base, true);
      const krw = await getBalance(c, uid, m.quote, true);
      wallets.set(uid, { coin: coin.available, krw: krw.available });
    }
    const { results, deltas } = settle(contracts, wallets);
    for (const d of deltas) {
      await adjustBalance(c, d.userId, d.asset === 'coin' ? m.base : m.quote, d.amount, 0n, d.reason, `mf:${d.contractId}`);
      this.notifyUser(d.userId, 'balance');
    }
    for (const r of results) {
      await c.query(
        `UPDATE mf_contracts SET status = $2, delivered_qty = $3, paid = $4, forfeited = $5, settled_at = now() WHERE id = $1`,
        [r.id, r.status, r.delivered.toString(), r.paid.toString(), (r.forfeitedSeller + r.forfeitedBuyer).toString()]);
    }
    await this.setMarketStatus(c, marketId, 'settled');
    const summary = {
      marketId, contracts: results.length,
      delivered: results.filter((r) => r.status === 'delivered').length,
      partial: results.filter((r) => r.status === 'partial').length,
      sellerDefault: results.filter((r) => r.status === 'seller_default').length,
      buyerDefault: results.filter((r) => r.status === 'buyer_default').length,
    };
    await audit(c, { action: 'mf.settle', details: summary });
    for (const uid of wallets.keys()) this.notifyUser(uid, 'contract');
    await this.ensureMiningFutureMarkets(c);
    return summary;
  }

  // ================================================================
  // 강제청산 / 보험기금
  // ================================================================
  async liquidationCheck(c: pg.PoolClient) {
    const mark = this.currentMark();
    const perp = this.markets.get(MARKET.PERP);
    if (mark === null || !perp || perp.status !== 'open') return { liquidated: 0 };
    const mmr = BigInt(this.settings.perp_mmr_bps);
    const { rows } = await c.query(
      `SELECT user_id, qty, entry_price, margin, leverage, margin_mode FROM positions
       WHERE market_id = $1 AND qty <> 0 AND user_id <> $2`, [perp.id, SYSTEM_USERS.INSURANCE]);
    let liquidated = 0;
    for (const r of rows) {
      const pos: Position = { qty: big(r.qty), entryPrice: big(r.entry_price), margin: big(r.margin), leverage: r.leverage, mode: r.margin_mode };
      if (pos.mode === 'isolated') {
        if (isolatedNeedsLiquidation(pos, mark, mmr)) { await this.liquidatePosition(c, r.user_id, perp.id, mark); liquidated++; }
        continue;
      }
      let bal = await getBalance(c, r.user_id, ASSET.QUOTE, true);
      if (!crossNeedsLiquidation(bal.available, [pos], mark, mmr)) continue;
      // 교차: 미체결 주문을 먼저 취소해 담보를 늘려 보고, 그래도 부족하면 청산
      const oo = await c.query<{ id: string }>(`SELECT id FROM orders WHERE user_id = $1 AND market_id = $2 AND status = 'open'`, [r.user_id, perp.id]);
      for (const o of oo.rows) await this.finish(c, await this.getOrd(c, o.id), 'canceled', 'margin_call');
      bal = await getBalance(c, r.user_id, ASSET.QUOTE, true);
      if (crossNeedsLiquidation(bal.available, [pos], mark, mmr)) {
        // 교차 포지션은 가용잔고도 담보이므로 청산 가치에 포함한 뒤 정산
        await this.liquidatePosition(c, r.user_id, perp.id, mark, bal.available);
        liquidated++;
      }
    }
    // 보험기금이 인수한 포지션은 상대 호가가 보호 범위 안에 있을 때마다 정리 시도
    await this.unwindInsurance(c, perp, mark);
    return { liquidated };
  }

  private async liquidatePosition(c: pg.PoolClient, userId: string, marketId: string, mark: bigint, crossCollateral = 0n) {
    const cur = await this.loadPosition(c, userId, marketId);
    if (cur.qty === 0n) return;
    // 교차 마진은 가용잔고를 증거금에 합쳐 계산 (잔고를 포지션으로 옮김)
    if (crossCollateral > 0n) await adjustBalance(c, userId, ASSET.QUOTE, -crossCollateral, 0n, 'cross_liquidation_collateral', marketId);
    const pos: Position = { ...cur, margin: cur.margin + crossCollateral };
    const r = liquidate(pos, mark, BigInt(this.settings.perp_liq_fee_bps));
    await adjustBalance(c, userId, ASSET.QUOTE, r.userReturn, 0n, 'liquidation_return', marketId);
    await adjustBalance(c, SYSTEM_USERS.INSURANCE, ASSET.QUOTE, r.insuranceDelta, 0n, r.insuranceDelta >= 0n ? 'liquidation_fee' : 'liquidation_deficit', userId);
    await this.savePosition(c, userId, marketId, { ...emptyPosition(cur.leverage, cur.mode) }, cur.realized + (r.userReturn - pos.margin));
    // 보험기금이 마크가로 포지션 인수
    await this.applyPerpFill(c, marketId, SYSTEM_USERS.INSURANCE, r.takeover.qty, r.takeover.price, 1, 'cross', `liq:${userId}`);
    await c.query(
      `INSERT INTO liquidations (user_id, market_id, qty, entry_price, mark_price, margin, equity, fee, insurance_delta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [userId, marketId, cur.qty.toString(), cur.entryPrice.toString(), mark.toString(), pos.margin.toString(), r.equity.toString(), r.fee.toString(), r.insuranceDelta.toString()]);
    await audit(c, { action: 'perp.liquidation', userId, details: { marketId, qty: cur.qty, entry: cur.entryPrice, mark, equity: r.equity, fee: r.fee, insuranceDelta: r.insuranceDelta } });
    if (r.insuranceDelta < 0n) {
      const ins = await getBalance(c, SYSTEM_USERS.INSURANCE, ASSET.QUOTE);
      if (ins.available < 0n) {
        await c.query(`INSERT INTO alerts (kind, message, details) VALUES ('insurance_deficit', '보험기금이 음수입니다', $1)`, [toJson({ balance: ins.available })]);
      }
    }
    this.notifyUser(userId, 'position');
    this.notifyUser(userId, 'balance');
  }

  /** 보험기금이 인수한 포지션을 호가창에 시장가(reduce-only, 보호가격 적용)로 정리. */
  private async unwindInsurance(c: pg.PoolClient, m: Market, mark: bigint) {
    const pos = await this.loadPosition(c, SYSTEM_USERS.INSURANCE, m.id);
    if (pos.qty === 0n) return;
    const side: Side = pos.qty > 0n ? 'sell' : 'buy';
    const protect = BigInt(this.settings.perp_protect_bps);
    const protectPrice = side === 'buy' ? (mark * (BPS + protect)) / BPS : (mark * (BPS - protect)) / BPS;
    const book = this.books.get(m.id);
    const best = side === 'sell' ? book?.bestBid() : book?.bestAsk();
    if (best === null || best === undefined || (side === 'sell' ? best < protectPrice : best > protectPrice)) return;
    const o = this.baseOrd(crypto.randomUUID(), m, SYSTEM_USERS.INSURANCE, side, 'market');
    o.qty = absBig(pos.qty); o.remaining = o.qty; o.reduceOnly = true; o.leverage = 1; o.marginMode = 'cross'; o.lockAsset = ASSET.QUOTE;
    const ord = await this.insertOrder(c, o);
    const r = this.book(m.id).match({ id: ord.id, userId: ord.userId, side, type: 'market', seq: ord.seq, qty: ord.qty!, protectPrice });
    await this.processMatch(c, m, ord, r, 'liquidation');
  }

  // ================================================================
  // 펀딩비 (8시간마다)
  // ================================================================
  nextFundingTime(from = this.now()): Date {
    const ms = this.settings.perp_funding_interval_hours * 3600_000;
    return new Date(Math.floor(from.getTime() / ms) * ms + ms);
  }

  currentFundingSlot(from = this.now()): Date {
    const ms = this.settings.perp_funding_interval_hours * 3600_000;
    return new Date(Math.floor(from.getTime() / ms) * ms);
  }

  async runFunding(c: pg.PoolClient, fundingTime: Date) {
    const perp = this.markets.get(MARKET.PERP);
    const mark = this.currentMark();
    if (!perp || perp.status !== 'open' || mark === null) return { skipped: true };
    const exists = await c.query('SELECT 1 FROM funding_events WHERE funding_time = $1', [fundingTime]);
    if (exists.rows[0]) return { skipped: true };
    const perpPx = this.perpPrice();
    const rate = fundingRatePpm(perpPx, mark, BigInt(this.settings.perp_funding_cap_ppm));
    const ev = await c.query<{ id: string }>(
      `INSERT INTO funding_events (market_id, rate_ppm, mark_price, perp_price, total_paid, insurance_delta, funding_time)
       VALUES ($1, $2, $3, $4, 0, 0, $5) RETURNING id`,
      [perp.id, rate.toString(), mark.toString(), perpPx?.toString() ?? null, fundingTime]);
    const eventId = ev.rows[0].id;
    if (rate === 0n) return { rate: 0 };

    const { rows } = await c.query(
      `SELECT user_id, qty, entry_price, margin, leverage, margin_mode, realized_pnl FROM positions WHERE market_id = $1 AND qty <> 0 FOR UPDATE`, [perp.id]);
    let collected = 0n, distributed = 0n;
    for (const r of rows) {
      const pos: Position = { qty: big(r.qty), entryPrice: big(r.entry_price), margin: big(r.margin), leverage: r.leverage, mode: r.margin_mode };
      const pay = fundingPayment(pos, mark, rate);
      if (pay === 0n) continue;
      const isIns = r.user_id === SYSTEM_USERS.INSURANCE;
      if (pay > 0n) {
        // 지불: 격리는 포지션 증거금에서, 교차/보험기금은 가용잔고에서(부족하면 증거금에서)
        let fromMargin = 0n, fromBalance = 0n;
        if (pos.mode === 'isolated' && !isIns) fromMargin = minBig(pay, pos.margin);
        else {
          const bal = await getBalance(c, r.user_id, ASSET.QUOTE, true);
          fromBalance = isIns ? pay : minBig(pay, bal.available > 0n ? bal.available : 0n);
          fromMargin = minBig(pay - fromBalance, pos.margin);
        }
        if (fromBalance) await adjustBalance(c, r.user_id, ASSET.QUOTE, -fromBalance, 0n, 'funding_pay', eventId);
        if (fromMargin) await this.savePosition(c, r.user_id, perp.id, { ...pos, margin: pos.margin - fromMargin }, big(r.realized_pnl));
        collected += fromBalance + fromMargin;
      } else {
        const amt = -pay;
        if (pos.mode === 'isolated' && !isIns) await this.savePosition(c, r.user_id, perp.id, { ...pos, margin: pos.margin + amt }, big(r.realized_pnl));
        else await adjustBalance(c, r.user_id, ASSET.QUOTE, amt, 0n, 'funding_receive', eventId);
        distributed += amt;
      }
      await c.query('INSERT INTO funding_payments (funding_event_id, user_id, amount) VALUES ($1, $2, $3)', [eventId, r.user_id, pay.toString()]);
      this.notifyUser(r.user_id, 'position');
    }
    // 반올림/미수금 차이는 보험기금이 흡수
    const insuranceDelta = collected - distributed;
    await adjustBalance(c, SYSTEM_USERS.INSURANCE, ASSET.QUOTE, insuranceDelta, 0n, 'funding_residual', eventId);
    await c.query('UPDATE funding_events SET total_paid = $2, insurance_delta = $3 WHERE id = $1', [eventId, collected.toString(), insuranceDelta.toString()]);
    await audit(c, { action: 'perp.funding', details: { rate, mark, collected, distributed } });
    return { ratePpm: Number(rate), collected: fromUnits(collected), distributed: fromUnits(distributed) };
  }

  // ================================================================
  // 타이머 (내부 명령도 같은 직렬 큐로 실행)
  // ================================================================
  private timerBusy = new Set<string>();

  private runInternal(type: string, payload: Record<string, unknown> = {}) {
    if (this.timerBusy.has(type)) return;
    this.timerBusy.add(type);
    this.execute({ cmdId: `internal:${type}:${Date.now()}`, type, payload })
      .then((r) => { if (!r.ok && !/전입니다|중이 아닙니다|이미/.test(r.error)) console.warn(`[engine] ${type}: ${r.error}`); })
      .finally(() => this.timerBusy.delete(type));
  }

  startTimers(): NodeJS.Timeout[] {
    return [
      setInterval(() => {
        // 콜옥션 종료
        if (this.settings.coin_status === 'CALL_AUCTION' && this.settings.auction_end_at && new Date(this.settings.auction_end_at) <= this.now()) {
          this.runInternal('end_auction');
        }
        // 만기 도래한 채굴량 선물 정산
        for (const m of this.markets.values()) {
          if (m.kind === 'mining_future' && m.status === 'open' && m.expiryAt && m.expiryAt <= this.now()) {
            this.runInternal('settle_mf', { marketId: m.id });
          }
        }
      }, 1000),
      setInterval(() => this.runInternal('liquidation_check'), 2000),
      setInterval(() => {
        const slot = this.currentFundingSlot();
        if (this.now().getTime() - slot.getTime() < 10 * 60_000) this.runInternal('funding', { fundingTime: slot.toISOString() });
        this.serial(() => this.publishMark()).catch(() => {});
      }, 30_000),
      setInterval(() => this.runInternal('ensure_mf_markets'), 3600_000),
    ];
  }
}
