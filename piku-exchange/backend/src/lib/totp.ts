/** TOTP(RFC 6238) 2단계 인증. 외부 라이브러리 없이 HMAC-SHA1로 구현. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('잘못된 base32');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = () => base32Encode(randomBytes(20));

export function hotp(secret: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

export const totpCounter = (timeMs = Date.now(), step = 30) => Math.floor(timeMs / 1000 / step);

/**
 * 코드 검증 (앞뒤 1스텝 허용). 이미 사용한 카운터 이하면 거부(재사용 방지).
 * 성공 시 사용한 카운터를, 실패 시 null을 반환.
 */
export function verifyTotp(secret: string, code: string, lastCounter = 0, timeMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpCounter(timeMs);
  for (const c of [now - 1, now, now + 1]) {
    if (c <= lastCounter) continue;
    const expected = Buffer.from(hotp(secret, c));
    if (timingSafeEqual(expected, Buffer.from(code))) return c;
  }
  return null;
}

export const otpauthUri = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
