import { fmt, krw, shortTime } from '../format';
import { useApi } from '../hooks';

export function Trades({ marketId }: { marketId: string }) {
  const { data } = useApi<{ id: number; price: string; qty: string; side: string; time: string; kind: string }[]>(
    `/api/markets/${marketId}/trades?limit=40`, [`trades:${marketId}`]);
  return (
    <div className="panel">
      <div className="panel-title">체결</div>
      <div className="max-h-80 overflow-y-auto">
        <table className="tbl">
          <thead><tr><th>시간</th><th>가격</th><th className="text-right">수량</th></tr></thead>
          <tbody>
            {(data ?? []).map((t) => (
              <tr key={t.id}>
                <td className="text-muted">{shortTime(t.time)}{t.kind === 'auction' && <span className="text-brand ml-1">단일가</span>}</td>
                <td className={t.side === 'buy' ? 'text-up' : 'text-down'}>{krw(t.price)}</td>
                <td className="text-right">{fmt(t.qty, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
