import { Link } from 'react-router-dom';
import { Badge, LoginRequired, Stat } from '../components/ui';
import { useConfig } from '../config';
import { fmt, hashrate, time } from '../format';
import { useApi } from '../hooks';

interface PoolMe {
  hashrate: { m10: number; h1: number; h24: number };
  workers: { name: string; hashrate: number; lastShareAt: string; online: boolean; difficulty: number | null; accepted: number | null; rejected: number | null }[];
  estimatedDaily: string; totalMined: string; immature: string; feeBps: number; maturity: number;
  network: { difficulty: number; height: number; networkHashps: number } | null;
  credits: { blockHash: string; height: number; amount: string; status: string; confirmations: number; time: string }[];
}

export default function Pool() {
  const cfg = useConfig();
  const { data: stats } = useApi<{ poolHashrate: number; activeMiners: number; blocks: { hash: string; height: number; reward: string; status: string; confirmations: number; created_at: string }[] }>('/api/pool/stats', ['pool'], 15_000);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">마이닝 풀 <span className="text-sm text-muted">PPLNS · 수수료 {cfg.pool.feeBps / 100}% · {cfg.pool.maturity}컨펌 후 확정</span></h1>
        <Link to="/pool/guide" className="btn-brand">채굴기 연결 방법</Link>
      </div>
      <LoginRequired><MyDashboard /></LoginRequired>
      <div className="panel">
        <div className="panel-title">풀이 찾은 블록 <span className="text-xs text-muted">풀 해시레이트 {hashrate(stats?.poolHashrate)} · 채굴자 {stats?.activeMiners ?? 0}명</span></div>
        <table className="tbl">
          <thead><tr><th>높이</th><th>해시</th><th>보상</th><th>컨펌</th><th>상태</th><th>시간</th></tr></thead>
          <tbody>
            {(stats?.blocks ?? []).map((b) => (
              <tr key={b.hash}><td>{b.height}</td><td className="truncate max-w-[240px]">{b.hash}</td><td>{fmt(b.reward)} {cfg.coin.ticker}</td>
                <td>{b.confirmations}/{cfg.pool.maturity}</td><td><Badge status={b.status} /></td><td>{time(b.created_at)}</td></tr>
            ))}
            {!stats?.blocks.length && <tr><td colSpan={6} className="text-center text-muted py-4 font-sans">아직 찾은 블록이 없습니다</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MyDashboard() {
  const cfg = useConfig();
  const { data } = useApi<PoolMe>('/api/pool/me', ['pool'], 15_000);
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Stat label="내 해시레이트 (10분)" value={hashrate(data?.hashrate.m10)} sub={`1시간 ${hashrate(data?.hashrate.h1)} · 24시간 ${hashrate(data?.hashrate.h24)}`} />
        <Stat label="예상 일일 채굴량" value={fmt(data?.estimatedDaily ?? '0', 4)} sub={`${cfg.coin.ticker} (1시간 평균 기준)`} />
        <Stat label="누적 채굴량 (확정)" value={fmt(data?.totalMined ?? '0', 4)} sub={cfg.coin.ticker} />
        <Stat label="미성숙 보상" value={fmt(data?.immature ?? '0', 4)} sub={`${cfg.pool.maturity}컨펌 후 잔고로 전환`} />
        <Stat label="네트워크 난이도" value={fmt(data?.network?.difficulty, 4)} sub={`높이 ${data?.network?.height ?? '-'}`} />
        <Stat label="네트워크 해시레이트" value={hashrate(data?.network?.networkHashps)} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel">
          <div className="panel-title">워커</div>
          <table className="tbl">
            <thead><tr><th>이름</th><th>상태</th><th>해시레이트</th><th>난이도</th><th>수락/거부</th><th>마지막 쉐어</th></tr></thead>
            <tbody>
              {(data?.workers ?? []).map((w) => (
                <tr key={w.name}>
                  <td>{w.name}</td>
                  <td className={w.online ? 'text-up' : 'text-down'}>{w.online ? '온라인' : '오프라인'}</td>
                  <td>{hashrate(w.hashrate)}</td><td>{w.difficulty ?? '-'}</td>
                  <td>{w.accepted ?? '-'} / {w.rejected ?? '-'}</td><td>{time(w.lastShareAt)}</td>
                </tr>
              ))}
              {!data?.workers.length && <tr><td colSpan={6} className="text-center text-muted py-4 font-sans">연결된 워커가 없습니다. <Link to="/pool/guide" className="text-brand">연결 방법 보기</Link></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <div className="panel-title">내 채굴 보상</div>
          <table className="tbl">
            <thead><tr><th>블록</th><th>보상</th><th>컨펌</th><th>상태</th></tr></thead>
            <tbody>
              {(data?.credits ?? []).map((c) => (
                <tr key={c.blockHash}><td>{c.height}</td><td>{fmt(c.amount)}</td><td>{c.confirmations}/{data?.maturity}</td><td><Badge status={c.status} /></td></tr>
              ))}
              {!data?.credits.length && <tr><td colSpan={4} className="text-center text-muted py-4 font-sans">보상 내역이 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
