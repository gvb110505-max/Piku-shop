import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { LoginRequired, useAction } from '../components/ui';
import { time } from '../format';
import { useApi } from '../hooks';

interface Me { email: string; username: string; email_verified: boolean; totp_enabled: boolean; kyc_status: string; is_operator: boolean; trading_banned: boolean }

export default function Security() {
  return <LoginRequired><SecurityInner /></LoginRequired>;
}

function SecurityInner() {
  const { data: me, reload } = useApi<Me>('/api/me');
  const { data: logs } = useApi<{ action: string; details: unknown; ip: string; created_at: string }[]>('/api/audit/mine');
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const totp = useAction();
  const kyc = useAction();
  const mail = useAction();
  useEffect(() => { if (setup) QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 180 }).then(setQr); }, [setup]);
  if (!me) return null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="panel p-4 space-y-3">
        <div className="font-semibold">계정</div>
        <div className="text-sm">{me.username} · {me.email}</div>
        <div className="text-sm">이메일 인증: {me.email_verified ? <span className="text-up">완료</span> : (
          <><span className="text-down">미완료</span> <button className="text-brand ml-2" disabled={mail.busy} onClick={() => mail.run(() => api('/api/auth/resend-verification', { method: 'POST', body: {} }), '인증 메일을 보냈습니다')}>인증 메일 다시 보내기</button></>
        )}</div>
        {mail.view}
        {me.is_operator && <div className="text-sm text-down">운영자 계정: 자사 코인 거래가 금지되어 있습니다</div>}
        <div className="text-sm">KYC: <b>{me.kyc_status}</b>
          {me.kyc_status !== 'approved' && <button className="text-brand ml-2" disabled={kyc.busy} onClick={() => kyc.run(async () => { await api('/api/kyc/start', { method: 'POST', body: {} }); reload(); })}>본인 인증 시작</button>}
        </div>
        {kyc.view}
      </div>
      <div className="panel p-4 space-y-3">
        <div className="font-semibold">2단계 인증 (OTP)</div>
        {me.totp_enabled ? (
          <>
            <div className="text-sm text-up">사용 중 — 로그인과 출금 시 OTP가 필요합니다</div>
            <div className="flex gap-2"><input className="input" placeholder="OTP 6자리" value={code} onChange={(e) => setCode(e.target.value)} />
              <button className="btn-ghost" disabled={totp.busy} onClick={() => totp.run(async () => { await api('/api/auth/2fa/disable', { method: 'POST', body: { code } }); setCode(''); reload(); }, '해제되었습니다')}>해제</button></div>
          </>
        ) : setup ? (
          <>
            <div className="text-sm text-muted">Google Authenticator 등으로 QR을 스캔하고 6자리 코드를 입력하세요.</div>
            <div className="flex gap-4 items-center">{qr && <img src={qr} alt="OTP QR" className="rounded" />}<code className="text-xs break-all">{setup.secret}</code></div>
            <div className="flex gap-2"><input className="input" placeholder="OTP 6자리" value={code} onChange={(e) => setCode(e.target.value)} />
              <button className="btn-brand" disabled={totp.busy} onClick={() => totp.run(async () => { await api('/api/auth/2fa/enable', { method: 'POST', body: { code } }); setSetup(null); setCode(''); reload(); }, '2단계 인증이 켜졌습니다')}>확인</button></div>
          </>
        ) : (
          <button className="btn-brand" disabled={totp.busy} onClick={() => totp.run(async () => setSetup(await api('/api/auth/2fa/setup', { method: 'POST', body: {} })))}>2단계 인증 설정</button>
        )}
        {totp.view}
      </div>
      <div className="panel lg:col-span-2">
        <div className="panel-title">내 활동 기록 (감사 로그)</div>
        <div className="max-h-80 overflow-y-auto">
          <table className="tbl">
            <thead><tr><th>시간</th><th>활동</th><th>IP</th><th>내용</th></tr></thead>
            <tbody>{(logs ?? []).map((l, i) => (
              <tr key={i}><td>{time(l.created_at)}</td><td>{l.action}</td><td>{l.ip ?? '-'}</td><td className="truncate max-w-[480px]">{JSON.stringify(l.details)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
