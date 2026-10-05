import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { BalanceLine, useBalances } from '../components/Balances';
import { MyOrders } from '../components/MyOrders';
import { OrderBook, useBook } from '../components/OrderBook';
import { Trades } from '../components/Trades';
import { Badge, LoginRequired, Stat, useAction } from '../components/ui';
import { useConfig } from '../config';
import { countdown, fmt, hashrate, krw, time } from '../format';
import { useApi, useNow } from '../hooks';

interface MarketRow { id: string; kind: string; status: string; expiryAt: string; last: string | null; openInterest: string | null }
interface Capacity { confirmed: string; expectedMining: string; committed: string; factor: number; sellLimit: string; hashrate7d: number }
interface ContractRow { id: number; marketId: string; expiryAt: string; role: string; qty: string; price: string; margin: string; status: string; deliveredQty: string | null; paid: string | null; forfeited: string | null }

/** 채굴량 선물: "만기일까지 PIKU N개를 가격 P에 인도". 만기(월물)별로 호가창이 분리된다. */
export default function MiningFutures() {
  const cfg = useConfig();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const { data: markets } = useApi<MarketRow[]>('/api/markets', ['status'], 30_000);
  const futures = (markets ?? []).filter((m) => m.kind === 'mining_future' && m.status === 'open');
  const marketId = params.get('m') ?? futures[0]?.id ?? null;
  const market = futures.find((m) => m.id === marketId);
  useEffect(() => { if (!params.get('m') && futures[0]) setParams({ m: futures[0].id }, { replace: true }); }, [futures, params, setParams]);

  if (!marketId || !market) return <div className="text-muted">열려 있는 월물이 없습니다.</div>;
  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <h1 className="text-xl font-semibold mr-2">채굴량 선물</h1>
        {futures.map((m) => (
          <button key={m.id} className={`tab ${m.id === marketId ? 'tab-active' : ''}`} onClick={() => setParams({ m: m.id })}>
            {new Date(m.expiryAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 만기
          </button>
        ))}
      </div>
      <div className="panel p-3 text-sm text-muted">
        계약: <b className="text-gray-200">"{new Date(market.expiryAt).toLocaleString('ko-KR')}까지 {cfg.coin.ticker} N개를 가격 P에 인도"</b>.
        매수자 증거금 {cfg.miningFutures.buyerMarginBps / 100}%, 매도자(채굴자) 증거금 {cfg.miningFutures.sellerMarginBps / 100}%.
        만기에 매도자 잔고에서 코인이 자동 인도되고 매수자는 잔금을 냅니다. 인도 부족분은 매도자 증거금을 몰수해 매수자에게 보상합니다.
        <span className="text-brand ml-1">남은 시간 {countdown(new Date(market.expiryAt).getTime() - now)}</span>
      </div>
      <Book marketId={marketId} expiryAt={market.expiryAt} />
      <LoginRequired><Contracts /></LoginRequired>
    </div>
  );
}

function Book({ marketId, expiryAt }: { marketId: string; expiryAt: string }) {
  const cfg = useConfig();
  const book = useBook(marketId);
  const { data: balances, reload } = useBalances();
  const { data: cap, reload: reloadCap } = useApi<Capacity>(`/api/mf/capacity?marketId=${marketId}`, ['user']);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const { busy, run, view } = useAction();
  const notional = Number(price) * Number(qty);
  const marginBps = side === 'buy' ? cfg.miningFutures.buyerMarginBps : cfg.miningFutures.sellerMarginBps;
  const submit = () => run(async () => {
    await api('/api/orders', { method: 'POST', body: { marketId, side, type: 'limit', price, qty } });
    reload(); reloadCap();
  }, '주문이 접수되었습니다');
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px_300px] gap-4">
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="확정 잔고" value={fmt(cap?.confirmed ?? '0', 4)} sub={cfg.coin.ticker} />
          <Stat label="만기까지 예상 채굴량" value={fmt(cap?.expectedMining ?? '0', 4)} sub={`7일 평균 ${hashrate(cap?.hashrate7d)}`} />
          <Stat label="이미 약정한 수량" value={fmt(cap?.committed ?? '0', 4)} sub="미정산 계약 + 매도 주문" />
          <Stat label="매도 가능 한도" value={fmt(cap?.sellLimit ?? '0', 4)} sub={`확정 + 예상 × ${(cap?.factor ?? 0.7) * 100}% − 약정`} />
        </div>
        <LoginRequired><MyOrders marketId={marketId} /></LoginRequired>
      </div>
      <OrderBook book={book} onPick={setPrice} />
      <div className="space-y-4">
        <div className="panel p-3 space-y-3">
          <div className="grid grid-cols-2 gap-1">
            <button className={side === 'buy' ? 'btn-up' : 'btn-ghost'} onClick={() => setSide('buy')}>매수 (인수)</button>
            <button className={side === 'sell' ? 'btn-down' : 'btn-ghost'} onClick={() => setSide('sell')}>매도 (채굴자)</button>
          </div>
          <BalanceLine balances={balances} asset={cfg.quote} />
          <div><label className="label">인도 가격 P ({cfg.quote}/{cfg.coin.ticker})</label><input className="input" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div><label className="label">수량 N ({cfg.coin.ticker})</label><input className="input" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div className="text-xs text-muted space-y-1">
            <div className="flex justify-between"><span>계약 금액</span><span className="font-mono">{krw(notional || 0)}</span></div>
            <div className="flex justify-between"><span>필요 증거금 ({marginBps / 100}%)</span><span className="font-mono">{krw((notional * marginBps) / 10000 || 0)}</span></div>
            <div className="flex justify-between"><span>만기</span><span>{time(expiryAt)}</span></div>
          </div>
          <button className={side === 'buy' ? 'btn-up w-full' : 'btn-down w-full'} disabled={busy} onClick={submit}>{side === 'buy' ? '매수' : '매도'}</button>
          {view}
        </div>
        <Trades marketId={marketId} />
      </div>
    </div>
  );
}

function Contracts() {
  const cfg = useConfig();
  const { data } = useApi<ContractRow[]>('/api/mf/contracts', ['user']);
  return (
    <div className="panel">
      <div className="panel-title">내 계약</div>
      <table className="tbl">
        <thead><tr><th>#</th><th>월물</th><th>역할</th><th>수량</th><th>가격</th><th>증거금</th><th>상태</th><th>인도</th><th>대금</th><th>몰수/보상</th></tr></thead>
        <tbody>
          {(data ?? []).map((c) => (
            <tr key={c.id}>
              <td>{c.id}</td><td>{c.marketId}</td>
              <td className={c.role === 'buyer' ? 'text-up' : 'text-down'}>{c.role === 'buyer' ? '매수' : '매도'}</td>
              <td>{fmt(c.qty, 4)}</td><td>{krw(c.price)}</td><td>{krw(c.margin)}</td>
              <td><Badge status={c.status} /></td>
              <td>{c.deliveredQty ? `${fmt(c.deliveredQty, 4)} ${cfg.coin.ticker}` : '-'}</td>
              <td>{krw(c.paid)}</td><td>{krw(c.forfeited)}</td>
            </tr>
          ))}
          {!data?.length && <tr><td colSpan={10} className="text-center text-muted py-4 font-sans">계약이 없습니다</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
