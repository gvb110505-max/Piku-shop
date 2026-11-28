'use strict';
/**
 * 의존성 없는 최소 WebSocket 서버 (RFC 6455, 텍스트 프레임 중심).
 * 단편화 프레임, ping/pong, close, 16/64비트 길이 지원.
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 1 << 20; // 1MB

class WSConn extends EventEmitter {
  constructor(socket, head) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = null;
    this.fragOp = 0;
    this.open = true;
    this.alive = true;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 15000);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('end', () => this._closed());
    socket.on('error', () => this._closed());
    if (head && head.length) this._onData(head);
  }

  _onData(chunk) {
    if (!this.open) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const buf = this.buf;
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const hi = buf.readUInt32BE(2);
        const lo = buf.readUInt32BE(6);
        if (hi !== 0 || lo > MAX_MESSAGE) return this.terminate();
        len = lo;
        off = 10;
      }
      if (len > MAX_MESSAGE) return this.close(1009);
      if (!masked) return this.terminate(); // 클라이언트 프레임은 반드시 마스킹
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      off += 4;
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = buf[off + i] ^ mask[i & 3];
      this.buf = buf.subarray(off + len);
      this._frame(fin, op, payload);
      if (!this.open) return;
    }
  }

  _frame(fin, op, payload) {
    switch (op) {
      case 0x8: // close
        this._send(0x8, payload.subarray(0, 2));
        this.socket.end();
        this._closed();
        return;
      case 0x9: // ping
        this._send(0xa, payload);
        return;
      case 0xa: // pong
        this.alive = true;
        return;
      case 0x1:
      case 0x2:
        this.fragOp = op;
        this.frags = [payload];
        break;
      case 0x0:
        if (!this.frags) return this.terminate();
        this.frags.push(payload);
        break;
      default:
        return this.terminate();
    }
    if (fin) {
      const data = this.frags.length === 1 ? this.frags[0] : Buffer.concat(this.frags);
      this.frags = null;
      if (data.length > MAX_MESSAGE) return this.close(1009);
      this.alive = true;
      if (this.fragOp === 0x1) this.emit('message', data.toString('utf8'));
    }
  }

  _send(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | op;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | op;
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(len, 6);
    }
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch (_) {
      this._closed();
    }
  }

  send(text) {
    this._send(0x1, Buffer.from(text, 'utf8'));
  }

  ping() {
    this._send(0x9, Buffer.alloc(0));
  }

  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code);
    this._send(0x8, p);
    try { this.socket.end(); } catch (_) { /* ignore */ }
    this._closed();
  }

  terminate() {
    try { this.socket.destroy(); } catch (_) { /* ignore */ }
    this._closed();
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }
}

function attachWebSocket(server, path, onConnection) {
  const conns = new Set();
  server.on('upgrade', (req, socket, head) => {
    const url = (req.url || '').split('?')[0];
    const key = req.headers['sec-websocket-key'];
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    if (url !== path || !key || upgrade !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const ws = new WSConn(socket, head);
    conns.add(ws);
    ws.on('close', () => conns.delete(ws));
    onConnection(ws, req);
  });
  const hb = setInterval(() => {
    for (const ws of conns) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, 20000);
  hb.unref();
  return conns;
}

module.exports = { attachWebSocket, WSConn };
