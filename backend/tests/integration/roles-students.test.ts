import jwt from 'jsonwebtoken';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { syncSystemRolePermissions } from '../../src/modules/organizations/organizations.service.js';
import { api, createOrg, registerUser, resetDb, type Session } from '../helpers.js';

/**
 * Editing permissions of existing roles (built-in and custom) is saved to the database, survives
 * the startup permission sync, and keeps the safeguards; students' programs must match their department.
 */
let owner: Session;
let orgId: string;

beforeAll(async () => {
  await resetDb();
  owner = await registerUser();
  orgId = (await createOrg(owner, 'Roles University')).id;
});
beforeEach(() => {
  const c = jwt.decode(owner.token) as { sub: string; org: string | null; sid: string };
  owner.token = signAccessToken({ sub: c.sub, org: c.org, sid: c.sid });
});

const roleByKey = async (key: string) => {
  const res = await api(owner, 'get', '/roles');
  return res.body.data.find((r: { key: string }) => r.key === key) as { id: string; permissions: string[]; permissionsCustomized: boolean };
};
const dbPerms = async (roleId: string) =>
  (await prisma.rolePermission.findMany({ where: { roleId }, include: { permission: true } })).map((p) => p.permission.key).sort();

describe('editing role permissions', () => {
  it('adds and removes permissions on a built-in role and keeps them after the startup sync', async () => {
    const lecturer = await roleByKey('lecturer');
    expect(lecturer.permissions).toContain('selfies.read');
    const next = [...lecturer.permissions.filter((p) => p !== 'selfies.read'), 'students.read'];

    const res = await api(owner, 'patch', `/roles/${lecturer.id}`, { permissions: next });
    expect(res.status).toBe(200);
    expect(await dbPerms(lecturer.id)).toEqual([...next].sort());

    await syncSystemRolePermissions(); // would re-add selfies.read if the role were not marked customized
    const after = await roleByKey('lecturer');
    expect(after.permissionsCustomized).toBe(true);
    expect(after.permissions).not.toContain('selfies.read');
    expect(after.permissions).toContain('students.read');
  });

  it('does not allow renaming built-in roles', async () => {
    const viewer = await roleByKey('viewer');
    const res = await api(owner, 'patch', `/roles/${viewer.id}`, { name: 'Watcher', permissions: viewer.permissions });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SYSTEM_ROLE');
  });

  it('the Administrator role always keeps "roles.manage"', async () => {
    const admin = await roleByKey('admin');
    const res = await api(owner, 'patch', `/roles/${admin.id}`, { permissions: admin.permissions.filter((p) => p !== 'roles.manage') });
    expect(res.status).toBe(403);
    expect(await dbPerms(admin.id)).toContain('roles.manage');
  });

  it('edits a custom role', async () => {
    const created = await api(owner, 'post', '/roles', { name: 'Registrar', permissions: ['students.read'] });
    expect(created.status).toBe(201);
    const res = await api(owner, 'patch', `/roles/${created.body.data.id}`, { name: 'Registrar', permissions: ['students.read', 'students.update'] });
    expect(res.status).toBe(200);
    expect(await dbPerms(created.body.data.id)).toEqual(['students.read', 'students.update']);
  });
});

describe('student program must belong to the chosen department', () => {
  it('rejects a program from another department and accepts a matching one', async () => {
    const fac = await api(owner, 'post', '/faculties', { name: 'Science', code: 'SCI' });
    const facultyId = fac.body.data?.id;
    const d1 = await api(owner, 'post', '/departments', { name: 'Computing', code: 'CMP', ...(facultyId ? { facultyId } : {}) });
    const d2 = await api(owner, 'post', '/departments', { name: 'Physics', code: 'PHY', ...(facultyId ? { facultyId } : {}) });
    expect(d1.status).toBe(201);
    expect(d2.status).toBe(201);
    const prog = await api(owner, 'post', '/programs', { name: 'BSc Computing', code: 'BSCC', departmentId: d1.body.data.id });
    expect(prog.status).toBe(201);
    const base = { studentNumber: '10000001', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test' };

    const bad = await api(owner, 'post', '/students', { ...base, departmentId: d2.body.data.id, programId: prog.body.data.id });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('PROGRAM_DEPARTMENT_MISMATCH');

    const good = await api(owner, 'post', '/students', { ...base, departmentId: d1.body.data.id, programId: prog.body.data.id });
    expect(good.status).toBe(201);
    expect(await prisma.student.count({ where: { organizationId: orgId } })).toBe(1);
  });
});

describe('role changes stay inside their organization', () => {
  it('editing or creating roles in one organization never changes another organization', async () => {
    const other = await registerUser();
    const otherOrgId = (await createOrg(other, 'Other College')).id;
    const rolesOf = async (s: Session) => (await api(s, 'get', '/roles')).body.data as { id: string; key: string; name: string; permissions: string[]; permissionsCustomized: boolean }[];
    const before = (await rolesOf(other)).find((r) => r.key === 'viewer')!;

    // Organization A removes a permission from its own Viewer role and creates a custom role.
    const mine = await roleByKey('viewer');
    expect(mine.id).not.toBe(before.id); // each organization has its own copy of the built-in roles
    expect((await api(owner, 'patch', `/roles/${mine.id}`, { permissions: mine.permissions.filter((p) => p !== 'reports.read') })).status).toBe(200);
    expect((await api(owner, 'post', '/roles', { name: 'Exam Officer', permissions: ['students.read'] })).status).toBe(201);

    // Organization B is unchanged.
    const after = await rolesOf(other);
    const otherViewer = after.find((r) => r.key === 'viewer')!;
    expect(otherViewer.permissions.sort()).toEqual(before.permissions.sort());
    expect(otherViewer.permissions).toContain('reports.read');
    expect(otherViewer.permissionsCustomized).toBe(false);
    expect(after.some((r) => r.name === 'Exam Officer')).toBe(false);
    expect(await prisma.role.count({ where: { organizationId: otherOrgId, name: 'Exam Officer' } })).toBe(0);

    // Neither organization can reach the other's roles by id.
    expect((await api(owner, 'patch', `/roles/${otherViewer.id}`, { permissions: ['students.read'] })).status).toBe(404);
    expect((await api(owner, 'delete', `/roles/${otherViewer.id}`)).status).toBe(404);
    const otherPerms = (await prisma.rolePermission.findMany({ where: { roleId: otherViewer.id }, include: { permission: true } })).map((p) => p.permission.key).sort();
    expect(otherPerms).toEqual(before.permissions.sort());
  });
});
