import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useBalances } from '../components/Balances';
import { Badge, LoginRequired, useAction } from '../components/ui';
import { useConfig } from '../config';
import { fmt, time } from '../format';
import { useApi } from '../hooks';

export default function Wallet() {
  return <LoginRequired><WalletInner /></LoginRequired>;
}

function WalletInner() {
  const cfg = useConfig();
  const { data: balances, reload } = useBalances();
  const faucet = useAction();
  return (
    <div className="space-y-4">
      <div className="panel">
        <div className="panel-title">
          잔고
          {cfg.testMode && <button className="btn-ghost text-xs" disabled={faucet.busy} onClick={() => faucet.run(async () => { await api('/api/faucet', { method: 'POST', body: {} }); reload(); }, '가상 KRW 10,000,000 충전')}>가상 KRW 충전</button>}
        </div>
        <table className="tbl">
          <thead><tr><th>자산</th><th>주문 가능</th><th>주문/출금 대기</th><th>미성숙 채굴 보상</th><th>선물 인도 예정</th></tr></thead>
          <tbody>
            {(balances ?? []).map((b) => (
              <tr key={b.asset}>
                <td>{b.asset}{b.virtual && <span className="text-brand ml-1 font-sans">가상</span>}</td>
                <td>{fmt(b.available)}</td><td>{fmt(b.locked)}</td><td>{b.immatureMining ? fmt(b.immatureMining) : '-'}</td>
                <td>{b.deliveryObligation ? fmt(b.deliveryObligation) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-3 pb-2">{faucet.view}</div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Deposit />
        <Withdraw onDone={reload} />
      </div>
      <History />
    </div>
  );
}

function Deposit() {
  const cfg = useConfig();
  const [address, setAddress] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const { busy, run, view } = useAction();
  useEffect(() => { if (address) QRCode.toDataURL(address, { margin: 1, width: 160 }).then(setQr); }, [address]);
  return (
    <div className="panel p-4 space-y-3">
      <div className="font-semibold">{cfg.coin.ticker} 입금</div>
      {address ? (
        <div className="flex gap-4 items-center">
          {qr && <img src={qr} alt="입금 주소 QR" className="rounded" />}
          <div className="text-sm break-all font-mono">{address}</div>
        </div>
      ) : (
        <button className="btn-brand" disabled={busy} onClick={() => run(async () => setAddress((await api<{ address: string }>('/api/wallet/address')).address))}>입금 주소 보기</button>
      )}
      <div className="text-xs text-muted">{cfg.wallet.depositConfirmations}컨펌 후 잔고에 반영됩니다. {cfg.coin.ticker} 이외의 코인을 보내면 복구할 수 없습니다.</div>
      {view}
    </div>
  );
}

function Withdraw({ onDone }: { onDone: () => void }) {
  const cfg = useConfig();
  const [form, setForm] = useState({ address: '', amount: '', totp: '' });
  const { busy, run, view } = useAction();
  const submit = () => run(async () => {
    await api('/api/wallet/withdrawals', { method: 'POST', body: form });
    setForm({ ...form, amount: '', totp: '' });
    onDone();
  }, '출금 요청이 접수되었습니다. 관리자 승인 후 전송됩니다.');
  return (
    <div className="panel p-4 space-y-3">
      <div className="font-semibold">{cfg.coin.ticker} 출금</div>
      <input className="input" placeholder="받을 주소" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      <input className="input" placeholder={`수량 (최소 ${cfg.wallet.withdrawMin})`} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
      <input className="input" placeholder="OTP 6자리 (2단계 인증 필수)" inputMode="numeric" value={form.totp} onChange={(e) => setForm({ ...form, totp: e.target.value })} />
      <div className="text-xs text-muted">출금 수수료 {cfg.wallet.withdrawFee} {cfg.coin.ticker} · 관리자 승인 후 전송 · 채굴량 선물 인도 예정 수량은 출금할 수 없습니다</div>
      <button className="btn-brand w-full" disabled={busy} onClick={submit}>출금 요청</button>
      {view}
    </div>
  );
}

function History() {
  const { data: deposits } = useApi<{ id: number; txid: string; amount: string; confirmations: number; status: string; time: string }[]>('/api/wallet/deposits', ['user'], 30_000);
  const { data: withdrawals, reload } = useApi<{ id: number; address: string; amount: string; fee: string; status: string; txid: string | null; note: string | null; time: string }[]>('/api/wallet/withdrawals', ['user'], 30_000);
  const cancel = async (id: number) => { await api(`/api/wallet/withdrawals/${id}/cancel`, { method: 'POST', body: {} }).catch((e) => alert(e.message)); reload(); };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="panel">
        <div className="panel-title">입금 내역</div>
        <table className="tbl">
          <thead><tr><th>시간</th><th>수량</th><th>컨펌</th><th>상태</th><th>TXID</th></tr></thead>
          <tbody>{(deposits ?? []).map((d) => (
            <tr key={d.id}><td>{time(d.time)}</td><td>{fmt(d.amount)}</td><td>{d.confirmations}</td><td><Badge status={d.status} /></td><td className="truncate max-w-[160px]">{d.txid}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="panel">
        <div className="panel-title">출금 내역</div>
        <table className="tbl">
          <thead><tr><th>시간</th><th>수량</th><th>주소</th><th>상태</th><th /></tr></thead>
          <tbody>{(withdrawals ?? []).map((w) => (
            <tr key={w.id}><td>{time(w.time)}</td><td>{fmt(w.amount)}</td><td className="truncate max-w-[160px]">{w.address}</td>
              <td><Badge status={w.status} />{w.note && <span className="text-muted ml-1">{w.note}</span>}</td>
              <td>{w.status === 'pending' && <button className="text-down" onClick={() => cancel(w.id)}>취소</button>}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
