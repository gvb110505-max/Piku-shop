// 메인 메뉴 / 화면 전환 / 게임 루프
import * as THREE from 'three';
import { Input } from './input.js';
import { SingleGame } from './single.js';
import { createWorld } from './world.js';
import { createCharacter } from './character.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const input = new Input(canvas);

// ---------- 프로필 (닉네임/색상) ----------
const COLORS = [0xffb547, 0x4fc3f7, 0xef5350, 0x66bb6a, 0xab47bc, 0xf5f5f5];
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const profile = { name: store.get('piku.name', ''), color: Number(store.get('piku.color', COLORS[0])) };
if (!COLORS.includes(profile.color)) profile.color = COLORS[0];
$('nickname').value = profile.name;

const pick = $('colorPick');
COLORS.forEach((c) => {
  const b = document.createElement('button');
  b.style.background = '#' + c.toString(16).padStart(6, '0');
  b.setAttribute('aria-label', '색상 선택');
  if (c === profile.color) b.classList.add('active');
  b.onclick = () => {
    profile.color = c; store.set('piku.color', c);
    pick.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    setPreviewColor(c);
  };
  pick.appendChild(b);
});

// ---------- 메뉴 배경: 회전하는 캐릭터 미리보기 ----------
const menuScene = new THREE.Scene();
createWorld(menuScene);
const menuCam = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 300);
let preview = createCharacter(profile.color);
preview.position.set(0, 0, 12);
menuScene.add(preview);
function setPreviewColor(c) {
  menuScene.remove(preview);
  preview = createCharacter(c);
  preview.position.set(0, 0, 12);
  menuScene.add(preview);
}

// ---------- UI ----------
const ui = {
  setCoins: (n, total) => ($('hudCoins').textContent = `${n} / ${total}`),
  setTime: (t) => ($('hudTime').textContent = t.toFixed(1)),
  onFinish: (t) => {
    $('resultText').textContent = `${profile.name || '플레이어'} 님, 기록 ${t.toFixed(2)}초!` +
      (best === null || t < best ? '\n최고 기록 갱신!' : `\n최고 기록 ${best.toFixed(2)}초`);
    if (best === null || t < best) { best = t; store.set('piku.best', t); }
    setState('result');
  },
};
let best = store.get('piku.best', null); best = best === null ? null : Number(best);

function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 2200);
}

// ---------- 상태 관리 ----------
let state = 'menu'; // menu | playing | paused | result
let game = null;

function setState(s) {
  state = s;
  $('menu').classList.toggle('hidden', s !== 'menu');
  $('pause').classList.toggle('hidden', s !== 'paused');
  $('result').classList.toggle('hidden', s !== 'result');
  $('hud').classList.toggle('hidden', s === 'menu');
  input.enabled = s === 'playing';
  if (s === 'playing') input.lock(); else { input.unlock(); input.keys.clear(); }
  updateClickHint();
}
function updateClickHint() {
  $('clickToPlay').classList.toggle('hidden', !(state === 'playing' && !input.locked));
}

function startSingle() {
  profile.name = $('nickname').value.trim();
  store.set('piku.name', profile.name);
  if (game) game.dispose();
  game = new SingleGame(renderer, input, profile, ui);
  setState('playing');
}

$('btnSingle').onclick = startSingle;
$('btnMulti').onclick = () => toast('멀티 플레이는 준비 중입니다.');
$('btnResume').onclick = () => setState('playing');
$('btnRestart').onclick = () => { game.reset(); setState('playing'); };
$('btnAgain').onclick = () => { game.reset(); setState('playing'); };
const quit = () => { if (game) { game.dispose(); game = null; } setState('menu'); };
$('btnQuit').onclick = quit;
$('btnResultQuit').onclick = quit;

canvas.addEventListener('click', () => { if (state === 'playing' && !input.locked) input.lock(); });
document.addEventListener('pointerlockchange', () => {
  // Esc로 포인터락이 풀리면 일시정지
  if (!input.locked && state === 'playing') setState('paused');
  updateClickHint();
});
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && state === 'paused') setState('playing');
  else if (e.code === 'KeyP' && state === 'playing') setState('paused');
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  menuCam.aspect = innerWidth / innerHeight; menuCam.updateProjectionMatrix();
  game?.resize();
});

// ---------- 루프 ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!game || state === 'menu') {
    const t = clock.elapsedTime * 0.15;
    menuCam.position.set(Math.sin(t) * 6, 2.6, 12 + Math.cos(t) * 6);
    menuCam.lookAt(0, 1.2, 12);
    preview.userData.animate(dt, 0.25, true);
    renderer.render(menuScene, menuCam);
    return;
  }
  if (state === 'playing') game.update(dt);
  game.render();
});

setState('menu');
