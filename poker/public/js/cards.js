/** 카드/칩 DOM 생성 헬퍼 */

export const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');

export function fmtShort(n) {
  n = Number(n || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e5) return Math.round(n / 1e3) + 'K';
  return fmt(n);
}

const VS = '︎'; // iOS 에서 이모지로 바뀌지 않도록 텍스트 표현 강제
export const SUIT_SYM = { s: '♠' + VS, h: '♥' + VS, d: '♦' + VS, c: '♣' + VS };
const RANK_TXT = { T: '10' };

export function cardEl(code, down = false) {
  const c = document.createElement('div');
  c.className = 'card';
  c.innerHTML = '<div class="card-inner"><div class="face front"></div><div class="face back"></div></div>';
  setCardFace(c, code);
  if (down) c.classList.add('down');
  return c;
}

export function setCardFace(c, code) {
  c.dataset.code = code;
  const front = c.querySelector('.front');
  if (!code || code === 'XX') {
    front.className = 'face front';
    front.innerHTML = '';
    c.classList.add('down');
    return;
  }
  const r = code[0], s = code[1];
  front.className = 'face front suit-' + s;
  front.innerHTML =
    `<span class="corner"><span class="rk${r === 'T' ? ' ten' : ''}">${RANK_TXT[r] || r}</span>` +
    `<span class="st-s">${SUIT_SYM[s]}</span></span>` +
    `<span class="st-b">${SUIT_SYM[s]}</span>`;
}

// [액면가, 바탕색, 줄무늬색]
const DENOMS = [
  [100000, '#f97316', '#fff3e0'],
  [25000, '#0ea5a4', '#e6fffb'],
  [5000, '#db2777', '#fff'],
  [1000, '#eab308', '#fffbea'],
  [500, '#7c3aed', '#f5f0ff'],
  [100, '#1f2329', '#e9edf2'],
  [25, '#16a34a', '#f0fff4'],
  [5, '#dc2626', '#fff5f5'],
  [1, '#eef1f5', '#2563eb'],
];

export function chipColors(amount, max = 6) {
  const out = [];
  let rest = Math.max(0, Math.floor(amount));
  for (const [v, c, s] of DENOMS) {
    while (rest >= v && out.length < max) {
      out.push([c, s]);
      rest -= v;
    }
    if (out.length >= max) break;
  }
  if (!out.length) out.push([DENOMS[DENOMS.length - 1][1], DENOMS[DENOMS.length - 1][2]]);
  return out;
}

/** 칩 더미. cols>1 이면 여러 줄로 쌓음 */
export function chipStack(amount, { max = 6, cols = 1 } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chips';
  const colors = chipColors(amount, max * cols);
  const per = Math.ceil(colors.length / cols);
  for (let k = 0; k < cols; k++) {
    const part = colors.slice(k * per, (k + 1) * per);
    if (!part.length) continue;
    const col = document.createElement('div');
    col.className = 'chip-col';
    part.forEach(([c, s], i) => {
      const chip = document.createElement('i');
      chip.className = 'chip';
      chip.style.setProperty('--c', c);
      chip.style.setProperty('--s', s);
      chip.style.setProperty('--i', i);
      col.appendChild(chip);
    });
    col.style.setProperty('--n', part.length);
    wrap.appendChild(col);
  }
  return wrap;
}
