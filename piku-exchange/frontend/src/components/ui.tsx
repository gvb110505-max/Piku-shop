import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { auth } from '../api';
import { statusLabel } from '../format';

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="panel p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold font-mono mt-1">{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  );
}

const marketStatusLabel: Record<string, string> = { pre: '상장 전', auction: '콜옥션', open: '거래 중', settled: '정산 완료', paused: '일시정지' };

/** 마켓 상태 배지 (주문 상태 'open'=미체결 과 구분) */
export function MarketBadge({ status, paused }: { status: string; paused?: boolean }) {
  const s = paused ? 'paused' : status;
  const color = s === 'open' ? 'text-up border-up/40' : s === 'paused' ? 'text-down border-down/40' : 'text-brand border-brand/40';
  return <span className={`text-xs border rounded px-1.5 py-0.5 ${color}`}>{marketStatusLabel[s] ?? s}</span>;
}

export function Badge({ status }: { status: string }) {
  const color = ['filled', 'sent', 'credited', 'confirmed', 'delivered', 'LISTED', 'approved'].includes(status) ? 'text-up border-up/40'
    : ['canceled', 'rejected', 'failed', 'orphaned', 'seller_default', 'buyer_default'].includes(status) ? 'text-down border-down/40'
    : 'text-brand border-brand/40';
  return <span className={`text-xs border rounded px-1.5 py-0.5 ${color}`}>{statusLabel[status] ?? status}</span>;
}

/** 비동기 버튼: 실행 중 비활성화 + 에러 표시 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, okText?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (okText) setMsg({ ok: true, text: okText }); return true; }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); return false; }
    finally { setBusy(false); }
  };
  const view = msg ? <div className={`text-xs mt-2 ${msg.ok ? 'text-up' : 'text-down'}`}>{msg.text}</div> : null;
  return { busy, run, view, setMsg };
}

export function LoginRequired({ children }: { children: ReactNode }) {
  if (auth.token) return <>{children}</>;
  return (
    <div className="panel p-6 text-center text-sm text-muted">
      <Link to="/login" className="text-brand">로그인</Link> 후 이용할 수 있습니다.
    </div>
  );
}
