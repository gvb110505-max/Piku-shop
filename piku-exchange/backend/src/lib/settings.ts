/** 운영 파라미터 (관리자 페이지에서 수정, DB settings 테이블에 저장). */
import type pg from 'pg';

export const DEFAULT_SETTINGS = {
  coin_status: 'PRE_LISTING' as 'PRE_LISTING' | 'CALL_AUCTION' | 'LISTED',
  auction_end_at: null as string | null,
  auction_minutes: 10,
  pool_fee_bps: 100,               // 풀 수수료 1%
  pool_maturity_confirmations: 100, // 블록 100컨펌 후 확정
  pplns_window_factor: 2,          // N = 네트워크 난이도 × 2
  deposit_confirmations: 6,
  withdraw_fee: '0.001',           // 코인 출금 수수료 (코인 단위)
  withdraw_min: '0.01',
  mf_buyer_margin_bps: 2000,       // 채굴량 선물 매수 증거금 20%
  mf_seller_margin_bps: 1000,      // 매도 증거금 10%
  mf_sell_limit_factor_bps: 7000,  // 예상 채굴량 반영 비율 70%
  mf_expiry_hour_utc: 6,           // 만기 시각 (UTC 06시 = KST 15시)
  mf_listed_months: 3,             // 동시에 열어 둘 월물 수
  perp_max_leverage: 10,
  perp_mmr_bps: 50,                // 유지증거금률 0.5%
  perp_liq_fee_bps: 50,            // 청산 수수료 0.5% (보험기금 적립)
  perp_funding_cap_ppm: 7500,      // 펀딩비 상한 0.75%
  perp_funding_interval_hours: 8,
  perp_protect_bps: 1000,          // 시장가 보호 범위 ±10%
  hotwallet_tolerance: '0.0001',
};

export type Settings = typeof DEFAULT_SETTINGS;
export type SettingKey = keyof Settings;

export async function loadSettings(db: pg.Pool | pg.PoolClient): Promise<Settings> {
  const { rows } = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM settings');
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s as Settings;
}

export async function saveSetting(db: pg.Pool | pg.PoolClient, key: SettingKey, value: unknown): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

/** 관리자가 수정 가능한 키와 허용 범위. */
export const EDITABLE_SETTINGS: Partial<Record<SettingKey, { min?: number; max?: number; kind: 'int' | 'decimal' }>> = {
  pool_fee_bps: { kind: 'int', min: 0, max: 1000 },
  pool_maturity_confirmations: { kind: 'int', min: 1, max: 1000 },
  pplns_window_factor: { kind: 'decimal', min: 0.1, max: 10 },
  deposit_confirmations: { kind: 'int', min: 1, max: 1000 },
  withdraw_fee: { kind: 'decimal', min: 0 },
  withdraw_min: { kind: 'decimal', min: 0 },
  mf_buyer_margin_bps: { kind: 'int', min: 100, max: 10000 },
  mf_seller_margin_bps: { kind: 'int', min: 100, max: 10000 },
  mf_sell_limit_factor_bps: { kind: 'int', min: 0, max: 10000 },
  perp_max_leverage: { kind: 'int', min: 1, max: 100 },
  perp_mmr_bps: { kind: 'int', min: 1, max: 5000 },
  perp_liq_fee_bps: { kind: 'int', min: 0, max: 1000 },
  perp_funding_cap_ppm: { kind: 'int', min: 0, max: 100000 },
  auction_minutes: { kind: 'int', min: 1, max: 1440 },
};
