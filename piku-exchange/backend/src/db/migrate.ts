/** 스키마 생성 + 기본 설정/시스템 계정/마켓 생성 (여러 번 실행해도 안전). */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET, config, MARKET, SYSTEM_USERS } from '../config.js';
import { DEFAULT_SETTINGS } from '../lib/settings.js';
import { createPool } from './pool.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function migrate(pool = createPool()): Promise<void> {
  // dist/에서 실행되어도 src/db/schema.sql을 찾는다
  const candidates = [join(here, 'schema.sql'), join(here, '../../src/db/schema.sql')];
  const sql = candidates.map((p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } }).find(Boolean);
  if (!sql) throw new Error('schema.sql을 찾을 수 없습니다');
  await pool.query(sql);

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, JSON.stringify(value)]);
  }
  const systemUsers: [string, string][] = [[SYSTEM_USERS.INSURANCE, 'system_insurance'], [SYSTEM_USERS.POOL_FEE, 'system_pool_fee']];
  for (const [id, name] of systemUsers) {
    await pool.query(
      `INSERT INTO users (id, email, username, password_hash, role, email_verified, trading_banned)
       VALUES ($1, $2, $3, '!', 'system', true, false) ON CONFLICT (id) DO NOTHING`,
      [id, `${name}@system.local`, name],
    );
  }
  await pool.query(
    `INSERT INTO balances (user_id, asset, allow_negative) VALUES ($1, $2, true)
     ON CONFLICT (user_id, asset) DO UPDATE SET allow_negative = true`,
    [SYSTEM_USERS.INSURANCE, ASSET.QUOTE],
  );
  await pool.query(
    `INSERT INTO markets (id, kind, base, quote, status) VALUES ($1, 'spot', $3, $4, 'pre'), ($2, 'perp', $3, $4, 'pre')
     ON CONFLICT (id) DO NOTHING`,
    [MARKET.SPOT, MARKET.PERP, ASSET.COIN, ASSET.QUOTE],
  );
  console.log(`[migrate] 완료 (${config.coin.name}, ${config.realMoney ? '실자금' : '테스트'} 모드)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pool = createPool();
  migrate(pool).then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
