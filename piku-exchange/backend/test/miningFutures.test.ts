import { describe, expect, it } from 'vitest';
import {
  buyerMargin, expectedMining, lastFridayOfMonth, sellLimit, settle, upcomingExpiries, type Contract, type Wallet,
} from '../src/core/miningFutures.js';
import { toUnits as u } from '../src/core/units.js';

const contract = (id: string, qty: string, price: string, over: Partial<Contract> = {}): Contract => ({
  id, buyerId: 'B', sellerId: 'S', qty: u(qty), price: u(price),
  buyerMargin: buyerMargin(u(price), u(qty), 2000n), sellerMargin: buyerMargin(u(price), u(qty), 1000n), ...over,
});

const total = (ws: Map<string, Wallet>, cs: Contract[], asset: 'coin' | 'krw') =>
  [...ws.values()].reduce((s, w) => s + w[asset], 0n) + (asset === 'krw' ? cs.reduce((s, c) => s + c.buyerMargin + c.sellerMargin, 0n) : 0n);

describe('채굴량 선물: 만기와 한도', () => {
  it('만기는 매월 마지막 금요일', () => {
    expect(lastFridayOfMonth(2026, 9).toISOString()).toBe('2026-10-30T06:00:00.000Z');
    expect(lastFridayOfMonth(2026, 1).toISOString()).toBe('2026-02-27T06:00:00.000Z');
    expect(upcomingExpiries(new Date('2026-10-30T07:00:00Z'), 2).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2026-11-27', '2026-12-25']);
  });

  it('예상 채굴량: 네트워크의 10% 해시로 30일 → 블록 보상 × 0.99 × 0.1 × 블록 수', () => {
    const exp = expectedMining({
      userHashrate: 1e12, networkHashrate: 1e13, blockReward: u('50'), blockTimeSec: 600, seconds: 30 * 86400, poolFeeBps: 100n,
    });
    expect(exp).toBe(u('21384')); // 4320블록 × 49.5 × 0.1
  });

  it('매도 한도 = 확정 잔고 + 예상 채굴량 × 70% − 이미 약속한 수량', () => {
    expect(sellLimit(u('100'), u('1000'), 7000n, u('50'))).toBe(u('750'));
    expect(sellLimit(0n, 0n, 7000n, u('5'))).toBe(0n);
  });
});

describe('채굴량 선물: 만기 정산', () => {
  it('정상 인도: 코인은 매수자에게, 대금은 매도자에게, 증거금은 반환', () => {
    const c = [contract('c1', '10', '1000')];
    const ws = new Map<string, Wallet>([['S', { coin: u('15'), krw: 0n }], ['B', { coin: 0n, krw: u('9000') }]]);
    const before = { coin: total(ws, c, 'coin'), krw: total(ws, c, 'krw') };
    const { results } = settle(c, ws);
    expect(results[0]).toMatchObject({ status: 'delivered', delivered: u('10'), paid: u('10000') });
    expect(ws.get('S')).toEqual({ coin: u('5'), krw: u('11000') }); // 대금 10000 + 증거금 1000 반환
    expect(ws.get('B')).toEqual({ coin: u('10'), krw: u('1000') }); // 9000 + 증거금 2000 − 10000
    expect(total(ws, [], 'coin')).toBe(before.coin);
    expect(total(ws, [], 'krw')).toBe(before.krw);
  });

  it('인도 부족: 인도분만 결제하고 부족분 비율만큼 매도자 증거금을 몰수해 매수자에게 보상', () => {
    const c = [contract('c1', '10', '1000')];
    const ws = new Map<string, Wallet>([['S', { coin: u('4'), krw: 0n }], ['B', { coin: 0n, krw: u('2000') }]]);
    const before = total(ws, c, 'krw');
    const { results } = settle(c, ws);
    expect(results[0]).toMatchObject({ status: 'partial', delivered: u('4'), paid: u('4000'), forfeitedSeller: u('600') });
    // 2000 + 증거금 2000 − 대금 4000 + 보상 600
    expect(ws.get('B')).toEqual({ coin: u('4'), krw: u('600') });
    expect(ws.get('S')).toEqual({ coin: 0n, krw: u('4000') + u('400') });
    expect(total(ws, [], 'krw')).toBe(before);
  });

  it('전혀 인도하지 못하면 매도자 증거금 전액 몰수', () => {
    const c = [contract('c1', '10', '1000')];
    const ws = new Map<string, Wallet>([['S', { coin: 0n, krw: 0n }], ['B', { coin: 0n, krw: 0n }]]);
    const { results } = settle(c, ws);
    expect(results[0]).toMatchObject({ status: 'seller_default', delivered: 0n, forfeitedSeller: u('1000') });
    expect(ws.get('B')!.krw).toBe(u('3000')); // 증거금 2000 반환 + 보상 1000
    expect(ws.get('S')!.krw).toBe(0n);
  });

  it('매수자가 잔금을 못 내면 매수자 불이행: 매수자 증거금이 매도자에게 가고 코인은 이동하지 않음', () => {
    const c = [contract('c1', '10', '1000')];
    const ws = new Map<string, Wallet>([['S', { coin: u('10'), krw: 0n }], ['B', { coin: 0n, krw: u('100') }]]);
    const { results } = settle(c, ws);
    expect(results[0]).toMatchObject({ status: 'buyer_default', forfeitedBuyer: u('2000') });
    expect(ws.get('S')).toEqual({ coin: u('10'), krw: u('3000') });
    expect(ws.get('B')).toEqual({ coin: 0n, krw: u('100') });
  });

  it('한 매도자의 여러 계약은 체결 순서대로 인도한다', () => {
    const c = [contract('c1', '6', '100', { buyerId: 'B1' }), contract('c2', '6', '100', { buyerId: 'B2' })];
    const ws = new Map<string, Wallet>([['S', { coin: u('8'), krw: 0n }], ['B1', { coin: 0n, krw: u('1000') }], ['B2', { coin: 0n, krw: u('1000') }]]);
    const before = { coin: total(ws, c, 'coin'), krw: total(ws, c, 'krw') };
    const { results } = settle(c, ws);
    expect(results.map((r) => [r.status, r.delivered])).toEqual([['delivered', u('6')], ['partial', u('2')]]);
    expect(total(ws, [], 'coin')).toBe(before.coin);
    expect(total(ws, [], 'krw')).toBe(before.krw);
  });
});
