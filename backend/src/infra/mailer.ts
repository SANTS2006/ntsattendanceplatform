import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { renderEmail } from './emailTemplate.js';

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

/**
 * Branded HTML for a plain-text message (fallback for mail queued without structured content).
 * A block indented by four spaces (a verification code) becomes the code box; URLs stay links.
 */
export function renderHtml(subject: string, text: string) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim() ? b : '').filter(Boolean);
  const codeBlock = text.split(/\n{2,}/).map((b) => /^ {4}([A-Z0-9]{4,8})$/.exec(b)).find(Boolean);
  return renderEmail({
    preheader: blocks[0]?.slice(0, 120) ?? subject,
    title: subject,
    paragraphs: blocks.filter((b) => !/^ {4}[A-Z0-9]{4,8}$/.test(b) && !/^\s*[A-Z0-9]{4,8}$/.test(b)),
    code: codeBlock ? { value: codeBlock[1] } : undefined,
    reason: 'You received this email because of activity on your NTSAttend account.',
  }).html;
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
