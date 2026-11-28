import { Net } from './net.js';
import { sound } from './sound.js';
import { computeLayout } from './layout.js';
import { cardEl, setCardFace, chipStack, fmt, fmtShort } from './cards.js';

const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🐵', '🦁', '🐨', '🐰', '🐻', '🐧', '🦄', '🐙', '🐶', '🐱', '🐲', '🦉', '🐷', '🐳', '🦖', '👽', '🤖', '👻', '🎃', '😎'];
const EMOTES = ['😂', '👍', '😱', '🔥', '😭', '🤔', '💸', '🙏', '😤', '🤫', '👏', '🍀'];
const ACTION_LABEL = { fold: '폴드', check: '체크', call: '콜', bet: '벳', raise: '레이즈', allin: '올인', sb: 'SB', bb: 'BB' };
const CIRC = 2 * Math.PI * 47;

const ICONS = {
  qr: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3M21 14v.01M14 21h3M21 17v4h-1"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5z"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 6h3v1.5A3.5 3.5 0 0 1 16.6 11M7 6H4v1.5A3.5 3.5 0 0 0 7.4 11"/>',
  vol: '<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  exit: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/>',
  coffee: '<path d="M4 9h13v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6V9zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3v3M12 3v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  cards: '<rect x="4" y="3" width="12" height="17" rx="2"/><path d="M16 6l3.5 1a1.5 1.5 0 0 1 1 1.8l-3 11.4"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.1-4-7.5-9-7.5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5M12 17h.01"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/>',
};
const icon = (n, size = 20) => `<svg class="ic" viewBox="0 0 24 24" style="width:${size}px;height:${size}px">${ICONS[n]}</svg>`;

const $ = (id) => document.getElementById(id);
function h(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ───────────────────────── 저장소 ─────────────────────────
const store = {
  get(k, d) { try { const v = localStorage.getItem('piku.' + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('piku.' + k, JSON.stringify(v)); } catch (_) { /* */ } },
};
function getToken() {
  let t = store.get('token', null);
  if (!t) {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    t = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    store.set('token', t);
  }
  return t;
}

const prefs = {
  sound: store.get('sound', true),
  fourColor: store.get('fourColor', false),
  theme: store.get('theme', 'green'),
};

// ───────────────────────── 상태 ─────────────────────────
const S = {
  state: null,
  you: null,
  urls: [],
  log: [],
  chat: [],
  unread: 0,
  layout: null,
  layoutKey: '',
  seatEls: [],
  betEls: [],
  ctlMode: null,
  ctl: null,
  raiseOpen: false,
  raiseValue: 0,
  actKey: '',
  pre: null,
  preAmt: 0,
  dealHand: null,
  dealOrder: [],
  turnSeat: null,
  deadline: 0,
  turnTotal: 0,
  lastTick: 0,
  levelDeadline: null,
  drawerTab: 'chat',
  modal: null,
  watching: false,
  pendingSeat: null,
  welcomed: false,
  titleFlash: null,
};

const net = new Net({
  onOpen() {
    const name = store.get('name', '');
    net.send({ t: 'hello', token: getToken(), name: name || undefined, avatar: store.get('avatar', undefined) });
  },
  onMessage(m) {
    switch (m.t) {
      case 'welcome': onWelcome(m); break;
      case 'state': onState(m.state, m.events || []); break;
      case 'error': toast(m.text, 'err'); break;
      default:
    }
  },
  onStatus(online) {
    const c = $('conn');
    $('conn-text').textContent = online ? '연결됨' : '연결이 끊어졌어요. 다시 연결하는 중…';
    c.classList.toggle('show', !online);
  },
});

function send(obj) {
  if (!net.send(obj)) toast('서버와 연결되어 있지 않아요', 'err');
}

// ───────────────────────── 초기화 ─────────────────────────
function init() {
  document.body.className = `theme-${prefs.theme}` + (prefs.fourColor ? ' four-color' : '');
  sound.enabled = prefs.sound;
  $('btn-invite').innerHTML = icon('qr');
  $('btn-chat').insertAdjacentHTML('afterbegin', icon('chat'));
  $('btn-board').innerHTML = icon('trophy');
  $('btn-menu').innerHTML = icon('menu');
  $('drawer-close').innerHTML = icon('close');
  $('modal-close').innerHTML = icon('close');
  $('chat-send').innerHTML = icon('send', 18);
  $('btn-emote').innerHTML = icon('smile', 22);
  updateSoundBtn();

  $('btn-invite').onclick = openInvite;
  $('btn-chat').onclick = () => openDrawer('chat');
  $('btn-board').onclick = openScoreboard;
  $('btn-sound').onclick = toggleSound;
  $('btn-menu').onclick = openMenu;
  $('drawer-close').onclick = closeDrawer;
  $('scrim').onclick = closeDrawer;
  $('modal-close').onclick = closeModal;
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  $('menu').addEventListener('click', (e) => { if (e.target.id === 'menu') closeMenu(); });
  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => setTab(t.dataset.tab); });
  $('chat-form').onsubmit = (e) => {
    e.preventDefault();
    const v = $('chat-input').value.trim();
    if (!v) return;
    if (!S.state?.me) { toast('먼저 입장해주세요', 'err'); return; }
    send({ t: 'chat', text: v });
    $('chat-input').value = '';
  };

  // 이모트
  const pop = $('emote-pop');
  pop.innerHTML = EMOTES.map((e) => `<button data-e="${e}">${e}</button>`).join('');
  pop.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    send({ t: 'emote', emoji: b.dataset.e });
    pop.classList.remove('show');
  };
  $('btn-emote').onclick = (e) => { e.stopPropagation(); pop.classList.toggle('show'); };
  document.addEventListener('click', (e) => { if (!e.target.closest('#emote-pop') && !e.target.closest('#btn-emote')) pop.classList.remove('show'); });

  // 로비
  buildLobby();

  // 사운드 잠금 해제 + 화면 꺼짐 방지
  const unlock = () => { sound.unlock(); requestWakeLock(); };
  document.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { requestWakeLock(); stopTitleFlash(); }
  });

  document.addEventListener('keydown', onKey);
  new ResizeObserver(() => { if (S.state) { ensureLayout(); renderAll(null, []); } }).observe($('table-area'));

  ensureLayout();
  requestAnimationFrame(frame);
  net.connect(true);
  setTimeout(() => { if (!net.online) $('conn').classList.add('show'); }, 1500);
}

let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock && !document.hidden) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (_) { /* 보안 컨텍스트가 아니면 사용 불가 */ }
}

// ───────────────────────── 서버 메시지 ─────────────────────────
function onWelcome(m) {
  if (S.instance && m.instance && S.instance !== m.instance) {
    toast('서버가 새로 시작되어 테이블이 다시 열렸어요', 'gold');
  }
  S.instance = m.instance;
  S.hosted = !!m.hosted;
  S.you = m.you;
  S.urls = m.urls || [];
  S.log = m.log || [];
  S.chat = m.chat || [];
  S.welcomed = true;
  renderLogAll();
  renderChatAll();
  if (S.you) {
    hideLobby();
    if (S.pendingSeat !== null) {
      send({ t: 'sit', seat: S.pendingSeat });
      S.pendingSeat = null;
    }
  } else if (!S.watching) {
    showLobby();
  }
}

function onState(s, events) {
  const prev = S.state;
  const snap = snapshotBets();
  S.state = s;
  const prevHandId = prev?.hand?.id ?? null;
  const handId = s.hand?.id ?? null;
  for (const ev of events) {
    if (ev.k === 'newHand') {
      S.dealHand = ev.id;
      S.dealOrder = ev.order;
    }
  }
  if (handId !== prevHandId) {
    S.pre = null;
    S.raiseOpen = false;
    clearWinLabels();
  }
  if (s.hand && s.hand.toAct !== null) {
    S.turnSeat = s.hand.toAct;
    S.deadline = performance.now() + s.hand.turnLeft;
    S.turnTotal = s.hand.turnMs || 1;
  } else {
    S.turnSeat = null;
  }
  S.levelDeadline = s.nextLevelIn != null ? performance.now() + s.nextLevelIn : null;
  ensureLayout();
  renderAll(prev, events);
  for (const ev of events) handleEvent(ev, prev, s, snap);
  maybeAutoPre(s);
  if (S.modal && S.modal.live) S.modal.refresh();
}

// ───────────────────────── 레이아웃 ─────────────────────────
function ensureLayout() {
  const area = $('table-area');
  const W = area.clientWidth, H = area.clientHeight;
  if (!W || !H) return;
  const s = S.state;
  const n = s ? s.settings.maxSeats : 9;
  const my = s?.me?.seat ?? null;
  const key = `${W}x${H}:${n}:${my}`;
  if (key === S.layoutKey) return;
  S.layoutKey = key;
  const L = computeLayout(W, H, n, my !== null);
  S.layout = L;
  const t = $('table');
  Object.assign(t.style, { left: L.table.x + 'px', top: L.table.y + 'px', width: L.table.w + 'px', height: L.table.h + 'px' });
  const z = L.sizes;
  for (const [k, v] of Object.entries({ av: z.av, ocw: z.ocw, rcw: z.rcw, mcw: z.mcw, bw: z.bw, chip: z.chip, db: z.db, rail: z.rail })) {
    area.style.setProperty('--' + k, v + 'px');
  }
  $('fx').style.setProperty('--chip', z.chip + 'px');
  const c = $('center');
  c.style.left = L.center.x + 'px';
  c.style.top = L.center.y + 'px';
}

function viewIdx(seat) {
  const s = S.state;
  const n = s.settings.maxSeats;
  const my = s.me?.seat;
  return my == null ? seat : (seat - my + n) % n;
}
const seatPos = (seat) => S.layout.seats[viewIdx(seat)];

function areaPoint(p) {
  const r = $('table-area').getBoundingClientRect();
  return { x: r.left + p.x, y: r.top + p.y };
}
function deckPoint() {
  const L = S.layout;
  return areaPoint({ x: L.center.x, y: L.table.y + L.table.h * 0.2 });
}
function rectCenter(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// ───────────────────────── 렌더 ─────────────────────────
function renderAll(prev, events) {
  const s = S.state;
  if (!s || !S.layout) return;
  renderTopbar(s);
  renderSeats(s);
  renderBets(s, prev);
  renderDealer(s);
  renderBoard(s);
  renderPot(s);
  renderCenterMsg(s);
  renderControls(s);
  $('btn-emote').classList.toggle('hide', !s.me);
  updateLobbyCount(s);
}

function renderTopbar(s) {
  const hand = s.hand;
  $('tb-hand').textContent = hand ? `핸드 #${hand.number}` : s.started ? (s.paused ? '일시정지됨' : '다음 핸드 준비 중') : '대기 중';
  const b = hand ? { sb: hand.sb, bb: hand.bb } : s.blinds;
  $('tb-blinds').textContent = `${fmtShort(b.sb)} / ${fmtShort(b.bb)}`;
}

function hueOf(str) {
  let x = 0;
  for (const ch of String(str)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return x % 360;
}

function makeSeatEl(i) {
  const e = h('div', 'seat');
  e.dataset.seat = i;
  e.innerHTML = `
    <div class="s-cards"></div>
    <div class="s-av"><div class="s-face"></div><div class="s-ring"></div>
      <svg class="s-timer" viewBox="0 0 100 100"><circle class="t-bg" cx="50" cy="50" r="47"/><circle class="t-fg" cx="50" cy="50" r="47" stroke-dasharray="${CIRC}" stroke-dashoffset="0"/></svg>
      <div class="s-flag"></div></div>
    <div class="s-plate"><div class="s-name"></div><div class="s-stack"></div></div>
    <div class="s-tag"></div>
    <div class="s-win"></div>
    <button class="s-sit" aria-label="앉기"><b>+</b><span>앉기</span></button>`;
  e._cards = e.querySelector('.s-cards');
  e._face = e.querySelector('.s-face');
  e._name = e.querySelector('.s-name');
  e._stack = e.querySelector('.s-stack');
  e._flag = e.querySelector('.s-flag');
  e._tag = e.querySelector('.s-tag');
  e._win = e.querySelector('.s-win');
  e._tfg = e.querySelector('.t-fg');
  e.querySelector('.s-sit').onclick = () => clickSit(i);
  e.querySelector('.s-av').onclick = () => clickSeat(i);
  e.querySelector('.s-plate').onclick = () => clickSeat(i);
  $('seats').appendChild(e);
  S.seatEls[i] = e;
  return e;
}

function renderSeats(s) {
  const n = s.settings.maxSeats;
  for (let i = 0; i < 9; i++) {
    if (i >= n) {
      if (S.seatEls[i]) { S.seatEls[i].remove(); S.seatEls[i] = null; }
      continue;
    }
    renderSeat(s, i);
  }
}

function renderSeat(s, i) {
  const e = S.seatEls[i] || makeSeatEl(i);
  const p = seatPos(i);
  e.style.left = p.x + 'px';
  e.style.top = p.y + 'px';
  const seat = s.seats[i];
  const hand = s.hand;
  const isMe = !!(s.me && s.me.seat === i);
  if (!seat) {
    e.className = 'seat empty' + (!s.me || s.me.seat === null ? ' can-sit' : '');
    if (e._cards.children.length) e._cards.innerHTML = '';
    e._handId = null;
    e._pid = null;
    return;
  }
  e._pid = seat.id;
  const result = hand?.result;
  const winner = !!result?.winners?.some((w) => w.seat === i);
  const revealed = !isMe && seat.inHand && seat.cards?.length && seat.cards[0] !== 'XX';
  const cls = ['seat'];
  if (isMe) cls.push('me');
  if (hand && hand.toAct === i) cls.push('turn');
  if (seat.inHand && seat.folded) cls.push('folded');
  if (seat.allIn) cls.push('allin');
  if (winner) cls.push('winner');
  if (revealed) cls.push('revealed');
  if (seat.sittingOut) cls.push('away');
  if (!seat.connected) cls.push('offline');
  if (p.upper) cls.push('upper');
  e.className = cls.join(' ');

  if (e._face.textContent !== seat.avatar) e._face.textContent = seat.avatar;
  e._face.style.setProperty('--hue', hueOf(seat.id));

  // 이름 줄: 최근 행동이 있으면 행동 표시
  const last = seat.inHand && !result ? seat.last : null;
  let nameText = seat.name, nameCls = 's-name';
  const allInNow = seat.allIn && seat.chips === 0 && !result;
  if (last && ACTION_LABEL[last.type] && !allInNow) {
    nameText = ACTION_LABEL[last.type];
    nameCls += ' acted a-' + last.type;
  }
  if (e._name.textContent !== nameText || e._name.className !== nameCls) {
    e._name.textContent = nameText;
    e._name.className = nameCls;
  }
  e._stack.textContent = allInNow ? 'ALL IN' : fmt(seat.chips);
  e._stack.classList.toggle('allin-txt', allInNow);
  e._stack.classList.toggle('zero', seat.chips === 0 && !seat.inHand);

  let flag = '';
  if (!seat.connected) flag = '연결 끊김';
  else if (seat.leaving) flag = '나가는 중';
  else if (seat.sittingOut) flag = '자리비움';
  else if (seat.chips === 0 && !seat.inHand) flag = '칩 없음';
  e._flag.textContent = flag;
  e._flag.classList.toggle('show', !!flag);

  // 족보/승률 태그
  let tag = '', tagCls = 's-tag';
  const rh = result?.hands?.[i];
  if (rh && seat.inHand) {
    tag = rh.label.length > 8 && rh.name ? rh.name : rh.label;
    if (winner) tagCls += ' win';
  } else if (hand?.equity && hand.equity[i] != null && seat.inHand && !seat.folded) {
    tag = `${hand.equity[i]}%`;
    const max = Math.max(...Object.values(hand.equity));
    if (hand.equity[i] === max) tagCls += ' eq-lead';
  }
  if (e._tag.textContent !== tag || !e._tag.className.startsWith(tagCls)) {
    e._tag.textContent = tag;
    e._tag.className = tagCls + (tag ? ' show' : '');
    e._tag.style.marginLeft = '';
    if (tag) keepInView(e._tag);
  }

  renderSeatCards(s, e, seat, i, isMe);
}

function renderSeatCards(s, e, seat, i, isMe) {
  const hand = s.hand;
  const cont = e._cards;
  const hid = hand ? hand.id : null;
  const codes = hand && seat.inHand ? seat.cards || [] : [];
  if (e._handId !== hid) {
    if (cont.children.length) fadeOutChildren(cont);
    e._handId = hid;
  }
  const kids = [...cont.children].filter((c) => !c._leaving);
  if (!codes.length) {
    if (kids.length) {
      if (seat.folded && !isMe) foldAway(kids);
      else fadeOutChildren(cont);
    }
    return;
  }
  const dealing = hand.phase === 'dealing' && S.dealHand === hid;
  codes.forEach((code, k) => {
    let c = kids[k];
    if (!c) {
      const faceDown = code === 'XX' || dealing;
      c = cardEl(code, faceDown);
      c.classList.add('instant');
      cont.appendChild(c);
      if (dealing) {
        const idx = Math.max(0, S.dealOrder.indexOf(i));
        const delay = 120 + (k * S.dealOrder.length + idx) * 110;
        animateDeal(c, delay, code !== 'XX');
      }
    } else if (c.dataset.code !== code) {
      c.classList.remove('instant');
      setCardFace(c, code);
      if (code !== 'XX') {
        c.classList.add('down');
        void c.offsetWidth;
        requestAnimationFrame(() => c.classList.remove('down'));
      }
    }
  });
  // 하이라이트
  const rh = hand.result?.hands?.[i];
  const winner = hand.result?.winners?.some((w) => w.seat === i);
  const best = winner && rh ? rh.best : null;
  [...cont.children].forEach((c) => {
    c.classList.toggle('hl', !!best && best.includes(c.dataset.code));
  });
}

/** 화면 가장자리 좌석의 라벨이 잘리지 않도록 가로 위치 보정 */
function keepInView(el) {
  const r = el.getBoundingClientRect();
  const pad = 4;
  if (r.left < pad) el.style.marginLeft = `${pad - r.left}px`;
  else if (r.right > window.innerWidth - pad) el.style.marginLeft = `${window.innerWidth - pad - r.right}px`;
}

function fadeOutChildren(cont) {
  [...cont.children].forEach((c) => {
    if (c._leaving) return;
    c._leaving = true;
    const a = c.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.9)' }], { duration: 220, fill: 'forwards' });
    a.onfinish = () => c.remove();
  });
}

function foldAway(kids) {
  const to = deckPoint();
  kids.forEach((c, k) => {
    c._leaving = true;
    const from = rectCenter(c);
    const a = c.animate(
      [{ transform: 'none', opacity: 1 }, { transform: `translate(${(to.x - from.x) * 0.55}px, ${(to.y - from.y) * 0.55}px) rotate(${k ? 30 : -30}deg) scale(.6)`, opacity: 0 }],
      { duration: 420, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' },
    );
    a.onfinish = () => c.remove();
  });
}

function animateDeal(c, delay, flip) {
  const from = deckPoint();
  const to = rectCenter(c);
  const dx = from.x - to.x, dy = from.y - to.y;
  c.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) rotate(-120deg) scale(.5)`, opacity: 0 },
      { opacity: 1, offset: 0.2 },
      { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1 },
    ],
    { duration: 430, delay, easing: 'cubic-bezier(.15,.75,.25,1)', fill: 'backwards' },
  );
  setTimeout(() => sound.play('deal'), delay);
  if (flip) {
    setTimeout(() => {
      c.classList.remove('instant');
      c.classList.remove('down');
    }, delay + 470);
  }
}

// ── 베팅 칩 ──
function snapshotBets() {
  const snap = {};
  S.betEls.forEach((b, i) => {
    if (b && b.isConnected) snap[i] = { center: rectCenter(b.querySelector('.chips')), amount: b._amt };
  });
  return snap;
}

function renderBets(s, prev) {
  const n = s.settings.maxSeats;
  const sameHand = prev?.hand?.id === s.hand?.id;
  for (let i = 0; i < 9; i++) {
    const seat = i < n ? s.seats[i] : null;
    const amount = s.hand && seat?.inHand ? seat.bet || 0 : 0;
    let b = S.betEls[i];
    if (amount > 0) {
      const pos = seatPos(i).bet;
      if (!b) {
        b = h('div', 'bet');
        $('bets').appendChild(b);
        S.betEls[i] = b;
      }
      b.style.left = pos.x + 'px';
      b.style.top = pos.y + 'px';
      if (b._amt !== amount) {
        const grew = (b._amt || 0) < amount;
        b.innerHTML = '';
        b.appendChild(chipStack(amount, { max: 6 }));
        b.appendChild(h('span', 'amt', fmtShort(amount)));
        if (grew && (sameHand || s.hand?.phase === 'dealing')) {
          const sp = seatPos(i);
          const dx = sp.x - pos.x, dy = sp.y - pos.y;
          b.animate(
            [{ transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.5)`, opacity: 0.2 }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }],
            { duration: 340, easing: 'cubic-bezier(.2,.8,.3,1)' },
          );
        }
        b._amt = amount;
      }
    } else if (b) {
      b.remove();
      S.betEls[i] = null;
    }
  }
}

function renderDealer(s) {
  const d = $('dealer-btn');
  if (!s.hand || s.hand.dealer == null || s.hand.dealer >= s.settings.maxSeats) {
    if (!s.started) d.classList.remove('show');
    return;
  }
  const pos = seatPos(s.hand.dealer).dealer;
  d.style.left = pos.x + 'px';
  d.style.top = pos.y + 'px';
  d.classList.add('show');
}

// ── 보드 ──
function renderBoard(s) {
  const cont = $('board');
  if (!cont._slots) {
    cont._slots = [];
    for (let k = 0; k < 5; k++) {
      const sl = h('div', 'slot');
      cont.appendChild(sl);
      cont._slots.push(sl);
    }
    cont._count = 0;
    cont._hid = null;
  }
  const hand = s.hand;
  const hid = hand ? hand.id : null;
  const board = hand ? hand.board : [];
  if (cont._hid !== hid) {
    cont._slots.forEach((sl) => fadeOutChildren(sl));
    cont._hid = hid;
    cont._count = 0;
  }
  cont.classList.toggle('idle', !hand);
  if (board.length > cont._count) {
    const start = cont._count;
    for (let k = start; k < board.length; k++) {
      const c = cardEl(board[k], true);
      c.classList.add('instant');
      cont._slots[k].appendChild(c);
      const delay = (k - start) * 160;
      const from = deckPoint();
      const to = rectCenter(c);
      c.animate(
        [{ transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(.6)`, opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: 'none', opacity: 1 }],
        { duration: 380, delay, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' },
      );
      setTimeout(() => sound.play('deal'), delay);
      setTimeout(() => {
        c.classList.remove('instant');
        c.classList.remove('down');
        sound.play('flip');
      }, delay + 300 + (board.length - start === 3 ? 160 * (2 - (k - start)) : 0));
    }
    cont._count = board.length;
  } else if (board.length < cont._count) {
    cont._slots.forEach((sl) => (sl.innerHTML = ''));
    cont._count = 0;
  }
  // 승자 족보 하이라이트
  const res = hand?.result;
  let best = null;
  if (res && !res.byFold && res.winners?.length) {
    const rh = res.hands?.[res.winners[0].seat];
    if (rh) best = rh.best;
  }
  cont._slots.forEach((sl) => {
    const c = sl.querySelector('.card:not([data-leaving])');
    if (!c || c._leaving) return;
    c.classList.toggle('hl', !!best && best.includes(c.dataset.code));
    c.classList.toggle('dim', !!best && !best.includes(c.dataset.code));
  });
}

// ── 팟 ──
function renderPot(s) {
  const z = $('pot-zone');
  const hand = s.hand;
  if (!hand) {
    if (z._key !== 'none') { z.innerHTML = ''; z._key = 'none'; }
    return;
  }
  const res = hand.result;
  if (res) {
    const key = 'res:' + hand.id + ':' + res.winners.map((w) => w.seat + '/' + w.amount).join(',');
    if (z._key === key) return;
    z._key = key;
    z.innerHTML = '';
    const ws = res.winners;
    const me = s.me;
    const mine = me && ws.some((w) => w.seat === me.seat);
    let main, sub;
    if (ws.length === 1) {
      main = `${esc(ws[0].name)} 승리`;
      sub = res.byFold ? `+${fmt(ws[0].amount)}` : `${esc(ws[0].label)} · +${fmt(ws[0].amount)}`;
    } else {
      const sameHand = ws.every((w) => w.label === ws[0].label);
      main = sameHand && res.pots.length === 1 ? '스플릿 팟' : ws.map((w) => esc(w.name)).join(' · ') + ' 승리';
      sub = (sameHand && ws[0].label ? `${esc(ws[0].label)}<br>` : '') + ws.map((w) => `${esc(w.name)} +${fmt(w.amount)}`).join(' · ');
    }
    const r = h('div', 'result', `<div class="r-main">${mine ? '🏆 ' : ''}${main}</div><div class="r-sub">${sub}</div>`);
    z.appendChild(r);
    return;
  }
  const total = hand.potTotal;
  const collected = hand.pots.reduce((a, p) => a + p.amount, 0);
  const key = `pot:${total}:${hand.pots.map((p) => p.amount).join(',')}`;
  if (z._key === key) return;
  z._key = key;
  z.innerHTML = '';
  if (total <= 0) return;
  const pot = h('div', 'pot');
  if (collected > 0) pot.appendChild(chipStack(collected, { max: 5, cols: collected >= 2000 ? 3 : collected >= 200 ? 2 : 1 }));
  pot.appendChild(h('span', 'lbl', '팟'));
  pot.appendChild(h('span', 'val', fmt(total)));
  z.appendChild(pot);
  if (hand.pots.length > 1) {
    const sp = h('div', 'side-pots');
    hand.pots.forEach((p, k) => sp.appendChild(h('span', 'side-pot', `${k === 0 ? '메인' : '사이드 ' + k} ${fmtShort(p.amount)}`)));
    z.appendChild(sp);
  }
}

// ── 중앙 안내 ──
function renderCenterMsg(s) {
  const c = $('center-msg');
  let html = '';
  if (!s.hand) {
    const seated = s.seats.filter(Boolean).length;
    const me = s.me;
    const isHost = !!me?.isHost;
    if (s.gameOver && !s.started) {
      html = `<div class="cm-card"><div class="cm-title">🎉 ${esc(s.gameOver.avatar)} ${esc(s.gameOver.name)} 최종 우승!</div>
        <div class="cm-sub">칩 ${fmt(s.gameOver.chips)}개로 테이블을 정복했습니다</div>
        ${isHost ? '<button class="btn btn-gold" data-a="reset">새 게임 준비</button>' : ''}</div>`;
    } else if (!s.started) {
      const ready = s.eligibleCount >= 2;
      const title = ready ? '준비 완료!' : '플레이어를 기다리는 중';
      let sub = `${seated}명 착석${ready ? '' : ' · 최소 2명이 필요해요'}`;
      if (ready && !isHost) sub += `<br>호스트 <b>${esc(s.hostName)}</b> 님이 곧 게임을 시작합니다`;
      if (!me || me.seat === null) sub += '<br>빈 자리를 눌러 앉으세요';
      html = `<div class="cm-card"><div class="cm-title">${title}</div><div class="cm-sub">${sub}</div>
        ${isHost && ready ? '<button class="btn btn-gold" data-a="start">' + icon('play', 16) + ' 게임 시작</button>' : ''}
        ${!ready || !isHost ? '<button class="btn btn-sm" data-a="invite">' + icon('qr', 15) + ' 친구 초대</button>' : ''}</div>`;
    } else if (s.paused) {
      html = `<div class="cm-card"><div class="cm-title">일시정지</div><div class="cm-sub">호스트가 게임을 잠시 멈췄어요</div>
        ${isHost ? '<button class="btn btn-gold" data-a="resume">' + icon('play', 16) + ' 재개</button>' : ''}</div>`;
    } else if (s.eligibleCount < 2) {
      html = `<div class="cm-card"><div class="cm-title dots">다른 플레이어를 기다리는 중</div><div class="cm-sub">2명 이상 앉으면 자동으로 다음 핸드가 시작됩니다</div>
        <button class="btn btn-sm" data-a="invite">${icon('qr', 15)} 친구 초대</button></div>`;
    }
  }
  if (c._html !== html) {
    c._html = html;
    c.innerHTML = html;
    c.classList.toggle('show', !!html);
    c.querySelectorAll('[data-a]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'start') send({ t: 'start' });
        else if (a === 'resume') send({ t: 'pause', value: false });
        else if (a === 'invite') openInvite();
        else if (a === 'reset') send({ t: 'reset' });
      };
    });
  }
  $('board').style.display = !s.hand && html ? 'none' : '';
}

// ───────────────────────── 컨트롤 ─────────────────────────
function controlMode(s) {
  const me = s.me;
  const hand = s.hand;
  if (!me) return 'guest';
  if (me.seat === null) return 'spectator';
  if (me.actions) return 'act';
  if (hand && me.inHand && !hand.result && !me.folded && !me.allIn) return 'pre';
  return 'info';
}

function renderControls(s) {
  const me = s.me;
  const mh = $('my-hand');
  if (me && me.inHand && me.hand && !me.folded && me.hand.label) {
    const t = `<small>내 패</small>${esc(me.hand.label)}`;
    if (mh._t !== t) { mh.innerHTML = t; mh._t = t; }
    mh.classList.add('show');
  } else {
    mh.classList.remove('show');
  }
  const mode = controlMode(s);
  if (mode !== 'act') S.raiseOpen = false;
  const body = $('ctl-body');
  if (mode !== S.ctlMode) {
    S.ctlMode = mode;
    body.innerHTML = '';
    S.ctl = { act: buildAct, pre: buildPre }[mode]?.() || buildInfo();
    body.appendChild(S.ctl.root);
  }
  S.ctl.update(s);
  $('controls').classList.toggle('raising', !!S.raiseOpen);
}

function snapRaise(v, a) {
  const step = Math.max(1, Math.round(a.bb / 2));
  let x = Math.round(v / step) * step;
  if (v >= a.maxRaiseTo) x = a.maxRaiseTo;
  return Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, x));
}

function presetValue(k, a) {
  const potAfterCall = a.pot + a.toCall;
  switch (k) {
    case 'min': return a.minRaiseTo;
    case 'half': return a.currentBet + Math.round(potAfterCall * 0.5);
    case 'tq': return a.currentBet + Math.round(potAfterCall * 0.75);
    case 'pot': return a.currentBet + potAfterCall;
    case 'max': return a.maxRaiseTo;
    default: return a.minRaiseTo;
  }
}

function buildAct() {
  const root = h('div', 'ctl-act');
  const panel = h('div', 'raise-panel');
  panel.innerHTML = `
    <div class="presets">${[['min', '최소'], ['half', '½ 팟'], ['tq', '¾ 팟'], ['pot', '팟'], ['max', '올인']].map(([k, l]) => `<button data-p="${k}">${l}</button>`).join('')}</div>
    <div class="slider-row">
      <button class="step" data-d="-1" aria-label="줄이기">−</button>
      <input type="range" class="slider" aria-label="베팅 금액">
      <input class="raise-amt" inputmode="numeric" aria-label="금액 입력">
      <button class="step" data-d="1" aria-label="늘리기">+</button>
    </div>`;
  const row = h('div', 'btn-row');
  const bFold = h('button', 'act fold');
  const bCall = h('button', 'act call');
  const bRaise = h('button', 'act raise');
  row.append(bFold, bCall, bRaise);
  root.append(panel, row);
  const slider = panel.querySelector('.slider');
  const amt = panel.querySelector('.raise-amt');
  const A = () => S.state?.me?.actions;

  const setVal = (v) => {
    const a = A();
    if (!a) return;
    S.raiseValue = snapRaise(v, a);
    api.update(S.state);
  };
  const refresh = () => renderControls(S.state);
  bFold.onclick = () => {
    if (S.raiseOpen) { S.raiseOpen = false; refresh(); return; }
    act('fold');
  };
  bCall.onclick = () => {
    const a = A();
    if (!a) return;
    act(a.canCheck ? 'check' : 'call');
  };
  bRaise.onclick = () => {
    const a = A();
    if (!a || !a.canRaise) return;
    if (a.minRaiseTo >= a.maxRaiseTo) { act('allin'); return; }
    if (!S.raiseOpen) {
      S.raiseOpen = true;
      if (!S.raiseValue || S.raiseValue < a.minRaiseTo || S.raiseValue > a.maxRaiseTo) S.raiseValue = a.minRaiseTo;
      refresh();
      return;
    }
    if (S.raiseValue >= a.maxRaiseTo) act('allin');
    else act('raise', S.raiseValue);
  };
  panel.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { const a = A(); if (a) setVal(presetValue(b.dataset.p, a)); }; });
  panel.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => { const a = A(); if (a) setVal(S.raiseValue + Number(b.dataset.d) * a.bb); }; });
  slider.oninput = () => {
    const a = A();
    if (!a) return;
    // 비선형 슬라이더: 작은 금액 구간을 더 세밀하게
    const t = Number(slider.value) / 1000;
    const v = a.minRaiseTo + (a.maxRaiseTo - a.minRaiseTo) * Math.pow(t, 1.8);
    setVal(t >= 0.999 ? a.maxRaiseTo : v);
  };
  amt.onfocus = () => amt.select();
  amt.onchange = () => {
    const v = Number(String(amt.value).replace(/[^0-9]/g, ''));
    if (v) setVal(v);
  };
  amt.onkeydown = (e) => { if (e.key === 'Enter') { amt.blur(); amt.onchange(); } };

  const api = {
    root,
    update(s) {
      const a = s.me?.actions;
      if (!a) return;
      const key = `${s.hand.id}:${s.hand.street}:${a.currentBet}:${a.myBet}`;
      if (key !== S.actKey) {
        S.actKey = key;
        S.raiseOpen = false;
        S.raiseValue = a.minRaiseTo;
      }
      const onlyAllIn = a.canRaise && a.minRaiseTo >= a.maxRaiseTo;
      panel.hidden = !S.raiseOpen;
      panel.style.display = S.raiseOpen ? '' : 'none';
      // 폴드/취소
      bFold.className = 'act ' + (S.raiseOpen ? 'cancel' : 'fold');
      bFold.innerHTML = S.raiseOpen ? '취소' : '폴드<kbd>F</kbd>';
      // 체크/콜
      if (a.canCheck) {
        bCall.className = 'act check';
        bCall.innerHTML = '체크<kbd>C</kbd>';
      } else {
        const allInCall = a.callAmount >= a.chips;
        bCall.className = 'act ' + (allInCall ? 'allin' : 'call');
        bCall.innerHTML = `${allInCall ? '올인 콜' : '콜'}<small>${fmt(a.callAmount)}</small><kbd>C</kbd>`;
      }
      // 레이즈
      bRaise.style.display = a.canRaise ? '' : 'none';
      const word = a.isBet ? '벳' : '레이즈';
      if (onlyAllIn) {
        bRaise.className = 'act allin';
        bRaise.innerHTML = `올인<small>${fmt(a.maxRaiseTo)}</small>`;
      } else if (S.raiseOpen) {
        const all = S.raiseValue >= a.maxRaiseTo;
        bRaise.className = 'act ' + (all ? 'allin' : 'raise');
        bRaise.innerHTML = `${all ? '올인' : word} 확인<small>${fmt(S.raiseValue)}</small><kbd>↵</kbd>`;
      } else {
        bRaise.className = 'act raise';
        bRaise.innerHTML = `${word}<small>${fmt(a.minRaiseTo)}+</small><kbd>R</kbd>`;
      }
      if (S.raiseOpen) {
        const range = a.maxRaiseTo - a.minRaiseTo || 1;
        const t = Math.pow(Math.max(0, (S.raiseValue - a.minRaiseTo) / range), 1 / 1.8);
        slider.min = 0;
        slider.max = 1000;
        slider.value = Math.round(t * 1000);
        slider.style.setProperty('--p', t * 100 + '%');
        if (document.activeElement !== amt) amt.value = fmt(S.raiseValue);
        panel.querySelectorAll('[data-p]').forEach((b) => {
          const v = snapRaise(presetValue(b.dataset.p, a), a);
          b.classList.toggle('on', v === S.raiseValue);
          b.disabled = b.dataset.p !== 'max' && b.dataset.p !== 'min' && presetValue(b.dataset.p, a) >= a.maxRaiseTo && v === a.maxRaiseTo && b.dataset.p !== 'pot';
        });
      }
    },
  };
  return api;
}

function act(action, amount) {
  sound.unlock();
  S.raiseOpen = false;
  send({ t: 'act', action, amount });
}

function buildPre() {
  const root = h('div', 'pre-row');
  const mk = (k) => {
    const b = h('button', 'pre');
    b.dataset.k = k;
    b.onclick = () => {
      if (S.pre === k) S.pre = null;
      else {
        S.pre = k;
        S.preAmt = S.state?.me?.toCall || 0;
      }
      api.update(S.state);
    };
    root.appendChild(b);
    return b;
  };
  const bCf = mk('cf'), bCall = mk('call'), bAny = mk('any');
  const api = {
    root,
    update(s) {
      const toCall = s.me?.toCall || 0;
      if (S.pre === 'call' && S.preAmt !== toCall) S.pre = null;
      bCf.innerHTML = `<span class="box"></span>${toCall > 0 ? '폴드' : '체크/폴드'}`;
      bCall.innerHTML = `<span class="box"></span>${toCall > 0 ? `콜 ${fmtShort(Math.min(toCall, s.me.chips))}` : '체크'}`;
      bAny.innerHTML = '<span class="box"></span>콜 애니';
      [bCf, bCall, bAny].forEach((b) => b.classList.toggle('on', S.pre === b.dataset.k));
    },
  };
  return api;
}

function buildInfo() {
  const root = h('div', 'info-row');
  const api = {
    root,
    update(s) {
      const me = s.me;
      let html = '';
      if (!me) {
        html = '<span class="info-text">관전 중입니다</span><button class="btn btn-gold btn-sm" data-a="join">참여하기</button>';
      } else if (me.seat === null) {
        html = '<span class="info-text">빈 자리(<b>+</b>)를 눌러 게임에 참여하세요</span><button class="btn btn-sm" data-a="invite">친구 초대</button>';
      } else if (me.busted) {
        html = s.settings.allowRebuy
          ? `<span class="info-text">칩을 모두 잃었어요 😢</span><button class="btn btn-gold btn-sm" data-a="rebuy">리바이 ${fmt(s.settings.startingStack)}</button><button class="btn btn-sm" data-a="stand">일어나기</button>`
          : '<span class="info-text">탈락했습니다. 관전을 즐겨주세요!</span>';
      } else if (me.sittingOut) {
        html = '<span class="info-text">자리비움 중 — 핸드에 참여하지 않습니다</span><button class="btn btn-green btn-sm" data-a="back">게임 복귀</button>';
      } else if (s.hand && me.inHand && s.hand.result) {
        const w = s.hand.result.winners.find((x) => x.seat === me.seat);
        const msg = w ? `<span class="info-text">🏆 <b style="color:var(--gold)">+${fmt(w.amount)}</b> 획득!</span>` : '<span class="info-text">다음 핸드가 곧 시작됩니다</span>';
        html = msg + (!me.shown ? `<button class="btn btn-sm" data-a="show">${icon('cards', 15)} 내 카드 공개</button>` : '');
      } else if (s.hand && me.inHand && me.folded) {
        html = '<span class="info-text dots">폴드했습니다. 다음 핸드를 기다리는 중</span>';
      } else if (s.hand && me.inHand && me.allIn) {
        html = '<span class="info-text">🔥 올인! 결과를 기다리는 중…</span>';
      } else if (s.hand && !me.inHand) {
        html = '<span class="info-text dots">다음 핸드부터 참여합니다</span>';
      } else if (!s.started) {
        html = me.isHost
          ? (s.eligibleCount >= 2 ? `<button class="btn btn-gold" data-a="start">${icon('play', 16)} 게임 시작</button><button class="btn btn-sm" data-a="settings">${icon('sliders', 15)} 설정</button>`
            : `<span class="info-text">친구들을 초대해 보세요</span><button class="btn btn-sm" data-a="invite">${icon('qr', 15)} 초대</button><button class="btn btn-sm" data-a="settings">${icon('sliders', 15)} 설정</button>`)
          : `<span class="info-text dots">호스트 <b>${esc(s.hostName)}</b> 님을 기다리는 중</span>`;
      } else if (s.paused) {
        html = '<span class="info-text">일시정지됨</span>' + (me.isHost ? `<button class="btn btn-gold btn-sm" data-a="resume">${icon('play', 15)} 재개</button>` : '');
      } else {
        html = '<span class="info-text dots">다음 핸드 준비 중</span>';
      }
      if (root._html === html) return;
      root._html = html;
      root.innerHTML = html;
      root.querySelectorAll('[data-a]').forEach((b) => {
        b.onclick = () => {
          const a = b.dataset.a;
          if (a === 'join') { S.watching = false; showLobby(); }
          else if (a === 'invite') openInvite();
          else if (a === 'rebuy') send({ t: 'rebuy' });
          else if (a === 'stand') send({ t: 'stand' });
          else if (a === 'back') send({ t: 'sitout', value: false });
          else if (a === 'show') send({ t: 'show' });
          else if (a === 'start') send({ t: 'start' });
          else if (a === 'resume') send({ t: 'pause', value: false });
          else if (a === 'settings') openSettings();
        };
      });
    },
  };
  return api;
}

function maybeAutoPre(s) {
  const a = s.me?.actions;
  if (!a || !S.pre) return;
  const p = S.pre;
  S.pre = null;
  let action = null;
  if (p === 'cf') action = a.canCheck ? 'check' : 'fold';
  else if (p === 'call') action = a.canCheck ? 'check' : a.toCall === S.preAmt ? 'call' : null;
  else if (p === 'any') action = a.canCheck ? 'check' : 'call';
  if (!action) return;
  const hid = s.hand.id;
  setTimeout(() => {
    if (S.state?.hand?.id === hid && S.state.me?.actions) send({ t: 'act', action });
  }, 280);
}

// ───────────────────────── 이벤트 효과 ─────────────────────────
function handleEvent(ev, prev, s, snap) {
  const mySeat = s.me?.seat ?? null;
  switch (ev.k) {
    case 'newHand':
      sound.play('shuffle');
      break;
    case 'action':
      if (ev.type === 'fold') sound.play('fold');
      else if (ev.type === 'check') sound.play('check');
      else if (ev.type === 'call') sound.play('chip');
      else if (ev.type === 'allin') sound.play('allin');
      else sound.play('chips');
      if (ev.auto && ev.seat === mySeat && ev.type !== 'fold' && ev.type !== 'check') break;
      if (ev.auto && ev.seat === mySeat) toast(`시간 초과로 자동 ${ACTION_LABEL[ev.type]} 되었어요`, 'err');
      break;
    case 'collect':
      flyBetsToPot(snap, ev.from);
      break;
    case 'reveal':
      sound.play('flip');
      break;
    case 'show':
      sound.play('flip');
      break;
    case 'win':
      winFx(ev, s);
      break;
    case 'turn':
      if (ev.seat === mySeat) {
        sound.play('turn');
        vibrate(70);
        if (document.hidden) startTitleFlash();
      }
      break;
    case 'chat':
      onChat(ev.msg);
      break;
    case 'emote':
      showEmote(ev.seat, ev.emoji);
      break;
    case 'log':
      appendLog(ev.entry);
      break;
    case 'sit':
      sound.play('join');
      break;
    case 'blindUp':
      toast(`⏫ 블라인드 상승! ${fmt(ev.sb)} / ${fmt(ev.bb)}`, 'gold');
      break;
    case 'start':
      toast('🃏 게임 시작! 행운을 빕니다', 'gold');
      break;
    case 'gameOver':
      openGameOver(ev.winner);
      break;
    case 'settings':
      if (!s.me?.isHost) toast('호스트가 게임 설정을 변경했어요');
      break;
    default:
  }
}

function fly(node, from, to, { duration = 520, delay = 0, easing = 'cubic-bezier(.45,.05,.3,1)', fade = true, scale = 1 } = {}) {
  $('fx').appendChild(node);
  const w = node.offsetWidth, hh = node.offsetHeight;
  const frames = [
    { transform: `translate(${from.x - w / 2}px, ${from.y - hh / 2}px) scale(1)`, opacity: 1 },
    { transform: `translate(${to.x - w / 2}px, ${to.y - hh / 2}px) scale(${scale})`, opacity: fade ? 0.85 : 1, offset: 0.85 },
    { transform: `translate(${to.x - w / 2}px, ${to.y - hh / 2}px) scale(${scale})`, opacity: fade ? 0 : 1 },
  ];
  const a = node.animate(frames, { duration, delay, easing, fill: 'both' });
  a.onfinish = () => node.remove();
  return a;
}

function potCenter() {
  const z = $('pot-zone');
  const r = z.getBoundingClientRect();
  if (r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  return areaPoint(S.layout.center);
}

function flyBetsToPot(snap, seats) {
  const to = potCenter();
  let any = false;
  for (const seat of seats || []) {
    const sn = snap[seat];
    if (!sn) continue;
    any = true;
    fly(chipStack(sn.amount, { max: 6 }), sn.center, to, { duration: 480, delay: 60 });
  }
  if (any) sound.play('collect');
}

function winFx(ev, s) {
  const me = s.me;
  const mine = me && ev.winners.some((w) => w.seat === me.seat);
  const delay = ev.byFold ? 380 : 1100;
  const from = potCenter();
  ev.winners.forEach((w, k) => {
    const e = S.seatEls[w.seat];
    if (!e) return;
    const to = rectCenter(e.querySelector('.s-av'));
    setTimeout(() => {
      fly(chipStack(w.amount, { max: 6, cols: 2 }), from, to, { duration: 700, easing: 'cubic-bezier(.3,.1,.2,1)' });
      setTimeout(() => {
        e._win.textContent = `+${fmt(w.amount)}`;
        e._win.classList.remove('show');
        void e._win.offsetWidth;
        e._win.classList.add('show');
        if (me && w.seat === me.seat) sparkle(to, 22);
        else sparkle(to, 8);
      }, 620);
    }, delay + k * 220);
  });
  setTimeout(() => sound.play(mine ? 'win' : 'chips'), delay + 500);
  if (mine) setTimeout(() => vibrate([40, 60, 40]), delay + 500);
}

function clearWinLabels() {
  S.seatEls.forEach((e) => e && e._win.classList.remove('show'));
}

function sparkle(at, n) {
  for (let i = 0; i < n; i++) {
    const sp = h('i', 'spark');
    const ang = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 70;
    const to = { x: at.x + Math.cos(ang) * dist, y: at.y + Math.sin(ang) * dist - 20 };
    fly(sp, at, to, { duration: 700 + Math.random() * 500, easing: 'cubic-bezier(.1,.7,.3,1)', scale: 0.4 });
  }
}

function showEmote(seat, emoji) {
  if (seat == null) return;
  const e = S.seatEls[seat];
  if (!e) return;
  const em = h('div', 's-emote', emoji);
  e.appendChild(em);
  setTimeout(() => em.remove(), 2000);
}

function showBubble(seat, text) {
  if (seat == null) return;
  const e = S.seatEls[seat];
  if (!e || e.classList.contains('empty')) return;
  e.querySelectorAll('.s-bubble').forEach((b) => b.remove());
  const b = h('div', 's-bubble');
  b.textContent = text;
  e.appendChild(b);
  setTimeout(() => b.remove(), 4300);
}

function vibrate(p) {
  try { if (navigator.vibrate) navigator.vibrate(p); } catch (_) { /* */ }
}

function startTitleFlash() {
  if (S.titleFlash) return;
  let on = false;
  S.titleFlash = setInterval(() => {
    on = !on;
    document.title = on ? '🔔 내 차례예요!' : 'Piku Poker';
    if (!document.hidden || !S.state?.me?.actions) stopTitleFlash();
  }, 900);
}
function stopTitleFlash() {
  clearInterval(S.titleFlash);
  S.titleFlash = null;
  document.title = 'Piku Poker';
}

// ───────────────────────── 타이머 루프 ─────────────────────────
let lastLevelText = '';
function frame() {
  const s = S.state;
  if (s && S.turnSeat !== null) {
    const e = S.seatEls[S.turnSeat];
    const left = Math.max(0, S.deadline - performance.now());
    const frac = Math.min(1, left / S.turnTotal);
    if (e && e._tfg) {
      e._tfg.style.strokeDashoffset = String(CIRC * (1 - frac));
      const hue = Math.max(0, Math.min(130, frac * 150 - 15));
      e._tfg.style.stroke = `hsl(${hue} 90% 55%)`;
      e._tfg.style.color = `hsl(${hue} 90% 55%)`;
    }
    if (s.me && s.me.seat === S.turnSeat && s.me.actions) {
      const secs = Math.ceil(left / 1000);
      if (secs <= 5 && secs > 0 && secs !== S.lastTick) {
        S.lastTick = secs;
        sound.play('tick');
        if (secs === 5) vibrate(40);
      }
    }
  }
  let lv = '';
  if (S.levelDeadline != null && s?.nextBlinds) {
    const ms = Math.max(0, S.levelDeadline - performance.now());
    const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000);
    lv = `↑ ${m}:${String(sec).padStart(2, '0')}`;
  }
  if (lv !== lastLevelText) {
    lastLevelText = lv;
    $('tb-level').textContent = lv;
    $('tb-level').title = s?.nextBlinds ? `다음 블라인드 ${fmt(s.nextBlinds.sb)} / ${fmt(s.nextBlinds.bb)}` : '';
  }
  requestAnimationFrame(frame);
}

// ───────────────────────── 좌석 클릭 ─────────────────────────
function clickSit(i) {
  sound.unlock();
  const s = S.state;
  if (!s) return;
  if (!s.me) {
    S.pendingSeat = i;
    S.watching = false;
    showLobby();
    return;
  }
  if (s.me.seat !== null) {
    if (!s.me.inHand) send({ t: 'sit', seat: i });
    return;
  }
  send({ t: 'sit', seat: i });
}

function clickSeat(i) {
  const s = S.state;
  const seat = s?.seats[i];
  if (!seat || !s.me) return;
  const isMe = s.me.seat === i;
  const items = [];
  if (isMe) {
    items.push({ ic: 'coffee', label: s.me.sittingOut ? '게임 복귀' : '자리비움', fn: () => send({ t: 'sitout', value: !s.me.sittingOut }) });
    items.push({ ic: 'user', label: '프로필 변경', fn: openProfile });
    items.push({ ic: 'exit', label: '자리에서 일어나기', danger: true, fn: confirmStand });
  } else {
    items.push({ head: `${seat.avatar} ${seat.name}` });
    items.push({ ic: 'smile', label: '이모티콘 보내기', fn: () => $('emote-pop').classList.add('show') });
    if (s.me.isHost) {
      items.push({ ic: 'crown', label: '호스트 넘기기', fn: () => send({ t: 'host', id: seat.id }) });
      items.push({ ic: 'exit', label: '자리에서 내보내기', danger: true, fn: () => send({ t: 'kick', id: seat.id }) });
    }
  }
  openSheet(items);
}

function confirmStand() {
  const s = S.state;
  if (s.me?.inHand && !s.me.folded && !s.hand?.result) {
    openModal('자리에서 일어날까요?', (body) => {
      body.innerHTML = `<p class="hint" style="font-size:14px">진행 중인 핸드는 폴드 처리됩니다. 남은 칩은 보관되어 다시 앉으면 돌아옵니다.</p>
        <div class="modal-actions"><button class="btn" data-x>취소</button><button class="btn btn-red" data-ok>일어나기</button></div>`;
      body.querySelector('[data-x]').onclick = closeModal;
      body.querySelector('[data-ok]').onclick = () => { send({ t: 'stand' }); closeModal(); };
    });
  } else {
    send({ t: 'stand' });
  }
}

// ───────────────────────── 키보드 ─────────────────────────
function onKey(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  if (e.key === 'Escape') {
    if (S.modal) closeModal();
    else if ($('drawer').classList.contains('open')) closeDrawer();
    else if (S.raiseOpen) { S.raiseOpen = false; renderControls(S.state); }
    closeMenu();
    return;
  }
  if (tag === 'input' || tag === 'textarea' || S.modal) return;
  const a = S.state?.me?.actions;
  const k = e.key.toLowerCase();
  if (a) {
    if (k === 'f') { act('fold'); e.preventDefault(); }
    else if (k === 'c' || k === ' ') { act(a.canCheck ? 'check' : 'call'); e.preventDefault(); }
    else if (k === 'r' || k === 'enter') {
      const btn = document.querySelector('.act.raise, .act.allin:last-child');
      if (btn && btn.style.display !== 'none') btn.click();
      e.preventDefault();
    } else if ((k === 'arrowup' || k === 'arrowdown') && S.raiseOpen) {
      S.raiseValue = snapRaise(S.raiseValue + (k === 'arrowup' ? 1 : -1) * a.bb, a);
      renderControls(S.state);
      e.preventDefault();
    }
  }
  if (k === 't' && !a) openDrawer('chat');
}

// ───────────────────────── 채팅 / 기록 ─────────────────────────
function openDrawer(tab) {
  setTab(tab || S.drawerTab);
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
  $('scrim').classList.add('show');
  if (S.drawerTab === 'chat') {
    S.unread = 0;
    updateBadge();
    setTimeout(() => { if (window.innerWidth > 700) $('chat-input').focus(); }, 250);
  }
}
function closeDrawer() {
  $('drawer').classList.remove('open');
  $('drawer').setAttribute('aria-hidden', 'true');
  $('scrim').classList.remove('show');
  $('chat-input').blur();
}
function setTab(tab) {
  S.drawerTab = tab;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
  $('pane-chat').classList.toggle('on', tab === 'chat');
  $('pane-log').classList.toggle('on', tab === 'log');
  $('chat-form').style.display = tab === 'chat' ? '' : 'none';
  if (tab === 'chat') { S.unread = 0; updateBadge(); }
  const pane = tab === 'chat' ? $('pane-chat') : $('pane-log');
  requestAnimationFrame(() => { pane.scrollTop = pane.scrollHeight; });
}
function updateBadge() {
  const b = $('chat-badge');
  b.textContent = S.unread > 9 ? '9+' : String(S.unread);
  b.classList.toggle('show', S.unread > 0);
}
const timeStr = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

function chatEl(m) {
  const mine = S.state?.me && m.id === S.state.me.id;
  const e = h('div', 'msg' + (mine ? ' mine' : ''));
  e.innerHTML = `<div class="m-av">${esc(m.avatar)}</div><div><div class="m-name">${esc(m.name)}<time>${timeStr(m.t)}</time></div><div class="m-text"></div></div>`;
  e.querySelector('.m-text').textContent = m.text;
  return e;
}
function renderChatAll() {
  const list = $('chat-list');
  list.innerHTML = '';
  if (!S.chat.length) list.appendChild(h('div', 'empty-note', '아직 메시지가 없어요.<br>먼저 인사해 보세요 👋'));
  S.chat.forEach((m) => list.appendChild(chatEl(m)));
}
function onChat(m) {
  S.chat.push(m);
  const list = $('chat-list');
  list.querySelector('.empty-note')?.remove();
  list.appendChild(chatEl(m));
  const pane = $('pane-chat');
  pane.scrollTop = pane.scrollHeight;
  if (m.seat != null) showBubble(m.seat, m.text);
  const mine = S.state?.me && m.id === S.state.me.id;
  const open = $('drawer').classList.contains('open') && S.drawerTab === 'chat';
  if (!mine && !open) {
    S.unread++;
    updateBadge();
    sound.play('pop');
  }
}
function logEl(l) {
  const e = h('div', 'log-item k-' + l.kind);
  e.innerHTML = `<time>${timeStr(l.t)}</time><span></span>`;
  e.querySelector('span').textContent = l.text;
  return e;
}
function renderLogAll() {
  const list = $('log-list');
  list.innerHTML = '';
  S.log.forEach((l) => list.appendChild(logEl(l)));
}
function appendLog(l) {
  S.log.push(l);
  const list = $('log-list');
  list.appendChild(logEl(l));
  while (list.children.length > 250) list.firstChild.remove();
  const pane = $('pane-log');
  if (pane.scrollHeight - pane.scrollTop - pane.clientHeight < 120) pane.scrollTop = pane.scrollHeight;
}

// ───────────────────────── 모달 ─────────────────────────
function openModal(title, build, { wide = false, live = false } = {}) {
  closeMenu();
  $('modal-title').textContent = title;
  const body = $('modal-body');
  body.innerHTML = '';
  document.querySelector('.modal').classList.toggle('wide', wide);
  S.modal = { live, refresh: () => build(body, true) };
  build(body, false);
  $('modal').classList.add('open');
  $('modal').setAttribute('aria-hidden', 'false');
}
function closeModal() {
  $('modal').classList.remove('open');
  $('modal').setAttribute('aria-hidden', 'true');
  S.modal = null;
}

function openSheet(items) {
  const sh = $('menu-sheet');
  sh.innerHTML = '';
  for (const it of items) {
    if (it.sep) { sh.appendChild(h('div', 'mi-sep')); continue; }
    if (it.head) { sh.appendChild(h('div', 'mi-label', esc(it.head))); continue; }
    const b = h('button', 'mi' + (it.danger ? ' danger' : ''));
    b.innerHTML = `${it.ic ? icon(it.ic, 18) : ''}<span>${esc(it.label)}</span>${it.toggle !== undefined ? `<span class="toggle${it.toggle ? ' on' : ''}"></span>` : it.right ? `<span class="mi-r">${esc(it.right)}</span>` : ''}`;
    b.onclick = () => {
      if (it.keep) { it.fn(b); return; }
      closeMenu();
      it.fn();
    };
    sh.appendChild(b);
  }
  $('menu').classList.add('open');
}
function closeMenu() { $('menu').classList.remove('open'); }

function openMenu() {
  const s = S.state;
  const me = s?.me;
  const items = [];
  if (me && me.seat !== null) {
    items.push({ ic: 'coffee', label: me.sittingOut ? '게임 복귀' : '자리비움', fn: () => send({ t: 'sitout', value: !me.sittingOut }) });
    items.push({ ic: 'exit', label: '자리에서 일어나기', fn: confirmStand });
    items.push({ sep: true });
  }
  if (me) items.push({ ic: 'user', label: '프로필 변경', right: `${me.avatar} ${me.name}`, fn: openProfile });
  else items.push({ ic: 'user', label: '게임 참여하기', fn: () => { S.watching = false; showLobby(); } });
  items.push({ ic: 'trophy', label: '순위표', fn: openScoreboard });
  items.push({ ic: 'help', label: '족보 & 게임 방법', fn: openHelp });
  items.push({ sep: true });
  items.push({ ic: prefs.sound ? 'vol' : 'mute', label: '사운드', toggle: prefs.sound, keep: true, fn: (b) => { toggleSound(); b.querySelector('.toggle').classList.toggle('on', prefs.sound); } });
  items.push({ ic: 'cards', label: '4색 카드', toggle: prefs.fourColor, keep: true, fn: (b) => { toggleFourColor(); b.querySelector('.toggle').classList.toggle('on', prefs.fourColor); } });
  items.push({ ic: 'palette', label: '테이블 색상', right: themeName(prefs.theme), keep: true, fn: (b) => { cycleTheme(); b.querySelector('.mi-r').textContent = themeName(prefs.theme); } });
  if (me?.isHost) {
    items.push({ sep: true });
    items.push({ head: '호스트' });
    items.push({ ic: 'sliders', label: '게임 설정', fn: openSettings });
    if (s.started) items.push({ ic: s.paused ? 'play' : 'pause', label: s.paused ? '게임 재개' : '일시정지 (핸드 종료 후)', fn: () => send({ t: 'pause', value: !s.paused }) });
    else if (s.eligibleCount >= 2) items.push({ ic: 'play', label: '게임 시작', fn: () => send({ t: 'start' }) });
    items.push({ ic: 'refresh', label: '새 게임 (칩 초기화)', danger: true, fn: confirmReset });
  }
  openSheet(items);
}

const THEMES = [['green', '클래식 그린'], ['blue', '로열 블루'], ['red', '카지노 레드'], ['purple', '미드나잇 퍼플'], ['black', '스텔스 블랙']];
const themeName = (t) => (THEMES.find((x) => x[0] === t) || THEMES[0])[1];
function applyBodyClass() {
  document.body.className = `theme-${prefs.theme}` + (prefs.fourColor ? ' four-color' : '');
}
function cycleTheme() {
  const i = THEMES.findIndex((x) => x[0] === prefs.theme);
  prefs.theme = THEMES[(i + 1) % THEMES.length][0];
  store.set('theme', prefs.theme);
  applyBodyClass();
}
function toggleFourColor() {
  prefs.fourColor = !prefs.fourColor;
  store.set('fourColor', prefs.fourColor);
  applyBodyClass();
}
function toggleSound() {
  prefs.sound = !prefs.sound;
  sound.enabled = prefs.sound;
  store.set('sound', prefs.sound);
  if (prefs.sound) { sound.unlock(); sound.play('chip'); }
  updateSoundBtn();
}
function updateSoundBtn() {
  $('btn-sound').innerHTML = icon(prefs.sound ? 'vol' : 'mute');
  $('btn-sound').classList.toggle('on', prefs.sound);
}

function confirmReset() {
  openModal('새 게임을 시작할까요?', (body) => {
    body.innerHTML = `<p class="hint" style="font-size:14px">모든 플레이어의 칩이 시작 칩으로 초기화되고 순위표가 리셋됩니다.${S.state?.hand ? '<br><b style="color:#ffb4b4">진행 중인 핸드가 끝난 뒤에 가능하니 먼저 일시정지하세요.</b>' : ''}</p>
      <div class="modal-actions"><button class="btn" data-x>취소</button><button class="btn btn-red" data-ok>초기화</button></div>`;
    body.querySelector('[data-x]').onclick = closeModal;
    body.querySelector('[data-ok]').onclick = () => { send({ t: 'reset' }); closeModal(); };
  });
}

const isPrivateHost = (h) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/.test(h);

async function openInvite() {
  const online = S.hosted || !isPrivateHost(location.hostname);
  if (!online && !S.urls.length) {
    try {
      const r = await fetch('/api/info');
      S.urls = (await r.json()).urls || [];
    } catch (_) { /* */ }
  }
  let main;
  if (online) main = location.origin;
  else if (/^(localhost|127\.)/.test(location.hostname)) main = S.urls[0] || location.origin;
  else main = S.urls.find((u) => u.includes(location.host)) || location.origin;
  const canShare = online && typeof navigator.share === 'function';
  openModal('친구 초대', (body) => {
    const steps = online
      ? `<div><b>1</b><span>링크를 카톡 등으로 보내거나 QR을 찍게 하세요</span></div>
         <div><b>2</b><span>와이파이가 달라도, LTE/5G 여도 어디서든 접속돼요</span></div>
         <div><b>3</b><span>닉네임을 정하고 빈 자리에 앉으면 끝!</span></div>`
      : `<div><b>1</b><span>친구가 <b>같은 와이파이</b>에 연결되어 있는지 확인하세요</span></div>
         <div><b>2</b><span>휴대폰 카메라로 QR을 스캔하거나 주소를 입력하세요</span></div>
         <div><b>3</b><span>닉네임을 정하고 빈 자리에 앉으면 끝!</span></div>`;
    body.innerHTML = `<div class="invite">
      <div class="qr-box"><img alt="QR 코드" src="/qr.svg?u=${encodeURIComponent(main)}"></div>
      <div class="url-box"><code id="inv-url">${esc(main)}</code><button class="btn btn-sm btn-gold" id="inv-copy">${icon('copy', 15)} 복사</button></div>
      ${canShare ? `<button class="btn btn-lg" id="inv-share" style="margin-top:10px">${icon('send', 17)} 친구에게 공유하기</button>` : ''}
      ${!online && S.urls.length > 1 ? `<div class="alt-urls">다른 주소: ${S.urls.filter((u) => u !== main).map(esc).join(' · ')}</div>` : ''}
      <div class="steps">${steps}</div></div>`;
    body.querySelector('#inv-copy').onclick = () => copyText(main);
    const sh = body.querySelector('#inv-share');
    if (sh) {
      sh.onclick = () => {
        navigator.share({ title: 'Piku Poker', text: '포커 한 판 하자! 🃏', url: main }).catch(() => {});
      };
    }
  });
}

function copyText(text) {
  const done = () => toast('주소를 복사했어요', 'gold');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (_) { toast('복사에 실패했어요. 길게 눌러 복사하세요', 'err'); }
  ta.remove();
}

function openScoreboard() {
  openModal('순위표', (body) => {
    const sb = S.state?.scoreboard || [];
    if (!sb.length) {
      body.innerHTML = '<div class="empty-note">아직 기록이 없어요.<br>게임을 시작해 보세요!</div>';
      return;
    }
    body.innerHTML = `<table class="sb-table"><thead><tr><th>플레이어</th><th>칩</th><th>손익</th><th>승리</th></tr></thead><tbody>
      ${sb.map((p, i) => `<tr><td><div class="who"><span class="rank${i === 0 ? ' r1' : ''}">${i + 1}</span><span>${esc(p.avatar)}</span><span>${esc(p.name)}${p.connected ? '' : ' <small style="color:#667">(오프라인)</small>'}</span></div></td>
      <td>${fmt(p.chips)}</td><td class="${p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : ''}">${p.net > 0 ? '+' : ''}${fmt(p.net)}</td><td>${p.handsWon}</td></tr>`).join('')}
      </tbody></table>
      <p class="hint">손익 = 현재 칩 − 총 바이인${sb.some((p) => p.rebuys) ? ' (리바이 포함)' : ''} · 최대 팟: ${esc(sb.slice().sort((a, b) => b.biggestPot - a.biggestPot)[0].name)} ${fmt(Math.max(...sb.map((p) => p.biggestPot)))}</p>`;
  }, { live: true, wide: true });
}

function openSettings() {
  const s = S.state;
  if (!s?.me?.isHost) { toast('호스트만 설정을 바꿀 수 있어요', 'err'); return; }
  const v = { ...s.settings };
  openModal('게임 설정', (body, refresh) => {
    if (refresh) return; // 편집 중에는 덮어쓰지 않음
    const seg = (key, opts, fmtFn = fmt) => `<div class="seg" data-key="${key}">${opts.map((o) => `<button type="button" data-v="${o}" class="${v[key] === o ? 'on' : ''}">${fmtFn(o)}</button>`).join('')}</div>`;
    body.innerHTML = `
      <label class="fld-label">시작 칩 (바이인)</label>${seg('startingStack', [1000, 2000, 5000, 10000, 20000])}
      <label class="fld-label">블라인드 (SB / BB)</label>
      <div class="seg" data-key="blinds">${[[5, 10], [10, 20], [25, 50], [50, 100], [100, 200]].map(([a, b]) => `<button type="button" data-sb="${a}" data-bb="${b}" class="${v.smallBlind === a && v.bigBlind === b ? 'on' : ''}">${a}/${b}</button>`).join('')}</div>
      <div class="row2" style="margin-top:8px"><input class="fld" id="st-sb" inputmode="numeric" value="${v.smallBlind}" aria-label="스몰 블라인드"><input class="fld" id="st-bb" inputmode="numeric" value="${v.bigBlind}" aria-label="빅 블라인드"></div>
      <label class="fld-label">블라인드 자동 상승</label>${seg('blindUpMinutes', [0, 5, 10, 15, 20, 30], (x) => (x ? x + '분' : '없음'))}
      <label class="fld-label">턴 제한 시간</label>${seg('turnTime', [15, 20, 25, 30, 45, 60], (x) => x + '초')}
      <label class="fld-label">최대 인원</label>${seg('maxSeats', [2, 3, 4, 5, 6, 7, 8, 9], (x) => x + '명')}
      <button type="button" class="mi" id="st-rebuy" style="margin-top:12px;padding-left:0"><span>칩을 잃으면 리바이 허용</span><span class="toggle${v.allowRebuy ? ' on' : ''}"></span></button>
      <p class="hint">리바이를 끄면 토너먼트처럼 마지막 1명이 남을 때까지 진행됩니다. 변경 사항은 다음 핸드부터 적용돼요.</p>
      <div class="modal-actions"><button class="btn" data-x>취소</button><button class="btn btn-gold" data-ok>저장</button></div>`;
    body.querySelectorAll('.seg').forEach((sg) => {
      sg.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        sg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        if (sg.dataset.key === 'blinds') {
          v.smallBlind = Number(b.dataset.sb);
          v.bigBlind = Number(b.dataset.bb);
          body.querySelector('#st-sb').value = v.smallBlind;
          body.querySelector('#st-bb').value = v.bigBlind;
        } else v[sg.dataset.key] = Number(b.dataset.v);
      };
    });
    const syncBl = () => {
      v.smallBlind = Number(body.querySelector('#st-sb').value.replace(/\D/g, '')) || v.smallBlind;
      v.bigBlind = Number(body.querySelector('#st-bb').value.replace(/\D/g, '')) || v.bigBlind;
      body.querySelectorAll('[data-key="blinds"] button').forEach((x) => x.classList.toggle('on', Number(x.dataset.sb) === v.smallBlind && Number(x.dataset.bb) === v.bigBlind));
    };
    body.querySelector('#st-sb').oninput = syncBl;
    body.querySelector('#st-bb').oninput = syncBl;
    body.querySelector('#st-rebuy').onclick = (e) => {
      v.allowRebuy = !v.allowRebuy;
      e.currentTarget.querySelector('.toggle').classList.toggle('on', v.allowRebuy);
    };
    body.querySelector('[data-x]').onclick = closeModal;
    body.querySelector('[data-ok]').onclick = () => {
      syncBl();
      if (v.bigBlind < v.smallBlind) { toast('빅 블라인드는 스몰 블라인드보다 커야 해요', 'err'); return; }
      send({ t: 'settings', settings: v });
      closeModal();
      toast('설정을 저장했어요', 'gold');
    };
  }, { live: false });
}

function openProfile() {
  const me = S.state?.me;
  let av = me?.avatar || store.get('avatar', AVATARS[0]);
  openModal('프로필', (body) => {
    body.innerHTML = `<label class="fld-label">닉네임</label><input class="fld" id="pf-name" maxlength="12" value="${esc(me?.name || store.get('name', ''))}">
      <label class="fld-label">아바타</label><div class="avatar-grid" id="pf-av">${AVATARS.map((a) => `<button type="button" data-a="${a}" class="${a === av ? 'on' : ''}">${a}</button>`).join('')}</div>
      <div class="modal-actions"><button class="btn" data-x>취소</button><button class="btn btn-gold" data-ok>저장</button></div>`;
    body.querySelector('#pf-av').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      av = b.dataset.a;
      body.querySelectorAll('#pf-av button').forEach((x) => x.classList.toggle('on', x === b));
    };
    body.querySelector('[data-x]').onclick = closeModal;
    body.querySelector('[data-ok]').onclick = () => {
      const name = body.querySelector('#pf-name').value.trim();
      if (!name) { toast('닉네임을 입력해주세요', 'err'); return; }
      store.set('name', name);
      store.set('avatar', av);
      send({ t: 'profile', name, avatar: av });
      closeModal();
    };
  });
}

function openHelp() {
  const ranks = [
    ['로열 플러시', '같은 무늬 A K Q J 10', ['As', 'Ks', 'Qs', 'Js', 'Ts']],
    ['스트레이트 플러시', '같은 무늬 연속 5장', ['9h', '8h', '7h', '6h', '5h']],
    ['포카드', '같은 숫자 4장', ['Qc', 'Qd', 'Qh', 'Qs', '3d']],
    ['풀하우스', '트리플 + 원페어', ['Kh', 'Kd', 'Ks', '7c', '7h']],
    ['플러시', '같은 무늬 5장', ['Ad', 'Jd', '8d', '6d', '2d']],
    ['스트레이트', '연속된 숫자 5장', ['Tc', '9d', '8s', '7h', '6c']],
    ['트리플', '같은 숫자 3장', ['8s', '8h', '8d', 'Kc', '4s']],
    ['투페어', '페어 2개', ['Jh', 'Jc', '4d', '4s', 'Ah']],
    ['원페어', '같은 숫자 2장', ['Ac', 'Ad', '9s', '6h', '3c']],
    ['하이카드', '가장 높은 카드', ['Ah', 'Qd', '9c', '5s', '3h']],
  ];
  openModal('족보 & 게임 방법', (body) => {
    body.innerHTML = `<div style="display:grid;gap:10px">${ranks.map(([n, d], i) => `<div style="display:flex;align-items:center;gap:12px">
      <div class="help-cards" data-i="${i}" style="display:flex;gap:3px;--cw:28px;flex:none"></div>
      <div><div style="font-weight:800;font-size:14px">${i + 1}. ${n}</div><div class="hint" style="margin:0">${d}</div></div></div>`).join('')}</div>
      <div class="hint" style="margin-top:16px;font-size:13px;line-height:1.7">
      • 각자 2장 + 바닥 5장 중 가장 좋은 5장으로 승부합니다.<br>
      • 순서: 프리플랍 → 플랍(3장) → 턴 → 리버 → 쇼다운<br>
      • <b>체크</b> 넘기기 · <b>콜</b> 따라가기 · <b>레이즈</b> 올리기 · <b>폴드</b> 포기<br>
      • 내 차례가 아닐 때 <b>체크/폴드 · 콜</b>을 미리 예약할 수 있어요.<br>
      • PC 단축키: F 폴드 · C 체크/콜 · R 레이즈 · ↑↓ 금액 · Enter 확정</div>`;
    body.querySelectorAll('.help-cards').forEach((c) => {
      ranks[Number(c.dataset.i)][2].forEach((code) => c.appendChild(cardEl(code)));
    });
  }, { wide: true });
}

function openGameOver(w) {
  openModal('게임 종료', (body) => {
    body.innerHTML = `<div class="go"><div class="go-av">${esc(w.avatar)}</div><h4>${esc(w.name)} 님 우승! 🎉</h4><p>최종 칩 ${fmt(w.chips)}</p></div>
      <div class="modal-actions"><button class="btn" data-sb>순위표 보기</button><button class="btn btn-gold" data-x>확인</button></div>`;
    body.querySelector('[data-x]').onclick = closeModal;
    body.querySelector('[data-sb]').onclick = openScoreboard;
  });
  if (S.state?.me?.id === w.id) { sound.play('win'); sparkle({ x: innerWidth / 2, y: innerHeight / 2 }, 40); }
}

// ───────────────────────── 로비 ─────────────────────────
function buildLobby() {
  let av = store.get('avatar', AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  const grid = $('lobby-avatars');
  grid.innerHTML = AVATARS.map((a) => `<button type="button" data-a="${a}" class="${a === av ? 'on' : ''}">${a}</button>`).join('');
  grid.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    av = b.dataset.a;
    grid.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  };
  $('lobby-name').value = store.get('name', '');
  $('lobby-form').onsubmit = (e) => {
    e.preventDefault();
    sound.unlock();
    const name = $('lobby-name').value.trim();
    if (!name) { $('lobby-name').focus(); return; }
    store.set('name', name);
    store.set('avatar', av);
    S.watching = false;
    if (!net.send({ t: 'hello', token: getToken(), name, avatar: av })) toast('서버에 연결하는 중이에요. 잠시 후 다시 시도하세요', 'err');
  };
  $('lobby-watch').onclick = () => {
    S.watching = true;
    S.pendingSeat = null;
    hideLobby();
  };
}
function showLobby() {
  $('lobby').classList.remove('hide');
  setTimeout(() => { if (window.innerWidth > 700) $('lobby-name').focus(); }, 300);
}
function hideLobby() {
  $('lobby').classList.add('hide');
  $('lobby-name').blur();
}
function updateLobbyCount(s) {
  const seated = s.seats.filter(Boolean).length;
  $('lobby-count').textContent = `현재 ${seated}명 착석 · ${s.spectators.length}명 관전`;
}

// ───────────────────────── 토스트 ─────────────────────────
function toast(text, kind = '') {
  const t = h('div', 'toast' + (kind ? ' ' + kind : ''));
  t.textContent = text;
  const box = $('toasts');
  box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 320);
  }, 2600);
}

init();
