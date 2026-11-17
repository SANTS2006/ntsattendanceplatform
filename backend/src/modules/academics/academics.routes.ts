import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { registerCrud } from '../../lib/crud.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { created, nullableStr, nullableUuid, ok, pageMeta, paginationQuery, uuidParam } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import { tenantCtx, type TenantContext } from '../../middleware/context.js';
import { audit } from '../audit/audit.service.js';
import { classScopeWhere } from '../attendance/access.js';

export const academicsRouter = Router();
const TAG = 'Academics';
const code = z.string().trim().min(1).max(30).transform((s) => s.toUpperCase());
const name = z.string().trim().min(1).max(150);
const status = z.enum(['ACTIVE', 'ARCHIVED']);
const date = z.coerce.date();

/** Department administrators may only write inside their departments. */
const deptGuard = (field = 'departmentId') => (ctx: TenantContext, data: Record<string, unknown>, existing?: Record<string, unknown>) => {
  const scope = ctx.scope('academics.manage');
  if (scope === 'all') return;
  if (!scope) throw forbidden();
  const target = (data[field] ?? existing?.[field]) as string | null | undefined;
  if (!target || !scope.includes(target)) throw forbidden('This record is outside your department', 'OUT_OF_SCOPE');
};
const deptRead = (field = 'departmentId') => (ctx: TenantContext) => {
  const s = ctx.scope('academics.read') ?? ctx.scope('academics.manage');
  return s === 'all' || s === null ? undefined : { [field]: { in: s } };
};

registerCrud(academicsRouter, {
  path: '/faculties', model: 'faculty', entity: 'Faculty', tag: TAG,
  readPermission: 'academics.read', managePermission: 'academics.manage',
  create: z.object({ name, code, status: status.optional() }),
  searchFields: ['name', 'code'], orderBy: { name: 'asc' }, softDelete: true,
  guardWrite: (ctx) => { if (ctx.scope('academics.manage') !== 'all') throw forbidden(); },
});

registerCrud(academicsRouter, {
  path: '/departments', model: 'department', entity: 'Department', tag: TAG,
  readPermission: 'academics.read', managePermission: 'academics.manage',
  create: z.object({ name, code, facultyId: nullableUuid(), status: status.optional() }),
  filters: { facultyId: z.string().uuid().optional(), status: status.optional() },
  include: { faculty: { select: { id: true, name: true } } },
  searchFields: ['name', 'code'], orderBy: { name: 'asc' }, softDelete: true,
  scopeWhere: (ctx) => { const s = ctx.scope('academics.read') ?? ctx.scope('academics.manage'); return s === 'all' || !s ? undefined : { id: { in: s } }; },
  guardWrite: (ctx) => { if (ctx.scope('academics.manage') !== 'all') throw forbidden(); },
});

registerCrud(academicsRouter, {
  path: '/programs', model: 'program', entity: 'Program', tag: TAG,
  readPermission: 'academics.read', managePermission: 'academics.manage',
  create: z.object({ name, code, departmentId: nullableUuid(), durationYears: z.number().int().min(1).max(10).nullable().optional(), status: status.optional() }),
  filters: { departmentId: z.string().uuid().optional(), status: status.optional() },
  include: { department: { select: { id: true, name: true } } },
  searchFields: ['name', 'code'], orderBy: { name: 'asc' }, softDelete: true,
  scopeWhere: deptRead(), guardWrite: deptGuard(),
});

registerCrud(academicsRouter, {
  path: '/levels', model: 'academicLevel', entity: 'Academic level', tag: TAG,
  readPermission: 'academics.read', managePermission: 'academics.manage',
  create: z.object({ name: z.string().trim().min(1).max(60), rank: z.number().int().min(0).max(100).optional() }),
  searchFields: ['name'], orderBy: { rank: 'asc' },
  guardWrite: (ctx) => { if (ctx.scope('academics.manage') !== 'all') throw forbidden(); },
});

registerCrud(academicsRouter, {
  path: '/academic-years', model: 'academicYear', entity: 'Academic year', tag: TAG,
  readPermission: 'academics.read', managePermission: 'academics.manage',
  create: z.object({ name: z.string().trim().min(1).max(30), startDate: date, endDate: date, isCurrent: z.boolean().optional() }),
  searchFields: ['name'], orderBy: { startDate: 'desc' },
  guardWrite: (ctx) => { if (ctx.scope('academics.manage') !== 'all') throw forbidden(); },
});

registerCrud(academicsRouter, {
  path: '/semesters', model: 'semester', entity: 'Semester', tag: TAG,
  readPermission: 'academics.read', managePermission: 'academics.manage',
  create: z.object({ academicYearId: z.string().uuid(), name: z.string().trim().min(1).max(60), startDate: date, endDate: date, isCurrent: z.boolean().optional() }),
  filters: { academicYearId: z.string().uuid().optional() },
  include: { academicYear: { select: { id: true, name: true } } },
  searchFields: ['name'], orderBy: { startDate: 'desc' },
  guardWrite: (ctx) => { if (ctx.scope('academics.manage') !== 'all') throw forbidden(); },
});

registerCrud(academicsRouter, {
  path: '/courses', model: 'course', entity: 'Course', tag: TAG,
  readPermission: 'academics.read', managePermission: 'academics.manage',
  create: z.object({
    code, title: name, description: nullableStr(2000), credits: z.number().int().min(0).max(100).nullable().optional(),
    departmentId: nullableUuid(), programId: nullableUuid(), levelId: nullableUuid(), status: status.optional(),
  }),
  filters: { departmentId: z.string().uuid().optional(), programId: z.string().uuid().optional(), levelId: z.string().uuid().optional(), status: status.optional() },
  include: { department: { select: { id: true, name: true } }, program: { select: { id: true, name: true } }, level: { select: { id: true, name: true } } },
  searchFields: ['code', 'title'], orderBy: { code: 'asc' }, softDelete: true,
  scopeWhere: deptRead(), guardWrite: deptGuard(),
});

/* Classes: custom list (lecturers see only assigned classes) + CRUD for writes. */
const classBody = z.object({
  name, code, courseId: nullableUuid(), academicYearId: nullableUuid(), semesterId: nullableUuid(), room: nullableStr(80),
  status: status.optional(),
});

const classGuard = async (ctx: TenantContext, data: Record<string, unknown>, existing?: { courseId?: string | null; lecturers?: { lecturerId: string }[] }) => {
  // Classroom coordinates are no longer collected: the reference point is the lecturer's position per session.
  const scope = ctx.scope('academics.manage');
  if (scope === 'all') return;
  if (!scope) {
    // Lecturers create classes (they become the assigned lecturer) and manage only classes assigned to them.
    if (!ctx.has('classes.manage_assigned') || !ctx.lecturerId) throw forbidden();
    if (existing && !existing.lecturers?.some((l) => l.lecturerId === ctx.lecturerId)) throw forbidden('You can only change classes you are assigned to', 'NOT_ASSIGNED');
    return;
  }
  const courseId = (data.courseId ?? existing?.courseId) as string | undefined;
  const course = courseId ? await ctx.db.course.findUnique({ where: { id: courseId }, select: { departmentId: true } }) : null;
  if (!course?.departmentId || !scope.includes(course.departmentId)) throw forbidden('This class is outside your department', 'OUT_OF_SCOPE');
};

const classInclude = {
  course: { select: { id: true, code: true, title: true, departmentId: true } },
  semester: { select: { id: true, name: true } },
  lecturers: { include: { lecturer: { select: { id: true, firstName: true, lastName: true, title: true, email: true } } } },
  _count: { select: { enrollments: true } },
};

registerCrud(academicsRouter, {
  path: '/classes', model: 'class', entity: 'Class', tag: TAG,
  readPermission: ['academics.read', 'attendance.sessions.create'], managePermission: ['academics.manage', 'classes.manage_assigned'],
  create: classBody,
  afterCreate: async (ctx, row) => {
    // A lecturer creating a class is assigned to it as its primary lecturer.
    if (ctx.scope('academics.manage') !== 'all' && ctx.lecturerId) {
      await ctx.db.classLecturer.create({ data: { organizationId: ctx.organizationId, classId: row.id, lecturerId: ctx.lecturerId, role: 'PRIMARY' } });
    }
  },
  filters: { courseId: z.string().uuid().optional(), semesterId: z.string().uuid().optional(), status: status.optional() },
  include: classInclude, searchFields: ['name', 'code'], orderBy: { code: 'asc' }, softDelete: true,
  scopeWhere: (ctx) => classScopeWhere(ctx), guardWrite: classGuard,
});

const r = routes(academicsRouter, '');
const T = [TAG];

async function loadVisibleClass(ctx: TenantContext, id: string) {
  const cls = await ctx.db.class.findFirst({ where: { AND: [{ id }, classScopeWhere(ctx) ?? {}] }, include: { course: { select: { departmentId: true } } } });
  if (!cls) throw notFound('Class');
  return cls;
}

r(
  {
    method: 'post', path: '/classes/:id/lecturers', summary: 'Assign a lecturer to a class', tags: T, access: 'tenant', permission: 'academics.manage',
    params: uuidParam, body: z.object({ lecturerId: z.string().uuid(), role: z.enum(['PRIMARY', 'ASSISTANT']).default('PRIMARY') }),
  },
  async (req, res) => {
    const ctx = tenantCtx(req);
    const cls = await loadVisibleClass(ctx, req.valid.params.id);
    await classGuard(ctx, {}, cls);
    const row = await ctx.db.classLecturer.upsert({
      where: { classId_lecturerId: { classId: cls.id, lecturerId: req.valid.body.lecturerId } },
      create: { organizationId: ctx.organizationId, classId: cls.id, lecturerId: req.valid.body.lecturerId, role: req.valid.body.role },
      update: { role: req.valid.body.role },
    });
    await audit({ action: 'class.lecturer_assigned', targetType: 'Class', targetId: cls.id, metadata: { lecturerId: req.valid.body.lecturerId }, req });
    created(res, row, 'Lecturer assigned');
  },
);

r(
  {
    method: 'delete', path: '/classes/:id/lecturers/:lecturerId', summary: 'Unassign a lecturer from a class', tags: T, access: 'tenant',
    permission: 'academics.manage', params: z.object({ id: z.string().uuid(), lecturerId: z.string().uuid() }),
  },
  async (req, res) => {
    const ctx = tenantCtx(req);
    const cls = await loadVisibleClass(ctx, req.valid.params.id);
    await classGuard(ctx, {}, cls);
    await ctx.db.classLecturer.deleteMany({ where: { classId: cls.id, lecturerId: req.valid.params.lecturerId } });
    await audit({ action: 'class.lecturer_unassigned', targetType: 'Class', targetId: cls.id, metadata: { lecturerId: req.valid.params.lecturerId }, req });
    ok(res, null, { message: 'Lecturer unassigned' });
  },
);

r(
  {
    method: 'get', path: '/classes/:id/students', summary: 'Class roster (enrolled students)', tags: T, access: 'tenant',
    permission: ['academics.read', 'attendance.sessions.create'], params: uuidParam,
    query: paginationQuery.extend({ search: z.string().trim().max(100).optional() }),
  },
  async (req, res) => {
    const ctx = tenantCtx(req);
    const cls = await loadVisibleClass(ctx, req.valid.params.id);
    const q = req.valid.query;
    const where = {
      classId: cls.id, status: 'ACTIVE' as const,
      ...(q.search ? { student: { OR: [{ fullName: { contains: q.search, mode: 'insensitive' as const } }, { studentNumber: { contains: q.search, mode: 'insensitive' as const } }] } } : {}),
    };
    const [items, total] = await Promise.all([
      ctx.db.enrollment.findMany({
        where, skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy: { student: { fullName: 'asc' } },
        include: { student: { select: { id: true, studentNumber: true, fullName: true, email: true, status: true, program: { select: { name: true } }, level: { select: { name: true } } } } },
      }),
      ctx.db.enrollment.count({ where }),
    ]);
    ok(res, items, { meta: pageMeta(q, total) });
  },
);

/* Enrollments */
r(
  {
    method: 'get', path: '/enrollments', summary: 'List enrollments', tags: T, access: 'tenant', permission: ['students.read', 'academics.read'],
    query: paginationQuery.extend({ classId: z.string().uuid().optional(), studentId: z.string().uuid().optional() }),
  },
  async (req, res) => {
    const ctx = tenantCtx(req);
    const q = req.valid.query;
    const scope = classScopeWhere(ctx);
    const where = { ...(q.classId ? { classId: q.classId } : {}), ...(q.studentId ? { studentId: q.studentId } : {}), ...(scope ? { class: scope } : {}) };
    const [items, total] = await Promise.all([
      ctx.db.enrollment.findMany({
        where, skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy: { createdAt: 'desc' },
        include: { class: { select: { id: true, name: true, code: true } }, student: { select: { id: true, studentNumber: true, fullName: true } } },
      }),
      ctx.db.enrollment.count({ where }),
    ]);
    ok(res, items, { meta: pageMeta(q, total) });
  },
);

r(
  {
    method: 'post', path: '/enrollments', summary: 'Enroll students in a class (bulk, idempotent)', tags: T, access: 'tenant', permission: ['students.update', 'classes.manage_assigned'], status: 201,
    body: z.object({ classId: z.string().uuid(), studentIds: z.array(z.string().uuid()).min(1).max(1000) }),
  },
  async (req, res) => {
    const ctx = tenantCtx(req);
    const cls = await loadVisibleClass(ctx, req.valid.body.classId);
    const ids = [...new Set<string>(req.valid.body.studentIds)];
    const students = await ctx.db.student.findMany({ where: { AND: [{ id: { in: ids } }, await enrollableStudentWhere(ctx, cls.course?.departmentId ?? null)] }, select: { id: true } });
    if (students.length !== ids.length) throw notFound('One or more students');
    const result = await ctx.db.enrollment.createMany({
      data: ids.map((studentId) => ({ organizationId: ctx.organizationId, classId: cls.id, studentId })),
      skipDuplicates: true,
    });
    await ctx.db.enrollment.updateMany({ where: { classId: cls.id, studentId: { in: ids }, status: 'DROPPED' }, data: { status: 'ACTIVE' } });
    await audit({ action: 'enrollment.created', targetType: 'Class', targetId: cls.id, metadata: { count: ids.length, studentIds: ids.slice(0, 200) }, req });
    created(res, { enrolled: result.count, requested: ids.length });
  },
);

r(
  { method: 'delete', path: '/enrollments/:id', summary: 'Drop an enrollment', tags: T, access: 'tenant', permission: ['students.update', 'classes.manage_assigned'], params: uuidParam },
  async (req, res) => {
    const ctx = tenantCtx(req);
    const e = await ctx.db.enrollment.findUnique({ where: { id: req.valid.params.id } });
    if (!e) throw notFound('Enrollment');
    await loadVisibleClass(ctx, e.classId);
    await ctx.db.enrollment.update({ where: { id: e.id }, data: { status: 'DROPPED' } });
    await audit({ action: 'enrollment.dropped', targetType: 'Class', targetId: e.classId, metadata: { studentId: e.studentId, enrollmentId: e.id }, req });
    ok(res, null, { message: 'Enrollment dropped' });
  },
);

/**
 * Students a caller may enroll: active students inside the caller's student scope. Callers without
 * students.read (lecturers) are limited to the class's department when it has one.
 */
export async function enrollableStudentWhere(ctx: TenantContext, departmentId: string | null): Promise<Prisma.StudentWhereInput> {
  const s = ctx.scope('students.update') ?? ctx.scope('students.read');
  if (s === 'all') return { status: 'ACTIVE' };
  if (Array.isArray(s)) return { status: 'ACTIVE', departmentId: { in: s } };
  return { status: 'ACTIVE', ...(departmentId ? { departmentId } : {}) };
}

const candidateQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  programId: z.string().uuid().optional(),
  levelId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
});
const candidateSelect = {
  id: true, studentNumber: true, fullName: true, email: true,
  program: { select: { id: true, name: true } }, level: { select: { id: true, name: true } }, department: { select: { id: true, name: true } },
} as const;

/** Students who can be added (not yet actively enrolled), filtered by program/level/department/search. */
export async function candidateStudents(
  ctx: TenantContext, base: Prisma.StudentWhereInput, exclude: Prisma.StudentWhereInput, q: z.infer<typeof candidateQuery>,
) {
  const where: Prisma.StudentWhereInput = {
    AND: [
      base,
      { NOT: exclude },
      q.programId ? { programId: q.programId } : {},
      q.levelId ? { levelId: q.levelId } : {},
      q.departmentId ? { departmentId: q.departmentId } : {},
      q.search ? { OR: [{ fullName: { contains: q.search, mode: 'insensitive' } }, { studentNumber: { contains: q.search, mode: 'insensitive' } }] } : {},
    ],
  };
  const [items, total] = await Promise.all([
    ctx.db.student.findMany({ where, select: candidateSelect, orderBy: { fullName: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ctx.db.student.count({ where }),
  ]);
  return { items, total };
}

r(
  {
    method: 'get', path: '/classes/:id/candidates', summary: 'Students who can be enrolled in a class (filter by program, level, department)', tags: T,
    access: 'tenant', permission: ['students.update', 'classes.manage_assigned'], params: uuidParam, query: candidateQuery,
  },
  async (req, res) => {
    const ctx = tenantCtx(req);
    const cls = await loadVisibleClass(ctx, req.valid.params.id);
    const q = req.valid.query;
    const base = await enrollableStudentWhere(ctx, cls.course?.departmentId ?? null);
    const out = await candidateStudents(ctx, base, { enrollments: { some: { classId: cls.id, status: 'ACTIVE' } } }, q);
    ok(res, out.items, { meta: pageMeta(q, out.total) });
  },
);

export { candidateQuery };
