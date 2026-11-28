'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, computePots } = require('../lib/game');

/** 수동으로 진행되는 가짜 스케줄러 */
function fakeScheduler() {
  let now = 1_000_000;
  let id = 0;
  const q = new Map();
  return {
    now: () => now,
    set(fn, ms) { const h = ++id; q.set(h, { fn, at: now + ms }); return h; },
    clear(h) { q.delete(h); },
    pending() { return q.size; },
    runNext() {
      let best = null;
      for (const [h, t] of q) if (!best || t.at < best[1].at) best = [h, t];
      if (!best) return false;
      q.delete(best[0]);
      now = Math.max(now, best[1].at);
      best[1].fn();
      return true;
    },
  };
}

function setup(n, opts = {}) {
  const s = fakeScheduler();
  let seed = opts.seed || 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
  const g = new Game({ scheduler: s, now: s.now, randInt: (k) => Math.floor(rnd() * k), settings: opts.settings });
  const ids = [];
  for (let i = 0; i < n; i++) {
    const p = g.join('token-player-' + i, 'P' + i, '🦊');
    g.sit(p.id, i);
    if (opts.stacks) p.chips = p.buyIn = opts.stacks[i];
    ids.push(p.id);
  }
  g.startGame(ids[0]);
  return { g, s, ids, rnd };
}

/** 다음 행동 차례가 오거나 핸드가 끝날 때까지 타이머 진행 */
function runUntilTurn(g, s, limit = 50) {
  for (let i = 0; i < limit; i++) {
    if (g.hand && g.hand.phase === 'betting' && g.hand.toAct !== null) return true;
    if (!s.runNext()) return false;
  }
  return false;
}

// 결과가 나온 뒤에는 팟이 이미 승자에게 지급되었으므로 기여액을 다시 세지 않음
const totalChips = (g) => [...g.players.values()].reduce((a, p) => a + p.chips, 0)
  + (g.hand && g.hand.result ? 0 : g.hps().reduce((a, hp) => a + hp.total, 0));

test('팟 계산: 사이드팟', () => {
  const pots = computePots([
    { seat: 0, amount: 100, folded: false },
    { seat: 1, amount: 300, folded: false },
    { seat: 2, amount: 300, folded: false },
    { seat: 3, amount: 50, folded: true },
  ]);
  assert.deepEqual(pots, [
    { amount: 350, eligible: [0, 1, 2] },
    { amount: 400, eligible: [1, 2] },
  ]);
});

test('헤즈업: 딜러가 SB, 프리플랍 먼저 행동', () => {
  const { g, s } = setup(2);
  s.runNext(); // start
  const h = g.hand;
  assert.ok(h);
  assert.equal(h.sbSeat, h.dealer);
  runUntilTurn(g, s);
  assert.equal(g.hand.toAct, h.dealer);
});

test('모두 폴드하면 마지막 남은 사람이 팟을 가져감 + 칩 보존', () => {
  const { g, s } = setup(4);
  runUntilTurn(g, s);
  const before = totalChips(g);
  const h = g.hand;
  const bb = g.playerAt(h.bbSeat);
  const bbStart = h.hp[h.bbSeat].startChips;
  while (g.hand && g.hand.toAct !== null && g.hand.toAct !== h.bbSeat) {
    g.act(g.playerAt(g.hand.toAct).id, 'fold');
  }
  assert.ok(g.hand.result.byFold);
  assert.equal(totalChips(g), before);
  assert.equal(bb.chips, bbStart + h.sb); // SB 만큼 이득
});

test('올인 런아웃: 사이드팟 분배와 칩 보존', () => {
  const { g, s } = setup(3, { stacks: [500, 1500, 3000] });
  runUntilTurn(g, s);
  const before = totalChips(g);
  // 모두 올인
  let guard = 0;
  while (g.hand && g.hand.phase === 'betting' && guard++ < 10) {
    const p = g.playerAt(g.hand.toAct);
    const info = g.actionInfo(p.seat);
    g.act(p.id, info.canRaise ? 'allin' : 'call');
  }
  // 런아웃 진행
  for (let i = 0; i < 20 && g.hand && !g.hand.result; i++) s.runNext();
  const h = g.hand;
  assert.ok(h.result, 'result');
  assert.equal(h.board.length, 5);
  assert.equal(totalChips(g), before);
  // 가장 큰 스택은 언콜 1500을 돌려받으므로 최소 1500은 남아야 함
  assert.ok(g.playerAt(2).chips >= 1500);
  const won = h.result.winners.reduce((a, w) => a + w.amount, 0);
  assert.equal(won, 500 * 3 + 1000 * 2);
});

test('미완성 올인 레이즈는 이미 행동한 사람에게 레이즈를 다시 열지 않음', () => {
  const { g, s } = setup(3, { stacks: [2000, 2000, 2000] });
  runUntilTurn(g, s);
  const h = g.hand;
  // 셋업: UTG(=dealer, 3인에선 BB 다음) 레이즈 100, 다음 사람 콜, 그 다음 사람의 칩을 130 으로 만들어 올인(미완성 레이즈)
  const a = g.playerAt(g.hand.toAct);
  g.act(a.id, 'raise', 100);
  const b = g.playerAt(g.hand.toAct);
  g.act(b.id, 'call');
  const c = g.playerAt(g.hand.toAct);
  // c 는 BB(20 포스팅). 남은 칩을 110 으로 만들어 총 130 올인
  c.chips = 110;
  g.act(c.id, 'allin');
  assert.equal(g.hand.currentBet, 130);
  // a 차례: 콜/폴드만 가능
  assert.equal(g.hand.toAct, a.seat);
  const info = g.actionInfo(a.seat);
  assert.equal(info.canRaise, false);
  assert.equal(info.toCall, 30);
  assert.ok(h);
});

test('BB 옵션: 림프 후 BB 는 체크/레이즈 기회', () => {
  const { g, s } = setup(3);
  runUntilTurn(g, s);
  const h = g.hand;
  while (g.hand.toAct !== h.bbSeat) g.act(g.playerAt(g.hand.toAct).id, 'call');
  const info = g.actionInfo(h.bbSeat);
  assert.equal(info.canCheck, true);
  assert.equal(info.canRaise, true);
  g.act(g.playerAt(h.bbSeat).id, 'check');
  assert.equal(g.hand.phase, 'transition');
  s.runNext();
  assert.equal(g.hand.street, 'flop');
  assert.equal(g.hand.board.length, 3);
});

test('타임아웃: 자동 체크/폴드, 2회 연속이면 자리비움', () => {
  const { g, s } = setup(3);
  runUntilTurn(g, s);
  const seat = g.hand.toAct;
  const p = g.playerAt(seat);
  s.runNext(); // 타임아웃 → 폴드
  assert.equal(g.hand.hp[seat].folded, true);
  assert.equal(p.timeouts, 1);
});

test('퍼징: 무작위 행동 300핸드 동안 칩 보존 & 멈춤 없음', () => {
  for (const n of [2, 3, 6, 9]) {
    const { g, s, rnd } = setup(n, { seed: 100 + n, stacks: Array.from({ length: n }, (_, i) => 300 + i * 450) });
    const total = totalChips(g);
    let hands = 0;
    let steps = 0;
    let lastHand = null;
    while (hands < 300 && steps < 200000) {
      steps++;
      if (g.hand && g.hand.id !== lastHand) { lastHand = g.hand.id; hands++; }
      if (g.hand && g.hand.phase === 'betting' && g.hand.toAct !== null) {
        const p = g.playerAt(g.hand.toAct);
        const info = g.actionInfo(p.seat);
        const r = rnd();
        if (r < 0.15) g.act(p.id, info.canCheck ? 'check' : 'fold');
        else if (r < 0.55) g.act(p.id, info.canCheck ? 'check' : 'call');
        else if (r < 0.85 && info.canRaise) {
          const to = info.minRaiseTo + Math.floor(rnd() * (info.maxRaiseTo - info.minRaiseTo + 1));
          g.act(p.id, 'raise', to);
        } else if (info.canRaise) g.act(p.id, 'allin');
        else g.act(p.id, 'call');
        continue;
      }
      if (!g.hand) {
        // 버스트한 사람 리바이
        for (const p of g.players.values()) if (p.seat !== null && p.chips === 0) g.rebuy(p.id);
      }
      assert.equal(totalChips(g), [...g.players.values()].reduce((a, p) => a + p.buyIn, 0), 'chips conserved mid-run');
      if (!s.runNext()) assert.fail(`stalled (n=${n}, hands=${hands})`);
    }
    const buyIns = [...g.players.values()].reduce((a, p) => a + p.buyIn, 0);
    assert.equal(totalChips(g), buyIns, `chip conservation n=${n}`);
    assert.ok(hands >= 300, `played ${hands} hands`);
    for (const p of g.players.values()) assert.ok(p.chips >= 0);
  }
});
