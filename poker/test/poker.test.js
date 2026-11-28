'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/poker');

const C = (s) => s.split(' ').map(P.fromStr);

// 단순 무차별 5장 판정 (검증용 레퍼런스)
function eval5(cards) {
  const ranks = cards.map(P.rankOf).sort((a, b) => b - a);
  const suits = cards.map(P.suitOf);
  const flush = suits.every((s) => s === suits[0]);
  const uniq = [...new Set(ranks)];
  let straight = 0;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straight = ranks[0];
    else if (ranks.join() === '14,5,4,3,2') straight = 5;
  }
  const cnt = {};
  for (const r of ranks) cnt[r] = (cnt[r] || 0) + 1;
  const groups = Object.entries(cnt).map(([r, n]) => [n, Number(r)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const tb = groups.map((g) => g[1]);
  let cat;
  if (straight && flush) return [8, straight];
  if (groups[0][0] === 4) cat = 7;
  else if (groups[0][0] === 3 && groups[1][0] === 2) cat = 6;
  else if (flush) return [5, ...ranks];
  else if (straight) return [4, straight];
  else if (groups[0][0] === 3) cat = 3;
  else if (groups[0][0] === 2 && groups[1][0] === 2) cat = 2;
  else if (groups[0][0] === 2) cat = 1;
  else cat = 0;
  return [cat, ...tb];
}
function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
function brute7(cards) {
  let best = null;
  for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) {
    const five = cards.filter((_, i) => i !== a && i !== b);
    const v = eval5(five);
    if (!best || cmp(v, best) > 0) best = v;
  }
  return best;
}

test('족보 이름', () => {
  assert.equal(P.evaluate(C('As Ks Qs Js Ts 2d 3c')).label, '로열 플러시');
  assert.equal(P.evaluate(C('5s 4s 3s 2s As Kd Kc')).label, '5 하이 스트레이트 플러시');
  assert.equal(P.evaluate(C('9h 9d 9s 9c 2d 3c 4h')).label, '9 포카드');
  assert.equal(P.evaluate(C('Jh Jd Js 4c 4d 3c 2h')).label, 'J·4 풀하우스');
  assert.equal(P.evaluate(C('Kh 9h 7h 4h 2h 3c 3d')).label, 'K 하이 플러시');
  assert.equal(P.evaluate(C('Ah 2d 3c 4s 5h Kd Qc')).label, '5 하이 스트레이트');
  assert.equal(P.evaluate(C('7h 7d 7s Kc 2d 3c 9h')).label, '7 트리플');
  assert.equal(P.evaluate(C('Kh Kd 8s 8c 2d 3c 9h')).label, 'K·8 투페어');
  assert.equal(P.evaluate(C('Ah Ad 8s 7c 2d 3c 9h')).label, 'A 원페어');
  assert.equal(P.evaluate(C('Ah Jd 8s 7c 2d 3c 9h')).label, 'A 하이');
  assert.equal(P.evaluate(C('Ah Kd')).label, 'A 하이');
  assert.equal(P.evaluate(C('Qh Qd')).label, 'Q 원페어');
});

test('베스트 5장 선택', () => {
  const e = P.evaluate(C('Ah Ad As Kc Kd Kh 2c'));
  assert.equal(e.cat, P.CAT.FULL_HOUSE);
  assert.equal(e.best.length, 5);
  assert.equal(e.label, 'A·K 풀하우스');
  const f = P.evaluate(C('2h 5h 9h Jh Kh Ah 3c'));
  assert.deepEqual(f.best.map(P.toStr).sort(), ['Ah', 'Kh', 'Jh', '9h', '5h'].sort());
  // 쓰리 페어: 가장 높은 투페어 + 최고 키커
  const tp = P.evaluate(C('Ah Ad Kh Kd Qh Qd 2c'));
  assert.equal(tp.label, 'A·K 투페어');
  assert.equal(P.rankOf(tp.best[4]), 12);
});

test('무작위 7장: 레퍼런스 판정기와 순위 일치', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
  const randInt = (n) => Math.floor(rnd() * n);
  for (let i = 0; i < 4000; i++) {
    const d = P.shuffle(P.newDeck(), randInt);
    const a = d.slice(0, 7), b = d.slice(7, 14);
    const ea = P.evaluate(a), eb = P.evaluate(b);
    const ra = brute7(a), rb = brute7(b);
    assert.equal(ea.cat, ra[0], `cat ${a.map(P.toStr)}`);
    assert.equal(Math.sign(ea.score - eb.score), cmp(ra, rb), `${a.map(P.toStr)} vs ${b.map(P.toStr)}`);
    // best 5장은 실제로 그 족보를 만들어야 함
    assert.equal(cmp(eval5(ea.best), ra), 0, `best ${ea.best.map(P.toStr)} of ${a.map(P.toStr)}`);
  }
});

test('승률 계산', () => {
  // AA vs KK 프리플랍 ≈ 82% : 18%
  const eq = P.equity([C('Ah Ad'), C('Kh Kd')], [], { samples: 20000 });
  assert.ok(eq[0] > 0.78 && eq[0] < 0.86, `AA eq ${eq[0]}`);
  // 리버까지 다 깔렸으면 결정적
  const fin = P.equity([C('Ah Ad'), C('Kh Kd')], C('2c 3c 7s 9d Kc'));
  assert.deepEqual(fin, [0, 1]);
  // 정확 계산(턴): 스플릿 처리
  const split = P.equity([C('2h 3d'), C('2s 3c')], C('Ah Kd Qc Js'));
  assert.ok(Math.abs(split[0] - split[1]) < 1e-9);
});
