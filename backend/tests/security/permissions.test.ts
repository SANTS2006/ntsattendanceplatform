import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { PASSWORD, api, getApp, registerUser, resetDb, seedTenant, startSession, type Session } from '../helpers.js';
import request from 'supertest';

let T: Awaited<ReturnType<typeof seedTenant>>;
let lecturer: Session;
let lecturerId: string;
let otherClassId: string;

async function joinAs(roleKey: string, opts: { createLecturer?: boolean; departmentId?: string } = {}) {
  const roles = (await api(T.owner, 'get', '/roles')).body.data as { id: string; key: string }[];
  const role = roles.find((r) => r.key === roleKey)!;
  const user = await registerUser();
  const inv = await api(T.owner, 'post', '/organizations/invitations', { email: user.email, roleId: role.id, createLecturer: opts.createLecturer, departmentId: opts.departmentId });
  expect(inv.status).toBe(201);
  const accept = await request(await getApp()).post('/api/v1/invitations/accept').set('Authorization', `Bearer ${user.token}`).send({ token: inv.body.data._testToken });
  expect(accept.status).toBe(200);
  user.token = accept.body.data.accessToken;
  return user;
}

beforeAll(async () => {
  await resetDb();
  T = await seedTenant('Gamma Institute');
  lecturer = await joinAs('lecturer', { createLecturer: true });
  lecturerId = (await prisma.lecturer.findFirstOrThrow({ where: { email: lecturer.email } })).id;
  await api(T.owner, 'post', `/classes/${T.cls.id}/lecturers`, { lecturerId });
  otherClassId = (await api(T.owner, 'post', '/classes', { name: 'Group B', code: 'CS201-B', courseId: T.course.id })).body.data.id;
});

describe('lecturer object-level permissions', () => {
  it('sees only assigned classes', async () => {
    const res = await api(lecturer, 'get', '/classes');
    expect(res.body.data.map((c: { id: string }) => c.id)).toEqual([T.cls.id]);
    expect((await api(lecturer, 'get', `/classes/${otherClassId}`)).status).toBe(404);
  });

  it('can run attendance for an assigned class but not an unassigned one', async () => {
    expect((await api(lecturer, 'post', '/attendance/sessions', { classId: T.cls.id, durationMinutes: 10 })).status).toBe(201);
    const denied = await api(lecturer, 'post', '/attendance/sessions', { classId: otherClassId, durationMinutes: 10, locationRequired: false });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('NOT_ASSIGNED');
  });

  it('cannot manage sessions created by others for other classes', async () => {
    const s = await startSession(T.owner, otherClassId, { locationRequired: false });
    expect((await api(lecturer, 'get', `/attendance/sessions/${s.session.id}`)).status).toBe(404);
    expect((await api(lecturer, 'post', `/attendance/sessions/${s.session.id}/close`)).status).toBe(404);
  });

  it('cannot manage students, members, settings or roles', async () => {
    expect((await api(lecturer, 'get', '/students')).status).toBe(403);
    expect((await api(lecturer, 'post', '/students', { studentNumber: '20249999', firstName: 'a', lastName: 'b' })).status).toBe(403);
    expect((await api(lecturer, 'patch', '/organizations/settings', { selfieRequired: false })).status).toBe(403);
    expect((await api(lecturer, 'post', '/roles', { name: 'Root', permissions: ['students.delete'] })).status).toBe(403);
    expect((await api(lecturer, 'get', '/organizations/members')).status).toBe(403);
  });
});

describe('platform separation', () => {
  it('organization owners cannot access platform APIs', async () => {
    for (const url of ['/platform/dashboard', '/platform/organizations', '/platform/users', '/platform/audit-logs', '/platform/analytics']) {
      const res = await api(T.owner, 'get', url);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLATFORM_FORBIDDEN');
    }
  });

  it('super admin can manage organizations and every action is audited', async () => {
    const admin = await registerUser();
    await prisma.platformAdmin.create({ data: { userId: admin.userId, role: 'SUPER_ADMIN' } });
    const list = await api(admin, 'get', '/platform/organizations');
    expect(list.status).toBe(200);
    expect(list.body.data.some((o: { id: string }) => o.id === T.org.id)).toBe(true);
    const sus = await api(admin, 'patch', `/platform/organizations/${T.org.id}/status`, { status: 'SUSPENDED', reason: 'Testing suspension' });
    expect(sus.status).toBe(200);
    // Suspended organizations are locked out immediately
    const blocked = await api(T.owner, 'get', '/students');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('ORGANIZATION_INACTIVE');
    await api(admin, 'patch', `/platform/organizations/${T.org.id}/status`, { status: 'ACTIVE', reason: 'Reactivate' });
    expect((await api(T.owner, 'get', '/students')).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { actorUserId: admin.userId, actorType: 'PLATFORM_ADMIN' } })).toBe(2);
  });
});

describe('privilege escalation', () => {
  it('a member with roles.manage cannot grant permissions they do not hold', async () => {
    const all = (await api(T.owner, 'get', '/roles')).body.data;
    const roleRes = await api(T.owner, 'post', '/roles', { name: 'Role Manager', permissions: ['roles.manage', 'members.manage', 'members.read'] });
    expect(roleRes.status).toBe(201);
    const mgr = await registerUser();
    const inv = await api(T.owner, 'post', '/organizations/invitations', { email: mgr.email, roleId: roleRes.body.data.id });
    const acc = await request(await getApp()).post('/api/v1/invitations/accept').set('Authorization', `Bearer ${mgr.token}`).send({ token: inv.body.data._testToken });
    mgr.token = acc.body.data.accessToken;
    const esc = await api(mgr, 'post', '/roles', { name: 'Everything', permissions: ['students.delete'] });
    expect(esc.status).toBe(403);
    expect(esc.body.code).toBe('PRIVILEGE_ESCALATION');
    const admin = all.find((r: { key: string }) => r.key === 'admin');
    const me = (await api(T.owner, 'get', '/organizations/members?pageSize=100')).body.data.find((m: { user: { email: string } }) => m.user.email === mgr.email);
    const self = await api(mgr, 'put', `/organizations/members/${me.id}/roles`, { roles: [{ roleId: admin.id }] });
    expect(self.status).toBe(403);
  });

  it('invitations are single-use and email-bound', async () => {
    const roles = (await api(T.owner, 'get', '/roles')).body.data as { id: string; key: string }[];
    const target = await registerUser();
    const other = await registerUser();
    const inv = await api(T.owner, 'post', '/organizations/invitations', { email: target.email, roleId: roles.find((r) => r.key === 'viewer')!.id });
    const a = await getApp();
    const wrong = await request(a).post('/api/v1/invitations/accept').set('Authorization', `Bearer ${other.token}`).send({ token: inv.body.data._testToken });
    expect(wrong.status).toBe(403);
    expect((await request(a).post('/api/v1/invitations/accept').set('Authorization', `Bearer ${target.token}`).send({ token: inv.body.data._testToken })).status).toBe(200);
    expect((await request(a).post('/api/v1/invitations/accept').set('Authorization', `Bearer ${target.token}`).send({ token: inv.body.data._testToken })).status).toBe(400);
  });

  it('new users accept an invitation by creating an account', async () => {
    const roles = (await api(T.owner, 'get', '/roles')).body.data as { id: string; key: string }[];
    const email = `newcomer-${Date.now()}@example.test`;
    const inv = await api(T.owner, 'post', '/organizations/invitations', { email, roleId: roles.find((r) => r.key === 'viewer')!.id });
    const res = await request(await getApp()).post('/api/v1/invitations/accept').send({ token: inv.body.data._testToken, firstName: 'New', lastName: 'Comer', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.activeOrganizationId).toBe(T.org.id);
  });
});

describe('unauthenticated access', () => {
  it('protected routes require authentication', async () => {
    for (const url of ['/students', '/attendance/sessions', '/attendance/records', '/reports/attendance', '/organizations/current']) {
      expect((await api(null, 'get', url)).status).toBe(401);
    }
  });
});
