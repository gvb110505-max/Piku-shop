'use strict';
/**
 * 카드 표현, 셔플, 7장 족보 판정, 승률(에퀴티) 계산.
 * 카드는 0..51 정수: id = (rank-2)*4 + suit  (rank 2..14, suit 0..3 = s h d c)
 */
const crypto = require('crypto');

const RANK_CH = '23456789TJQKA';
const SUIT_CH = 'shdc';

const rankOf = (c) => (c >> 2) + 2;
const suitOf = (c) => c & 3;
const toStr = (c) => RANK_CH[c >> 2] + SUIT_CH[c & 3];
const fromStr = (s) => (RANK_CH.indexOf(s[0]) << 2) | SUIT_CH.indexOf(s[1]);

function newDeck() {
  return Array.from({ length: 52 }, (_, i) => i);
}

function shuffle(deck, randInt = crypto.randomInt) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    const t = deck[i];
    deck[i] = deck[j];
    deck[j] = t;
  }
  return deck;
}

const CAT = {
  HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4,
  FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8,
};
const CAT_NAMES = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];
const RN = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10', 9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2' };

function straightTop(mask) {
  let m = mask;
  if (m & (1 << 14)) m |= 1 << 1; // A 를 1로도 사용 (휠)
  for (let top = 14; top >= 5; top--) {
    const need = 0b11111 << (top - 4);
    if ((m & need) === need) return top;
  }
  return 0;
}

function straightRanks(top) {
  return top === 5 ? [5, 4, 3, 2, 14] : [top, top - 1, top - 2, top - 3, top - 4];
}

function makeScore(cat, tb) {
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 16 + (tb[i] || 0);
  return s;
}

function labelFor(cat, tb) {
  switch (cat) {
    case CAT.HIGH: return `${RN[tb[0]] || ''} 하이`;
    case CAT.PAIR: return `${RN[tb[0]]} 원페어`;
    case CAT.TWO_PAIR: return `${RN[tb[0]]}·${RN[tb[1]]} 투페어`;
    case CAT.TRIPS: return `${RN[tb[0]]} 트리플`;
    case CAT.STRAIGHT: return `${RN[tb[0]]} 하이 스트레이트`;
    case CAT.FLUSH: return `${RN[tb[0]]} 하이 플러시`;
    case CAT.FULL_HOUSE: return `${RN[tb[0]]}·${RN[tb[1]]} 풀하우스`;
    case CAT.QUADS: return `${RN[tb[0]]} 포카드`;
    case CAT.STRAIGHT_FLUSH: return tb[0] === 14 ? '로열 플러시' : `${RN[tb[0]]} 하이 스트레이트 플러시`;
    default: return '';
  }
}

/**
 * 2~7장의 카드에서 최고의 5장 족보를 판정.
 * @returns {{cat:number, score:number, name:string, label:string, best:number[]}}
 */
function evaluate(cards) {
  const byRank = [];
  for (let r = 0; r <= 14; r++) byRank.push([]);
  const bySuit = [[], [], [], []];
  const suitMask = [0, 0, 0, 0];
  let rankMask = 0;
  for (const c of cards) {
    const r = rankOf(c), s = suitOf(c);
    byRank[r].push(c);
    bySuit[s].push(c);
    rankMask |= 1 << r;
    suitMask[s] |= 1 << r;
  }
  const sorted = cards.slice().sort((a, b) => b - a); // 랭크 내림차순
  const kick = (excl, n) => {
    const out = [];
    for (const c of sorted) {
      if (out.length >= n) break;
      if (!excl.includes(rankOf(c))) out.push(c);
    }
    return out;
  };
  const done = (cat, tb, best) => ({
    cat, score: makeScore(cat, tb), name: CAT_NAMES[cat], label: labelFor(cat, tb), best,
  });

  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (bySuit[s].length >= 5) flushSuit = s;

  if (flushSuit >= 0) {
    const top = straightTop(suitMask[flushSuit]);
    if (top) {
      const best = straightRanks(top).map((r) => bySuit[flushSuit].find((c) => rankOf(c) === r));
      return done(CAT.STRAIGHT_FLUSH, [top], best);
    }
  }

  const g4 = [], g3 = [], g2 = [];
  for (let r = 14; r >= 2; r--) {
    const n = byRank[r].length;
    if (n === 4) g4.push(r);
    else if (n === 3) g3.push(r);
    else if (n === 2) g2.push(r);
  }

  if (g4.length) {
    const q = g4[0];
    const k = kick([q], 1);
    return done(CAT.QUADS, [q, ...k.map(rankOf)], [...byRank[q], ...k]);
  }
  if (g3.length && (g3.length >= 2 || g2.length)) {
    const t = g3[0];
    const p = Math.max(g3[1] || 0, g2[0] || 0);
    return done(CAT.FULL_HOUSE, [t, p], [...byRank[t], ...byRank[p].slice(0, 2)]);
  }
  if (flushSuit >= 0) {
    const best = bySuit[flushSuit].slice().sort((a, b) => b - a).slice(0, 5);
    return done(CAT.FLUSH, best.map(rankOf), best);
  }
  const st = straightTop(rankMask);
  if (st) {
    const best = straightRanks(st).map((r) => byRank[r][0]);
    return done(CAT.STRAIGHT, [st], best);
  }
  if (g3.length) {
    const t = g3[0];
    const k = kick([t], 2);
    return done(CAT.TRIPS, [t, ...k.map(rankOf)], [...byRank[t], ...k]);
  }
  if (g2.length >= 2) {
    const [p1, p2] = g2;
    const k = kick([p1, p2], 1);
    return done(CAT.TWO_PAIR, [p1, p2, ...k.map(rankOf)], [...byRank[p1], ...byRank[p2], ...k]);
  }
  if (g2.length) {
    const p = g2[0];
    const k = kick([p], 3);
    return done(CAT.PAIR, [p, ...k.map(rankOf)], [...byRank[p], ...k]);
  }
  const k = kick([], 5);
  return done(CAT.HIGH, k.map(rankOf), k);
}

/** 빠른 점수 전용 판정 (에퀴티 계산용) */
function scoreOf(cards) {
  return evaluate(cards).score;
}

function combinations(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/**
 * 각 플레이어의 승률 계산 (무승부는 지분만큼 나눔)
 * @param {number[][]} hands 각 플레이어의 홀카드
 * @param {number[]} board 현재 보드
 * @returns {number[]} 0..1
 */
function equity(hands, board, opts = {}) {
  const used = new Set(board);
  for (const h of hands) for (const c of h) used.add(c);
  const rest = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) rest.push(c);
  const need = 5 - board.length;
  const wins = new Array(hands.length).fill(0);
  let total = 0;

  const runBoard = (b) => {
    let best = -1;
    let winners = [];
    for (let i = 0; i < hands.length; i++) {
      const s = scoreOf(hands[i].concat(b));
      if (s > best) { best = s; winners = [i]; } else if (s === best) winners.push(i);
    }
    for (const w of winners) wins[w] += 1 / winners.length;
    total++;
  };

  if (need <= 0) {
    runBoard(board);
  } else if (combinations(rest.length, need) <= (opts.exactLimit || 20000)) {
    const pick = [];
    const rec = (start, depth) => {
      if (depth === need) { runBoard(board.concat(pick)); return; }
      for (let i = start; i < rest.length; i++) {
        pick[depth] = rest[i];
        rec(i + 1, depth + 1);
      }
    };
    rec(0, 0);
  } else {
    const iters = opts.samples || 5000;
    const rnd = opts.random || Math.random;
    const pool = rest.slice();
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < need; i++) {
        const j = i + Math.floor(rnd() * (pool.length - i));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      runBoard(board.concat(pool.slice(0, need)));
    }
  }
  return wins.map((w) => (total ? w / total : 0));
}

module.exports = {
  RANK_CH, SUIT_CH, CAT, CAT_NAMES,
  rankOf, suitOf, toStr, fromStr, newDeck, shuffle, evaluate, scoreOf, equity,
};
