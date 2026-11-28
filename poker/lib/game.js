'use strict';
/**
 * 노리밋 텍사스 홀덤 테이블 엔진 (서버 권한형).
 * - 9석, 블라인드/딜러 버튼, 사이드팟, 언콜 벳 반환, 미완성 올인 레이즈 규칙
 * - 턴 타이머, 자리비움, 재접속, 리바이, 블라인드 상승, 올인 런아웃 + 승률 표시
 */
const { EventEmitter } = require('events');
const P = require('./poker');

const MAX_SEATS = 9;

const DEFAULT_SETTINGS = {
  startingStack: 2000,
  smallBlind: 10,
  bigBlind: 20,
  turnTime: 25,
  blindUpMinutes: 0,
  allowRebuy: true,
  maxSeats: 9,
};

const TIMING = {
  dealBase: 650,
  dealPerCard: 110,
  street: 950,
  runoutReveal: 1500,
  runoutStreet: 1900,
  beforeShowdown: 700,
  showdown: 6500,
  foldWin: 3600,
  disconnectedTurn: 8000,
  sitoutTurn: 1200,
  grace: 400,
  startDelay: 1600,
};

const BLIND_MULT = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 300, 500];

const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🐵', '🦁', '🐨', '🐰', '🐻', '🐧', '🦄', '🐙', '🐶', '🐱', '🐲', '🦉', '🐷', '🐳', '🦖', '👽', '🤖', '👻', '🎃', '😎'];
const EMOTES = ['😂', '👍', '😱', '🔥', '😭', '🤔', '💸', '🙏', '😤', '🤫', '👏', '🍀'];

class GameError extends Error {}

function roundNice(x) {
  if (x < 10) return Math.max(1, Math.round(x));
  if (x < 100) return Math.round(x / 5) * 5;
  if (x < 1000) return Math.round(x / 10) * 10;
  return Math.round(x / 50) * 50;
}

function cleanName(name) {
  return String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
}

/** 기여액으로 메인팟/사이드팟 계산 */
function computePots(entries) {
  const live = entries.filter((e) => !e.folded && e.amount > 0);
  const levels = [...new Set(live.map((e) => e.amount))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const lvl of levels) {
    let amount = 0;
    for (const e of entries) amount += Math.max(0, Math.min(e.amount, lvl) - prev);
    const eligible = entries.filter((e) => !e.folded && e.amount >= lvl).map((e) => e.seat);
    if (amount > 0) pots.push({ amount, eligible });
    prev = lvl;
  }
  let rem = 0;
  for (const e of entries) rem += Math.max(0, e.amount - prev);
  if (rem > 0) {
    if (pots.length) pots[pots.length - 1].amount += rem;
    else pots.push({ amount: rem, eligible: entries.filter((e) => !e.folded).map((e) => e.seat) });
  }
  return pots;
}

class Game extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.sched = opts.scheduler || { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h) };
    this.now = opts.now || (() => Date.now());
    this.randInt = opts.randInt || undefined;
    this.T = { ...TIMING, ...(opts.timing || {}) };
    this.settings = { ...DEFAULT_SETTINGS, ...(opts.settings || {}) };
    this.players = new Map();
    this.tokens = new Map();
    this.seats = new Array(MAX_SEATS).fill(null);
    this.hostId = null;
    this.started = false;
    this.paused = false;
    this.hand = null;
    this.handNumber = 0;
    this.dealerSeat = -1;
    this.level = 0;
    this.levelStart = 0;
    this.log = [];
    this.chat = [];
    this.events = [];
    this.timer = null;
    this.nextId = 1;
    this.handSeq = 0;
    this._flushQueued = false;
    this.gameOver = null;
  }

  // ───────────────────────── 유틸 ─────────────────────────
  err(msg) { throw new GameError(msg); }

  emitEv(ev) {
    this.events.push(ev);
    this.queueFlush();
  }

  queueFlush() {
    if (this._flushQueued) return;
    this._flushQueued = true;
    queueMicrotask(() => {
      this._flushQueued = false;
      const evs = this.events;
      this.events = [];
      this.emit('update', evs);
    });
  }

  addLog(text, kind = 'info') {
    const entry = { t: this.now(), text, kind };
    this.log.push(entry);
    if (this.log.length > 200) this.log.shift();
    this.emitEv({ k: 'log', entry });
  }

  schedule(ms, fn) {
    this.clearTimer();
    this.timer = this.sched.set(() => {
      this.timer = null;
      try {
        fn();
      } catch (e) {
        console.error('[game] scheduled task failed:', e);
      }
    }, ms);
  }

  clearTimer() {
    if (this.timer) {
      this.sched.clear(this.timer);
      this.timer = null;
    }
  }

  getPlayer(pid) {
    const p = pid ? this.players.get(pid) : null;
    if (!p) this.err('플레이어 정보가 없습니다. 새로고침 해주세요.');
    return p;
  }

  playerAt(seat) {
    const id = this.seats[seat];
    return id ? this.players.get(id) : null;
  }

  isHost(pid) { return pid && pid === this.hostId; }

  requireHost(pid) {
    if (!this.isHost(pid)) this.err('호스트만 할 수 있습니다.');
  }

  inHand(p) {
    return !!(this.hand && p.seat !== null && this.hand.hp[p.seat] && this.hand.hp[p.seat].id === p.id);
  }

  hps() {
    return this.hand ? Object.values(this.hand.hp) : [];
  }

  liveHps() {
    return this.hps().filter((hp) => !hp.folded);
  }

  currentBlinds() {
    const s = this.settings;
    const m = BLIND_MULT[Math.min(this.level, BLIND_MULT.length - 1)];
    if (m === 1) return { sb: s.smallBlind, bb: s.bigBlind };
    const sb = roundNice(s.smallBlind * m);
    const bb = Math.max(sb, roundNice(s.bigBlind * m));
    return { sb, bb };
  }

  nextBlinds() {
    const save = this.level;
    this.level = Math.min(save + 1, BLIND_MULT.length - 1);
    const b = this.currentBlinds();
    this.level = save;
    return b;
  }

  eligibleSeats() {
    const out = [];
    for (let s = 0; s < this.settings.maxSeats; s++) {
      const p = this.playerAt(s);
      if (p && p.chips > 0 && !p.sittingOut && !p.standAfterHand) out.push(s);
    }
    return out;
  }

  nextSeatFrom(seat, list) {
    for (let i = 1; i <= MAX_SEATS; i++) {
      const s = (seat + i + MAX_SEATS) % MAX_SEATS;
      if (list.includes(s)) return s;
    }
    return -1;
  }

  // ───────────────────────── 플레이어 관리 ─────────────────────────
  join(token, name, avatar) {
    token = String(token || '').slice(0, 80);
    if (token.length < 8) this.err('잘못된 접속 정보입니다.');
    let p = this.tokens.get(token);
    const nm = cleanName(name);
    if (!p) {
      if (!nm) this.err('닉네임을 입력해주세요.');
      p = {
        id: 'p' + this.nextId++, token, name: nm, avatar: AVATARS.includes(avatar) ? avatar : AVATARS[0],
        chips: 0, buyIn: 0, rebuys: 0, handsWon: 0, biggestPot: 0,
        seat: null, connected: true, lastSeen: this.now(), sittingOut: false, timeouts: 0,
        standAfterHand: false, lastChat: 0,
      };
      this.players.set(p.id, p);
      this.tokens.set(token, p);
      this.addLog(`${p.name} 님이 입장했습니다`, 'join');
    } else {
      if (nm) p.name = nm;
      if (AVATARS.includes(avatar)) p.avatar = avatar;
      if (!p.connected) this.addLog(`${p.name} 님이 다시 연결되었습니다`, 'join');
    }
    p.connected = true;
    p.lastSeen = this.now();
    const host = this.hostId && this.players.get(this.hostId);
    if (!host) this.hostId = p.id;
    this.queueFlush();
    return p;
  }

  updateProfile(pid, name, avatar) {
    const p = this.getPlayer(pid);
    const nm = cleanName(name);
    if (nm && nm !== p.name) {
      this.addLog(`${p.name} → ${nm} 닉네임 변경`, 'info');
      p.name = nm;
    }
    if (AVATARS.includes(avatar)) p.avatar = avatar;
    this.queueFlush();
  }

  disconnect(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    p.connected = false;
    p.lastSeen = this.now();
    this.queueFlush();
  }

  /** 서버가 주기적으로 호출: 장시간 접속 끊긴 플레이어 정리, 호스트 이양 */
  tick() {
    const now = this.now();
    for (const p of this.players.values()) {
      if (!p.connected && p.seat !== null && now - p.lastSeen > 10 * 60 * 1000) {
        if (this.inHand(p)) p.standAfterHand = true;
        else this.unseat(p, `${p.name} 님이 장시간 연결되지 않아 자리에서 일어났습니다`);
      }
    }
    const host = this.players.get(this.hostId);
    if (!host || (!host.connected && now - host.lastSeen > 20000)) {
      const cand = [...this.players.values()].filter((p) => p.connected);
      const seated = cand.filter((p) => p.seat !== null);
      const next = seated[0] || cand[0];
      if (next && next.id !== this.hostId) {
        this.hostId = next.id;
        this.addLog(`${next.name} 님이 새 호스트가 되었습니다`, 'host');
      }
    }
  }

  sit(pid, seat) {
    const p = this.getPlayer(pid);
    seat = Number(seat);
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.settings.maxSeats) this.err('잘못된 자리입니다.');
    if (this.seats[seat]) this.err('이미 누군가 앉아 있는 자리입니다.');
    if (p.seat !== null) {
      if (this.inHand(p)) this.err('핸드 진행 중에는 자리를 옮길 수 없습니다.');
      this.seats[p.seat] = null;
    }
    if (p.chips <= 0 && p.buyIn === 0) {
      p.chips = this.settings.startingStack;
      p.buyIn = this.settings.startingStack;
    }
    p.seat = seat;
    this.seats[seat] = p.id;
    p.sittingOut = false;
    p.standAfterHand = false;
    p.timeouts = 0;
    this.addLog(`${p.name} 님이 ${seat + 1}번 자리에 앉았습니다`, 'sit');
    this.emitEv({ k: 'sit', seat });
    this.scheduleStart();
  }

  unseat(p, msg) {
    if (p.seat === null) return;
    this.seats[p.seat] = null;
    p.seat = null;
    p.standAfterHand = false;
    p.sittingOut = false;
    if (msg) this.addLog(msg, 'sit');
    this.queueFlush();
  }

  stand(pid) {
    const p = this.getPlayer(pid);
    if (p.seat === null) return;
    if (this.inHand(p)) {
      p.standAfterHand = true;
      const hp = this.hand.hp[p.seat];
      if (!this.hand.result && !hp.folded && !hp.allIn) this.foldOutOfTurn(hp);
      this.addLog(`${p.name} 님이 이번 핸드 후 자리에서 일어납니다`, 'sit');
      this.queueFlush();
    } else {
      this.unseat(p, `${p.name} 님이 자리에서 일어났습니다`);
    }
  }

  kick(pid, targetId) {
    this.requireHost(pid);
    const t = this.getPlayer(targetId);
    if (t.id === pid) this.err('자기 자신은 내보낼 수 없습니다.');
    if (t.seat === null) return;
    if (this.inHand(t)) {
      t.standAfterHand = true;
      const hp = this.hand.hp[t.seat];
      if (!this.hand.result && !hp.folded && !hp.allIn) this.foldOutOfTurn(hp);
      this.addLog(`호스트가 ${t.name} 님을 자리에서 내보냈습니다 (핸드 종료 후)`, 'sit');
    } else {
      this.unseat(t, `호스트가 ${t.name} 님을 자리에서 내보냈습니다`);
    }
  }

  transferHost(pid, targetId) {
    this.requireHost(pid);
    const t = this.getPlayer(targetId);
    this.hostId = t.id;
    this.addLog(`${t.name} 님이 새 호스트가 되었습니다`, 'host');
  }

  setSitOut(pid, value) {
    const p = this.getPlayer(pid);
    if (p.seat === null) return;
    p.sittingOut = !!value;
    p.timeouts = 0;
    this.addLog(value ? `${p.name} 님이 자리를 비웠습니다` : `${p.name} 님이 게임에 복귀했습니다`, 'sit');
    if (value && this.hand && this.hand.toAct === p.seat && this.hand.phase === 'betting') {
      const info = this.actionInfo(p.seat);
      this.applyAction(p, info.canCheck ? 'check' : 'fold', 0, true);
    }
    if (!value) this.scheduleStart();
    this.queueFlush();
  }

  rebuy(pid) {
    const p = this.getPlayer(pid);
    if (!this.settings.allowRebuy) this.err('리바이가 허용되지 않은 게임입니다.');
    if (p.chips > 0) this.err('칩이 남아있을 때는 리바이할 수 없습니다.');
    if (this.inHand(p)) this.err('핸드가 끝난 뒤에 리바이할 수 있습니다.');
    p.chips = this.settings.startingStack;
    p.buyIn += this.settings.startingStack;
    p.rebuys++;
    p.sittingOut = false;
    p.timeouts = 0;
    this.addLog(`${p.name} 님이 리바이했습니다 (+${p.chips.toLocaleString()})`, 'rebuy');
    this.emitEv({ k: 'rebuy', seat: p.seat });
    this.scheduleStart();
  }

  say(pid, text) {
    const p = this.getPlayer(pid);
    text = String(text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
    if (!text) return;
    const now = this.now();
    if (now - p.lastChat < 350) this.err('너무 빠르게 보내고 있어요.');
    p.lastChat = now;
    const msg = { t: now, id: p.id, name: p.name, avatar: p.avatar, seat: p.seat, text };
    this.chat.push(msg);
    if (this.chat.length > 100) this.chat.shift();
    this.emitEv({ k: 'chat', msg });
  }

  emote(pid, emoji) {
    const p = this.getPlayer(pid);
    if (!EMOTES.includes(emoji)) return;
    const now = this.now();
    if (now - p.lastChat < 300) return;
    p.lastChat = now;
    this.emitEv({ k: 'emote', id: p.id, seat: p.seat, emoji });
  }

  // ───────────────────────── 호스트 제어 ─────────────────────────
  updateSettings(pid, s) {
    this.requireHost(pid);
    const cur = { ...this.settings };
    const int = (v, lo, hi, def) => {
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n)) return def;
      return Math.min(hi, Math.max(lo, n));
    };
    if (s.startingStack !== undefined) cur.startingStack = int(s.startingStack, 100, 10_000_000, cur.startingStack);
    if (s.smallBlind !== undefined) cur.smallBlind = int(s.smallBlind, 1, 1_000_000, cur.smallBlind);
    if (s.bigBlind !== undefined) cur.bigBlind = int(s.bigBlind, 1, 2_000_000, cur.bigBlind);
    if (cur.bigBlind < cur.smallBlind) cur.bigBlind = cur.smallBlind;
    if (s.turnTime !== undefined) cur.turnTime = int(s.turnTime, 8, 180, cur.turnTime);
    if (s.blindUpMinutes !== undefined) cur.blindUpMinutes = int(s.blindUpMinutes, 0, 120, cur.blindUpMinutes);
    if (s.allowRebuy !== undefined) cur.allowRebuy = !!s.allowRebuy;
    if (s.maxSeats !== undefined) {
      const m = int(s.maxSeats, 2, MAX_SEATS, cur.maxSeats);
      for (let i = m; i < MAX_SEATS; i++) {
        if (this.seats[i]) this.err(`${i + 1}번 자리에 플레이어가 있어 인원을 줄일 수 없습니다.`);
      }
      cur.maxSeats = m;
    }
    const blindsChanged = cur.smallBlind !== this.settings.smallBlind || cur.bigBlind !== this.settings.bigBlind || cur.blindUpMinutes !== this.settings.blindUpMinutes;
    this.settings = cur;
    if (blindsChanged) {
      this.level = 0;
      this.levelStart = this.now();
    }
    this.addLog('호스트가 게임 설정을 변경했습니다 (다음 핸드부터 적용)', 'host');
    this.emitEv({ k: 'settings' });
  }

  startGame(pid) {
    this.requireHost(pid);
    if (this.started && !this.paused) return;
    if (this.eligibleSeats().length < 2) this.err('최소 2명이 앉아야 시작할 수 있습니다.');
    if (!this.started) {
      this.level = 0;
      this.levelStart = this.now();
      this.gameOver = null;
      this.addLog('게임이 시작되었습니다! 행운을 빕니다 🍀', 'start');
    } else {
      this.addLog('게임이 재개되었습니다', 'start');
    }
    this.started = true;
    this.paused = false;
    this.emitEv({ k: 'start' });
    this.scheduleStart(400);
  }

  setPaused(pid, value) {
    this.requireHost(pid);
    if (!this.started) return;
    this.paused = !!value;
    this.addLog(value ? '호스트가 게임을 일시정지했습니다 (현재 핸드 종료 후)' : '게임이 재개되었습니다', 'host');
    if (!value) this.scheduleStart(400);
    this.queueFlush();
  }

  resetGame(pid) {
    this.requireHost(pid);
    if (this.hand) this.err('핸드가 끝난 후에 새 게임을 시작할 수 있습니다. 먼저 일시정지하세요.');
    for (const p of this.players.values()) {
      if (p.seat !== null) {
        p.chips = this.settings.startingStack;
        p.buyIn = this.settings.startingStack;
      } else {
        p.chips = 0;
        p.buyIn = 0;
      }
      p.rebuys = 0;
      p.handsWon = 0;
      p.biggestPot = 0;
      p.sittingOut = false;
      p.timeouts = 0;
    }
    this.started = false;
    this.paused = false;
    this.handNumber = 0;
    this.dealerSeat = -1;
    this.level = 0;
    this.gameOver = null;
    this.clearTimer();
    this.addLog('새 게임이 준비되었습니다. 모든 칩이 초기화되었습니다.', 'start');
    this.emitEv({ k: 'reset' });
  }

  // ───────────────────────── 핸드 진행 ─────────────────────────
  scheduleStart(ms = this.T.startDelay) {
    this.queueFlush();
    if (!this.started || this.paused || this.hand) return;
    if (this.eligibleSeats().length < 2) return;
    if (this.timer) return;
    this.schedule(ms, () => this.maybeStartHand());
  }

  maybeStartHand() {
    if (!this.started || this.paused || this.hand) return;
    if (this.eligibleSeats().length < 2) { this.queueFlush(); return; }
    this.startHand();
  }

  startHand() {
    const s = this.settings;
    if (s.blindUpMinutes > 0) {
      const lvl = Math.floor((this.now() - this.levelStart) / (s.blindUpMinutes * 60000));
      const capped = Math.min(lvl, BLIND_MULT.length - 1);
      if (capped > this.level) {
        this.level = capped;
        const b = this.currentBlinds();
        this.addLog(`블라인드가 ${b.sb.toLocaleString()} / ${b.bb.toLocaleString()} 로 올랐습니다`, 'blind');
        this.emitEv({ k: 'blindUp', sb: b.sb, bb: b.bb });
      }
    }
    const { sb, bb } = this.currentBlinds();
    const elig = this.eligibleSeats();
    let dealer;
    if (this.dealerSeat < 0) {
      const r = this.randInt ? this.randInt(elig.length) : Math.floor(Math.random() * elig.length);
      dealer = elig[r];
    } else {
      dealer = this.nextSeatFrom(this.dealerSeat, elig);
    }
    this.dealerSeat = dealer;
    let sbSeat, bbSeat;
    if (elig.length === 2) {
      sbSeat = dealer;
      bbSeat = this.nextSeatFrom(dealer, elig);
    } else {
      sbSeat = this.nextSeatFrom(dealer, elig);
      bbSeat = this.nextSeatFrom(sbSeat, elig);
    }

    this.handNumber++;
    const deck = P.shuffle(P.newDeck(), this.randInt);
    const h = {
      id: ++this.handSeq,
      number: this.handNumber,
      deck,
      board: [],
      dealer, sbSeat, bbSeat, sb, bb,
      street: 'preflop',
      phase: 'dealing',
      hp: {},
      currentBet: bb,
      minRaise: bb,
      raiseId: 0,
      toAct: null,
      turnStart: 0,
      turnMs: 0,
      result: null,
      runout: false,
      equity: null,
      startedAt: this.now(),
    };
    this.hand = h;
    const order = [];
    let cur = this.nextSeatFrom(dealer, elig);
    for (let i = 0; i < elig.length; i++) {
      order.push(cur);
      cur = this.nextSeatFrom(cur, elig);
    }
    for (const seat of order) {
      const p = this.playerAt(seat);
      h.hp[seat] = {
        id: p.id, seat, cards: [], bet: 0, total: 0, folded: false, allIn: false,
        acted: false, actedRaiseId: -1, last: null, shown: false, startChips: p.chips,
      };
    }
    for (let r = 0; r < 2; r++) for (const seat of order) h.hp[seat].cards.push(deck.pop());

    this.postBlind(sbSeat, sb, 'sb');
    this.postBlind(bbSeat, bb, 'bb');

    this.addLog(`── 핸드 #${h.number} · 블라인드 ${sb.toLocaleString()}/${bb.toLocaleString()} ──`, 'hand');
    this.emitEv({ k: 'newHand', id: h.id, order, dealer });

    const dealMs = this.T.dealBase + order.length * 2 * this.T.dealPerCard;
    const hid = h.id;
    this.schedule(dealMs, () => {
      if (!this.hand || this.hand.id !== hid) return;
      this.hand.phase = 'betting';
      if (this.liveHps().length === 1) return this.finishByFold();
      const first = this.nextToActFrom(bbSeat);
      if (first === null) return this.endRound();
      this.startTurn(first);
    });
  }

  postBlind(seat, amount, type) {
    const h = this.hand;
    const hp = h.hp[seat];
    const p = this.playerAt(seat);
    const amt = Math.min(amount, p.chips);
    this.putChips(p, hp, amt);
    hp.last = { type, amount: hp.bet };
  }

  putChips(p, hp, amt) {
    amt = Math.max(0, Math.min(amt, p.chips));
    p.chips -= amt;
    hp.bet += amt;
    hp.total += amt;
    if (p.chips === 0) hp.allIn = true;
  }

  needsAction(hp) {
    if (hp.folded || hp.allIn) return false;
    const h = this.hand;
    if (hp.bet < h.currentBet) return true;
    if (hp.acted) return false;
    return this.hps().some((o) => o !== hp && !o.folded && !o.allIn);
  }

  nextToActFrom(seat) {
    const h = this.hand;
    for (let i = 1; i <= MAX_SEATS; i++) {
      const s = (seat + i) % MAX_SEATS;
      const hp = h.hp[s];
      if (hp && this.needsAction(hp)) return s;
    }
    return null;
  }

  actionInfo(seat) {
    const h = this.hand;
    const hp = h.hp[seat];
    const p = this.playerAt(seat);
    const toCall = Math.max(0, h.currentBet - hp.bet);
    const callAmount = Math.min(toCall, p.chips);
    const maxTo = hp.bet + p.chips;
    const othersCanAct = this.hps().some((o) => o.seat !== seat && !o.folded && !o.allIn);
    const reopened = !hp.acted || hp.actedRaiseId < h.raiseId;
    const canRaise = p.chips > toCall && othersCanAct && reopened;
    let minTo = h.currentBet === 0 ? h.bb : h.currentBet + h.minRaise;
    minTo = Math.min(minTo, maxTo);
    const pot = this.hps().reduce((a, o) => a + o.total, 0);
    return {
      toCall, callAmount, canCheck: toCall === 0, canCall: toCall > 0,
      canRaise, minRaiseTo: minTo, maxRaiseTo: maxTo, isBet: h.currentBet === 0,
      pot, currentBet: h.currentBet, myBet: hp.bet, chips: p.chips, bb: h.bb,
    };
  }

  startTurn(seat) {
    const h = this.hand;
    const p = this.playerAt(seat);
    h.toAct = seat;
    h.phase = 'betting';
    let ms = this.settings.turnTime * 1000;
    if (p.sittingOut || p.standAfterHand) ms = this.T.sitoutTurn;
    else if (!p.connected) ms = Math.min(ms, this.T.disconnectedTurn);
    h.turnStart = this.now();
    h.turnMs = ms;
    const hid = h.id;
    this.schedule(ms + this.T.grace, () => {
      if (this.hand && this.hand.id === hid && this.hand.toAct === seat && this.hand.phase === 'betting') this.onTimeout(seat);
    });
    this.emitEv({ k: 'turn', seat, ms });
  }

  onTimeout(seat) {
    const p = this.playerAt(seat);
    if (!p) return;
    const info = this.actionInfo(seat);
    if (!p.sittingOut && !p.standAfterHand) {
      p.timeouts++;
      if (p.timeouts >= 2) {
        p.sittingOut = true;
        this.addLog(`${p.name} 님이 시간 초과로 자리비움 처리되었습니다`, 'sit');
      }
    }
    this.applyAction(p, info.canCheck ? 'check' : 'fold', 0, true);
  }

  act(pid, type, amount) {
    const p = this.getPlayer(pid);
    const h = this.hand;
    if (!h || p.seat === null || h.toAct !== p.seat || h.phase !== 'betting') this.err('지금은 당신의 차례가 아닙니다.');
    this.applyAction(p, type, amount, false);
  }

  applyAction(p, type, amount, auto) {
    const h = this.hand;
    const seat = p.seat;
    const hp = h.hp[seat];
    const info = this.actionInfo(seat);
    const fmt = (n) => n.toLocaleString();

    if (type === 'allin') {
      if (info.canRaise) { type = 'raise'; amount = info.maxRaiseTo; } else if (info.canCall) type = 'call';
      else type = 'check';
    }
    if (type === 'bet') type = 'raise';
    if (type === 'call' && info.toCall === 0) type = 'check';

    let logText;
    switch (type) {
      case 'fold':
        hp.folded = true;
        hp.last = { type: 'fold' };
        logText = `${p.name}: 폴드${auto ? ' (자동)' : ''}`;
        break;
      case 'check':
        if (!info.canCheck) this.err('체크할 수 없습니다. 콜 또는 폴드하세요.');
        hp.last = { type: 'check' };
        logText = `${p.name}: 체크${auto ? ' (자동)' : ''}`;
        break;
      case 'call': {
        this.putChips(p, hp, info.callAmount);
        hp.last = { type: hp.allIn ? 'allin' : 'call', amount: hp.bet };
        logText = `${p.name}: ${hp.allIn ? '올인 콜' : '콜'} ${fmt(hp.bet)}`;
        break;
      }
      case 'raise': {
        if (!info.canRaise) this.err('지금은 레이즈할 수 없습니다.');
        let to = Math.floor(Number(amount));
        if (!Number.isFinite(to)) this.err('금액이 올바르지 않습니다.');
        to = Math.max(info.minRaiseTo, Math.min(to, info.maxRaiseTo));
        const wasBet = h.currentBet === 0;
        const raiseSize = to - h.currentBet;
        this.putChips(p, hp, to - hp.bet);
        if (raiseSize >= h.minRaise) {
          h.minRaise = raiseSize;
          h.raiseId++;
        }
        h.currentBet = Math.max(h.currentBet, to);
        hp.last = { type: hp.allIn ? 'allin' : wasBet ? 'bet' : 'raise', amount: hp.bet };
        logText = `${p.name}: ${hp.allIn ? '올인' : wasBet ? '벳' : '레이즈'} ${fmt(hp.bet)}`;
        break;
      }
      default:
        this.err('알 수 없는 행동입니다.');
    }
    hp.acted = true;
    hp.actedRaiseId = h.raiseId;
    if (!auto) p.timeouts = 0;
    this.addLog(logText, 'action');
    this.emitEv({ k: 'action', seat, type: hp.last.type, amount: hp.last.amount || 0, auto: !!auto });
    this.clearTimer();
    this.advance();
  }

  foldOutOfTurn(hp) {
    const h = this.hand;
    const p = this.players.get(hp.id);
    if (h.phase === 'betting' && h.toAct === hp.seat) {
      this.applyAction(p, 'fold', 0, true);
      return;
    }
    hp.folded = true;
    hp.last = { type: 'fold' };
    hp.acted = true;
    this.addLog(`${p.name}: 폴드`, 'action');
    this.emitEv({ k: 'action', seat: hp.seat, type: 'fold', amount: 0, auto: true });
    if (this.liveHps().length === 1 && !h.result) {
      if (h.phase === 'dealing') return; // 딜링 끝나면 처리됨
      this.finishByFold();
    }
  }

  advance() {
    const h = this.hand;
    if (this.liveHps().length === 1) return this.finishByFold();
    const next = this.nextToActFrom(h.toAct);
    if (next === null) return this.endRound();
    this.startTurn(next);
  }

  returnUncalled() {
    const h = this.hand;
    const list = this.hps().slice().sort((a, b) => b.bet - a.bet);
    if (list.length >= 2 && list[0].bet > list[1].bet) {
      const top = list[0];
      const diff = top.bet - list[1].bet;
      const p = this.players.get(top.id);
      top.bet -= diff;
      top.total -= diff;
      p.chips += diff;
      if (p.chips > 0) top.allIn = false;
      if (top.last && top.last.amount) top.last = { ...top.last, amount: top.bet };
      this.emitEv({ k: 'uncalled', seat: top.seat, amount: diff });
      if (h.currentBet > list[1].bet) h.currentBet = list[1].bet;
    }
  }

  collectBets() {
    const from = [];
    for (const hp of this.hps()) {
      if (hp.bet > 0) from.push(hp.seat);
      hp.bet = 0;
    }
    if (from.length) this.emitEv({ k: 'collect', from });
  }

  endRound() {
    const h = this.hand;
    h.toAct = null;
    h.phase = 'transition';
    this.clearTimer();
    this.returnUncalled();
    this.collectBets();
    const live = this.liveHps();
    if (h.street === 'river') {
      this.schedule(this.T.beforeShowdown, () => this.showdown());
      return;
    }
    const canAct = live.filter((hp) => !hp.allIn);
    if (canAct.length <= 1) {
      let delay = this.T.runoutStreet;
      if (!h.runout) {
        h.runout = true;
        for (const hp of live) hp.shown = true;
        this.computeEquity();
        this.emitEv({ k: 'reveal', seats: live.map((x) => x.seat) });
        this.addLog('올인! 카드를 공개합니다', 'allin');
        delay = this.T.runoutReveal;
      }
      const hid = h.id;
      this.schedule(delay, () => {
        if (!this.hand || this.hand.id !== hid) return;
        this.dealStreet();
        this.computeEquity();
        this.endRound();
      });
      return;
    }
    const hid = h.id;
    this.schedule(this.T.street, () => {
      if (!this.hand || this.hand.id !== hid) return;
      this.dealStreet();
      this.hand.phase = 'betting';
      const first = this.nextToActFrom(this.hand.dealer);
      if (first === null) return this.endRound();
      this.startTurn(first);
    });
  }

  dealStreet() {
    const h = this.hand;
    h.deck.pop(); // 번 카드
    let street;
    if (h.street === 'preflop') {
      h.board.push(h.deck.pop(), h.deck.pop(), h.deck.pop());
      street = 'flop';
    } else if (h.street === 'flop') {
      h.board.push(h.deck.pop());
      street = 'turn';
    } else {
      h.board.push(h.deck.pop());
      street = 'river';
    }
    h.street = street;
    h.currentBet = 0;
    h.minRaise = h.bb;
    h.raiseId = 0;
    for (const hp of this.hps()) {
      hp.acted = false;
      hp.actedRaiseId = -1;
      if (!hp.folded && !hp.allIn) hp.last = null;
    }
    const names = { flop: '플랍', turn: '턴', river: '리버' };
    this.addLog(`${names[street]}: ${h.board.map(P.toStr).join(' ')}`, 'board');
    this.emitEv({ k: 'board', street, count: h.board.length });
  }

  computeEquity() {
    const h = this.hand;
    const live = this.liveHps();
    if (live.length < 2 || h.board.length >= 5) {
      h.equity = h.board.length >= 5 ? null : h.equity;
      return;
    }
    const eq = P.equity(live.map((hp) => hp.cards), h.board);
    h.equity = {};
    live.forEach((hp, i) => { h.equity[hp.seat] = Math.round(eq[i] * 1000) / 10; });
  }

  oddChipOrder(seats) {
    const h = this.hand;
    return seats.slice().sort((a, b) => ((a - h.dealer - 1 + MAX_SEATS) % MAX_SEATS) - ((b - h.dealer - 1 + MAX_SEATS) % MAX_SEATS));
  }

  showdown() {
    const h = this.hand;
    h.street = 'showdown';
    h.phase = 'showdown';
    h.toAct = null;
    h.equity = null;
    const live = this.liveHps();
    const evals = {};
    for (const hp of live) {
      hp.shown = true;
      evals[hp.seat] = P.evaluate(hp.cards.concat(h.board));
    }
    const pots = computePots(this.hps().map((hp) => ({ seat: hp.seat, amount: hp.total, folded: hp.folded })));
    const won = {};
    const potResults = [];
    for (const pot of pots) {
      const contenders = pot.eligible.filter((s) => evals[s]);
      let best = -1;
      let winners = [];
      for (const s of contenders) {
        const sc = evals[s].score;
        if (sc > best) { best = sc; winners = [s]; } else if (sc === best) winners.push(s);
      }
      if (!winners.length) continue;
      const ordered = this.oddChipOrder(winners);
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      for (const s of ordered) {
        const amt = share + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
        won[s] = (won[s] || 0) + amt;
      }
      potResults.push({ amount: pot.amount, winners: ordered, label: evals[ordered[0]].label });
    }
    const winners = [];
    for (const [seatStr, amount] of Object.entries(won)) {
      const seat = Number(seatStr);
      const p = this.playerAt(seat);
      p.chips += amount;
      p.handsWon++;
      p.biggestPot = Math.max(p.biggestPot, amount);
      winners.push({ seat, amount, label: evals[seat].label, cat: evals[seat].cat, name: p.name });
    }
    winners.sort((a, b) => b.amount - a.amount);
    const hands = {};
    for (const hp of live) {
      const e = evals[hp.seat];
      hands[hp.seat] = { label: e.label, name: e.name, cat: e.cat, best: e.best.map(P.toStr) };
    }
    h.result = { byFold: false, winners, pots: potResults, hands };
    for (const w of winners) {
      this.addLog(`🏆 ${w.name} 님이 ${w.amount.toLocaleString()} 획득 (${w.label})`, 'win');
    }
    this.emitEv({ k: 'win', winners, byFold: false });
    const hid = h.id;
    this.schedule(this.T.showdown, () => {
      if (this.hand && this.hand.id === hid) this.endHand();
    });
  }

  finishByFold() {
    const h = this.hand;
    if (h.result) return;
    this.clearTimer();
    h.toAct = null;
    h.phase = 'showdown';
    h.equity = null;
    this.returnUncalled();
    this.collectBets();
    const winnerHp = this.liveHps()[0];
    const p = this.players.get(winnerHp.id);
    const amount = this.hps().reduce((a, hp) => a + hp.total, 0);
    p.chips += amount;
    p.handsWon++;
    p.biggestPot = Math.max(p.biggestPot, amount);
    h.result = {
      byFold: true,
      winners: [{ seat: winnerHp.seat, amount, label: '', name: p.name }],
      pots: [{ amount, winners: [winnerHp.seat], label: '' }],
      hands: {},
    };
    this.addLog(`🏆 ${p.name} 님이 ${amount.toLocaleString()} 획득`, 'win');
    this.emitEv({ k: 'win', winners: h.result.winners, byFold: true });
    const hid = h.id;
    this.schedule(this.T.foldWin, () => {
      if (this.hand && this.hand.id === hid) this.endHand();
    });
  }

  showCards(pid) {
    const p = this.getPlayer(pid);
    const h = this.hand;
    if (!h || !h.result || !this.inHand(p)) this.err('지금은 카드를 공개할 수 없습니다.');
    const hp = h.hp[p.seat];
    if (hp.shown) return;
    hp.shown = true;
    const e = P.evaluate(hp.cards.concat(h.board));
    h.result.hands[p.seat] = { label: e.label, name: e.name, cat: e.cat, best: e.best.map(P.toStr), voluntary: true };
    this.addLog(`${p.name} 님이 카드를 공개했습니다: ${hp.cards.map(P.toStr).join(' ')}`, 'show');
    this.emitEv({ k: 'show', seat: p.seat });
  }

  endHand() {
    const h = this.hand;
    this.hand = null;
    this.lastHandId = h ? h.id : null;
    for (let s = 0; s < MAX_SEATS; s++) {
      const p = this.playerAt(s);
      if (!p) continue;
      if (p.standAfterHand) {
        this.unseat(p, `${p.name} 님이 자리에서 일어났습니다`);
        continue;
      }
      if (p.chips === 0) {
        if (!this.settings.allowRebuy) {
          this.unseat(p, `${p.name} 님이 탈락했습니다`);
        } else {
          this.addLog(`${p.name} 님의 칩이 모두 소진되었습니다`, 'bust');
        }
      }
    }
    if (this.started && !this.settings.allowRebuy) {
      const alive = [...this.players.values()].filter((p) => p.seat !== null && p.chips > 0);
      if (alive.length === 1) {
        const w = alive[0];
        this.started = false;
        this.gameOver = { id: w.id, name: w.name, avatar: w.avatar, chips: w.chips };
        this.addLog(`🎉 ${w.name} 님이 최종 우승했습니다!`, 'win');
        this.emitEv({ k: 'gameOver', winner: this.gameOver });
      }
    }
    this.emitEv({ k: 'handEnd' });
    this.scheduleStart(250);
  }

  // ───────────────────────── 뷰 ─────────────────────────
  viewFor(pid) {
    const me = pid ? this.players.get(pid) : null;
    const h = this.hand;
    const now = this.now();
    const seats = [];
    for (let s = 0; s < this.settings.maxSeats; s++) {
      const p = this.playerAt(s);
      if (!p) { seats.push(null); continue; }
      const hp = h && h.hp[s] && h.hp[s].id === p.id ? h.hp[s] : null;
      const o = {
        id: p.id, name: p.name, avatar: p.avatar, chips: p.chips, connected: p.connected,
        sittingOut: p.sittingOut, leaving: p.standAfterHand, host: p.id === this.hostId,
        inHand: !!hp,
      };
      if (hp) {
        const isMe = me && me.id === p.id;
        o.bet = hp.bet;
        o.total = hp.total;
        o.folded = hp.folded;
        o.allIn = hp.allIn;
        o.last = hp.last;
        o.shown = hp.shown;
        if (isMe || hp.shown) o.cards = hp.cards.map(P.toStr);
        else if (hp.folded) o.cards = [];
        else o.cards = ['XX', 'XX'];
      }
      seats.push(o);
    }

    let hand = null;
    if (h) {
      const pots = computePots(this.hps().map((hp) => ({ seat: hp.seat, amount: hp.total - hp.bet, folded: hp.folded })));
      hand = {
        id: h.id, number: h.number, street: h.street, phase: h.phase,
        board: h.board.map(P.toStr), dealer: h.dealer, sbSeat: h.sbSeat, bbSeat: h.bbSeat,
        sb: h.sb, bb: h.bb, currentBet: h.currentBet,
        pots: pots.map((x) => ({ amount: x.amount, eligible: x.eligible })),
        potTotal: this.hps().reduce((a, hp) => a + hp.total, 0),
        toAct: h.toAct,
        turnLeft: h.toAct !== null ? Math.max(0, h.turnStart + h.turnMs - now) : 0,
        turnMs: h.turnMs,
        result: h.result,
        equity: h.equity,
        runout: h.runout,
      };
    }

    let my = null;
    if (me) {
      const hp = h && me.seat !== null && h.hp[me.seat] && h.hp[me.seat].id === me.id ? h.hp[me.seat] : null;
      my = {
        id: me.id, name: me.name, avatar: me.avatar, seat: me.seat, chips: me.chips,
        isHost: me.id === this.hostId, sittingOut: me.sittingOut, leaving: me.standAfterHand,
        inHand: !!hp, folded: hp ? hp.folded : false, allIn: hp ? hp.allIn : false,
        busted: me.seat !== null && me.chips === 0 && !hp,
        buyIn: me.buyIn,
      };
      if (hp) {
        const e = P.evaluate(hp.cards.concat(h.board));
        my.hand = { label: e.label, cat: e.cat, best: h.board.length ? e.best.map(P.toStr) : [] };
        my.toCall = Math.max(0, h.currentBet - hp.bet);
        my.bet = hp.bet;
        my.shown = hp.shown;
        if (h.toAct === me.seat && h.phase === 'betting') my.actions = this.actionInfo(me.seat);
      }
    }

    const blinds = this.currentBlinds();
    let nextLevelIn = null;
    if (this.started && this.settings.blindUpMinutes > 0 && this.level < BLIND_MULT.length - 1) {
      const nextAt = this.levelStart + (this.level + 1) * this.settings.blindUpMinutes * 60000;
      nextLevelIn = Math.max(0, nextAt - now);
    }

    const spectators = [];
    const scoreboard = [];
    for (const p of this.players.values()) {
      if (p.seat === null && p.connected) spectators.push({ id: p.id, name: p.name, avatar: p.avatar });
      if (p.buyIn > 0) {
        const inPot = this.inHand(p) ? h.hp[p.seat].total : 0;
        scoreboard.push({
          id: p.id, name: p.name, avatar: p.avatar, chips: p.chips + inPot, buyIn: p.buyIn,
          net: p.chips + inPot - p.buyIn, rebuys: p.rebuys, handsWon: p.handsWon,
          biggestPot: p.biggestPot, seated: p.seat !== null, connected: p.connected,
        });
      }
    }
    scoreboard.sort((a, b) => b.net - a.net);

    return {
      me: my,
      hostId: this.hostId,
      hostName: this.players.get(this.hostId)?.name || '',
      settings: this.settings,
      started: this.started,
      paused: this.paused,
      handNumber: this.handNumber,
      level: this.level,
      blinds,
      nextBlinds: nextLevelIn !== null ? this.nextBlinds() : null,
      nextLevelIn,
      seats,
      hand,
      eligibleCount: this.eligibleSeats().length,
      spectators,
      scoreboard,
      gameOver: this.gameOver,
      serverTime: now,
    };
  }
}

module.exports = { Game, GameError, computePots, DEFAULT_SETTINGS, AVATARS, EMOTES, MAX_SEATS, BLIND_MULT };
