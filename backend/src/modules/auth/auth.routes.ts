import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { ok, created } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import { csrfGuard } from '../../middleware/csrf.js';
import { limits } from '../../middleware/rateLimit.js';
import * as auth from './auth.service.js';
import { passwordSchema } from './password.js';
import { imageUpload } from '../media/image.js';

export const REFRESH_COOKIE = 'nts_rt';
const COOKIE_PATH = '/api/v1/auth';

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent'), req });

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
}
const clearRefreshCookie = (res: Response) =>
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: env.cookieSecure, sameSite: 'strict', path: COOKIE_PATH });

/** Never put the refresh token in a response body: it lives only in the HttpOnly cookie. */
function sessionBody(s: Awaited<ReturnType<typeof auth.issueSession>>) {
  const { refreshToken: _rt, refreshTokenId: _id, ...rest } = s;
  return rest;
}

const email = z.string().trim().toLowerCase().email().max(254);
const name = z.string().trim().min(1).max(80);

export const authRouter = Router();
const r = routes(authRouter, '/auth');
const T = ['Authentication'];

r({ method: 'get', path: '/config', summary: 'Public sign-in options (e.g. Google client id)', tags: T, access: 'public' }, async (_req, res) =>
  ok(res, { googleClientId: env.GOOGLE_CLIENT_ID ?? null, emailCodeLength: 6 }),
);

r(
  {
    method: 'post', path: '/register', summary: 'Start sign-up: emails a 6-character verification code', tags: T, access: 'public', status: 202,
    description: 'No account is created until the code is confirmed at /auth/register/verify. The response is identical whether or not the email is already registered.',
    middleware: [limits.register()],
    body: z.object({
      email, password: passwordSchema, firstName: name, lastName: name, phone: z.string().trim().max(30).optional(),
      acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must agree to the Terms of Service and Privacy Policy' }) }),
    }),
  },
  async (req, res) => ok(res, await auth.startRegistration(req.valid.body, meta(req)), { status: 202, message: 'Check your email for a 6-character verification code.' }),
);

r(
  {
    method: 'post', path: '/register/verify', summary: 'Confirm the emailed code and create the account', tags: T, access: 'public', status: 201,
    middleware: [limits.emailVerify()],
    body: z.object({ email, code: z.string().trim().regex(/^[A-Za-z0-9]{6}$/, 'Enter the 6-character code') }),
  },
  async (req, res) => {
    const s = await auth.verifyRegistration(req.valid.body.email, req.valid.body.code, meta(req));
    setRefreshCookie(res, s.refreshToken);
    created(res, sessionBody(s), 'Email verified — your account is ready.');
  },
);

r(
  { method: 'post', path: '/register/resend', summary: 'Resend the sign-up verification code', tags: T, access: 'public', middleware: [limits.passwordReset()], body: z.object({ email }) },
  async (req, res) => ok(res, await auth.resendRegistrationCode(req.valid.body.email), { message: 'If a sign-up is pending for this email, a new code has been sent.' }),
);

r(
  {
    method: 'post', path: '/google', summary: 'Sign in or sign up with a Google ID token (Google Identity Services)', tags: T, access: 'public',
    middleware: [limits.loginIp()], body: z.object({ credential: z.string().min(20).max(4096) }),
  },
  async (req, res) => {
    const r2 = await auth.googleSignIn(req.valid.body.credential, meta(req));
    if (r2.mfaRequired) return ok(res, r2, { message: 'Multi-factor verification required' });
    setRefreshCookie(res, r2.refreshToken);
    const { refreshToken: _rt, refreshTokenId: _id, ...body } = r2;
    ok(res, body, { status: r2.created ? 201 : 200, message: r2.created ? 'Account created with Google' : 'Signed in with Google' });
  },
);

r(
  {
    method: 'post', path: '/login', summary: 'Sign in', tags: T, access: 'public',
    middleware: [limits.loginIp(), limits.login()],
    body: z.object({ email, password: z.string().min(1).max(128) }),
  },
  async (req, res) => {
    const result = await auth.login(req.valid.body, meta(req));
    if (result.mfaRequired) return ok(res, result, { message: 'Multi-factor verification required' });
    setRefreshCookie(res, result.refreshToken);
    ok(res, { mfaRequired: false, ...sessionBody(result) }, { message: 'Signed in' });
  },
);

r(
  {
    method: 'post', path: '/mfa/verify', summary: 'Complete sign-in with a TOTP code', tags: T, access: 'public',
    middleware: [limits.login()],
    body: z.object({ mfaToken: z.string().min(10), code: z.string().regex(/^\d{6}$/) }),
  },
  async (req, res) => {
    const s = await auth.verifyMfaLogin(req.valid.body.mfaToken, req.valid.body.code, meta(req));
    setRefreshCookie(res, s.refreshToken);
    ok(res, { mfaRequired: false, ...sessionBody(s) }, { message: 'Signed in' });
  },
);

r(
  {
    method: 'post', path: '/refresh', summary: 'Rotate the refresh cookie and get a new access token', tags: T, access: 'public',
    description: 'Requires header `X-NTS-CSRF: 1`. Reuse of a rotated refresh token revokes the whole session family.',
    middleware: [limits.refresh(), csrfGuard],
  },
  async (req, res) => {
    try {
      const s = await auth.refresh(req.cookies?.[REFRESH_COOKIE], meta(req));
      setRefreshCookie(res, s.refreshToken);
      ok(res, sessionBody(s), { message: 'Session refreshed' });
    } catch (e) {
      clearRefreshCookie(res);
      throw e;
    }
  },
);

r(
  { method: 'post', path: '/logout', summary: 'Sign out (revokes this device session)', tags: T, access: 'public', middleware: [csrfGuard] },
  async (req, res) => {
    await auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearRefreshCookie(res);
    ok(res, null, { message: 'Signed out' });
  },
);

r(
  { method: 'post', path: '/verify-email', summary: 'Verify email address', tags: T, access: 'public', middleware: [limits.emailVerify()], body: z.object({ token: z.string().min(20).max(200) }) },
  async (req, res) => {
    await auth.verifyEmail(req.valid.body.token);
    ok(res, null, { message: 'Email verified' });
  },
);

r(
  { method: 'post', path: '/resend-verification', summary: 'Resend the verification email', tags: T, access: 'user', middleware: [limits.passwordReset()] },
  async (req, res) => {
    await auth.resendVerification(req.auth!.sub);
    ok(res, null, { message: 'If your email is not yet verified, a new link has been sent' });
  },
);

r(
  { method: 'post', path: '/forgot-password', summary: 'Request a password reset email', tags: T, access: 'public', middleware: [limits.passwordReset()], body: z.object({ email }) },
  async (req, res) => {
    await auth.forgotPassword(req.valid.body.email, meta(req));
    ok(res, null, { message: 'If an account exists for this email, a reset link has been sent' });
  },
);

r(
  {
    method: 'post', path: '/reset-password', summary: 'Reset password with a reset token', tags: T, access: 'public',
    middleware: [limits.passwordReset()], body: z.object({ token: z.string().min(20).max(200), password: passwordSchema }),
  },
  async (req, res) => {
    await auth.resetPassword(req.valid.body.token, req.valid.body.password, meta(req));
    ok(res, null, { message: 'Password updated. Please sign in.' });
  },
);

r(
  {
    method: 'post', path: '/change-password', summary: 'Change password (signs out other devices)', tags: T, access: 'user',
    body: z.object({ currentPassword: z.string().max(128).optional(), newPassword: passwordSchema }),
  },
  async (req, res) => {
    await auth.changePassword(req.auth!.sub, req.valid.body.currentPassword, req.valid.body.newPassword, req.auth!.sid, meta(req));
    ok(res, null, { message: 'Password changed' });
  },
);

r({ method: 'get', path: '/me', summary: 'Current user, memberships and active organization', tags: T, access: 'user' }, async (req, res) => {
  ok(res, await auth.me(req.auth!.sub, req.auth!.org));
});

r(
  {
    method: 'patch', path: '/me', summary: 'Update own profile', tags: T, access: 'user',
    body: z.object({ firstName: name.optional(), lastName: name.optional(), phone: z.string().trim().max(30).nullable().optional() }),
  },
  async (req, res) => ok(res, await auth.updateProfile(req.auth!.sub, req.valid.body)),
);

r(
  { method: 'post', path: '/switch-organization', summary: 'Switch the active organization', tags: T, access: 'user', body: z.object({ organizationId: z.string().uuid() }) },
  async (req, res) => ok(res, await auth.switchOrganization(req.auth!.sub, req.auth!.sid, req.valid.body.organizationId)),
);

r({ method: 'get', path: '/sessions', summary: 'List active device sessions', tags: T, access: 'user' }, async (req, res) =>
  ok(res, await auth.listSessions(req.auth!.sub, req.auth!.sid)),
);

r(
  { method: 'delete', path: '/sessions/:id', summary: 'Revoke a device session', tags: T, access: 'user', params: z.object({ id: z.string().uuid() }) },
  async (req, res) => {
    await auth.revokeSession(req.auth!.sub, req.valid.params.id);
    ok(res, null, { message: 'Session revoked' });
  },
);

r({ method: 'post', path: '/mfa/setup', summary: 'Begin TOTP MFA enrolment', tags: T, access: 'user' }, async (req, res) =>
  ok(res, await auth.mfaSetup(req.auth!.sub)),
);
r(
  { method: 'post', path: '/mfa/enable', summary: 'Confirm TOTP MFA enrolment', tags: T, access: 'user', body: z.object({ code: z.string().regex(/^\d{6}$/) }) },
  async (req, res) => {
    await auth.mfaEnable(req.auth!.sub, req.valid.body.code, req);
    ok(res, null, { message: 'Multi-factor authentication enabled' });
  },
);
r(
  {
    method: 'post', path: '/mfa/disable', summary: 'Disable TOTP MFA', tags: T, access: 'user',
    body: z.object({ password: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) }),
  },
  async (req, res) => {
    await auth.mfaDisable(req.auth!.sub, req.valid.body.password, req.valid.body.code, req);
    ok(res, null, { message: 'Multi-factor authentication disabled' });
  },
);

/* ── Profile picture ─────────────────────────────────────────────────────── */
r(
  {
    method: 'post', path: '/me/avatar', summary: 'Upload a profile picture (JPEG/PNG/WebP ≤ 5 MB)', tags: T, access: 'user',
    multipart: true, middleware: [limits.passwordReset(), imageUpload.single('file')],
  },
  async (req, res) => ok(res, await auth.uploadAvatar(req.auth!.sub, req.file?.buffer, req), { message: 'Profile picture updated' }),
);
r({ method: 'delete', path: '/me/avatar', summary: 'Remove the profile picture', tags: T, access: 'user' }, async (req, res) =>
  ok(res, await auth.removeAvatar(req.auth!.sub, req), { message: 'Profile picture removed' }),
);

/* ── Email change (code sent to the new address) ─────────────────────────── */
r(
  {
    method: 'post', path: '/email-change', summary: 'Start an email change: emails a 6-character code to the new address', tags: T, access: 'user',
    description: 'Accounts with a password must confirm it. The current address is alerted.',
    middleware: [limits.passwordReset()],
    body: z.object({ newEmail: email, password: z.string().max(128).optional() }),
  },
  async (req, res) => ok(res, await auth.startEmailChange(req.auth!.sub, req.valid.body, req), { status: 202, message: 'Check the new inbox for a 6-character code.' }),
);
r({ method: 'post', path: '/email-change/resend', summary: 'Resend the email-change code', tags: T, access: 'user', middleware: [limits.passwordReset()] }, async (req, res) =>
  ok(res, await auth.resendEmailChange(req.auth!.sub, req), { message: 'A new code has been sent' }),
);
r(
  {
    method: 'post', path: '/email-change/verify', summary: 'Confirm the new email with the emailed code', tags: T, access: 'user',
    middleware: [limits.emailVerify()], body: z.object({ code: z.string().trim().regex(/^[A-Za-z0-9]{6}$/, 'Enter the 6-character code') }),
  },
  async (req, res) => ok(res, await auth.confirmEmailChange(req.auth!.sub, req.valid.body.code, req), { message: 'Email address updated' }),
);
r({ method: 'delete', path: '/email-change', summary: 'Cancel a pending email change', tags: T, access: 'user' }, async (req, res) => {
  await auth.cancelEmailChange(req.auth!.sub);
  ok(res, null, { message: 'Email change cancelled' });
});
