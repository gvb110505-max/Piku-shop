export const fmt = (v: string | number | null | undefined, digits = 8) => {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('ko-KR', { maximumFractionDigits: digits });
};
export const krw = (v: string | number | null | undefined) => fmt(v, 2);
export const pct = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? '-' : `${(v * 100).toFixed(digits)}%`);

export function hashrate(h: number | null | undefined) {
  if (!h) return '0 H/s';
  const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s'];
  let i = 0;
  while (h >= 1000 && i < units.length - 1) { h /= 1000; i++; }
  return `${h.toFixed(2)} ${units[i]}`;
}

export const time = (v: string | number | Date | null | undefined) => (v ? new Date(v).toLocaleString('ko-KR') : '-');
export const shortTime = (v: string | number | Date) => new Date(v).toLocaleTimeString('ko-KR', { hour12: false });

export function countdown(ms: number) {
  if (ms <= 0) return '00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export const statusLabel: Record<string, string> = {
  pre: '상장 전', auction: '콜옥션', settled: '정산 완료', paused: '일시정지',
  PRE_LISTING: '상장 전', CALL_AUCTION: '콜옥션 진행 중', LISTED: '상장됨',
  open: '미체결', filled: '체결', canceled: '취소', pending: '대기', approved: '승인', sending: '전송 중', sent: '전송 완료',
  rejected: '거절', failed: '실패', credited: '입금 완료', orphaned: '무효(고아)', immature: '미성숙', confirmed: '확정',
  delivered: '인도 완료', partial: '부분 인도', seller_default: '매도자 불이행', buyer_default: '매수자 불이행',
};
