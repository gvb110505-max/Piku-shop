import { Link } from 'react-router-dom';
import { MarketBadge, Stat } from '../components/ui';
import { useConfig } from '../config';
import { countdown, fmt, hashrate, krw, pct, statusLabel } from '../format';
import { useApi, useNow } from '../hooks';

interface MarketRow { id: string; kind: string; status: string; paused: boolean; expiryAt: string | null; last: string | null; change24h: number | null; volume24h: string; openInterest: string | null }

export default function Home() {
  const cfg = useConfig();
  const now = useNow();
  const { data: markets } = useApi<MarketRow[]>('/api/markets', ['status'], 10_000);
  const { data: pool } = useApi<{ network: { difficulty: number; height: number; networkHashps: number } | null; poolHashrate: number; activeMiners: number }>('/api/pool/stats', [], 15_000);
  const kindLabel: Record<string, string> = { spot: '현물', perp: '무기한 선물', mining_future: '채굴량 선물' };
  const href = (m: MarketRow) => (m.kind === 'spot' ? '/spot' : m.kind === 'perp' ? '/perp' : `/futures?m=${m.id}`);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={`${cfg.coin.ticker} 상태`} value={statusLabel[cfg.coinStatus]}
          sub={cfg.coinStatus === 'CALL_AUCTION' && cfg.auctionEndAt ? `단일가 체결까지 ${countdown(new Date(cfg.auctionEndAt).getTime() - now)}` : cfg.coinStatus === 'PRE_LISTING' ? '채굴량 선물만 거래 가능' : '연속 매매 중'} />
        <Stat label="네트워크 난이도" value={fmt(pool?.network?.difficulty, 4)} sub={`블록 높이 ${pool?.network?.height ?? '-'}`} />
        <Stat label="풀 해시레이트" value={hashrate(pool?.poolHashrate)} sub={`활성 채굴자 ${pool?.activeMiners ?? 0}명`} />
        <Stat label="알고리즘" value={cfg.coin.algorithm.toUpperCase()} sub={<Link to="/pool/guide" className="text-brand">채굴 시작하기 →</Link>} />
      </div>
      <div className="panel">
        <div className="panel-title">마켓</div>
        <table className="tbl">
          <thead><tr><th>마켓</th><th>종류</th><th>상태</th><th>현재가</th><th>24h 변동</th><th>24h 거래량</th><th>미결제약정</th><th>만기</th></tr></thead>
          <tbody>
            {(markets ?? []).filter((m) => m.status !== 'settled').map((m) => (
              <tr key={m.id} className="hover:bg-line/40">
                <td><Link to={href(m)} className="text-brand">{m.id}</Link></td>
                <td className="font-sans">{kindLabel[m.kind]}</td>
                <td><MarketBadge status={m.status} paused={m.paused} /></td>
                <td>{krw(m.last)}</td>
                <td className={(m.change24h ?? 0) >= 0 ? 'text-up' : 'text-down'}>{pct(m.change24h)}</td>
                <td>{fmt(m.volume24h, 4)}</td>
                <td>{m.openInterest ? fmt(m.openInterest, 4) : '-'}</td>
                <td>{m.expiryAt ? new Date(m.expiryAt).toLocaleDateString('ko-KR') : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
