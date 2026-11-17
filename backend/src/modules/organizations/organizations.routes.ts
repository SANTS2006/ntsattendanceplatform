import { Router } from 'express';
import { z } from 'zod';
import { created, ok, optStr, pageMeta, paginationQuery } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import { tenantCtx } from '../../middleware/context.js';
import { imageUpload } from '../media/image.js';
import * as svc from './organizations.service.js';

export const organizationsRouter = Router();
const r = routes(organizationsRouter, '/organizations');
const T = ['Organizations'];

const orgType = z.enum(['UNIVERSITY', 'COLLEGE', 'SCHOOL', 'TRAINING_INSTITUTION', 'EVENT_ORGANIZER', 'OTHER']);
const orgBody = z.object({
  name: z.string().trim().min(2).max(150),
  type: orgType,
  officialEmail: z.string().trim().toLowerCase().email(),
  contactNumber: optStr(30),
  country: z.string().trim().min(2).max(80),
  address: optStr(300),
  timezone: z.string().trim().min(1).max(64),
  website: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().url().max(200).optional()),
  description: optStr(2000),
});

r({ method: 'post', path: '/', summary: 'Register a new organization (caller becomes owner)', tags: T, access: 'user', body: orgBody, status: 201 }, async (req, res) =>
  created(res, await svc.createOrganization(req.auth!.sub, req.auth!.sid, req.valid.body, req), 'Organization created'),
);

r({ method: 'get', path: '/current', summary: 'Active organization profile', tags: T, access: 'tenant' }, async (req, res) =>
  ok(res, await svc.getCurrent(tenantCtx(req))),
);

r(
  { method: 'patch', path: '/current', summary: 'Update organization profile', tags: T, access: 'tenant', permission: 'organization.manage', body: orgBody.partial() },
  async (req, res) => ok(res, await svc.updateCurrent(tenantCtx(req), req.valid.body, req)),
);

r(
  {
    method: 'post', path: '/current/logo', summary: 'Upload organization logo', tags: T, access: 'tenant', permission: 'organization.manage',
    multipart: true, middleware: [imageUpload.single('file')],
  },
  async (req, res) => ok(res, await svc.uploadLogo(tenantCtx(req), req.file?.buffer, req)),
);

r({ method: 'delete', path: '/current/logo', summary: 'Remove organization logo', tags: T, access: 'tenant', permission: 'organization.manage' }, async (req, res) =>
  ok(res, await svc.removeLogo(tenantCtx(req), req), { message: 'Logo removed' }),
);

r({ method: 'get', path: '/current/overview', summary: 'Organization dashboard statistics', tags: T, access: 'tenant' }, async (req, res) =>
  ok(res, await svc.overview(tenantCtx(req))),
);

r({ method: 'get', path: '/settings', summary: 'Organization configuration', tags: T, access: 'tenant' }, async (req, res) =>
  ok(res, await svc.getSettings(tenantCtx(req))),
);

const settingsBody = z
  .object({
    studentIdExactLength: z.number().int().min(1).max(64).nullable(),
    studentIdMinLength: z.number().int().min(1).max(64),
    studentIdMaxLength: z.number().int().min(1).max(64),
    studentIdCharset: z.enum(['NUMERIC', 'ALPHA', 'ALPHANUMERIC', 'CUSTOM']),
    studentIdCustomPattern: z.string().regex(/^[A-Za-z0-9\-_/.]{1,40}$/, 'Only letters, digits, ranges and - _ / . are allowed').nullable(),
    studentIdPrefix: z.string().trim().max(10).nullable(),
    studentIdSuffix: z.string().trim().max(10).nullable(),
    studentIdCaseSensitive: z.boolean(),
    studentIdAllowSpaces: z.boolean(),
    studentIdExample: z.string().trim().max(64).nullable(),
    locationRequired: z.boolean(),
    /** Student readings less precise than this are "uncertain" (retry). The 20 m distance itself is fixed. */
    studentMaxAccuracyM: z.number().int().min(5, 'Use at least 5 m').max(100, 'Use at most 100 m'),
    /** The lecturer's reference reading must be at least this precise. */
    lecturerMaxAccuracyM: z.number().int().min(5, 'Use at least 5 m').max(50, 'Use at most 50 m'),
    maxLocationAgeSeconds: z.number().int().min(5).max(300),
    locationTimeoutSeconds: z.number().int().min(10).max(180),
    locationSampleCount: z.number().int().min(1).max(20),
    selfieRequired: z.boolean(),
    requireEnrollment: z.boolean(),
    defaultSessionDurationMin: z.number().int().min(1).max(24 * 60),
    defaultQrExpiryMin: z.number().int().min(1).max(24 * 60),
    lateAfterMin: z.number().int().min(1).max(24 * 60).nullable(),
    allowLateAttendance: z.boolean(),
    imageRetentionDays: z.number().int().min(1).max(3650),
    maxFailedLocationAttempts: z.number().int().min(1).max(100),
  })
  .partial();

r(
  { method: 'patch', path: '/settings', summary: 'Update organization configuration', tags: T, access: 'tenant', permission: 'settings.manage', body: settingsBody },
  async (req, res) => ok(res, await svc.updateSettings(tenantCtx(req), req.valid.body, req)),
);

r(
  {
    method: 'get', path: '/audit-logs', summary: 'Organization audit trail', tags: T, access: 'tenant', permission: 'audit.read',
    query: paginationQuery.extend({ action: z.string().max(80).optional() }),
  },
  async (req, res) => {
    const out = await svc.auditLogs(tenantCtx(req), req.valid.query);
    ok(res, out.items, { meta: pageMeta(req.valid.query, out.total) });
  },
);
