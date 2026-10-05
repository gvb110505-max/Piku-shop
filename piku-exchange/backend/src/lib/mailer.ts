/** 이메일 발송. SMTP 미설정(테스트 모드)이면 콘솔에 링크를 출력한다. */
import nodemailer from 'nodemailer';
import { config } from '../config.js';

const transport = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!transport) {
    console.log(`[mail:console] to=${to} subject="${subject}"\n${text}`);
    return;
  }
  await transport.sendMail({ from: config.smtp.from, to, subject, text });
}
