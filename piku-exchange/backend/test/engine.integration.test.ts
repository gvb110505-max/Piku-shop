/**
 * 엔진 통합 테스트: 실제 PostgreSQL 위에서 엔진 명령을 실행해
 * 콜옥션 상장, 현물 체결, 채굴량 선물 만기 정산, 무기한 선물 청산/펀딩을 검증한다.
 * TEST_DATABASE_URL이 없으면 건너뛴다 (예: postgres://piku:piku@localhost:5432/piku_test).
 * Redis는 엔진이 쓰는 메서드만 흉내 낸 스텁으로 대체한다.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;

class RedisStub {
  kv = new Map<string, string>();
  async get(k: string) { return this.kv.get(k) ?? null; }
  async set(k: string, v: string) { this.kv.set(k, v); return 'OK'; }
  async publish() { return 0; }
  pipeline() { return { publish: () => undefined, exec: async () => [] }; }
}

describe.skipIf(!TEST_DB)('엔진 통합 (PostgreSQL)', () => {
  let pool: pg.Pool;
  let engine: import('../src/engine/engine.js').Engine;
  let redis: RedisStub;
  let mod: {
    u: typeof import('../src/core/units.js').toUnits;
    MARKET: typeof import('../src/config.js').MARKET;
    SYSTEM_USERS: typeof import('../src/config.js').SYSTEM_USERS;
  };
  const ids: Record<string, string> = {};

  const exec = async (type: string, payload: Record<string, unknown> = {}) => {
    const r = await engine.execute({ cmdId: randomUUID(), type, payload, actorId: ids.admin });
    if (!r.ok) throw new Error(r.error);
    return r.result as Record<string, unknown>;
  };
  const order = (user: string, marketId: string, side: 'buy' | 'sell', price: string | null, qty: string, extra: Record<string, unknown> = {}) =>
    exec('place_order', { orderId: randomUUID(), userId: ids[user], marketId, side, type: price ? 'limit' : 'market', price: price ?? undefined, qty, ...extra });
  const bal = async (user: string, asset: string) => {
    const { rows } = await pool.query('SELECT available, locked FROM balances WHERE user_id = $1 AND asset = $2', [ids[user], asset]);
    return { available: BigInt(rows[0]?.available ?? 0), locked: BigInt(rows[0]?.locked ?? 0) };
  };
  /** 시스템 전체 KRW = 잔고 + 포지션 증거금 + 선물 계약 에스크로 + 미실현손익 (마크가 기준) */
  const totalKrw = async (mark: bigint) => {
    const b = await pool.query(`SELECT COALESCE(SUM(available + locked), 0) AS s FROM balances WHERE asset = 'KRW'`);
    const p = await pool.query(`SELECT qty, entry_price, margin FROM positions`);
    const e = await pool.query(`SELECT COALESCE(SUM(buyer_margin + seller_margin), 0) AS s FROM mf_contracts WHERE status = 'open'`);
    const upnl = p.rows.reduce((s, r) => s + (BigInt(r.qty) * (mark - BigInt(r.entry_price))) / 100_000_000n, 0n);
    return BigInt(b.rows[0].s) + p.rows.reduce((s, r) => s + BigInt(r.margin), 0n) + BigInt(e.rows[0].s) + upnl;
  };
  const totalCoin = async () => BigInt((await pool.query(`SELECT COALESCE(SUM(available + locked), 0) AS s FROM balances WHERE asset = 'PIKU'`)).rows[0].s);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    pool = new pg.Pool({ connectionString: TEST_DB });
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const { migrate } = await import('../src/db/migrate.js');
    await migrate(pool);
    const cfg = await import('../src/config.js');
    const units = await import('../src/core/units.js');
    mod = { u: units.toUnits, MARKET: cfg.MARKET, SYSTEM_USERS: cfg.SYSTEM_USERS };
    for (const name of ['admin', 'alice', 'bob', 'carol', 'dave']) {
      const { rows } = await pool.query(
        `INSERT INTO users (email, username, password_hash, email_verified, role, is_operator) VALUES ($1, $2, '!', true, $3, $4) RETURNING id`,
        [`${name}@t.test`, name, name === 'admin' ? 'admin' : 'user', name === 'admin']);
      ids[name] = rows[0].id;
      await pool.query(`INSERT INTO balances (user_id, asset, available) VALUES ($1, 'KRW', $2)`, [ids[name], units.toUnits('1000000').toString()]);
    }
    for (const name of ['bob', 'carol']) {
      await pool.query(`INSERT INTO balances (user_id, asset, available) VALUES ($1, 'PIKU', $2)`, [ids[name], units.toUnits('100').toString()]);
    }
    const { Engine } = await import('../src/engine/engine.js');
    redis = new RedisStub();
    engine = new Engine(pool, redis as never);
    await engine.init();
  });

  afterAll(async () => { await pool?.end(); });

  it('상장 전에는 현물 거래 불가, 운영자는 PIKU 거래 불가', async () => {
    await expect(order('bob', mod.MARKET.SPOT, 'sell', '1000', '1')).rejects.toThrow(/상장 전/);
    await expect(order('admin', mod.MARKET.SPOT, 'buy', '1000', '1')).rejects.toThrow(/운영자/);
  });

  it('콜옥션: 모은 주문을 단일가로 체결하고 연속매매로 전환, 자산 총량 보존', async () => {
    const coinBefore = await totalCoin();
    const krwBefore = await totalKrw(0n);
    await exec('start_listing');
    await order('alice', mod.MARKET.SPOT, 'buy', '1000', '10');
    await order('dave', mod.MARKET.SPOT, 'buy', '950', '5');
    await order('bob', mod.MARKET.SPOT, 'sell', '900', '8');
    await order('carol', mod.MARKET.SPOT, 'sell', '960', '4');
    expect((await pool.query('SELECT COUNT(*) AS n FROM trades')).rows[0].n).toBe('0');
    const r = await exec('end_auction', { force: true });
    expect(r).toMatchObject({ coinStatus: 'LISTED', openingPrice: '960', volume: '10' });
    const trades = await pool.query(`SELECT price, kind FROM trades`);
    expect(trades.rows.every((t) => t.price === mod.u('960').toString() && t.kind === 'auction')).toBe(true);
    expect((await bal('alice', 'PIKU')).available).toBe(mod.u('10'));
    // alice는 1000에 주문했지만 960에 체결 → 초과 대금은 풀림
    expect((await bal('alice', 'KRW')).locked).toBe(0n);
    expect((await bal('alice', 'KRW')).available).toBe(mod.u('1000000') - mod.u('9600'));
    expect(await totalCoin()).toBe(coinBefore);
    expect(await totalKrw(0n)).toBe(krwBefore);
  });

  it('현물 연속매매: 시장가 매수는 대금 한도 안에서 체결', async () => {
    // 남은 호가: dave 매수 5@950, carol 매도 2@960
    await order('alice', mod.MARKET.SPOT, 'buy', null, '0', { quoteAmount: '5000', qty: undefined });
    expect((await bal('alice', 'PIKU')).available).toBe(mod.u('12'));
  });

  it('채굴량 선물: 체결 시 계약 생성, 만기 정산으로 인도/부족분 보상', async () => {
    const mf = [...engine.markets.values()].find((m) => m.kind === 'mining_future')!;
    // carol은 PIKU 100 - 2(현물 매도) = 98 보유. 120개는 한도 초과
    await expect(order('carol', mf.id, 'sell', '800', '120')).rejects.toThrow(/한도 초과/);
    await order('carol', mf.id, 'sell', '800', '50');
    await order('alice', mf.id, 'buy', '850', '30');
    await order('dave', mf.id, 'buy', '800', '20');
    const contracts = await pool.query(`SELECT * FROM mf_contracts WHERE market_id = $1 ORDER BY id`, [mf.id]);
    expect(contracts.rows.map((c) => [c.qty, c.buyer_margin, c.seller_margin])).toEqual([
      [mod.u('30').toString(), mod.u('4800').toString(), mod.u('2400').toString()],
      [mod.u('20').toString(), mod.u('3200').toString(), mod.u('1600').toString()],
    ]);
    // 인도 의무 때문에 현물로 다 팔 수 없다
    await expect(order('carol', mod.MARKET.SPOT, 'sell', '2000', '60')).rejects.toThrow(/인도 예정/);

    // carol이 인도 전에 코인을 줄였다고 가정 (예: 출금) → 40개만 남김
    await pool.query(`UPDATE balances SET available = $2 WHERE user_id = $1 AND asset = 'PIKU'`, [ids.carol, mod.u('40').toString()]);
    const coinBefore = await totalCoin();
    const krwBefore = await totalKrw(0n);
    const aliceKrw = (await bal('alice', 'KRW')).available;

    engine.now = () => new Date(mf.expiryAt!.getTime() + 1000); // 만기 이후로 시간 이동
    const s = await exec('settle_mf', { marketId: mf.id });
    engine.now = () => new Date();
    expect(s).toMatchObject({ contracts: 2, delivered: 1, partial: 1 });

    const rows = (await pool.query(`SELECT status, delivered_qty, forfeited FROM mf_contracts WHERE market_id = $1 ORDER BY id`, [mf.id])).rows;
    expect(rows[0]).toMatchObject({ status: 'delivered', delivered_qty: mod.u('30').toString() });
    expect(rows[1]).toMatchObject({ status: 'partial', delivered_qty: mod.u('10').toString(), forfeited: mod.u('800').toString() });
    // alice: 30개 수령, 대금 24000 지불(증거금 4800 반환 후 차감)
    expect((await bal('alice', 'PIKU')).available).toBe(mod.u('42'));
    expect((await bal('alice', 'KRW')).available).toBe(aliceKrw + mod.u('4800') - mod.u('24000'));
    expect(await totalCoin()).toBe(coinBefore);
    expect(await totalKrw(0n)).toBe(krwBefore);
    expect(engine.markets.get(mf.id)!.status).toBe('settled');
  });

  it('무기한 선물: 마크가가 청산가 아래로 가면 강제청산, 보험기금이 인수', async () => {
    const P = mod.MARKET.PERP;
    await order('bob', P, 'sell', '960', '10', { leverage: 1 });
    await order('alice', P, 'buy', '960', '10', { leverage: 10 });
    const pos = (await pool.query(`SELECT qty, margin FROM positions WHERE user_id = $1`, [ids.alice])).rows[0];
    expect(pos).toMatchObject({ qty: mod.u('10').toString(), margin: mod.u('960').toString() });

    // 현물 가격을 860까지 끌어내린다 → 마크가 860 (청산가 868.34 아래)
    await exec('cancel_all', { userId: ids.dave });
    await order('bob', mod.MARKET.SPOT, 'sell', '860', '3');
    await order('dave', mod.MARKET.SPOT, 'buy', '860', '3');
    expect(engine.currentMark()).toBe(mod.u('860'));
    const mark = engine.currentMark()!;
    const before = await totalKrw(mark);

    const r = await exec('liquidation_check');
    expect(r).toEqual({ liquidated: 1 });
    const liq = (await pool.query(`SELECT equity, fee, insurance_delta FROM liquidations`)).rows[0];
    // 증거금 960 + 손익 -1000 = -40 → 파산, 보험기금이 40 보전
    expect(liq).toMatchObject({ equity: (-mod.u('40')).toString(), fee: '0', insurance_delta: (-mod.u('40')).toString() });
    const ins = (await pool.query(`SELECT qty, entry_price FROM positions WHERE user_id = $1`, [mod.SYSTEM_USERS.INSURANCE])).rows[0];
    expect(ins).toMatchObject({ qty: mod.u('10').toString(), entry_price: mark.toString() });
    expect(await totalKrw(mark)).toBe(before);
  });

  it('보험기금 포지션은 호가가 생기면 정리된다', async () => {
    await order('dave', mod.MARKET.PERP, 'buy', '855', '10', { leverage: 2 });
    await exec('liquidation_check');
    const ins = (await pool.query(`SELECT qty FROM positions WHERE user_id = $1`, [mod.SYSTEM_USERS.INSURANCE])).rows[0];
    expect(ins.qty).toBe('0');
  });

  it('펀딩: 선물가가 현물보다 높으면 롱이 숏에게 지불, 총량 보존', async () => {
    // 현재 포지션: bob 숏 10 (1배), dave 롱 10 (2배). 선물 호가를 마크보다 높게
    await order('carol', mod.MARKET.PERP, 'sell', '900', '1', { leverage: 1 });
    await order('alice', mod.MARKET.PERP, 'buy', '880', '1', { leverage: 1 }); // 선물 중간가 890 > 마크 860
    const mark = engine.currentMark()!;
    const before = await totalKrw(mark);
    const daveMargin = BigInt((await pool.query(`SELECT margin FROM positions WHERE user_id = $1`, [ids.dave])).rows[0].margin);
    const bobMargin = BigInt((await pool.query(`SELECT margin FROM positions WHERE user_id = $1`, [ids.bob])).rows[0].margin);
    const r = await exec('funding', { fundingTime: new Date('2030-01-01T00:00:00Z').toISOString() });
    expect(r.ratePpm).toBe(7500); // 상한
    const daveAfter = BigInt((await pool.query(`SELECT margin FROM positions WHERE user_id = $1`, [ids.dave])).rows[0].margin);
    const bobAfter = BigInt((await pool.query(`SELECT margin FROM positions WHERE user_id = $1`, [ids.bob])).rows[0].margin);
    const payment = (mod.u('10') * mark / 100_000_000n) * 7500n / 1_000_000n;
    expect(daveMargin - daveAfter).toBe(payment);
    expect(bobAfter - bobMargin).toBe(payment);
    expect(await totalKrw(mark)).toBe(before);
    // 같은 시각 펀딩은 한 번만
    expect(await exec('funding', { fundingTime: new Date('2030-01-01T00:00:00Z').toISOString() })).toEqual({ skipped: true });
  });

  it('주문 실패 시 DB와 호가창이 모두 원상태로 돌아간다', async () => {
    const depth = JSON.stringify(engine.books.get(mod.MARKET.SPOT)!.depth());
    await expect(order('alice', mod.MARKET.SPOT, 'buy', '1000', '99999999')).rejects.toThrow(/잔고가 부족/);
    expect(JSON.stringify(engine.books.get(mod.MARKET.SPOT)!.depth())).toBe(depth);
  });

  it('일시정지된 마켓은 주문을 받지 않는다', async () => {
    await exec('set_market_paused', { marketId: mod.MARKET.SPOT, paused: true });
    await expect(order('alice', mod.MARKET.SPOT, 'buy', '900', '1')).rejects.toThrow(/일시정지/);
    await exec('set_market_paused', { marketId: mod.MARKET.SPOT, paused: false });
  });
});
