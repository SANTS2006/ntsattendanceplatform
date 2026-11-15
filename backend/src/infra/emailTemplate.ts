import { env } from '../config/env.js';

/**
 * NTSAttend email template. Every email is described as structured content and rendered into a
 * branded HTML version (table layout + inline styles, so it works in Gmail, Outlook and Apple Mail)
 * and a matching plain-text version. All dynamic values are HTML-escaped.
 */
export type EmailTone = 'brand' | 'security' | 'success';
export type EmailContent = {
  /** Hidden inbox preview line shown next to the subject. */
  preheader: string;
  /** Small label above the title, e.g. "Verify your email". */
  eyebrow?: string;
  title: string;
  /** Recipient's first name — "Hello Ada,". Omit for generic emails. */
  name?: string;
  paragraphs: string[];
  /** One-time code shown in a large box. */
  code?: { value: string; caption?: string };
  /** Primary call to action. */
  action?: { label: string; url: string; caption?: string };
  /** Key facts as a two-column table (e.g. organization, role, expiry). */
  details?: [string, string][];
  /** Quoted message (support replies). */
  quote?: { from: string; text: string };
  /** Short closing notes under the main content (expiry, "ignore if this wasn't you"). */
  notes?: string[];
  /** Highlighted safety tip, used for codes and account changes. */
  securityTip?: string;
  tone?: EmailTone;
  /** Why the recipient got this email (footer). */
  reason: string;
};

export const APP_NAME = 'NTSAttend';
export const COMPANY = 'NTS Digital Solutions';
export const TAGLINE = 'Secure QR attendance for universities, schools and events';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Consolas,'Liberation Mono',monospace";

const TONES: Record<EmailTone, { accent: string; soft: string; border: string; badge: string }> = {
  brand: { accent: '#1d4ed8', soft: '#eff5ff', border: '#bfd6fe', badge: '#0ea5e9' },
  security: { accent: '#b45309', soft: '#fff7ed', border: '#fed7aa', badge: '#f59e0b' },
  success: { accent: '#047857', soft: '#ecfdf5', border: '#a7f3d0', badge: '#22c55e' },
};

/** Absolute links to the public site (EMAIL_BASE_URL, else APP_URL); no tracking parameters. */
export const appLink = (path = '/') => `${env.EMAIL_BASE_URL}${path}`;

export function renderEmail(c: EmailContent): { html: string; text: string } {
  const t = TONES[c.tone ?? 'brand'];
  const year = new Date().getUTCFullYear();
  const p = (s: string) => `<p style="margin:0 0 14px;font:15px/1.65 ${FONT};color:#334155">${esc(s)}</p>`;

  const sections: string[] = [];
  if (c.name) sections.push(p(`Hello ${c.name},`));
  sections.push(...c.paragraphs.map(p));

  if (c.code) {
    sections.push(`
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0 8px"><tr><td align="center">
  <div style="display:inline-block;padding:18px 26px;border-radius:16px;background:${t.soft};border:1px solid ${t.border}">
    <span style="font:700 34px/1 ${MONO};letter-spacing:10px;color:#0b1f4d">${esc(c.code.value)}</span>
  </div>
  ${c.code.caption ? `<p style="margin:10px 0 0;font:13px/1.5 ${FONT};color:#64748b">${esc(c.code.caption)}</p>` : ''}
</td></tr></table>`);
  }

  if (c.quote) {
    sections.push(`
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 18px"><tr>
  <td style="border-left:4px solid ${t.badge};background:#f8fafc;border-radius:0 12px 12px 0;padding:14px 18px">
    <p style="margin:0 0 6px;font:700 12px/1.4 ${FONT};letter-spacing:.06em;text-transform:uppercase;color:#64748b">${esc(c.quote.from)}</p>
    <p style="margin:0;font:15px/1.65 ${FONT};color:#1e293b;white-space:pre-wrap">${esc(c.quote.text)}</p>
  </td></tr></table>`);
  }

  if (c.details?.length) {
    const rows = c.details
      .map(([k, v], i) => `<tr><td style="padding:10px 14px;font:13px ${FONT};color:#64748b;${i ? 'border-top:1px solid #eef2f7;' : ''}width:38%">${esc(k)}</td><td style="padding:10px 14px;font:600 14px ${FONT};color:#0b1f4d;${i ? 'border-top:1px solid #eef2f7;' : ''}word-break:break-word">${esc(v)}</td></tr>`)
      .join('');
    sections.push(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 20px;border:1px solid #e2e8f0;border-radius:14px;border-collapse:separate;overflow:hidden">${rows}</table>`);
  }

  if (c.action) {
    sections.push(`
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 6px"><tr>
  <td style="border-radius:12px;background:${t.accent};background-image:linear-gradient(135deg,${t.accent},#0ea5e9)">
    <a href="${esc(c.action.url)}" style="display:inline-block;padding:14px 26px;font:700 15px ${FONT};color:#ffffff;text-decoration:none;border-radius:12px">${esc(c.action.label)} &rarr;</a>
  </td></tr></table>
<p style="margin:10px 0 18px;font:12px/1.6 ${FONT};color:#94a3b8">${esc(c.action.caption ?? 'Button not working? Copy this link into your browser:')}<br><a href="${esc(c.action.url)}" style="color:${t.accent};word-break:break-all">${esc(c.action.url)}</a></p>`);
  }

  if (c.notes?.length) sections.push(...c.notes.map((n) => `<p style="margin:0 0 10px;font:13px/1.6 ${FONT};color:#64748b">${esc(n)}</p>`));

  if (c.securityTip) {
    sections.push(`
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 0"><tr>
  <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;font:13px/1.55 ${FONT};color:#475569">
    <strong style="color:#0b1f4d">&#128274; Security tip:</strong> ${esc(c.securityTip)}
  </td></tr></table>`);
  }

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(c.title)}</title></head>
<body style="margin:0;padding:0;background:#eef3fa">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(c.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3fa"><tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px">
    <!-- Header -->
    <tr><td style="border-radius:20px 20px 0 0;background:#0b1f4d;background-image:linear-gradient(135deg,#081633 0%,#1d4ed8 58%,#0ea5e9 100%);padding:26px 30px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
        <td><a href="${esc(appLink('/'))}" style="text-decoration:none">
          <img src="${esc(appLink('/logo-192.png'))}" width="40" height="40" alt="" style="vertical-align:middle;border:0;border-radius:10px">
          <span style="vertical-align:middle;margin-left:10px;font:800 22px ${FONT};color:#ffffff;letter-spacing:-.01em">${APP_NAME}</span></a></td>
        ${c.eyebrow ? `<td align="right"><span style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.14);font:700 11px ${FONT};letter-spacing:.08em;text-transform:uppercase;color:#cffafe">${esc(c.eyebrow)}</span></td>` : ''}
      </tr></table>
      <p style="margin:14px 0 0;font:13px ${FONT};color:rgba(255,255,255,.75)">${TAGLINE}</p>
    </td></tr>
    <!-- Body -->
    <tr><td style="background:#ffffff;padding:32px 30px 26px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
      <h1 style="margin:0 0 18px;font:800 22px/1.3 ${FONT};color:#0b1f4d">${esc(c.title)}</h1>
      ${sections.join('\n')}
      <p style="margin:22px 0 0;font:15px/1.6 ${FONT};color:#334155">— The ${APP_NAME} team</p>
    </td></tr>
    <!-- Footer -->
    <tr><td style="border-radius:0 0 20px 20px;background:#f8fafc;border:1px solid #e2e8f0;border-top:0;padding:22px 30px">
      <p style="margin:0 0 10px;font:12px/1.6 ${FONT};color:#64748b">${esc(c.reason)}</p>
      <p style="margin:0 0 10px;font:12px/1.6 ${FONT}">
        <a href="${esc(appLink('/login'))}" style="color:#1d4ed8;text-decoration:none;font-weight:600">Sign in</a> &nbsp;·&nbsp;
        <a href="${esc(appLink('/app/support'))}" style="color:#1d4ed8;text-decoration:none;font-weight:600">Help &amp; support</a> &nbsp;·&nbsp;
        <a href="${esc(appLink('/privacy'))}" style="color:#1d4ed8;text-decoration:none;font-weight:600">Privacy</a> &nbsp;·&nbsp;
        <a href="${esc(appLink('/terms'))}" style="color:#1d4ed8;text-decoration:none;font-weight:600">Terms</a>
      </p>
      <p style="margin:0;font:11px/1.6 ${FONT};color:#94a3b8">This is an automated message from ${APP_NAME} — replies to this address are not monitored.<br>&copy; ${year} ${COMPANY}. All rights reserved.</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  // Plain-text alternative (also what spam filters and screen readers in some clients use).
  const lines: string[] = [];
  if (c.name) lines.push(`Hello ${c.name},`, '');
  for (const para of c.paragraphs) lines.push(para, '');
  if (c.code) lines.push(`    ${c.code.value}`, '', ...(c.code.caption ? [c.code.caption, ''] : []));
  if (c.quote) lines.push(`${c.quote.from}:`, ...c.quote.text.split('\n').map((l) => `> ${l}`), '');
  if (c.details?.length) lines.push(...c.details.map(([k, v]) => `${k}: ${v}`), '');
  if (c.action) lines.push(`${c.action.label}: ${c.action.url}`, '');
  if (c.notes?.length) for (const n of c.notes) lines.push(n, '');
  if (c.securityTip) lines.push(`Security tip: ${c.securityTip}`, '');
  lines.push(`— The ${APP_NAME} team`, '', '--', c.reason, `${APP_NAME} · ${TAGLINE}`, `Help: ${appLink('/app/support')} · Privacy: ${appLink('/privacy')} · Terms: ${appLink('/terms')}`, `© ${year} ${COMPANY}`);
  return { html, text: lines.join('\n') };
}
