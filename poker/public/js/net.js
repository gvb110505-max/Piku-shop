/** 자동 재연결 + 하트비트가 있는 WebSocket 클라이언트 */

export class Net {
  constructor({ onOpen, onMessage, onStatus }) {
    this.onOpen = onOpen;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.ws = null;
    this.retry = 0;
    this.lastPong = 0;
    this.timer = null;
    this.hb = null;
    this.online = false;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && (!this.ws || this.ws.readyState > 1)) this.connect(true);
    });
    window.addEventListener('online', () => this.connect(true));
  }

  connect(now = false) {
    clearTimeout(this.timer);
    if (this.ws && this.ws.readyState <= 1) return;
    const go = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      let ws;
      try {
        ws = new WebSocket(`${proto}://${location.host}/ws`);
      } catch (_) {
        this.schedule();
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        this.retry = 0;
        this.lastPong = Date.now();
        this.setOnline(true);
        this.onOpen();
        clearInterval(this.hb);
        this.hb = setInterval(() => this.beat(), 4000);
      };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch (_) { return; }
        this.lastPong = Date.now();
        if (m.t === 'pong') return;
        this.onMessage(m);
      };
      ws.onclose = () => {
        clearInterval(this.hb);
        if (this.ws === ws) {
          this.setOnline(false);
          this.schedule();
        }
      };
      ws.onerror = () => { try { ws.close(); } catch (_) { /* */ } };
    };
    if (now) go();
    else this.timer = setTimeout(go, 0);
  }

  schedule() {
    clearTimeout(this.timer);
    const delay = Math.min(5000, 400 * Math.pow(1.6, this.retry++));
    this.timer = setTimeout(() => this.connect(true), delay);
  }

  beat() {
    if (!this.ws || this.ws.readyState !== 1) return;
    if (Date.now() - this.lastPong > 14000) {
      // 응답 없음 → 강제 재연결
      const ws = this.ws;
      this.ws = null;
      try { ws.close(); } catch (_) { /* */ }
      this.setOnline(false);
      this.connect(true);
      return;
    }
    this.send({ t: 'ping', at: Date.now() });
  }

  setOnline(v) {
    if (this.online === v) return;
    this.online = v;
    this.onStatus(v);
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }
}
