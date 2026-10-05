import { useState } from 'react';
import { api } from '../api';
import { fmt, krw, time } from '../format';
import { useApi } from '../hooks';
import { Badge } from './ui';

interface OrderRow {
  id: string; marketId: string; side: string; type: string; price: string | null; qty: string | null; quoteAmount: string | null;
  remaining: string; filledQty: string; avgPrice: string | null; status: string; cancelReason: string | null; leverage: number | null; createdAt: string;
}

const reasonLabel: Record<string, string> = {
  self_trade_prevention: '자전거래 방지', no_liquidity: '호가 없음', partial_no_liquidity: '일부만 체결', expired: '만기', margin_call: '증거금 부족', admin: '관리자', user: '사용자',
};

/** 내 미체결/체결 내역. */
export function MyOrders({ marketId }: { marketId: string }) {
  const [tab, setTab] = useState<'open' | 'history'>('open');
  const { data, reload } = useApi<OrderRow[]>(`/api/orders?marketId=${marketId}&status=${tab}`, ['user']);
  const cancel = async (id: string) => { await api(`/api/orders/${id}`, { method: 'DELETE' }).catch((e) => alert(e.message)); reload(); };
  const cancelAll = async () => { await api(`/api/orders?marketId=${marketId}`, { method: 'DELETE' }).catch((e) => alert(e.message)); reload(); };
  return (
    <div className="panel">
      <div className="panel-title">
        <div className="flex gap-1">
          <button className={`tab ${tab === 'open' ? 'tab-active' : ''}`} onClick={() => setTab('open')}>미체결</button>
          <button className={`tab ${tab === 'history' ? 'tab-active' : ''}`} onClick={() => setTab('history')}>주문 내역</button>
        </div>
        {tab === 'open' && (data?.length ?? 0) > 0 && <button className="text-xs text-down" onClick={cancelAll}>전체 취소</button>}
      </div>
      <div className="max-h-72 overflow-y-auto">
        <table className="tbl">
          <thead><tr><th>시간</th><th>구분</th><th>가격</th><th>수량/금액</th><th>체결</th><th>평균가</th><th>상태</th><th /></tr></thead>
          <tbody>
            {(data ?? []).map((o) => (
              <tr key={o.id}>
                <td className="text-muted">{time(o.createdAt)}</td>
                <td className={o.side === 'buy' ? 'text-up' : 'text-down'}>{o.side === 'buy' ? '매수' : '매도'} {o.type === 'market' ? '시장가' : '지정가'}{o.leverage ? ` ${o.leverage}x` : ''}</td>
                <td>{o.price ? krw(o.price) : '-'}</td>
                <td>{o.qty ? fmt(o.qty, 4) : `${krw(o.quoteAmount)} KRW`}</td>
                <td>{fmt(o.filledQty, 4)}</td>
                <td>{krw(o.avgPrice)}</td>
                <td><Badge status={o.status} />{o.cancelReason && <span className="text-muted ml-1">{reasonLabel[o.cancelReason] ?? o.cancelReason}</span>}</td>
                <td>{o.status === 'open' && <button className="text-down" onClick={() => cancel(o.id)}>취소</button>}</td>
              </tr>
            ))}
            {!data?.length && <tr><td colSpan={8} className="text-center text-muted py-4 font-sans">내역이 없습니다</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
