/** 환경변수 설정. 기본값은 모두 '테스트 모드'(가상 KRW)로 안전하게 동작하도록 잡혀 있다. */
const env = process.env;

const num = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  coin: {
    name: env.COIN_NAME ?? 'PIKU',
    ticker: env.COIN_TICKER ?? 'PIKU',
    algorithm: env.COIN_ALGORITHM ?? 'sha256d',
    blockTimeSec: num(env.BLOCK_TIME_SEC, 600),
  },
  quote: 'KRW',
  /** 실자금 모드: 환경변수로만 켤 수 있다. 켜면 아래 assertModeSafety()의 요구사항을 모두 충족해야 기동된다. */
  realMoney: env.REAL_MONEY_MODE === 'true',
  testModeInitialKrw: env.TEST_MODE_INITIAL_KRW ?? '100000000',
  databaseUrl: env.DATABASE_URL ?? 'postgres://piku:piku@localhost:5432/piku',
  redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: env.JWT_SECRET ?? 'dev-only-insecure-secret-change-me',
  apiPort: num(env.API_PORT, 8080),
  appUrl: env.APP_URL ?? 'http://localhost:5173',
  adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  rpc: {
    host: env.RPC_HOST ?? '127.0.0.1',
    port: num(env.RPC_PORT, 8332),
    user: env.RPC_USER ?? '',
    pass: env.RPC_PASSWORD ?? '',
    wallet: env.RPC_WALLET ?? '',
  },
  stratum: {
    port: num(env.STRATUM_PORT, 3333),
    host: env.STRATUM_PUBLIC_HOST ?? 'localhost',
    initialDifficulty: num(env.STRATUM_INITIAL_DIFF, 16),
    minDifficulty: num(env.STRATUM_MIN_DIFF, 0.001),
    targetShareSec: num(env.STRATUM_TARGET_SHARE_SEC, 15),
    poolAddress: env.POOL_ADDRESS ?? '',
    tag: env.POOL_TAG ?? '/PIKU-pool/',
  },
  smtp: {
    host: env.SMTP_HOST ?? '',
    port: num(env.SMTP_PORT, 587),
    user: env.SMTP_USER ?? '',
    pass: env.SMTP_PASSWORD ?? '',
    from: env.SMTP_FROM ?? 'PIKU Exchange <no-reply@localhost>',
  },
  compliance: {
    vaspRegistrationNo: env.VASP_REGISTRATION_NO ?? '',
    legalReviewAck: env.LEGAL_REVIEW_ACK ?? '',
  },
};

/**
 * 실자금 모드 안전장치. 다음을 모두 만족하지 않으면 프로세스를 띄우지 않는다.
 *  - 기본 JWT 비밀키를 바꿨을 것
 *  - 가상자산사업자(VASP) 신고 번호가 설정됐을 것
 *  - 법률 검토 확인 플래그가 설정됐을 것 (README의 '실자금 모드 전 확인사항' 참고)
 *  - SMTP가 설정돼 실제 이메일 인증이 가능할 것
 */
export function assertModeSafety(): void {
  if (!config.realMoney) return;
  const problems: string[] = [];
  if (config.jwtSecret.startsWith('dev-only') || config.jwtSecret.length < 32) problems.push('JWT_SECRET(32자 이상)');
  if (!config.compliance.vaspRegistrationNo) problems.push('VASP_REGISTRATION_NO');
  if (config.compliance.legalReviewAck !== 'I_HAVE_LEGAL_APPROVAL') problems.push('LEGAL_REVIEW_ACK=I_HAVE_LEGAL_APPROVAL');
  if (!config.smtp.host) problems.push('SMTP_HOST');
  if (problems.length) {
    throw new Error(`REAL_MONEY_MODE=true 이지만 필수 설정이 없습니다: ${problems.join(', ')}`);
  }
}

export const ASSET = { COIN: config.coin.ticker, QUOTE: config.quote } as const;
export const MARKET = {
  SPOT: `${config.coin.ticker}-${config.quote}`,
  PERP: `${config.coin.ticker}-PERP`,
} as const;

/** 시스템 계정 (보험기금, 풀 수수료 수취). */
export const SYSTEM_USERS = {
  INSURANCE: '00000000-0000-0000-0000-000000000001',
  POOL_FEE: '00000000-0000-0000-0000-000000000002',
} as const;
