import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export type Mail = { to: string; subject: string; text: string; html?: string };

/**
 * Email delivery through Brevo's transactional API (BREVO_API_KEY; MAIL_FROM must be a sender
 * verified in Brevo). In automated tests messages are captured in memory instead.
 */
const outbox: Mail[] = [];

/** "NTSAttend <no-reply@example.com>" → { name, email } */
export function parseSender(from: string) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1].replace(/^"|"$/g, '') || 'NTSAttend', email: m[2].trim() } : { name: 'NTSAttend', email: from.trim() };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Branded HTML version of a plain-text message. Lines indented by four spaces (verification codes)
 * are rendered as a large code box; URLs become buttons.
 */
export function renderHtml(subject: string, text: string) {
  const blocks = text.split(/\n{2,}/).map((block) => {
    const code = /^ {4}([A-Z0-9]{4,8})$/.exec(block);
    if (code) {
      return `<div style="margin:24px 0;text-align:center"><span style="display:inline-block;padding:16px 28px;border-radius:14px;background:#eff5ff;border:1px solid #bfd6fe;font:700 32px/1 'SFMono-Regular',Consolas,monospace;letter-spacing:10px;color:#0b1f4d">${code[1]}</span></div>`;
    }
    const lines = block.split('\n').map((line) => {
      const url = /^(.*?)(https?:\/\/\S+)\s*$/.exec(line);
      if (url) {
        return `${escapeHtml(url[1])}<br><a href="${escapeHtml(url[2])}" style="display:inline-block;margin-top:8px;padding:12px 22px;border-radius:12px;background:linear-gradient(135deg,#1d4ed8,#0ea5e9);color:#fff;text-decoration:none;font-weight:600">Open NTSAttend</a>`;
      }
      return escapeHtml(line);
    });
    return `<p style="margin:0 0 16px;font:15px/1.6 Segoe UI,Roboto,Arial,sans-serif;color:#1e293b">${lines.join('<br>')}</p>`;
  });
  return `<!doctype html><html><body style="margin:0;background:#f1f5fb;padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(11,31,77,.12)">
<tr><td style="background:linear-gradient(135deg,#081633,#1d4ed8 60%,#0ea5e9);padding:24px 28px">
<img src="${env.APP_URL}/logo-192.png" width="44" height="44" alt="" style="vertical-align:middle;border:0">
<span style="vertical-align:middle;margin-left:10px;font:700 22px Segoe UI,Roboto,Arial,sans-serif;color:#fff">NTSAttend</span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 18px;font:700 20px Segoe UI,Roboto,Arial,sans-serif;color:#0b1f4d">${escapeHtml(subject)}</h1>
${blocks.join('\n')}
</td></tr>
<tr><td style="padding:16px 28px;background:#f8fafc;font:12px Segoe UI,Roboto,Arial,sans-serif;color:#64748b">Secure QR attendance · This is an automated message, please do not reply.</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendMail(mail: Mail): Promise<void> {
  const html = mail.html ?? renderHtml(mail.subject, mail.text);
  if (env.isTest) {
    outbox.push({ ...mail, html });
    if (outbox.length > 500) outbox.shift();
    return;
  }
  await sendViaBrevo({ ...mail, html });
}

/** Brevo transactional API call (exported for unit tests). */
export async function sendViaBrevo(mail: Mail & { html: string }, apiKey = env.BREVO_API_KEY!, from = env.MAIL_FROM) {
  const html = mail.html;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: parseSender(from), to: [{ email: mail.to }], subject: mail.subject, textContent: mail.text, htmlContent: html }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300); // Brevo error bodies contain no secrets
    throw new Error(`Brevo send failed (${res.status}): ${body}`);
  }
  logger.info({ to: mail.to, subject: mail.subject }, 'email sent via Brevo');
}

/** Test helper: captured messages (NODE_ENV=test only). */
export const testOutbox = () => outbox;
