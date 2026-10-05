import { NavLink, Route, Routes } from 'react-router-dom';
import { auth } from './api';
import { ConfigContext, type AppConfig } from './config';
import { countdown, statusLabel } from './format';
import { useApi, useAuth, useNow } from './hooks';
import Admin from './pages/Admin';
import { Login, Register, Verify } from './pages/Auth';
import Home from './pages/Home';
import MiningFutures from './pages/MiningFutures';
import Perp from './pages/Perp';
import Pool from './pages/Pool';
import PoolGuide from './pages/PoolGuide';
import Security from './pages/Security';
import Spot from './pages/Spot';
import Wallet from './pages/Wallet';

export default function App() {
  const token = useAuth();
  const { data: config } = useApi<AppConfig>('/api/config', ['status']);
  const { data: me } = useApi<{ username: string; role: string; is_operator: boolean }>(token ? '/api/me' : null, []);
  const now = useNow();
  if (!config) return <div className="p-8 text-muted">불러오는 중… (API 서버가 실행 중인지 확인하세요)</div>;

  const link = ({ isActive }: { isActive: boolean }) => `px-3 py-2 text-sm ${isActive ? 'text-brand' : 'text-gray-300 hover:text-white'}`;
  return (
    <ConfigContext.Provider value={config}>
      {config.testMode && (
        <div className="bg-brand text-black text-xs text-center py-1 font-semibold">
          테스트 모드 — KRW는 가상 잔고이며 실제 돈이 아닙니다
        </div>
      )}
      <header className="border-b border-line bg-panel">
        <div className="max-w-[1400px] mx-auto px-4 flex items-center gap-2 flex-wrap">
          <NavLink to="/" className="font-bold text-brand text-lg mr-4 py-3">{config.coin.name}<span className="text-gray-300"> Exchange</span></NavLink>
          <NavLink to="/spot" className={link}>현물</NavLink>
          <NavLink to="/futures" className={link}>채굴량 선물</NavLink>
          <NavLink to="/perp" className={link}>무기한 선물</NavLink>
          <NavLink to="/pool" className={link}>마이닝 풀</NavLink>
          <NavLink to="/wallet" className={link}>지갑</NavLink>
          {me?.role === 'admin' && <NavLink to="/admin" className={link}>관리자</NavLink>}
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-xs border border-line rounded px-2 py-1">
              {config.coin.ticker}: <span className="text-brand">{statusLabel[config.coinStatus]}</span>
              {config.coinStatus === 'CALL_AUCTION' && config.auctionEndAt && <> · {countdown(new Date(config.auctionEndAt).getTime() - now)}</>}
            </span>
            {token ? (
              <>
                <NavLink to="/security" className={link}>{me?.username ?? '내 계정'}{me?.is_operator && <span className="text-down text-xs ml-1">(운영자)</span>}</NavLink>
                <button className="text-muted hover:text-white" onClick={() => auth.set(null)}>로그아웃</button>
              </>
            ) : (
              <>
                <NavLink to="/login" className={link}>로그인</NavLink>
                <NavLink to="/register" className="btn-brand">회원가입</NavLink>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-[1400px] mx-auto p-4">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/spot" element={<Spot />} />
          <Route path="/futures" element={<MiningFutures />} />
          <Route path="/perp" element={<Perp />} />
          <Route path="/pool" element={<Pool />} />
          <Route path="/pool/guide" element={<PoolGuide />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/security" element={<Security />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </main>
    </ConfigContext.Provider>
  );
}
