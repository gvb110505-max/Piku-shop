-- PIKU 거래소 스키마. 금액은 모두 1e-8 단위 정수(NUMERIC(40,0)).
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,              -- 거래소 아이디 = Stratum 접속 ID
  password_hash TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  email_verify_token TEXT,
  totp_secret TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  totp_last_counter BIGINT NOT NULL DEFAULT 0,  -- TOTP 재사용(replay) 방지
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'system')),
  is_operator BOOLEAN NOT NULL DEFAULT FALSE,   -- 운영자: 자사 코인 거래 금지
  trading_banned BOOLEAN NOT NULL DEFAULT FALSE,
  kyc_status TEXT NOT NULL DEFAULT 'none' CHECK (kyc_status IN ('none', 'pending', 'approved', 'rejected')),
  kyc_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS balances (
  user_id UUID NOT NULL REFERENCES users(id),
  asset TEXT NOT NULL,
  available NUMERIC(40,0) NOT NULL DEFAULT 0,
  locked NUMERIC(40,0) NOT NULL DEFAULT 0,
  allow_negative BOOLEAN NOT NULL DEFAULT FALSE, -- 보험기금만 음수 허용 (적자 발생 시 알림)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset),
  CONSTRAINT balances_nonnegative CHECK (allow_negative OR (available >= 0 AND locked >= 0))
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  asset TEXT NOT NULL,
  delta_available NUMERIC(40,0) NOT NULL,
  delta_locked NUMERIC(40,0) NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_user_idx ON ledger_entries (user_id, created_at DESC);

-- 감사 로그: 추가만 가능 (UPDATE/DELETE 금지 트리거)
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID,
  user_id UUID,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_user_idx ON audit_logs (user_id, created_at DESC);
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_logs는 수정/삭제할 수 없습니다'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('spot', 'mining_future', 'perp')),
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pre', 'auction', 'open', 'settled')),
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  expiry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  seq BIGSERIAL UNIQUE,
  market_id TEXT NOT NULL REFERENCES markets(id),
  user_id UUID NOT NULL REFERENCES users(id),
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  type TEXT NOT NULL CHECK (type IN ('limit', 'market')),
  price NUMERIC(40,0),
  qty NUMERIC(40,0),
  quote_budget NUMERIC(40,0),
  remaining NUMERIC(40,0) NOT NULL DEFAULT 0,
  filled_qty NUMERIC(40,0) NOT NULL DEFAULT 0,
  quote_filled NUMERIC(40,0) NOT NULL DEFAULT 0,
  lock_asset TEXT,
  locked NUMERIC(40,0) NOT NULL DEFAULT 0,
  leverage INT,
  margin_mode TEXT,
  reduce_only BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK (status IN ('open', 'filled', 'canceled')),
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_open_idx ON orders (market_id, seq) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY,
  market_id TEXT NOT NULL,
  price NUMERIC(40,0) NOT NULL,
  qty NUMERIC(40,0) NOT NULL,
  taker_side TEXT NOT NULL,
  maker_order_id UUID NOT NULL,
  taker_order_id UUID NOT NULL,
  maker_user_id UUID NOT NULL,
  taker_user_id UUID NOT NULL,
  kind TEXT NOT NULL DEFAULT 'continuous', -- continuous | auction | liquidation
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trades_market_idx ON trades (market_id, created_at DESC);

CREATE TABLE IF NOT EXISTS positions (
  user_id UUID NOT NULL REFERENCES users(id),
  market_id TEXT NOT NULL,
  qty NUMERIC(40,0) NOT NULL DEFAULT 0,
  entry_price NUMERIC(40,0) NOT NULL DEFAULT 0,
  margin NUMERIC(40,0) NOT NULL DEFAULT 0,
  leverage INT NOT NULL DEFAULT 1,
  margin_mode TEXT NOT NULL DEFAULT 'isolated' CHECK (margin_mode IN ('isolated', 'cross')),
  realized_pnl NUMERIC(40,0) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, market_id)
);

CREATE TABLE IF NOT EXISTS liquidations (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  market_id TEXT NOT NULL,
  qty NUMERIC(40,0) NOT NULL,
  entry_price NUMERIC(40,0) NOT NULL,
  mark_price NUMERIC(40,0) NOT NULL,
  margin NUMERIC(40,0) NOT NULL,
  equity NUMERIC(40,0) NOT NULL,
  fee NUMERIC(40,0) NOT NULL,
  insurance_delta NUMERIC(40,0) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS funding_events (
  id BIGSERIAL PRIMARY KEY,
  market_id TEXT NOT NULL,
  rate_ppm BIGINT NOT NULL,
  mark_price NUMERIC(40,0) NOT NULL,
  perp_price NUMERIC(40,0),
  total_paid NUMERIC(40,0) NOT NULL,
  insurance_delta NUMERIC(40,0) NOT NULL,
  funding_time TIMESTAMPTZ NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS funding_payments (
  id BIGSERIAL PRIMARY KEY,
  funding_event_id BIGINT NOT NULL REFERENCES funding_events(id),
  user_id UUID NOT NULL,
  amount NUMERIC(40,0) NOT NULL, -- 양수 = 지불, 음수 = 수령
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 채굴량 선물 계약 (체결 1건 = 매수자-매도자 간 1계약, 실물 인도)
CREATE TABLE IF NOT EXISTS mf_contracts (
  id BIGSERIAL PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id),
  trade_id BIGINT,
  buyer_id UUID NOT NULL,
  seller_id UUID NOT NULL,
  qty NUMERIC(40,0) NOT NULL,
  price NUMERIC(40,0) NOT NULL,
  buyer_margin NUMERIC(40,0) NOT NULL,
  seller_margin NUMERIC(40,0) NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'delivered', 'partial', 'seller_default', 'buyer_default')),
  delivered_qty NUMERIC(40,0),
  paid NUMERIC(40,0),
  forfeited NUMERIC(40,0),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mf_contracts_open_idx ON mf_contracts (market_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS mf_contracts_seller_idx ON mf_contracts (seller_id) WHERE status = 'open';

-- 지갑
CREATE TABLE IF NOT EXISTS deposit_addresses (
  address TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deposit_addresses_user_idx ON deposit_addresses (user_id);

CREATE TABLE IF NOT EXISTS deposits (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  txid TEXT NOT NULL,
  vout INT NOT NULL,
  address TEXT NOT NULL,
  amount NUMERIC(40,0) NOT NULL,
  confirmations INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'orphaned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  credited_at TIMESTAMPTZ,
  UNIQUE (txid, vout)
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  address TEXT NOT NULL,
  amount NUMERIC(40,0) NOT NULL,
  fee NUMERIC(40,0) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'sending', 'sent', 'rejected', 'failed')),
  txid TEXT,
  reviewed_by UUID,
  review_note TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 마이닝 풀
CREATE TABLE IF NOT EXISTS pool_shares (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  worker TEXT NOT NULL,
  difficulty DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pool_shares_time_idx ON pool_shares (created_at DESC);
CREATE INDEX IF NOT EXISTS pool_shares_user_idx ON pool_shares (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pool_blocks (
  hash TEXT PRIMARY KEY,
  height INT NOT NULL,
  reward NUMERIC(40,0) NOT NULL,
  fee NUMERIC(40,0) NOT NULL,
  finder_id UUID,
  finder_worker TEXT,
  network_difficulty DOUBLE PRECISION,
  confirmations INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'immature' CHECK (status IN ('immature', 'confirmed', 'orphaned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pool_credits (
  block_hash TEXT NOT NULL REFERENCES pool_blocks(hash),
  user_id UUID NOT NULL,
  amount NUMERIC(40,0) NOT NULL,
  status TEXT NOT NULL DEFAULT 'immature' CHECK (status IN ('immature', 'confirmed', 'orphaned')),
  PRIMARY KEY (block_hash, user_id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
