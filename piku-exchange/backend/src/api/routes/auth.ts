import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ASSET, config } from '../../config.js';
import { withTx } from '../../db/pool.js';
import { toUnits } from '../../core/units.js';
import { audit } from '../../lib/audit.js';
import { adjustBalance, UserError } from '../../lib/ledger.js';
import { sendMail } from '../../lib/mailer.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../../lib/totp.js';
import { checkTotp, ip, requireUser, type Ctx } from '../context.js';

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // 거래소 아이디 = Stratum 접속 ID ("아이디.워커이름")이므로 점(.)은 허용하지 않는다
  username: z.string().regex(/^[a-zA-Z0-9_]{3,20}$/, '아이디는 영문/숫자/밑줄 3~20자'),
  password: z.string().min(10, '비밀번호는 10자 이상').max(200),
});

export default async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  app.post('/api/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = registerSchema.parse(req.body);
    const isAdmin = config.adminEmails.includes(body.email);
    const token = randomBytes(24).toString('hex');
    const hash = await hashPassword(body.password);
    const user = await withTx(db, async (c) => {
      const dup = await c.query('SELECT 1 FROM users WHERE email = $1 OR lower(username) = lower($2)', [body.email, body.username]);
      if (dup.rows[0]) throw new UserError('이미 사용 중인 이메일 또는 아이디입니다', 409);
      const { rows } = await c.query(
        `INSERT INTO users (email, username, password_hash, email_verify_token, role, is_operator, email_verified)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, username, role`,
        // 테스트 모드에서 SMTP가 없으면 이메일 인증을 자동 완료 (콘솔에도 링크 출력)
        [body.email, body.username, hash, token, isAdmin ? 'admin' : 'user', isAdmin, !config.realMoney && !config.smtp.host],
      );
      const u = rows[0];
      if (!config.realMoney) {
        await adjustBalance(c, u.id, ASSET.QUOTE, toUnits(config.testModeInitialKrw), 0n, 'test_mode_grant');
      }
      await audit(c, { action: 'user.register', userId: u.id, ip: ip(req), details: { email: u.email, username: u.username, admin: isAdmin } });
      return u;
    });
    await sendMail(user.email, `[${config.coin.name}] 이메일 인증`, `아래 링크를 열어 이메일 인증을 완료하세요.\n${config.appUrl}/verify?token=${token}`);
    return { id: user.id, username: user.username, emailVerificationRequired: config.realMoney || Boolean(config.smtp.host) };
  });

  app.post('/api/auth/verify-email', async (req) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
    const { rows } = await db.query(
      'UPDATE users SET email_verified = true, email_verify_token = NULL WHERE email_verify_token = $1 RETURNING id', [token]);
    if (!rows[0]) throw new UserError('유효하지 않은 인증 링크입니다');
    await audit(db, { action: 'user.email_verified', userId: rows[0].id, ip: ip(req) });
    return { ok: true };
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.object({ login: z.string().trim(), password: z.string(), totp: z.string().optional() }).parse(req.body);
    const { rows } = await db.query(
      `SELECT id, role, password_hash, totp_enabled, totp_secret, totp_last_counter FROM users
       WHERE (email = lower($1) OR lower(username) = lower($1)) AND role <> 'system'`, [body.login]);
    const u = rows[0];
    if (!u || !(await verifyPassword(body.password, u.password_hash))) {
      await audit(db, { action: 'user.login_failed', userId: u?.id ?? null, ip: ip(req), details: { login: body.login } });
      throw new UserError('아이디 또는 비밀번호가 올바르지 않습니다', 401);
    }
    if (u.totp_enabled) {
      if (!body.totp) return { totpRequired: true };
      const counter = verifyTotp(u.totp_secret, body.totp, Number(u.totp_last_counter));
      if (counter === null) throw new UserError('OTP 코드가 올바르지 않습니다', 401);
      await db.query('UPDATE users SET totp_last_counter = $2 WHERE id = $1', [u.id, counter]);
    }
    await audit(db, { action: 'user.login', userId: u.id, ip: ip(req) });
    return { token: app.jwt.sign({ sub: u.id, role: u.role }, { expiresIn: '12h' }) };
  });

  app.get('/api/me', async (req) => {
    const me = await requireUser(req);
    const { rows } = await db.query(
      `SELECT id, email, username, role, email_verified, totp_enabled, is_operator, trading_banned, kyc_status, created_at
       FROM users WHERE id = $1`, [me.id]);
    if (!rows[0]) throw new UserError('사용자 없음', 404);
    return rows[0];
  });

  app.post('/api/auth/resend-verification', async (req) => {
    const me = await requireUser(req);
    const token = randomBytes(24).toString('hex');
    const { rows } = await db.query(
      'UPDATE users SET email_verify_token = $2 WHERE id = $1 AND NOT email_verified RETURNING email', [me.id, token]);
    if (!rows[0]) throw new UserError('이미 인증된 계정입니다');
    await sendMail(rows[0].email, `[${config.coin.name}] 이메일 인증`, `${config.appUrl}/verify?token=${token}`);
    return { ok: true };
  });

  // ---------- 2FA (TOTP) ----------
  app.post('/api/auth/2fa/setup', async (req) => {
    const me = await requireUser(req);
    const { rows } = await db.query('SELECT email, totp_enabled FROM users WHERE id = $1', [me.id]);
    if (rows[0].totp_enabled) throw new UserError('이미 2단계 인증이 켜져 있습니다');
    const secret = generateTotpSecret();
    await db.query('UPDATE users SET totp_secret = $2 WHERE id = $1', [me.id, secret]);
    return { secret, otpauthUri: otpauthUri(secret, rows[0].email, `${config.coin.name} Exchange`) };
  });

  app.post('/api/auth/2fa/enable', async (req) => {
    const me = await requireUser(req);
    const { code } = z.object({ code: z.string() }).parse(req.body);
    const { rows } = await db.query('SELECT totp_secret, totp_last_counter FROM users WHERE id = $1', [me.id]);
    if (!rows[0].totp_secret) throw new UserError('먼저 2FA 설정을 시작하세요');
    const counter = verifyTotp(rows[0].totp_secret, code, Number(rows[0].totp_last_counter));
    if (counter === null) throw new UserError('OTP 코드가 올바르지 않습니다', 401);
    await db.query('UPDATE users SET totp_enabled = true, totp_last_counter = $2 WHERE id = $1', [me.id, counter]);
    await audit(db, { action: 'user.2fa_enabled', userId: me.id, ip: ip(req) });
    return { ok: true };
  });

  app.post('/api/auth/2fa/disable', async (req) => {
    const me = await requireUser(req);
    const { code } = z.object({ code: z.string() }).parse(req.body);
    await checkTotp(db, me.id, code, true);
    await db.query('UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE id = $1', [me.id]);
    await audit(db, { action: 'user.2fa_disabled', userId: me.id, ip: ip(req) });
    return { ok: true };
  });

  // ---------- KYC (인터페이스만) ----------
  app.post('/api/kyc/start', async (req) => {
    const me = await requireUser(req);
    const { rows } = await db.query('SELECT id, email FROM users WHERE id = $1', [me.id]);
    const r = await ctx.kyc.start(rows[0]);
    await db.query('UPDATE users SET kyc_status = $2, kyc_reference = $3 WHERE id = $1', [me.id, r.status, r.reference]);
    await audit(db, { action: 'kyc.start', userId: me.id, ip: ip(req), details: { provider: ctx.kyc.name, status: r.status } });
    return r;
  });
}
