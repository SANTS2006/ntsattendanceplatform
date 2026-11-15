import type { Prisma } from '@prisma/client';
import type { PermissionKey } from '../../config/permissions.js';
import { forbidden, notFound } from '../../lib/errors.js';
import type { TenantContext } from '../../middleware/context.js';

/**
 * Object-level authorization for classes, events, sessions and attendance records.
 *
 * A user may act on a class/event when ANY of these hold:
 *  - an organization-wide grant of the relevant "all" permission
 *  - a department-scoped grant covering the class's course department
 *  - they are the assigned lecturer (ClassLecturer / EventManager) or created the session
 */
type Mode = 'manage' | 'read';

const allPerm = (mode: Mode): PermissionKey => (mode === 'manage' ? 'attendance.sessions.manage_all' : 'attendance.read_all');
const ownPerm = (mode: Mode): PermissionKey => (mode === 'manage' ? 'attendance.sessions.create' : 'attendance.read_assigned');

/** WHERE clause on AttendanceSession limiting rows to what the caller may see/manage. */
export function sessionScopeWhere(ctx: TenantContext, mode: Mode): Prisma.AttendanceSessionWhereInput {
  const all = ctx.scope(allPerm(mode));
  if (all === 'all') return {};
  const or: Prisma.AttendanceSessionWhereInput[] = [];
  if (Array.isArray(all)) or.push({ class: { course: { departmentId: { in: all } } } });
  // Read access to "all" also implies being able to read the sessions one manages.
  const own = ctx.has(ownPerm(mode)) || ctx.has(ownPerm('manage')) || (mode === 'read' && ctx.has('attendance.sessions.create'));
  if (own && ctx.lecturerId) {
    or.push({ lecturerId: ctx.lecturerId });
    or.push({ class: { lecturers: { some: { lecturerId: ctx.lecturerId } } } });
    or.push({ event: { managers: { some: { lecturerId: ctx.lecturerId } } } });
  }
  if (own) or.push({ createdByUserId: ctx.userId });
  if (or.length === 0) throw forbidden();
  return { OR: or };
}

export function recordScopeWhere(ctx: TenantContext): Prisma.AttendanceRecordWhereInput {
  const s = sessionScopeWhere(ctx, 'read');
  return Object.keys(s).length ? { session: s } : {};
}

/** Throws unless the caller may create/manage sessions for this class or event. */
export async function assertCanManageTarget(ctx: TenantContext, target: { classId?: string | null; eventId?: string | null }) {
  const all = ctx.scope('attendance.sessions.manage_all');
  if (target.classId) {
    const cls = await ctx.db.class.findUnique({
      where: { id: target.classId },
      include: { course: { select: { departmentId: true } }, lecturers: { select: { lecturerId: true } } },
    });
    if (!cls || cls.status !== 'ACTIVE') throw notFound('Class');
    if (all === 'all') return cls;
    if (Array.isArray(all) && cls.course?.departmentId && all.includes(cls.course.departmentId)) return cls;
    if (ctx.has('attendance.sessions.create') && ctx.lecturerId && cls.lecturers.some((l) => l.lecturerId === ctx.lecturerId)) return cls;
    throw forbidden('You are not assigned to this class', 'NOT_ASSIGNED');
  }
  if (target.eventId) {
    const ev = await ctx.db.event.findUnique({ where: { id: target.eventId }, include: { managers: { select: { lecturerId: true } } } });
    if (!ev || ev.status !== 'ACTIVE') throw notFound('Event');
    if (all === 'all' || (ctx.has('events.manage') && ctx.has('attendance.sessions.create'))) return ev;
    if (ctx.has('attendance.sessions.create') && ctx.lecturerId && ev.managers.some((m) => m.lecturerId === ctx.lecturerId)) return ev;
    throw forbidden('You are not assigned to this event', 'NOT_ASSIGNED');
  }
  throw forbidden();
}

/** Loads a session the caller may access in the given mode, or 404 (never reveals existence). */
export async function loadSession(ctx: TenantContext, id: string, mode: Mode) {
  const s = await ctx.db.attendanceSession.findFirst({
    where: { AND: [{ id }, sessionScopeWhere(ctx, mode)] },
    include: {
      class: { select: { id: true, name: true, code: true, course: { select: { id: true, code: true, title: true } } } },
      event: { select: { id: true, name: true } },
      lecturer: { select: { id: true, firstName: true, lastName: true, title: true } },
    },
  });
  if (!s) throw notFound('Attendance session');
  return s;
}

/** Classes the caller may see when only assignment-scoped. Returns undefined when unrestricted. */
export function classScopeWhere(ctx: TenantContext): Prisma.ClassWhereInput | undefined {
  const unrestricted = (['academics.manage', 'attendance.read_all', 'attendance.sessions.manage_all'] as const).some(
    (p) => ctx.scope(p) === 'all',
  );
  if (unrestricted) return undefined;
  const or: Prisma.ClassWhereInput[] = [];
  for (const p of ['academics.read', 'academics.manage', 'attendance.read_all'] as const) {
    const s = ctx.scope(p);
    if (Array.isArray(s)) or.push({ course: { departmentId: { in: s } } });
  }
  // Lecturers only see the classes they are assigned to.
  if (ctx.lecturerId) or.push({ lecturers: { some: { lecturerId: ctx.lecturerId } } });
  return or.length ? { OR: or } : { id: { in: [] } };
}

/** Same rule for events: lecturers only see events they manage unless granted events.manage. */
export function eventScopeWhere(ctx: TenantContext): Prisma.EventWhereInput | undefined {
  if (ctx.has('events.manage') || ctx.scope('attendance.read_all') === 'all' || ctx.scope('attendance.sessions.manage_all') === 'all') {
    return undefined;
  }
  if (ctx.lecturerId) return { managers: { some: { lecturerId: ctx.lecturerId } } };
  return ctx.has('events.read') ? undefined : { id: { in: [] } };
}
