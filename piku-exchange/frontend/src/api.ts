/** API/WebSocket 클라이언트. */
const TOKEN_KEY = 'piku_token';

export const auth = {
  get token() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(token: string | null) {
    try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* 무시 */ }
    window.dispatchEvent(new Event('auth'));
  },
};

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;
  const res = await fetch(path, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && auth.token && path !== '/api/auth/login') auth.set(null);
    throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

type Listener = (data: any) => void;

/** 자동 재연결되는 단일 WebSocket. 채널 구독 관리. */
class Socket {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private retry = 0;

  connect() {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws${auth.token ? `?token=${auth.token}` : ''}`;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.retry = 0;
      const chans = [...this.listeners.keys()].filter((c) => !c.startsWith('user:'));
      if (chans.length) this.ws!.send(JSON.stringify({ op: 'sub', channels: chans }));
    };
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (!msg.ch) return;
      const key = msg.ch.startsWith('user:') ? 'user' : msg.ch;
      this.listeners.get(key)?.forEach((l) => l(msg.data));
    };
    this.ws.onclose = () => setTimeout(() => this.connect(), Math.min(10_000, 500 * 2 ** this.retry++));
  }

  reconnect() { this.ws?.close(); }

  /** 채널 구독. 'user'는 로그인한 사용자 본인 이벤트. 반환값은 구독 해제 함수. */
  on(channel: string, fn: Listener): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
      if (channel !== 'user' && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op: 'sub', channels: [channel] }));
    }
    this.listeners.get(channel)!.add(fn);
    return () => { this.listeners.get(channel)?.delete(fn); };
  }
}

export const socket = new Socket();
