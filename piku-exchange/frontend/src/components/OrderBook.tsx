import { fmt, krw } from '../format';
import { useChannel } from '../hooks';

export interface BookSnapshot {
  market: string; bids: [string, string][]; asks: [string, string][]; last: string | null;
  status?: string; paused?: boolean; indicative?: { price: string; volume: string } | null; auctionEndAt?: string | null;
}

export function useBook(marketId: string) {
  return useChannel<BookSnapshot>(`book:${marketId}`, `/api/markets/${marketId}/orderbook`);
}

/** 호가창. 행을 클릭하면 가격을 주문 폼에 넣는다. */
export function OrderBook({ book, onPick, rows = 12 }: { book: BookSnapshot | null; onPick?: (price: string) => void; rows?: number }) {
  const asks = (book?.asks ?? []).slice(0, rows).reverse();
  const bids = (book?.bids ?? []).slice(0, rows);
  const max = Math.max(1, ...[...asks, ...bids].map(([, q]) => Number(q)));
  const Row = ({ p, q, side }: { p: string; q: string; side: 'bid' | 'ask' }) => (
    <tr className="relative cursor-pointer hover:bg-line/50" onClick={() => onPick?.(p)}>
      <td className={side === 'bid' ? 'text-up' : 'text-down'}>{krw(p)}</td>
      <td className="text-right relative">
        <span className={`absolute inset-y-0 right-0 ${side === 'bid' ? 'bg-up/10' : 'bg-down/10'}`} style={{ width: `${(Number(q) / max) * 100}%` }} />
        <span className="relative">{fmt(q, 4)}</span>
      </td>
    </tr>
  );
  return (
    <div className="panel">
      <div className="panel-title">호가 {book?.paused && <span className="text-down text-xs">일시정지</span>}</div>
      <table className="tbl">
        <thead><tr><th>가격</th><th className="text-right">수량</th></tr></thead>
        <tbody>
          {asks.map(([p, q]) => <Row key={`a${p}`} p={p} q={q} side="ask" />)}
          <tr><td colSpan={2} className="text-center py-2 text-base font-semibold">
            {book?.status === 'auction'
              ? <span className="text-brand">예상 체결가 {book.indicative ? `${krw(book.indicative.price)} (${fmt(book.indicative.volume, 4)})` : '-'}</span>
              : <span>{book?.last ? krw(book.last) : '-'}</span>}
          </td></tr>
          {bids.map(([p, q]) => <Row key={`b${p}`} p={p} q={q} side="bid" />)}
        </tbody>
      </table>
    </div>
  );
}
