import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, MarketBadge, Stat, useAction } from '../components/ui';
import { useConfig } from '../config';
import { countdown, fmt, krw, statusLabel, time } from '../format';
import { useApi, useNow } from '../hooks';

interface Overview {
  coinStatus: string; auctionEndAt: string | null; settings: Record<string, unknown>;
  markets: { id: string; kind: string; status: string; paused: boolean; expiry_at: string | null }[];
  pendingWithdrawals: number; alerts: { id: number; kind: string; message: string; created_at: string }[];
  insuranceFund: { balance: string; position: { qty: string; entryPrice: string } | null };
  users: number;
  hotWallet: { node: string; expected: string; difference: string; ok: boolean; checkedAt: string; userLiabilities: string; pendingDeposits: string; immaturePoolRewards: string } | null;
}

const settingLabels: Record<string, string> = {
  pool_fee_bps: '풀 수수료 (bps, 100=1%)', pool_maturity_confirmations: '채굴 보상 확정 컨펌 수', pplns_window_factor: 'PPLNS 창 (네트워크 난이도 배수)',
  deposit_confirmations: '입금 컨펌 수', withdraw_fee: '출금 수수료 (코인)', withdraw_min: '최소 출금 (코인)',
  mf_buyer_margin_bps: '채굴량 선물 매수 증거금 (bps)', mf_seller_margin_bps: '채굴량 선물 매도 증거금 (bps)', mf_sell_limit_factor_bps: '예상 채굴량 반영 비율 (bps)',
  perp_max_leverage: '무기한 최대 레버리지', perp_mmr_bps: '유지증거금률 (bps)', perp_liq_fee_bps: '청산 수수료 (bps)', perp_funding_cap_ppm: '펀딩비 상한 (ppm)',
  auction_minutes: '콜옥션 시간 (분)',
};

export default function Admin() {
  const { data, error, reload } = useApi<Overview>('/api/admin/overview', ['status'], 15_000);
  if (error) return <div className="panel p-6 text-down">{error}</div>;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">관리자</h1>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="코인 상태" value={statusLabel[data.coinStatus]} />
        <Stat label="회원 수" value={data.users} />
        <Stat label="출금 승인 대기" value={data.pendingWithdrawals} />
        <Stat label="보험기금" value={krw(data.insuranceFund.balance)} sub={data.insuranceFund.position ? `인수 포지션 ${data.insuranceFund.position.qty} @ ${krw(data.insuranceFund.position.entryPrice)}` : '인수 포지션 없음'} />
        <Stat label="핫월렛 대사" value={data.hotWallet ? <span className={data.hotWallet.ok ? 'text-up' : 'text-down'}>{data.hotWallet.ok ? '일치' : '불일치'}</span> : '미확인'}
          sub={data.hotWallet ? `노드 ${fmt(data.hotWallet.node)} / 장부 ${fmt(data.hotWallet.expected)} (차이 ${data.hotWallet.difference})` : '워커/노드 연결 확인'} />
      </div>
      <Alerts alerts={data.alerts} onAck={reload} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Listing data={data} onChange={reload} />
        <Markets markets={data.markets} onChange={reload} />
      </div>
      <Withdrawals />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SettingsEditor settings={data.settings} onSaved={reload} />
        <Users />
      </div>
      <AuditLog />
    </div>
  );
}

function Alerts({ alerts, onAck }: { alerts: Overview['alerts']; onAck: () => void }) {
  if (!alerts.length) return null;
  return (
    <div className="panel border-down/50">
      <div className="panel-title text-down">알림 {alerts.length}건</div>
      {alerts.map((a) => (
        <div key={a.id} className="px-3 py-2 text-sm flex justify-between border-b border-line/50">
          <span><b>{a.kind}</b> {a.message} <span className="text-muted text-xs">{time(a.created_at)}</span></span>
          <button className="text-xs text-brand" onClick={async () => { await api(`/api/admin/alerts/${a.id}/ack`, { method: 'POST', body: {} }); onAck(); }}>확인</button>
        </div>
      ))}
    </div>
  );
}

function Listing({ data, onChange }: { data: Overview; onChange: () => void }) {
  const cfg = useConfig();
  const now = useNow();
  const { busy, run, view } = useAction();
  return (
    <div className="panel p-4 space-y-3">
      <div className="font-semibold">상장 단계</div>
      <div className="flex gap-2 text-sm">
        {['PRE_LISTING', 'CALL_AUCTION', 'LISTED'].map((s, i) => (
          <span key={s} className={`px-2 py-1 rounded ${data.coinStatus === s ? 'bg-brand text-black' : 'bg-line text-muted'}`}>{i + 1}. {statusLabel[s]}</span>
        ))}
      </div>
      {data.coinStatus === 'PRE_LISTING' && (
        <>
          <div className="text-sm text-muted">상장 버튼을 누르면 {String(data.settings.auction_minutes)}분 동안 현물 지정가 주문을 모은 뒤 단일가로 첫 가격을 정하고 연속 매매를 시작합니다. 무기한 선물도 함께 열립니다.</div>
          <button className="btn-brand" disabled={busy} onClick={() => { if (confirm(`${cfg.coin.ticker} 상장 절차(콜옥션)를 시작할까요? 되돌릴 수 없습니다.`)) run(async () => { await api('/api/admin/listing/start', { method: 'POST', body: {} }); onChange(); }); }}>상장 시작 (콜옥션)</button>
        </>
      )}
      {data.coinStatus === 'CALL_AUCTION' && data.auctionEndAt && (
        <>
          <div className="text-sm">단일가 체결까지 <b className="text-brand">{countdown(new Date(data.auctionEndAt).getTime() - now)}</b></div>
          <button className="btn-ghost" disabled={busy} onClick={() => { if (confirm('지금 바로 콜옥션을 종료하고 체결할까요?')) run(async () => { await api('/api/admin/listing/end-auction', { method: 'POST', body: {} }); onChange(); }); }}>지금 종료</button>
        </>
      )}
      {data.coinStatus === 'LISTED' && <div className="text-sm text-up">상장 완료 — 연속 매매 중</div>}
      {view}
    </div>
  );
}

function Markets({ markets, onChange }: { markets: Overview['markets']; onChange: () => void }) {
  const toggle = async (id: string, paused: boolean) => { await api(`/api/admin/markets/${id}/pause`, { method: 'POST', body: { paused } }).catch((e) => alert(e.message)); onChange(); };
  return (
    <div className="panel">
      <div className="panel-title">마켓 일시정지</div>
      <table className="tbl">
        <thead><tr><th>마켓</th><th>상태</th><th>만기</th><th /></tr></thead>
        <tbody>{markets.filter((m) => m.status !== 'settled').map((m) => (
          <tr key={m.id}><td>{m.id}</td><td><MarketBadge status={m.status} paused={m.paused} /></td><td>{m.expiry_at ? time(m.expiry_at) : '-'}</td>
            <td><button className={m.paused ? 'text-up' : 'text-down'} onClick={() => toggle(m.id, !m.paused)}>{m.paused ? '재개' : '일시정지'}</button></td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Withdrawals() {
  const [status, setStatus] = useState('pending');
  const { data, reload } = useApi<{ id: number; user: string; email: string; address: string; amount: string; fee: string; status: string; txid: string | null; error: string | null; time: string }[]>(`/api/admin/withdrawals?status=${status}`);
  const [totp, setTotp] = useState('');
  const act = async (id: number, action: 'approve' | 'reject') => {
    const body = action === 'approve' ? { totp: totp || undefined } : { note: prompt('거절 사유') ?? '' };
    await api(`/api/admin/withdrawals/${id}/${action}`, { method: 'POST', body }).catch((e) => alert(e.message));
    reload();
  };
  return (
    <div className="panel">
      <div className="panel-title">
        <div className="flex gap-1">{['pending', 'approved', 'sending', 'sent', 'failed', 'rejected'].map((s) => (
          <button key={s} className={`tab ${status === s ? 'tab-active' : ''}`} onClick={() => setStatus(s)}>{statusLabel[s]}</button>
        ))}</div>
        {status === 'pending' && <input className="input w-40" placeholder="내 OTP (승인용)" value={totp} onChange={(e) => setTotp(e.target.value)} />}
      </div>
      <table className="tbl">
        <thead><tr><th>#</th><th>사용자</th><th>주소</th><th>수량</th><th>수수료</th><th>시간</th><th>TXID/오류</th><th /></tr></thead>
        <tbody>{(data ?? []).map((w) => (
          <tr key={w.id}><td>{w.id}</td><td className="font-sans">{w.user}</td><td className="truncate max-w-[200px]">{w.address}</td><td>{fmt(w.amount)}</td><td>{fmt(w.fee)}</td><td>{time(w.time)}</td>
            <td className="truncate max-w-[160px]">{w.txid ?? w.error ?? '-'}</td>
            <td className="space-x-2">{w.status === 'pending' && <><button className="text-up" onClick={() => act(w.id, 'approve')}>승인</button><button className="text-down" onClick={() => act(w.id, 'reject')}>거절</button></>}
              {w.status === 'failed' && <button className="text-down" onClick={() => act(w.id, 'reject')}>종결</button>}</td></tr>
        ))}
          {!data?.length && <tr><td colSpan={8} className="text-center text-muted py-4 font-sans">없음</td></tr>}</tbody>
      </table>
    </div>
  );
}

function SettingsEditor({ settings, onSaved }: { settings: Record<string, unknown>; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => { setForm(Object.fromEntries(Object.keys(settingLabels).map((k) => [k, String(settings[k] ?? '')]))); }, [settings]);
  const { busy, run, view } = useAction();
  const save = () => run(async () => {
    const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => String(settings[k]) !== v));
    if (!Object.keys(changed).length) throw new Error('변경된 값이 없습니다');
    await api('/api/admin/settings', { method: 'PUT', body: changed });
    onSaved();
  }, '저장되었습니다 (엔진에 즉시 반영)');
  return (
    <div className="panel p-4 space-y-2">
      <div className="font-semibold">풀 수수료 / 선물 파라미터</div>
      {Object.entries(settingLabels).map(([k, label]) => (
        <div key={k} className="grid grid-cols-[1fr_140px] gap-2 items-center text-sm">
          <span className="text-muted">{label}</span>
          <input className="input py-1" value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
        </div>
      ))}
      <button className="btn-brand" disabled={busy} onClick={save}>저장</button>
      {view}
    </div>
  );
}

function Users() {
  const [q, setQ] = useState('');
  const { data, reload } = useApi<{ id: string; email: string; username: string; role: string; is_operator: boolean; trading_banned: boolean; kyc_status: string; totp_enabled: boolean }[]>(`/api/admin/users?q=${encodeURIComponent(q)}`);
  const patch = async (id: string, body: Record<string, unknown>) => { await api(`/api/admin/users/${id}`, { method: 'PATCH', body }).catch((e) => alert(e.message)); reload(); };
  return (
    <div className="panel">
      <div className="panel-title">사용자 <input className="input w-48 py-1" placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="max-h-96 overflow-y-auto">
        <table className="tbl">
          <thead><tr><th>아이디</th><th>KYC</th><th>2FA</th><th>운영자(거래금지)</th><th>거래 정지</th></tr></thead>
          <tbody>{(data ?? []).map((u) => (
            <tr key={u.id}>
              <td className="font-sans">{u.username} <span className="text-muted">{u.email}</span>{u.role === 'admin' && <span className="text-brand ml-1">관리자</span>}</td>
              <td><select className="bg-bg border border-line rounded text-xs" value={u.kyc_status} onChange={(e) => patch(u.id, { kyc_status: e.target.value })}>
                {['none', 'pending', 'approved', 'rejected'].map((s) => <option key={s}>{s}</option>)}</select></td>
              <td>{u.totp_enabled ? 'ON' : '-'}</td>
              <td><input type="checkbox" checked={u.is_operator} onChange={(e) => patch(u.id, { is_operator: e.target.checked })} /></td>
              <td><input type="checkbox" checked={u.trading_banned} onChange={(e) => patch(u.id, { trading_banned: e.target.checked })} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function AuditLog() {
  const [action, setAction] = useState('');
  const { data } = useApi<{ id: number; actor_id: string; user_id: string; action: string; details: unknown; ip: string; created_at: string }[]>(`/api/admin/audit?action=${encodeURIComponent(action)}`);
  return (
    <div className="panel">
      <div className="panel-title">감사 로그 (수정/삭제 불가) <input className="input w-48 py-1" placeholder="action 접두어 (예: wallet.)" value={action} onChange={(e) => setAction(e.target.value)} /></div>
      <div className="max-h-96 overflow-y-auto">
        <table className="tbl">
          <thead><tr><th>#</th><th>시간</th><th>action</th><th>사용자</th><th>IP</th><th>내용</th></tr></thead>
          <tbody>{(data ?? []).map((l) => (
            <tr key={l.id}><td>{l.id}</td><td>{time(l.created_at)}</td><td>{l.action}</td><td className="truncate max-w-[120px]">{l.user_id ?? '-'}</td><td>{l.ip ?? '-'}</td>
              <td className="truncate max-w-[480px]">{JSON.stringify(l.details)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
