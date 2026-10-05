import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, auth } from '../api';
import { useAction } from '../components/ui';

export function Login() {
  const nav = useNavigate();
  const [form, setForm] = useState({ login: '', password: '', totp: '' });
  const [needTotp, setNeedTotp] = useState(false);
  const { busy, run, view } = useAction();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api<{ token?: string; totpRequired?: boolean }>('/api/auth/login', { method: 'POST', body: { ...form, totp: form.totp || undefined } });
      if (r.totpRequired) { setNeedTotp(true); throw new Error('OTP 코드를 입력하세요'); }
      auth.set(r.token!);
      nav('/');
    });
  };
  return (
    <form onSubmit={submit} className="panel p-6 max-w-sm mx-auto mt-10 space-y-3">
      <h1 className="text-lg font-semibold">로그인</h1>
      <input className="input" placeholder="이메일 또는 아이디" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
      <input className="input" type="password" placeholder="비밀번호" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      {needTotp && <input className="input" placeholder="OTP 6자리" inputMode="numeric" value={form.totp} onChange={(e) => setForm({ ...form, totp: e.target.value })} />}
      <button className="btn-brand w-full" disabled={busy}>로그인</button>
      {view}
      <div className="text-xs text-muted">계정이 없나요? <Link to="/register" className="text-brand">회원가입</Link></div>
    </form>
  );
}

export function Register() {
  const nav = useNavigate();
  const [form, setForm] = useState({ email: '', username: '', password: '' });
  const { busy, run, view } = useAction();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api<{ emailVerificationRequired: boolean }>('/api/auth/register', { method: 'POST', body: form });
      const login = await api<{ token: string }>('/api/auth/login', { method: 'POST', body: { login: form.username, password: form.password } });
      auth.set(login.token);
      nav(r.emailVerificationRequired ? '/security?verify=1' : '/');
    });
  };
  return (
    <form onSubmit={submit} className="panel p-6 max-w-sm mx-auto mt-10 space-y-3">
      <h1 className="text-lg font-semibold">회원가입</h1>
      <input className="input" placeholder="이메일" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <div>
        <input className="input" placeholder="거래소 아이디 (영문/숫자/_ 3~20자)" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <div className="text-xs text-muted mt-1">채굴기 접속 ID로도 쓰입니다: <code>{form.username || '아이디'}.워커이름</code></div>
      </div>
      <input className="input" type="password" placeholder="비밀번호 (10자 이상)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      <button className="btn-brand w-full" disabled={busy}>가입하기</button>
      {view}
    </form>
  );
}

export function Verify() {
  const [params] = useSearchParams();
  const [state, setState] = useState('확인 중…');
  useEffect(() => {
    api('/api/auth/verify-email', { method: 'POST', body: { token: params.get('token') } })
      .then(() => setState('이메일 인증이 완료되었습니다.'))
      .catch((e) => setState(e.message));
  }, [params]);
  return <div className="panel p-6 max-w-sm mx-auto mt-10 text-center">{state} <Link to="/" className="text-brand block mt-3">홈으로</Link></div>;
}
