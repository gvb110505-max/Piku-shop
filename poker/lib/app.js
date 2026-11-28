'use strict';
/**
 * HTTP + WebSocket 앱. 로컬 실행(server.js)과 Vercel 함수(api/server.js)가 함께 사용한다.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { attachWebSocket } = require('./ws');
const { Game, GameError } = require('./game');
const qr = require('./qr');

const PUBLIC = path.join(__dirname, '..', 'public');
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
function lanAddresses(port) {
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
  return out.map((a) => `http://${a.ip}:${port}`);
}

/**
 * @param {{ hosted?: boolean, port?: number }} opts
 *   hosted: 인터넷에 배포된 경우(Vercel). LAN 주소를 쓰지 않고 접속 경로 검사를 완화한다.
 */
function createApp({ hosted = false, port = 3000 } = {}) {
  const game = new Game();
  const clients = new Set();
  const instance = crypto.randomBytes(6).toString('hex');
  const urls = () => (hosted ? [] : lanAddresses(port));

  const send = (c, obj) => {
    if (c.ws.open) c.ws.send(JSON.stringify(obj));
  };

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

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/info') {
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ urls: urls(), port, hosted }));
      return;
    }
    if (url.pathname === '/qr.svg') {
      const text = (url.searchParams.get('u') || urls()[0] || `http://localhost:${port}`).slice(0, 300);
      try {
        res.writeHead(200, { 'Content-Type': MIME['.svg'], 'Cache-Control': 'public, max-age=3600' });
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
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
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

  // 연결이 잠깐 끊겼다 바로 다시 붙는 경우(서버리스 연결 시간 제한 등) '연결 끊김'이 깜빡이지 않도록 유예
  const DISCONNECT_GRACE = 4000;

  attachWebSocket(server, hosted ? null : '/ws', (ws, req) => {
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
      const pid = c.pid;
      if (!pid) return;
      setTimeout(() => {
        if (![...clients].some((o) => o.pid === pid)) game.disconnect(pid);
      }, DISCONNECT_GRACE).unref();
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
          t: 'welcome', you: c.pid, log: game.log.slice(-80), chat: game.chat.slice(-60),
          urls: urls(), hosted, instance,
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

  return { server, game, urls };
}

module.exports = { createApp, lanAddresses };
