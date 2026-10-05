/**
 * 채굴량 선물: "만기일까지 PIKU N개를 가격 P에 인도"하는 실물인도 계약.
 * 매도자 = 채굴자, 매수자 = 증거금(기본 20%)을 내고 사는 쪽.
 */
import { BPS, minBig, mulDivCeil, notional } from './units.js';

/** 월물 만기: 매월 마지막 금요일 (UTC hourUtc시). */
export function lastFridayOfMonth(year: number, month0: number, hourUtc = 6): Date {
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0));
  const back = (lastDay.getUTCDay() - 5 + 7) % 7;
  return new Date(Date.UTC(year, month0, lastDay.getUTCDate() - back, hourUtc));
}

/** now 이후의 만기일 count개. */
export function upcomingExpiries(now: Date, count: number, hourUtc = 6): Date[] {
  const out: Date[] = [];
  let y = now.getUTCFullYear(), m = now.getUTCMonth();
  while (out.length < count) {
    const d = lastFridayOfMonth(y, m, hourUtc);
    if (d.getTime() > now.getTime()) out.push(d);
    m++; if (m === 12) { m = 0; y++; }
  }
  return out;
}

/** 마켓 ID: PIKU-MF-2026-10-30 */
export function miningFutureMarketId(ticker: string, expiry: Date): string {
  return `${ticker}-MF-${expiry.toISOString().slice(0, 10)}`;
}

export interface ExpectedMiningInput {
  userHashrate: number;      // 최근 7일 평균 해시레이트 (H/s)
  networkHashrate: number;   // 네트워크 해시레이트 (H/s)
  blockReward: bigint;       // 블록당 보상 (1e-8 단위)
  blockTimeSec: number;      // 목표 블록 간격
  seconds: number;           // 만기까지 남은 시간
  poolFeeBps: bigint;
}

/** 예상 채굴량 = 내 해시 비중 × 블록 보상 × (1−풀 수수료) × 만기까지 생성될 블록 수. */
export function expectedMining(i: ExpectedMiningInput): bigint {
  if (i.userHashrate <= 0 || i.networkHashrate <= 0 || i.seconds <= 0) return 0n;
  const share = Math.min(1, i.userHashrate / i.networkHashrate);
  const blocks = i.seconds / i.blockTimeSec;
  const netReward = (i.blockReward * (BPS - i.poolFeeBps)) / BPS;
  // 부동소수점은 비율 계산에만 쓰고 결과는 1e-8 단위로 내림
  return BigInt(Math.floor(Number(netReward) * share * blocks));
}

/** 매도 가능 한도 = 확정 잔고 + 예상 채굴량 × 70% − 이미 약속한 수량(미정산 계약 + 미체결 매도주문). */
export function sellLimit(confirmed: bigint, expected: bigint, factorBps: bigint, committed: bigint): bigint {
  const limit = confirmed + (expected * factorBps) / BPS - committed;
  return limit > 0n ? limit : 0n;
}

export const buyerMargin = (price: bigint, qty: bigint, bps: bigint) => mulDivCeil(notional(price, qty), bps, BPS);
export const sellerMargin = buyerMargin;

export interface Contract {
  id: string;
  buyerId: string;
  sellerId: string;
  qty: bigint;
  price: bigint;
  buyerMargin: bigint;   // 계약에 묶인 매수자 증거금 (KRW)
  sellerMargin: bigint;  // 계약에 묶인 매도자 증거금 (KRW)
}

export interface Wallet { coin: bigint; krw: bigint } // 정산 시점의 가용 잔고

export type SettlementStatus = 'delivered' | 'partial' | 'seller_default' | 'buyer_default';

export interface ContractSettlement {
  id: string;
  status: SettlementStatus;
  delivered: bigint;
  paid: bigint;               // 매수자가 낸 대금
  forfeitedSeller: bigint;    // 몰수되어 매수자에게 간 매도자 증거금
  forfeitedBuyer: bigint;     // 몰수되어 매도자에게 간 매수자 증거금
}

export interface Delta { userId: string; asset: 'coin' | 'krw'; amount: bigint; reason: string; contractId: string }

/**
 * 만기 정산. 계약 생성 순서대로 처리하며 지갑 스냅샷을 갱신해 간다.
 *
 * 1) 인도 가능 수량 d = min(N, 매도자 코인 잔고)
 * 2) 매수자는 d × P를 증거금 → 가용 KRW 순으로 지불.
 *    지불 능력이 없으면 매수자 불이행: 매수자 증거금을 매도자에게 주고 인도하지 않음.
 * 3) 인도 수량만큼 코인 이동, 대금 지급, 남은 매수자 증거금 반환
 * 4) 부족분 s = N − d 가 있으면 매도자 증거금 × s/N 을 몰수해 매수자에게 보상, 나머지는 반환
 *
 * 모든 이동은 사용자 간 이전이므로 KRW·코인 총량은 보존된다(테스트로 검증).
 */
export function settle(contracts: Contract[], wallets: Map<string, Wallet>): { results: ContractSettlement[]; deltas: Delta[] } {
  const results: ContractSettlement[] = [];
  const deltas: Delta[] = [];
  const w = (id: string) => {
    if (!wallets.has(id)) wallets.set(id, { coin: 0n, krw: 0n });
    return wallets.get(id)!;
  };
  const move = (userId: string, asset: 'coin' | 'krw', amount: bigint, reason: string, contractId: string) => {
    if (amount === 0n) return;
    w(userId)[asset] += amount;
    deltas.push({ userId, asset, amount, reason, contractId });
  };

  for (const c of contracts) {
    const seller = w(c.sellerId), buyer = w(c.buyerId);
    const delivered = minBig(c.qty, seller.coin > 0n ? seller.coin : 0n);
    const payable = notional(c.price, delivered);

    if (c.buyerMargin + buyer.krw < payable) {
      // 매수자 불이행
      move(c.sellerId, 'krw', c.buyerMargin + c.sellerMargin, 'mf_buyer_default', c.id);
      results.push({ id: c.id, status: 'buyer_default', delivered: 0n, paid: 0n, forfeitedSeller: 0n, forfeitedBuyer: c.buyerMargin });
      continue;
    }

    move(c.sellerId, 'coin', -delivered, 'mf_deliver', c.id);
    move(c.buyerId, 'coin', delivered, 'mf_receive', c.id);
    // 매수자: 증거금 반환 후 대금 지불 (순액으로 기록)
    move(c.buyerId, 'krw', c.buyerMargin - payable, 'mf_pay', c.id);
    move(c.sellerId, 'krw', payable, 'mf_proceeds', c.id);

    const shortfall = c.qty - delivered;
    const forfeited = shortfall === 0n ? 0n : shortfall === c.qty ? c.sellerMargin : (c.sellerMargin * shortfall) / c.qty;
    move(c.buyerId, 'krw', forfeited, 'mf_compensation', c.id);
    move(c.sellerId, 'krw', c.sellerMargin - forfeited, 'mf_margin_return', c.id);

    results.push({
      id: c.id,
      status: shortfall === 0n ? 'delivered' : delivered === 0n ? 'seller_default' : 'partial',
      delivered, paid: payable, forfeitedSeller: forfeited, forfeitedBuyer: 0n,
    });
  }
  return { results, deltas };
}
