#!/usr/bin/env node
'use strict';
/**
 * Piku Poker — 같은 와이파이에서 즐기는 멀티플레이 텍사스 홀덤
 *   실행:  node server.js        (포트 변경: PORT=4000 node server.js)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { attachWebSocket } = require('./lib/ws');
const { Game, GameError } = require('./lib/game');
const qr = require('./lib/qr');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** 같은 네트워크의 다른 기기가 접속할 수 있는 주소 목록 (사설 IP 우선) */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      const ip = a.address;
      let score = 0;
      if (/^192\.168\./.test(ip)) score = 3;
      else if (/^10\./.test(ip)) score = 2;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) score = 1;
      if (/^(docker|br-|veth|vmnet|vboxnet|utun|tailscale|zt)/i.test(name)) score -= 5;
      out.push({ ip, name, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.map((a) => `http://${a.ip}:${PORT}`);
}

const game = new Game();
const clients = new Set();

function send(c, obj) {
  if (c.ws.open) c.ws.send(JSON.stringify(obj));
}

game.on('update', (events) => {
  for (const c of clients) {
    try {
      send(c, { t: 'state', state: game.viewFor(c.pid), events });
    } catch (e) {
      console.error('[server] broadcast failed', e);
    }
  }
});

setInterval(() => {
  try { game.tick(); } catch (e) { console.error(e); }
}, 5000).unref();

// ───────────────────────── HTTP ─────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ urls: lanAddresses(), port: PORT }));
    return;
  }
  if (url.pathname === '/qr.svg') {
    const text = (url.searchParams.get('u') || lanAddresses()[0] || `http://localhost:${PORT}`).slice(0, 300);
    try {
      res.writeHead(200, { 'Content-Type': MIME['.svg'], 'Cache-Control': 'no-store' });
      res.end(qr.toSvg(text, { border: 2 }));
    } catch (e) {
      res.writeHead(400);
      res.end();
    }
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA 폴백
      if (!path.extname(p)) {
        fs.readFile(path.join(PUBLIC, 'index.html'), (e2, html) => {
          if (e2) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(html);
        });
        return;
      }
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ───────────────────────── WebSocket ─────────────────────────
attachWebSocket(server, '/ws', (ws, req) => {
  const c = { ws, pid: null, ip: req.socket.remoteAddress };
  clients.add(c);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'ping') { send(c, { t: 'pong', at: msg.at }); return; }
    try {
      handle(c, msg);
    } catch (e) {
      if (e instanceof GameError) send(c, { t: 'error', text: e.message });
      else {
        console.error('[server] handler error', e);
        send(c, { t: 'error', text: '서버 오류가 발생했습니다.' });
      }
    }
  });

  ws.on('close', () => {
    clients.delete(c);
    if (c.pid && ![...clients].some((o) => o.pid === c.pid)) game.disconnect(c.pid);
  });
});

function handle(c, m) {
  const pid = c.pid;
  switch (m.t) {
    case 'hello': {
      if (m.name || game.tokens.has(String(m.token || ''))) {
        const p = game.join(m.token, m.name, m.avatar);
        c.pid = p.id;
      }
      send(c, {
        t: 'welcome', you: c.pid, log: game.log.slice(-80), chat: game.chat.slice(-60), urls: lanAddresses(),
      });
      game.queueFlush();
      return;
    }
    case 'profile': return game.updateProfile(pid, m.name, m.avatar);
    case 'sit': return game.sit(pid, m.seat);
    case 'stand': return game.stand(pid);
    case 'act': return game.act(pid, m.action, m.amount);
    case 'settings': return game.updateSettings(pid, m.settings || {});
    case 'start': return game.startGame(pid);
    case 'pause': return game.setPaused(pid, !!m.value);
    case 'reset': return game.resetGame(pid);
    case 'rebuy': return game.rebuy(pid);
    case 'sitout': return game.setSitOut(pid, !!m.value);
    case 'show': return game.showCards(pid);
    case 'chat': return game.say(pid, m.text);
    case 'emote': return game.emote(pid, m.emoji);
    case 'kick': return game.kick(pid, m.id);
    case 'host': return game.transferHost(pid, m.id);
    default: return undefined;
  }
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  ✖ 포트 ${PORT} 이 이미 사용 중입니다. 다른 포트로 실행하세요:  PORT=4000 node server.js\n`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  const urls = lanAddresses();
  const main = urls[0] || `http://localhost:${PORT}`;
  const gold = (s) => `\x1b[38;5;220m${s}\x1b[0m`;
  const dim = (s) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s) => `\x1b[1m${s}\x1b[0m`;
  console.log('');
  console.log(gold('   ♠ ♥  PIKU POKER  ♦ ♣'));
  console.log(dim('   같은 와이파이의 친구들과 텍사스 홀덤'));
  console.log('');
  console.log(`   이 컴퓨터에서:   ${bold(`http://localhost:${PORT}`)}`);
  if (urls.length) {
    console.log(`   친구들 접속:     ${bold(gold(main))}`);
    for (const u of urls.slice(1)) console.log(dim(`                    ${u}`));
  } else {
    console.log('   ⚠ 네트워크 주소를 찾지 못했습니다. 와이파이 연결을 확인하세요.');
  }
  console.log('');
  if (urls.length && !process.env.NO_QR) {
    console.log(dim('   휴대폰 카메라로 스캔해서 바로 입장:'));
    console.log(qr.toTerminal(main).split('\n').map((l) => '   ' + l).join('\n'));
    console.log('');
  }
  console.log(dim('   종료: Ctrl+C'));
  console.log('');
});
