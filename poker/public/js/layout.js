/**
 * 테이블 레이아웃: 화면 크기에 맞춰 스타디움(둥근 직사각형) 테이블을 만들고
 * 둘레를 따라 같은 간격으로 좌석을 배치한다. (시계방향 = 화면 기준 아래→왼쪽→위→오른쪽)
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function stadiumPath(cx, cy, a, b) {
  const segs = [];
  const arc = (ox, oy, r, a0, a1) => ({ k: 'arc', ox, oy, r, a0, a1, len: (Math.abs(a1 - a0) * Math.PI * r) / 180 });
  const line = (x0, y0, x1, y1) => ({ k: 'line', x0, y0, x1, y1, len: Math.hypot(x1 - x0, y1 - y0) });
  if (b >= a) {
    const r = a, d = b - a;
    segs.push(
      arc(cx, cy + d, r, 90, 180),
      line(cx - r, cy + d, cx - r, cy - d),
      arc(cx, cy - d, r, 180, 360),
      line(cx + r, cy - d, cx + r, cy + d),
      arc(cx, cy + d, r, 0, 90),
    );
  } else {
    const r = b, d = a - b;
    segs.push(
      line(cx, cy + r, cx - d, cy + r),
      arc(cx - d, cy, r, 90, 270),
      line(cx - d, cy - r, cx + d, cy - r),
      arc(cx + d, cy, r, 270, 450),
      line(cx + d, cy + r, cx, cy + r),
    );
  }
  const total = segs.reduce((s, g) => s + g.len, 0);
  const at = (s) => {
    s = ((s % total) + total) % total;
    for (let i = 0; i < segs.length; i++) {
      const g = segs[i];
      if (s <= g.len || i === segs.length - 1) {
        const t = g.len ? clamp(s / g.len, 0, 1) : 0;
        if (g.k === 'line') {
          const dx = (g.x1 - g.x0) / (g.len || 1), dy = (g.y1 - g.y0) / (g.len || 1);
          return { x: g.x0 + (g.x1 - g.x0) * t, y: g.y0 + (g.y1 - g.y0) * t, tx: dx, ty: dy, nx: -dy, ny: dx };
        }
        const ang = ((g.a0 + (g.a1 - g.a0) * t) * Math.PI) / 180;
        const c = Math.cos(ang), sn = Math.sin(ang);
        return { x: g.ox + g.r * c, y: g.oy + g.r * sn, nx: -c, ny: -sn, tx: -sn, ty: c };
      }
      s -= g.len;
    }
    return { x: cx, y: cy + b, nx: 0, ny: -1, tx: -1, ty: 0 };
  };
  return { total, at };
}

/**
 * 허용 구간(ok)만 이어붙인 길이 위에서 좌석을 균등 배치한다.
 * 첫 좌석(나)은 항상 s=0(아래 가운데).
 */
function placeSeats(path, n, hasMe, ok, minSpacing) {
  const N = Math.max(1, Math.ceil(path.total));
  for (const k of [1, 0.7, 0.4, 0]) {
    const allowed = [];
    for (let s = 0; s < N; s++) if (k === 0 || ok(path.at(s), k)) allowed.push(s);
    const A = allowed.length;
    if (!A) continue;
    const at = (t) => allowed[Math.max(0, Math.min(A - 1, Math.round(t)))];
    const pos = [];
    if (hasMe && n > 2) {
      const gap = (A / n) * 1.22;
      const step = (A - 2 * gap) / (n - 2);
      if (k > 0 && step < minSpacing) continue;
      pos.push(0);
      for (let j = 1; j < n; j++) pos.push(at(gap + (j - 1) * step));
    } else {
      const step = A / n;
      if (k > 0 && step < minSpacing) continue;
      // 첫 좌석이 아래 가운데(s=0)에 오도록
      for (let i = 0; i < n; i++) pos.push(at(i * step));
    }
    return pos;
  }
  return Array.from({ length: n }, (_, i) => (i * path.total) / n);
}

/**
 * @param {number} W 영역 너비
 * @param {number} H 영역 높이
 * @param {number} n 좌석 수
 * @param {boolean} hasMe 내가 앉아 있는지 (아래 가운데 좌석을 넓게)
 */
export function computeLayout(W, H, n, hasMe) {
  const portrait = H > W * 1.05;
  const minDim = Math.min(W, H);
  const crowd = n >= 8 ? 0.92 : 1;
  const av = Math.round(clamp(Math.min(W * (portrait ? 0.125 : 0.07), H * 0.105) * crowd, 40, 76));
  const ocw = Math.round(av * 0.6);
  const rcw = Math.round(av * 0.78);
  const mcw = Math.round(clamp(av * 1.12, 46, 84));

  const mx = av * (portrait ? 0.98 : 1.15);
  const mt = av * 1.42;
  const mb = av * (hasMe ? 1.02 : 1.0);
  let a = (W - 2 * mx) / 2;
  let b = (H - mt - mb) / 2;
  let cx = W / 2;
  let cy = mt + b;
  if (!portrait && a > b * 2.25) a = b * 2.25;
  if (portrait && b > a * 2.05) {
    const nb = a * 2.05;
    cy += (b - nb) * 0.35;
    b = nb;
  }
  a = Math.max(a, 60);
  b = Math.max(b, 60);

  const rail = Math.round(clamp(Math.min(a, b) * 0.085, 9, 22));
  const table = { x: cx - a, y: cy - b, w: a * 2, h: b * 2, rail };
  const path = stadiumPath(cx, cy, a - rail * 0.35, b - rail * 0.35);
  const bw = Math.round(clamp(Math.min((a * 2 - rail * 2) / 6.4, H * 0.115, (b * 2) / 3.4), 34, 88));
  const db = Math.round(clamp(av * 0.42, 18, 30));

  // 보드와 겹치는 구간(세로 모드의 좌우 가운데)은 피해서 좌석을 균등 배치.
  // 공간이 부족하면 금지 구간을 줄여가며 재시도.
  const boardHalfW = bw * 2.7;
  const pos = placeSeats(path, n, hasMe, (p, k) => {
    if (Math.abs(p.x - cx) > boardHalfW + av * 0.95 * k) return true;
    const top = cy - bw * 0.31 - av * 1.02 * k;
    const bot = cy + bw * 1.09 + av * 1.25 * k;
    return !(p.y > top && p.y < bot);
  }, av * 1.75);

  // 좌석이 차지하는 박스(아바타+명패+카드) 밖으로 나가는 최소 거리
  const BW2 = 34, BH2 = 14; // 베팅 칩 + 금액 라벨의 대략적 반크기
  const box = { l: av * 0.95, r: av * 0.95, t: av * 1.02, b: av * 1.02 };
  const exitDist = (nx, ny, w2, h2) => {
    const dx = nx > 0.01 ? (box.r + w2) / nx : nx < -0.01 ? (box.l + w2) / -nx : Infinity;
    const dy = ny > 0.01 ? (box.b + h2) / ny : ny < -0.01 ? (box.t + h2) / -ny : Infinity;
    return Math.min(dx, dy) + 4;
  };
  // 중앙(팟+보드) 영역
  const cHalfW = bw * 2.7 + 6, cHalfH = bw * 1.1 + 4;
  const hitsCenter = (pt, w2, h2) => Math.abs(pt.x - cx) < cHalfW + w2 && Math.abs(pt.y - cy) < cHalfH + h2;
  const outsideSeat = (pt, p, w2, h2) => {
    const dx = pt.x - p.x, dy = pt.y - p.y;
    return dx - w2 > box.r || -dx - w2 > box.l || dy - h2 > box.b || -dy - h2 > box.t;
  };
  /** 좌석 박스 밖 + 중앙 영역 밖의 자리를 찾음: 안쪽 → 중앙 피해 위/아래 → 좌석 옆 */
  const placeNear = (p, w2, h2, avoid) => {
    const ok = (pt) => !hitsCenter(pt, w2, h2) && outsideSeat(pt, p, w2, h2) && !(avoid && avoid(pt));
    const d = exitDist(p.nx, p.ny, w2, h2);
    const c1 = { x: p.x + p.nx * d, y: p.y + p.ny * d };
    if (ok(c1)) return c1;
    const c2 = { x: c1.x, y: p.y < cy ? cy - cHalfH - h2 - 2 : cy + cHalfH + h2 + 2 };
    if (ok(c2)) return c2;
    const sgn = Math.sign(cx - p.x) || 1;
    for (const s of [sgn, -sgn]) {
      const c3 = { x: p.x + s * (box.r + w2 + 4), y: p.y + av * 0.1 };
      if (ok(c3)) return c3;
    }
    return c1;
  };

  const seats = pos.map((s, i) => {
    const p = path.at(s);
    const isMe = hasMe && i === 0;
    let bet, dealer;
    if (isMe) {
      const d = av * 0.3 + mcw * 1.4 + 18;
      bet = { x: p.x + p.nx * d, y: p.y + p.ny * d };
      const side = mcw * 1.25 + 14;
      dealer = { x: p.x + p.tx * side + p.nx * av * 0.5, y: p.y + p.ty * side + p.ny * av * 0.5 };
    } else {
      bet = placeNear(p, BW2, BH2);
      // 딜러 버튼: 베팅 칩과 겹치지 않는 근처
      const r = db / 2;
      const clash = (pt) => Math.abs(pt.x - bet.x) < BW2 + r + 2 && Math.abs(pt.y - bet.y) < BH2 + r + 2;
      const dd = exitDist(p.nx, p.ny, r, r);
      const side = BW2 + r + 6;
      const cands = [
        { x: p.x + p.nx * dd - p.tx * side, y: p.y + p.ny * dd - p.ty * side },
        { x: p.x + p.nx * dd + p.tx * side, y: p.y + p.ny * dd + p.ty * side },
      ];
      dealer = cands.find((c) => !hitsCenter(c, r, r) && !clash(c) && outsideSeat(c, p, r, r)) || placeNear(p, r, r, clash);
    }
    return { ...p, bet, dealer, isMe, upper: p.y < cy - av };
  });

  return {
    W, H, portrait, table, seats,
    center: { x: cx, y: cy },
    sizes: { av, ocw, rcw, mcw, bw, chip: Math.round(clamp(av * 0.36, 15, 26)), db, rail },
  };
}
