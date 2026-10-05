import { useState } from 'react';
import { api } from '../api';
import { BalanceLine, useBalances } from '../components/Balances';
import { CandleChart } from '../components/CandleChart';
import { MyOrders } from '../components/MyOrders';
import { OrderBook, useBook } from '../components/OrderBook';
import { Trades } from '../components/Trades';
import { LoginRequired, Stat, useAction } from '../components/ui';
import { useConfig } from '../config';
import { countdown, fmt, krw, pct, time } from '../format';
import { useApi, useChannel, useNow } from '../hooks';

interface Mark { mark: string | null; perpPrice: string | null; estimatedFundingRate: number; nextFundingAt: string }
interface PositionRow {
  marketId: string; side: string; qty: string; entryPrice: string; margin: string; leverage: number; marginMode: string; markPrice: string | null;
  unrealizedPnl: string; roe: number; maintenanceMargin: string | null; liquidationPrice: string | null; realizedPnl: string;
}

export default function Perp() {
  const cfg = useConfig();
  const marketId = cfg.markets.perp;
  const book = useBook(marketId);
  const mark = useChannel<Mark>('mark', '/api/perp/mark');
  const now = useNow();
  const { data: insurance } = useApi<{ balance: string }>('/api/insurance', [], 30_000);
  if (cfg.coinStatus !== 'LISTED') {
    return <div className="panel p-6 text-center text-muted">무기한 선물은 {cfg.coin.ticker} 상장(콜옥션 종료) 후 열립니다.</div>;
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="마크 가격 (현물 기반)" value={krw(mark?.mark)} />
        <Stat label="선물 가격" value={krw(mark?.perpPrice)} />
        <Stat label={`예상 펀딩비 (${cfg.perp.fundingIntervalHours}h)`} value={<span className={(mark?.estimatedFundingRate ?? 0) >= 0 ? 'text-up' : 'text-down'}>{pct(mark?.estimatedFundingRate, 4)}</span>} sub="양수면 롱이 숏에게 지불" />
        <Stat label="다음 펀딩" value={mark ? countdown(new Date(mark.nextFundingAt).getTime() - now) : '-'} />
        <Stat label="보험기금" value={krw(insurance?.balance)} sub={cfg.quote} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px_300px] gap-4">
        <div className="space-y-4">
          <CandleChart marketId={marketId} />
          <LoginRequired><Positions /></LoginRequired>
          <LoginRequired><MyOrders marketId={marketId} /></LoginRequired>
        </div>
        <OrderBook book={book} />
        <div className="space-y-4">
          <OrderForm marketId={marketId} markPrice={mark?.mark ?? null} />
          <Trades marketId={marketId} />
        </div>
      </div>
    </div>
  );
}

function OrderForm({ marketId, markPrice }: { marketId: string; markPrice: string | null }) {
  const cfg = useConfig();
  const { data: balances, reload } = useBalances();
  const [type, setType] = useState<'limit' | 'market'>('limit');
  const [leverage, setLeverage] = useState(5);
  const [marginMode, setMarginMode] = useState<'isolated' | 'cross'>('isolated');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const { busy, run, view } = useAction();
  const refPrice = type === 'limit' ? Number(price) : Number(markPrice);
  const margin = (refPrice * Number(qty)) / leverage;
  const mmr = cfg.perp.mmrBps / 10000;
  const liqLong = refPrice * (1 - 1 / leverage) / (1 - mmr);
  const liqShort = refPrice * (1 + 1 / leverage) / (1 + mmr);
  const submit = (side: 'buy' | 'sell') => run(async () => {
    await api('/api/orders', { method: 'POST', body: { marketId, side, type, price: type === 'limit' ? price : undefined, qty, leverage, marginMode } });
    reload();
  }, '주문이 접수되었습니다');
  return (
    <div className="panel p-3 space-y-3">
      <div className="flex gap-1">
        <button className={`tab ${marginMode === 'isolated' ? 'tab-active' : ''}`} onClick={() => setMarginMode('isolated')}>격리</button>
        <button className={`tab ${marginMode === 'cross' ? 'tab-active' : ''}`} onClick={() => setMarginMode('cross')}>교차</button>
        <span className="mx-2 border-l border-line" />
        <button className={`tab ${type === 'limit' ? 'tab-active' : ''}`} onClick={() => setType('limit')}>지정가</button>
        <button className={`tab ${type === 'market' ? 'tab-active' : ''}`} onClick={() => setType('market')}>시장가</button>
      </div>
      <div>
        <label className="label">레버리지 {leverage}배</label>
        <input type="range" min={1} max={cfg.perp.maxLeverage} value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} className="w-full accent-brand" />
      </div>
      <BalanceLine balances={balances} asset={cfg.quote} />
      {type === 'limit' && <div><label className="label">가격</label><input className="input" value={price} onChange={(e) => setPrice(e.target.value)} /></div>}
      <div><label className="label">수량 ({cfg.coin.ticker})</label><input className="input" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
      <div className="text-xs text-muted space-y-1">
        <div className="flex justify-between"><span>필요 증거금</span><span className="font-mono">{krw(margin || 0)}</span></div>
        <div className="flex justify-between"><span>예상 청산가 (롱/숏, 격리)</span><span className="font-mono">{refPrice && qty ? `${krw(liqLong)} / ${krw(liqShort)}` : '-'}</span></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-up" disabled={busy} onClick={() => submit('buy')}>롱 (매수)</button>
        <button className="btn-down" disabled={busy} onClick={() => submit('sell')}>숏 (매도)</button>
      </div>
      {view}
    </div>
  );
}

function Positions() {
  const cfg = useConfig();
  const { data, reload } = useApi<PositionRow[]>('/api/perp/positions', ['user', 'mark']);
  const { data: funding } = useApi<{ time: string; rate: number; payment: string | null }[]>('/api/perp/funding', ['user']);
  const close = async (p: PositionRow) => {
    await api('/api/orders', { method: 'POST', body: { marketId: p.marketId, side: p.side === 'long' ? 'sell' : 'buy', type: 'market', qty: p.qty.replace('-', ''), leverage: p.leverage, marginMode: p.marginMode, reduceOnly: true } })
      .catch((e) => alert(e.message));
    reload();
  };
  const open = (data ?? []).filter((p) => p.side !== 'flat');
  return (
    <div className="panel">
      <div className="panel-title">포지션</div>
      <table className="tbl">
        <thead><tr><th>방향</th><th>수량</th><th>진입가</th><th>마크가</th><th>청산가</th><th>증거금</th><th>미실현 손익 (ROE)</th><th>실현 손익</th><th /></tr></thead>
        <tbody>
          {open.map((p) => (
            <tr key={p.marketId}>
              <td className={p.side === 'long' ? 'text-up' : 'text-down'}>{p.side === 'long' ? '롱' : '숏'} {p.leverage}x {p.marginMode === 'cross' ? '교차' : '격리'}</td>
              <td>{fmt(p.qty, 4)}</td><td>{krw(p.entryPrice)}</td><td>{krw(p.markPrice)}</td>
              <td className="text-brand">{krw(p.liquidationPrice)}</td><td>{krw(p.margin)}</td>
              <td className={Number(p.unrealizedPnl) >= 0 ? 'text-up' : 'text-down'}>{krw(p.unrealizedPnl)} ({p.roe.toFixed(2)}%)</td>
              <td>{krw(p.realizedPnl)}</td>
              <td><button className="text-brand" onClick={() => close(p)}>시장가 종료</button></td>
            </tr>
          ))}
          {!open.length && <tr><td colSpan={9} className="text-center text-muted py-4 font-sans">보유 포지션이 없습니다</td></tr>}
        </tbody>
      </table>
      {funding && funding.some((f) => f.payment) && (
        <div className="px-3 py-2 text-xs text-muted border-t border-line">
          최근 펀딩: {funding.filter((f) => f.payment).slice(0, 3).map((f) => `${time(f.time)} ${pct(f.rate, 4)} → ${Number(f.payment) > 0 ? '지불' : '수령'} ${krw(Math.abs(Number(f.payment)))} ${cfg.quote}`).join(' · ')}
        </div>
      )}
    </div>
  );
}
