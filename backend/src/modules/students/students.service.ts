import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { validateStudentId } from '../../lib/studentId.js';
import type { TenantContext } from '../../middleware/context.js';
import { audit } from '../audit/audit.service.js';
import { classScopeWhere } from '../attendance/access.js';
import { settingsFor } from '../organizations/settings.js';

export type StudentInput = {
  studentNumber: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  programId?: string | null;
  departmentId?: string | null;
  levelId?: string | null;
  academicYear?: string | null;
  status?: 'ACTIVE' | 'INACTIVE' | 'GRADUATED' | 'SUSPENDED';
  metadata?: Record<string, string>;
};

/** Department-scoped administrators only see students of their departments. */
function scopeWhere(ctx: TenantContext): Prisma.StudentWhereInput {
  const dept = ctx.departmentFilter('students.read');
  return dept ? { departmentId: dept } : {};
}

function assertDeptWrite(ctx: TenantContext, perm: 'students.create' | 'students.update' | 'students.delete', departmentId: string | null | undefined) {
  const scope = ctx.scope(perm);
  if (scope === null) throw forbidden();
  if (scope !== 'all' && (!departmentId || !scope.includes(departmentId))) {
    throw forbidden('Students must belong to a department you manage', 'OUT_OF_SCOPE');
  }
}

export async function normalizeNumber(organizationId: string, raw: string) {
  const v = validateStudentId(raw, await settingsFor(organizationId));
  if (!v.valid) throw badRequest(v.reason, 'INVALID_STUDENT_ID', { studentNumber: [v.reason] });
  return v.normalized;
}

const listInclude = {
  program: { select: { id: true, name: true, code: true } },
  department: { select: { id: true, name: true } },
  level: { select: { id: true, name: true } },
} satisfies Prisma.StudentInclude;

export async function list(
  ctx: TenantContext,
  q: { page: number; pageSize: number; search?: string; programId?: string; departmentId?: string; levelId?: string; status?: string; classId?: string; sort?: string },
) {
  const where: Prisma.StudentWhereInput = {
    AND: [
      scopeWhere(ctx),
      q.programId ? { programId: q.programId } : {},
      q.departmentId ? { departmentId: q.departmentId } : {},
      q.levelId ? { levelId: q.levelId } : {},
      q.status ? { status: q.status as Prisma.EnumStudentStatusFilter['equals'] } : {},
      q.classId ? { enrollments: { some: { classId: q.classId, status: 'ACTIVE' } } } : {},
      q.search
        ? {
            OR: [
              { studentNumber: { contains: q.search, mode: 'insensitive' } },
              { fullName: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {},
    ],
  };
  const [field, dir] = (q.sort ?? 'fullName:asc').split(':');
  const orderBy = { [['fullName', 'studentNumber', 'createdAt'].includes(field) ? field : 'fullName']: dir === 'desc' ? 'desc' : 'asc' };
  const [items, total] = await Promise.all([
    ctx.db.student.findMany({ where, include: listInclude, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ctx.db.student.count({ where }),
  ]);
  return { items, total };
}

export async function get(ctx: TenantContext, id: string) {
  const s = await ctx.db.student.findFirst({
    where: { AND: [{ id }, scopeWhere(ctx)] },
    include: {
      ...listInclude,
      enrollments: { include: { class: { select: { id: true, name: true, code: true, course: { select: { code: true, title: true } } } } } },
      _count: { select: { attendance: true } },
    },
  });
  if (!s) throw notFound('Student');
  return s;
}

export async function create(ctx: TenantContext, input: StudentInput, req: Request) {
  assertDeptWrite(ctx, 'students.create', input.departmentId);
  const normalized = await normalizeNumber(ctx.organizationId, input.studentNumber);
  const exists = await ctx.db.student.findFirst({ where: { normalizedNumber: normalized }, select: { id: true } });
  if (exists) throw conflict('A student with this ID already exists', 'STUDENT_ID_TAKEN');
  const s = await ctx.db.student.create({
    data: {
      organizationId: ctx.organizationId,
      ...input,
      studentNumber: input.studentNumber.trim(),
      normalizedNumber: normalized,
      fullName: `${input.firstName} ${input.lastName}`.trim(),
      email: input.email?.toLowerCase() ?? null,
    },
    include: listInclude,
  });
  await audit({ action: 'student.created', targetType: 'Student', targetId: s.id, req });
  return s;
}

export async function update(ctx: TenantContext, id: string, input: Partial<StudentInput>, req: Request) {
  const existing = await get(ctx, id);
  assertDeptWrite(ctx, 'students.update', input.departmentId !== undefined ? input.departmentId : existing.departmentId);
  const data: Prisma.StudentUncheckedUpdateInput = { ...input };
  if (input.studentNumber !== undefined) {
    const normalized = await normalizeNumber(ctx.organizationId, input.studentNumber);
    const clash = await ctx.db.student.findFirst({ where: { normalizedNumber: normalized, NOT: { id } }, select: { id: true } });
    if (clash) throw conflict('A student with this ID already exists', 'STUDENT_ID_TAKEN');
    data.normalizedNumber = normalized;
    data.studentNumber = input.studentNumber.trim();
  }
  if (input.firstName !== undefined || input.lastName !== undefined) {
    data.fullName = `${input.firstName ?? existing.firstName} ${input.lastName ?? existing.lastName}`.trim();
  }
  if (input.email !== undefined) data.email = input.email?.toLowerCase() ?? null;
  const s = await ctx.db.student.update({ where: { id }, data, include: listInclude });
  await audit({ action: 'student.updated', targetType: 'Student', targetId: id, metadata: { fields: Object.keys(input) }, req });
  return s;
}

/** Deactivates by default; permanent deletion only when no attendance history exists. */
export async function remove(ctx: TenantContext, id: string, permanent: boolean, req: Request) {
  const s = await get(ctx, id);
  assertDeptWrite(ctx, 'students.delete', s.departmentId);
  if (permanent) {
    if (s._count.attendance > 0) throw conflict('Students with attendance history cannot be permanently deleted; deactivate instead', 'HAS_ATTENDANCE');
    await ctx.db.student.delete({ where: { id } });
  } else {
    await ctx.db.student.update({ where: { id }, data: { status: 'INACTIVE' } });
  }
  await audit({ action: permanent ? 'student.deleted' : 'student.deactivated', targetType: 'Student', targetId: id, req });
}

export async function attendanceHistory(ctx: TenantContext, id: string, q: { page: number; pageSize: number }) {
  await get(ctx, id);
  const classScope = classScopeWhere(ctx);
  const where: Prisma.AttendanceRecordWhereInput = { studentId: id, ...(classScope ? { session: { class: classScope } } : {}) };
  const [items, total] = await Promise.all([
    ctx.db.attendanceRecord.findMany({
      where, orderBy: { submittedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      select: { id: true, referenceNumber: true, submittedAt: true, attendanceDate: true, status: true, contextSnapshot: true, locationVerified: true, sessionId: true },
    }),
    ctx.db.attendanceRecord.count({ where }),
  ]);
  return { items, total };
}
