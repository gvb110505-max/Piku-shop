import { useState } from 'react';
import { api } from '../api';
import { BalanceLine, useBalances } from '../components/Balances';
import { CandleChart } from '../components/CandleChart';
import { MyOrders } from '../components/MyOrders';
import { OrderBook, useBook } from '../components/OrderBook';
import { Trades } from '../components/Trades';
import { LoginRequired, useAction } from '../components/ui';
import { useConfig } from '../config';
import { countdown, krw } from '../format';
import { useNow } from '../hooks';

export default function Spot() {
  const cfg = useConfig();
  const marketId = cfg.markets.spot;
  const book = useBook(marketId);
  const now = useNow();
  const { data: balances, reload } = useBalances();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'limit' | 'market'>('limit');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [quoteAmount, setQuoteAmount] = useState('');
  const { busy, run, view } = useAction();
  const auction = cfg.coinStatus === 'CALL_AUCTION';
  const closed = cfg.coinStatus === 'PRE_LISTING';
  const coin = balances?.find((b) => b.asset === cfg.coin.ticker);

  const submit = () => run(async () => {
    const body: Record<string, unknown> = { marketId, side, type };
    if (type === 'limit') { body.price = price; body.qty = qty; }
    else if (side === 'buy') body.quoteAmount = quoteAmount;
    else body.qty = qty;
    const r = await api<{ status: string; filledQty: string }>('/api/orders', { method: 'POST', body });
    reload();
    return r;
  }, '주문이 접수되었습니다');

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-4">
        <h1 className="text-xl font-semibold">{cfg.coin.ticker}/{cfg.quote}</h1>
        <span className="text-2xl font-mono">{krw(book?.last)}</span>
        {auction && cfg.auctionEndAt && (
          <span className="text-brand text-sm">콜옥션 진행 중 — 주문을 모아 {countdown(new Date(cfg.auctionEndAt).getTime() - now)} 후 단일가로 체결합니다 (지정가만 가능)</span>
        )}
        {closed && <span className="text-down text-sm">상장 전에는 현물 거래를 할 수 없습니다. 채굴 잔고는 쌓이기만 하며, 채굴량 선물만 거래할 수 있습니다.</span>}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px_300px] gap-4">
        <div className="space-y-4">
          <CandleChart marketId={marketId} />
          <LoginRequired><MyOrders marketId={marketId} /></LoginRequired>
        </div>
        <div className="space-y-4">
          <OrderBook book={book} onPick={setPrice} />
        </div>
        <div className="space-y-4">
          <div className="panel p-3 space-y-3">
            <div className="grid grid-cols-2 gap-1">
              <button className={side === 'buy' ? 'btn-up' : 'btn-ghost'} onClick={() => setSide('buy')}>매수</button>
              <button className={side === 'sell' ? 'btn-down' : 'btn-ghost'} onClick={() => setSide('sell')}>매도</button>
            </div>
            <div className="flex gap-1">
              <button className={`tab ${type === 'limit' ? 'tab-active' : ''}`} onClick={() => setType('limit')}>지정가</button>
              <button className={`tab ${type === 'market' ? 'tab-active' : ''}`} onClick={() => setType('market')} disabled={auction}>시장가</button>
            </div>
            <BalanceLine balances={balances} asset={side === 'buy' ? cfg.quote : cfg.coin.ticker} />
            {side === 'sell' && Number(coin?.deliveryObligation ?? 0) > 0 && (
              <div className="text-xs text-brand">채굴량 선물 인도 예정 {coin?.deliveryObligation} {cfg.coin.ticker}은(는) 매도할 수 없습니다</div>
            )}
            {type === 'limit' && <div><label className="label">가격 ({cfg.quote})</label><input className="input" value={price} onChange={(e) => setPrice(e.target.value)} /></div>}
            {type === 'market' && side === 'buy'
              ? <div><label className="label">주문 총액 ({cfg.quote})</label><input className="input" value={quoteAmount} onChange={(e) => setQuoteAmount(e.target.value)} /></div>
              : <div><label className="label">수량 ({cfg.coin.ticker})</label><input className="input" value={qty} onChange={(e) => setQty(e.target.value)} /></div>}
            {type === 'limit' && price && qty && <div className="text-xs text-muted">주문 금액 ≈ {krw(Number(price) * Number(qty))} {cfg.quote}</div>}
            <button className={side === 'buy' ? 'btn-up w-full' : 'btn-down w-full'} disabled={busy || closed} onClick={submit}>
              {side === 'buy' ? '매수' : '매도'}
            </button>
            {view}
          </div>
          <Trades marketId={marketId} />
        </div>
      </div>
    </div>
  );
}
