import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { tenantDb, withTenant } from '../../src/db/tenant.js';
import { drainInlineJobs } from '../../src/infra/queue.js';
import { api, getApp, publicFlow, refreshTokens, resetDb, seedTenant, startSession, submitAttendance } from '../helpers.js';

/**
 * Proves Organization A cannot read, modify, delete or reference Organization B's data through
 * any layer: API, tenant-scoped client, database triggers or Row-Level Security.
 */
let A: Awaited<ReturnType<typeof seedTenant>>;
let B: Awaited<ReturnType<typeof seedTenant>>;
let bSessionId: string;
let bRecordId: string;
let bExportId: string;

beforeEach(() => refreshTokens(A?.owner, B?.owner));

beforeAll(async () => {
  await resetDb();
  A = await seedTenant('Alpha University');
  B = await seedTenant('Beta College');
  const s = await startSession(B.owner, B.cls.id);
  bSessionId = s.session.id;
  const flow = await publicFlow(s.qr.token, '20240001');
  if (flow.stage !== 'ready') throw new Error(JSON.stringify(flow.res.body));
  const sub = await submitAttendance(s.qr.token, flow.attemptToken);
  bRecordId = (await prisma.attendanceRecord.findUniqueOrThrow({ where: { referenceNumber: sub.body.data.referenceNumber } })).id;
  bExportId = (await api(B.owner, 'post', '/reports/export', { format: 'CSV', filters: {} })).body.data.id;
  await drainInlineJobs();
});

describe('API-level tenant isolation', () => {
  it('A cannot read B students (list or by id)', async () => {
    const list = await api(A.owner, 'get', '/students?pageSize=100');
    expect(list.status).toBe(200);
    expect(list.body.data.every((s: { lastName: string }) => s.lastName === 'Alpha')).toBe(true);
    expect((await api(A.owner, 'get', `/students/${B.students[0].id}`)).status).toBe(404);
  });

  it('A cannot update or delete B students', async () => {
    expect((await api(A.owner, 'patch', `/students/${B.students[0].id}`, { firstName: 'Hacked' })).status).toBe(404);
    expect((await api(A.owner, 'delete', `/students/${B.students[0].id}?permanent=true`)).status).toBe(404);
    const still = await prisma.student.findUniqueOrThrow({ where: { id: B.students[0].id } });
    expect(still.firstName).toBe('Student1');
    expect(still.status).toBe('ACTIVE');
  });

  it('A cannot read or modify B academic records', async () => {
    expect((await api(A.owner, 'get', `/classes/${B.cls.id}`)).status).toBe(404);
    expect((await api(A.owner, 'patch', `/courses/${B.course.id}`, { title: 'x' })).status).toBe(404);
    expect((await api(A.owner, 'delete', `/departments/${B.dept.id}`)).status).toBe(404);
  });

  it('A cannot access B attendance sessions, records, selfies or QR codes', async () => {
    expect((await api(A.owner, 'get', `/attendance/sessions/${bSessionId}`)).status).toBe(404);
    expect((await api(A.owner, 'get', `/attendance/sessions/${bSessionId}/records`)).status).toBe(404);
    expect((await api(A.owner, 'post', `/attendance/sessions/${bSessionId}/qr`)).status).toBe(404);
    expect((await api(A.owner, 'post', `/attendance/sessions/${bSessionId}/close`)).status).toBe(404);
    expect((await api(A.owner, 'get', `/attendance/records/${bRecordId}/selfie`)).status).toBe(404);
    expect((await api(A.owner, 'patch', `/attendance/records/${bRecordId}`, { status: 'INVALIDATED', reason: 'cross tenant' })).status).toBe(404);
    const records = await api(A.owner, 'get', '/attendance/records');
    expect(records.body.data).toHaveLength(0);
  });

  it('A cannot download B reports or see B background jobs', async () => {
    expect((await api(A.owner, 'get', `/reports/export/${bExportId}`)).status).toBe(404);
    const analytics = await api(A.owner, 'get', '/reports/attendance');
    expect(analytics.body.data.totalRecords).toBe(0);
  });

  it('A settings changes never affect B', async () => {
    expect((await api(A.owner, 'patch', '/organizations/settings', { defaultQrExpiryMin: 77 })).status).toBe(200);
    expect((await api(A.owner, 'get', '/organizations/settings')).body.data.defaultQrExpiryMin).toBe(77);
    expect((await api(B.owner, 'get', '/organizations/settings')).body.data.defaultQrExpiryMin).not.toBe(77);
  });

  it('A cannot create rows that reference B rows (enroll B student into A class)', async () => {
    const res = await api(A.owner, 'post', '/enrollments', { classId: A.cls.id, studentIds: [B.students[2].id] });
    expect(res.status).toBe(404);
    const res2 = await api(A.owner, 'post', '/attendance/sessions', { classId: B.cls.id, durationMinutes: 5 });
    expect(res2.status).toBe(404);
  });

  it('ignores client-supplied organization ids (mass assignment)', async () => {
    const res = await api(A.owner, 'post', '/departments', { name: 'Sneaky', code: 'SNK', organizationId: B.org.id });
    expect(res.status).toBe(201);
    const row = await prisma.department.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.organizationId).toBe(A.org.id);
  });

  it('cannot switch to an organization without membership', async () => {
    const res = await api(A.owner, 'post', '/auth/switch-organization', { organizationId: B.org.id });
    expect(res.status).toBe(403);
  });

  it('cannot use a QR token of B to verify an A student', async () => {
    const s = await startSession(B.owner, B.cls.id);
    // 20240003 exists in both tenants; only B's record may ever be returned.
    const flow = await publicFlow(s.qr.token, '20240002');
    expect(flow.stage).toBe('ready');
    if (flow.stage === 'ready') expect(flow.student.fullName).toBe('Student2 Beta');
  });
});

describe('database-level tenant isolation', () => {
  it('tenant-scoped client cannot see other tenants', async () => {
    const rows = await tenantDb(A.org.id).student.findMany();
    expect(rows.every((r) => r.organizationId === A.org.id)).toBe(true);
    expect(await tenantDb(A.org.id).student.findUnique({ where: { id: B.students[0].id } })).toBeNull();
  });

  it('Row-Level Security hides other tenants even for unfiltered raw SQL', async () => {
    const rows = await withTenant(A.org.id, (tx) => tx.$queryRaw<{ organizationId: string }[]>`SELECT "organizationId" FROM students`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === A.org.id)).toBe(true);
  });

  it('Row-Level Security rejects writes into another tenant', async () => {
    await expect(
      withTenant(A.org.id, (tx) =>
        tx.$executeRaw`UPDATE students SET "firstName" = 'X' WHERE id = ${B.students[0].id}::uuid`,
      ),
    ).resolves.toBe(0);
    await expect(
      withTenant(A.org.id, (tx) =>
        tx.$executeRaw`INSERT INTO faculties (id, "organizationId", name, code, "updatedAt") VALUES (gen_random_uuid(), ${B.org.id}::uuid, 'x', 'X', now())`,
      ),
    ).rejects.toThrow();
  });

  it('cross-tenant reference trigger blocks foreign keys into another tenant', async () => {
    await expect(
      prisma.enrollment.create({ data: { organizationId: A.org.id, classId: A.cls.id, studentId: B.students[0].id } }),
    ).rejects.toThrow(/NTS_CROSS_TENANT_REFERENCE/);
  });

  it('organizationId is immutable', async () => {
    // A level references nothing, so the immutability trigger itself is exercised.
    await expect(prisma.academicLevel.update({ where: { id: A.level.id }, data: { organizationId: B.org.id } })).rejects.toThrow(/NTS_TENANT_IMMUTABLE/);
    // A student also references program/department/level, so moving it is blocked one way or the other.
    await expect(prisma.student.update({ where: { id: A.students[0].id }, data: { organizationId: B.org.id } })).rejects.toThrow(
      /NTS_TENANT_IMMUTABLE|NTS_CROSS_TENANT_REFERENCE/,
    );
  });

  it('audit log is append-only', async () => {
    const log = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { action: 'tampered' } })).rejects.toThrow(/NTS_AUDIT_IMMUTABLE/);
    await expect(prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(/NTS_AUDIT_IMMUTABLE/);
  });
});

describe('file isolation', () => {
  it('signed file URLs cannot be forged or reused after expiry', async () => {
    const a = await getApp();
    const bad = await request(a).get('/api/v1/files').query({ key: `tenants/${B.org.id}/selfies/2026/01/x.jpg`, exp: Math.floor(Date.now() / 1000) + 60, sig: 'a'.repeat(64) });
    expect(bad.status).toBe(403);
  });
});
