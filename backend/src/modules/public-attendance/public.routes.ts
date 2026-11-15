import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import { limits } from '../../middleware/rateLimit.js';
import { imageUpload } from '../media/image.js';
import * as svc from './public.service.js';

/**
 * Anonymous endpoints used by students' phones after scanning a QR code.
 * No accounts; access is constrained by: unguessable QR token → signed attempt token →
 * per-step rate limits → per-client failure caps → server-side revalidation on submit.
 */
export const publicAttendanceRouter = Router();
const r = routes(publicAttendanceRouter, '/public/attendance');
const T = ['Public attendance'];
const tokenParam = z.object({ token: z.string().min(10).max(100) });
const attempt = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h);

// No caching of any public attendance response.
publicAttendanceRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

r(
  {
    method: 'get', path: '/confirmation/:reference', summary: 'Retrieve an attendance confirmation (requires the confirmation token)', tags: T,
    access: 'public', middleware: [limits.publicConfirmation()],
    params: z.object({ reference: z.string().max(40) }), query: z.object({ token: z.string().max(64).optional() }),
  },
  async (req, res) => ok(res, await svc.confirmation(req.valid.params.reference, req.valid.query.token)),
);

r(
  { method: 'post', path: '/:token/validate', summary: 'Validate a scanned QR code and start an attempt', tags: T, access: 'public', middleware: [limits.publicValidate()], params: tokenParam },
  async (req, res) => ok(res, await svc.validate(req.valid.params.token, req)),
);

r(
  {
    method: 'post', path: '/:token/verify-student', summary: 'Verify a student ID for this session (header X-Attempt-Token)', tags: T, access: 'public',
    middleware: [limits.publicVerifyStudent()], params: tokenParam, body: z.object({ studentId: z.string().max(80) }),
  },
  async (req, res) => ok(res, await svc.verifyStudent(req.valid.params.token, attempt(req.headers['x-attempt-token']), req.valid.body.studentId, req), { message: 'Student verified' }),
);

const coords = z.object({
  latitude: z.number().finite().nullable().optional(),
  longitude: z.number().finite().nullable().optional(),
  accuracy: z.number().finite().nonnegative().max(100_000).nullable().optional(),
});

r(
  {
    method: 'post', path: '/:token/verify-location', summary: 'Server-side geofence check of device coordinates', tags: T, access: 'public',
    middleware: [limits.publicLocation()], params: tokenParam, body: coords,
  },
  async (req, res) => ok(res, await svc.verifyLocation(req.valid.params.token, attempt(req.headers['x-attempt-token']), req.valid.body, req)),
);

r(
  {
    method: 'post', path: '/:token/upload-selfie', summary: 'Upload the selfie (multipart field "file"; JPEG/PNG/WebP ≤ 5 MB)', tags: T, access: 'public',
    multipart: true, middleware: [limits.publicUpload(), imageUpload.single('file')], params: tokenParam,
  },
  async (req, res) => ok(res, await svc.uploadSelfie(req.valid.params.token, attempt(req.headers['x-attempt-token']), req.file?.buffer, req), { status: 201, message: 'Photo uploaded' }),
);

r(
  {
    method: 'post', path: '/:token/submit', summary: 'Submit attendance (requires Idempotency-Key header)', tags: T, access: 'public',
    middleware: [limits.publicSubmit()], params: tokenParam, body: coords.extend({ selfieId: z.string().uuid().nullable().optional() }),
  },
  async (req, res) => {
    const out = await svc.submit(req.valid.params.token, attempt(req.headers['x-attempt-token']), req.get('idempotency-key'), req.valid.body, req);
    ok(res, out, { status: out.idempotentReplay ? 200 : 201, message: svc.MESSAGES.SUCCESS });
  },
);
