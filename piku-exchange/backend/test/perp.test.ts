import { describe, expect, it } from 'vitest';
import {
  applyFill, crossNeedsLiquidation, emptyPosition, fundingPayment, fundingRatePpm, isolatedNeedsLiquidation,
  liquidate, liquidationPrice, maintenanceMargin, markPrice, unrealizedPnl,
} from '../src/core/perp.js';
import { toUnits as u } from '../src/core/units.js';

const MMR = 50n; // 0.5%

describe('무기한 선물: 포지션', () => {
  it('10배 롱 진입: 증거금 = 명목가치/10, 평단은 가중평균', () => {
    let e = applyFill(emptyPosition(10, 'isolated'), u('2'), u('1000'));
    expect(e.addedMargin).toBe(u('200'));
    e = applyFill(e.position, u('2'), u('1100'));
    expect(e.position.qty).toBe(u('4'));
    expect(e.position.entryPrice).toBe(u('1050'));
    expect(e.position.margin).toBe(u('420'));
  });

  it('반대 방향 체결은 먼저 포지션을 줄이며 손익을 실현하고, 남으면 반대 포지션을 연다', () => {
    const long = applyFill(emptyPosition(5, 'isolated'), u('2'), u('1000')).position;
    const e = applyFill(long, -u('3'), u('1200'));
    expect(e.closedQty).toBe(u('2'));
    expect(e.realizedPnl).toBe(u('400'));
    expect(e.releasedMargin).toBe(u('400'));
    expect(e.position.qty).toBe(-u('1'));
    expect(e.position.entryPrice).toBe(u('1200'));
    expect(e.position.margin).toBe(u('240'));
  });

  it('미실현 손익', () => {
    const short = applyFill(emptyPosition(2, 'cross'), -u('3'), u('500')).position;
    expect(unrealizedPnl(short, u('400'))).toBe(u('300'));
    expect(unrealizedPnl(short, u('600'))).toBe(-u('300'));
  });
});

describe('무기한 선물: 강제청산', () => {
  it('격리 롱 청산가: 그 가격에서 정확히 증거금+손익 = 유지증거금', () => {
    const pos = applyFill(emptyPosition(10, 'isolated'), u('1'), u('1000')).position;
    const liq = liquidationPrice(pos, MMR);
    // (1000 - 100) / (1 - 0.005) = 904.52...
    expect(liq).toBe(904_52261306n);
    expect(isolatedNeedsLiquidation(pos, liq + u('0.01'), MMR)).toBe(false);
    expect(isolatedNeedsLiquidation(pos, liq - u('0.01'), MMR)).toBe(true);
  });

  it('격리 숏 청산가', () => {
    const pos = applyFill(emptyPosition(10, 'isolated'), -u('1'), u('1000')).position;
    const liq = liquidationPrice(pos, MMR);
    // (1000 + 100) / 1.005 = 1094.527...
    expect(liq).toBe(1094_52736319n);
    expect(isolatedNeedsLiquidation(pos, liq - u('0.01'), MMR)).toBe(false);
    expect(isolatedNeedsLiquidation(pos, liq + u('0.01'), MMR)).toBe(true);
  });

  it('1배 롱은 청산가가 0 (가격이 0이 되어도 증거금으로 감당)', () => {
    const pos = applyFill(emptyPosition(1, 'isolated'), u('1'), u('1000')).position;
    expect(liquidationPrice(pos, MMR)).toBe(0n);
  });

  it('교차 마진은 가용잔고까지 담보로 쓰므로 같은 가격에서 격리보다 늦게 청산된다', () => {
    const pos = { ...applyFill(emptyPosition(10, 'cross'), u('1'), u('1000')).position };
    const mark = u('890');
    expect(isolatedNeedsLiquidation({ ...pos, mode: 'isolated' }, mark, MMR)).toBe(true);
    expect(crossNeedsLiquidation(u('500'), [pos], mark, MMR)).toBe(false);
    expect(crossNeedsLiquidation(0n, [pos], mark, MMR)).toBe(true);
    expect(liquidationPrice(pos, MMR, u('500'))).toBeLessThan(liquidationPrice(pos, MMR));
  });

  it('청산 시 남은 가치에서 수수료를 보험기금에 넣고 나머지를 돌려준다', () => {
    const pos = applyFill(emptyPosition(10, 'isolated'), u('1'), u('1000')).position;
    const r = liquidate(pos, u('904'), 50n);
    expect(r.equity).toBe(u('4'));            // 100 - 96
    expect(r.fee).toBe(u('4'));               // min(904*0.5%=4.52, 4)
    expect(r.userReturn).toBe(0n);
    expect(r.insuranceDelta).toBe(u('4'));
    expect(r.takeover).toEqual({ qty: u('1'), price: u('904') });
  });

  it('파산(가치 음수)이면 보험기금이 손실을 메운다', () => {
    const pos = applyFill(emptyPosition(10, 'isolated'), u('1'), u('1000')).position;
    const r = liquidate(pos, u('850'), 50n);
    expect(r.equity).toBe(-u('50'));
    expect(r.userReturn).toBe(0n);
    expect(r.insuranceDelta).toBe(-u('50'));
  });

  it('유지증거금', () => {
    const pos = applyFill(emptyPosition(3, 'isolated'), u('10'), u('100')).position;
    expect(maintenanceMargin(pos, u('100'), MMR)).toBe(u('5'));
  });
});

describe('무기한 선물: 마크 가격과 펀딩', () => {
  it('마크 가격은 현물 bid/ask/last의 중앙값', () => {
    expect(markPrice(u('99'), u('101'), u('150'))).toBe(u('101'));
    expect(markPrice(u('99'), u('101'), null)).toBe(u('100'));
    expect(markPrice(null, null, null)).toBeNull();
  });

  it('선물이 현물보다 비싸면 롱이 숏에게 지불, 상한으로 제한', () => {
    expect(fundingRatePpm(u('101'), u('100'), 7500n)).toBe(7500n);
    expect(fundingRatePpm(u('100.1'), u('100'), 7500n)).toBe(1000n);
    const long = applyFill(emptyPosition(1, 'cross'), u('10'), u('100')).position;
    const short = applyFill(emptyPosition(1, 'cross'), -u('10'), u('100')).position;
    expect(fundingPayment(long, u('100'), 1000n)).toBe(u('1'));
    expect(fundingPayment(short, u('100'), 1000n)).toBe(-u('1'));
    expect(fundingPayment(long, u('100'), -1000n)).toBe(-u('1'));
  });
});
