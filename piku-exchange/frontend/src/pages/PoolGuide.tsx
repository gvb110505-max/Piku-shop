import { useConfig } from '../config';
import { useApi } from '../hooks';

/** 채굴 소프트웨어 접속 방법 안내. */
export default function PoolGuide() {
  const cfg = useConfig();
  const { data: me } = useApi<{ username: string }>('/api/me');
  const user = me?.username ?? '거래소아이디';
  const url = `stratum+tcp://${cfg.stratum.host}:${cfg.stratum.port}`;
  const Code = ({ children }: { children: string }) => <pre className="bg-bg border border-line rounded p-3 text-xs overflow-x-auto font-mono">{children}</pre>;
  return (
    <div className="max-w-3xl space-y-4 text-sm leading-relaxed">
      <h1 className="text-xl font-semibold">채굴기 연결 방법</h1>
      <div className="panel p-4 space-y-2">
        <div>풀 주소: <code className="text-brand">{url}</code></div>
        <div>사용자명: <code className="text-brand">{user}.워커이름</code> (예: <code>{user}.rig1</code>) · 비밀번호: 아무 값 (<code>x</code>)</div>
        <div>알고리즘: <b>{cfg.coin.algorithm.toUpperCase()}</b> · 보상 방식: PPLNS · 풀 수수료 {cfg.pool.feeBps / 100}% · 블록 {cfg.pool.maturity}컨펌 후 거래소 잔고에 확정 적립</div>
        <div className="text-muted">채굴 보상은 별도 지갑 주소 없이 <b>거래소 계정 잔고로 바로 적립</b>됩니다. 워커 이름은 영문/숫자/-/_ 만 사용하세요.</div>
      </div>
      <h2 className="font-semibold">ASIC (Antminer, Whatsminer 등)</h2>
      <div className="panel p-4 space-y-1 text-muted">
        <div>웹 관리 화면 → Miner Configuration → Pool 1</div>
        <div>URL: <code className="text-gray-200">{url}</code></div>
        <div>Worker: <code className="text-gray-200">{user}.asic1</code> / Password: <code className="text-gray-200">x</code></div>
      </div>
      <h2 className="font-semibold">cpuminer (테스트/학습용)</h2>
      <Code>{`minerd -a sha256d -o ${url} -u ${user}.cpu1 -p x`}</Code>
      <h2 className="font-semibold">cgminer / bfgminer</h2>
      <Code>{`cgminer -o ${url} -u ${user}.rig1 -p x`}</Code>
      <h2 className="font-semibold">연결 확인</h2>
      <div className="panel p-4 text-muted">
        접속 후 1~2분 안에 <b className="text-gray-200">마이닝 풀</b> 화면의 워커 목록에 표시됩니다. 서버가 쉐어 난이도를 자동 조정(vardiff, 목표 15초/쉐어)하므로
        해시레이트 수치는 몇 분 지나야 안정됩니다. 거부된 쉐어가 많으면 네트워크 지연이나 오래된 작업(stale)을 확인하세요.
      </div>
    </div>
  );
}
