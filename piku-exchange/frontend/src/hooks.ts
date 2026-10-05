import { useCallback, useEffect, useRef, useState } from 'react';
import { api, auth, socket } from './api';

/** GET 요청 + 지정한 WS 채널 이벤트가 오면 자동 새로고침. */
export function useApi<T>(path: string | null, refreshOn: string[] = [], intervalMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;
  const reload = useCallback(async () => {
    if (!pathRef.current) return;
    try { setData(await api<T>(pathRef.current)); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => {
    setData(null);
    reload();
    let t: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => { if (t) clearTimeout(t); t = setTimeout(reload, 150); };
    const offs = refreshOn.map((ch) => socket.on(ch, debounced));
    const iv = intervalMs ? setInterval(reload, intervalMs) : null;
    return () => { offs.forEach((o) => o()); if (iv) clearInterval(iv); if (t) clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, refreshOn.join(','), intervalMs]);
  return { data, error, reload, setData };
}

/** WS 채널의 최신 데이터 (초기값은 REST로). */
export function useChannel<T>(channel: string, initialPath?: string) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    setData(null);
    if (initialPath) api<T>(initialPath).then(setData).catch(() => {});
    return socket.on(channel, setData);
  }, [channel, initialPath]);
  return data;
}

export function useAuth() {
  const [token, setToken] = useState(auth.token);
  useEffect(() => {
    const h = () => { setToken(auth.token); socket.reconnect(); };
    window.addEventListener('auth', h);
    return () => window.removeEventListener('auth', h);
  }, []);
  return token;
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return now;
}
