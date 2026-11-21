import type { Request } from 'express';
import type { AttendanceSession, Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { emitToSession } from '../../infra/realtime.js';
import { imageStorage } from '../../infra/storage.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { haversineMeters } from '../../lib/geo.js';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors.js';
import { dateInZone, timeInZone } from '../../lib/time.js';
import type { TenantContext } from '../../middleware/context.js';
import { audit } from '../audit/audit.service.js';
import { settingsFor } from '../organizations/settings.js';
import { assertCanManageTarget, loadSession, recordScopeWhere, sessionScopeWhere } from './access.js';
import { isValidPoint, MAX_DISTANCE_METERS, reportedAccuracy, type LocationInput } from './location.service.js';

export type EffectiveStatus = 'ACTIVE' | 'EXPIRED' | 'CLOSED' | 'REVOKED';

/** Expiry is decided by the server clock only. */
export const effectiveStatus = (s: Pick<AttendanceSession, 'status' | 'expiresAt'>, now = new Date()): EffectiveStatus =>
  s.status !== 'ACTIVE' ? s.status : s.expiresAt <= now ? 'EXPIRED' : 'ACTIVE';

export type CreateSessionInput = {
  classId?: string | null;
  eventId?: string | null;
  title?: string;
  durationMinutes?: number;
  locationVerificationEnabled?: boolean;
  selfieRequired?: boolean;
  requireEnrollment?: boolean;
  lateAfterMinutes?: number | null;
  allowLate?: boolean;
  qrRotationSeconds?: number | null;
};

const publicUrl = (raw: string) => `${env.APP_URL}/attend/${raw}`;

/**
 * Mints a QR token: 256-bit random value. Only its SHA-256 is stored; the raw value is returned
 * once to the authorized lecturer for display and never logged. With rotation enabled each token
 * lives for `rotation` seconds (plus a grace window for students mid-scan), which defeats
 * forwarding screenshots of the QR to absent students.
 */
async function mintToken(ctx: TenantContext, session: AttendanceSession) {
  const rotation = (session.configSnapshot as { qrRotationSeconds?: number | null })?.qrRotationSeconds ?? null;
  const raw = randomToken(32);
  const expiresAt = rotation ? new Date(Math.min(session.expiresAt.getTime(), Date.now() + rotation * 1000)) : session.expiresAt;
  await ctx.db.qRToken.create({ data: { organizationId: ctx.organizationId, sessionId: session.id, tokenHash: sha256(raw), expiresAt } });
  return { token: raw, url: publicUrl(raw), expiresAt, rotationSeconds: rotation, sessionExpiresAt: session.expiresAt, serverTime: new Date() };
}

type CopiedLocation = { latitude: number; longitude: number; accuracyMeters: number | null; capturedAt: Date | null; source: string | null };

export async function createSession(ctx: TenantContext, input: CreateSessionInput, req: Request, replaces?: string, copiedLocation?: CopiedLocation | null) {
  if (!!input.classId === !!input.eventId) throw badRequest('Choose exactly one class or event', 'TARGET_REQUIRED');
  const target = await assertCanManageTarget(ctx, input);
  const settings = await settingsFor(ctx.organizationId);
  const now = new Date();
  const duration = input.durationMinutes ?? settings.defaultQrExpiryMin;
  const locationVerificationEnabled = input.locationVerificationEnabled ?? settings.locationRequired;
  // The lecturer's location is saved right after this, from the session page. A replacement session
  // is in the same room, so it starts with the location of the session it replaces.
  const location = locationVerificationEnabled ? (copiedLocation ?? null) : null;
  const lateAfterMin = input.lateAfterMinutes === undefined ? settings.lateAfterMin : input.lateAfterMinutes;
  let lecturerId = ctx.lecturerId;
  if (!lecturerId && input.classId && 'lecturers' in target) {
    lecturerId = (target.lecturers as { lecturerId: string }[])[0]?.lecturerId ?? null;
  }
  const title =
    input.title ??
    ('course' in target && target.course ? `${(target as { code: string }).code} — ${dateInZone(now, ctx.timezone)}` : `${(target as { name: string }).name} — ${dateInZone(now, ctx.timezone)}`);

  const session = await ctx.db.attendanceSession.create({
    data: {
      organizationId: ctx.organizationId,
      title,
      classId: input.classId ?? null,
      eventId: input.eventId ?? null,
      lecturerId,
      createdByUserId: ctx.userId,
      startsAt: now,
      expiresAt: new Date(now.getTime() + duration * 60_000),
      referenceLatitude: location?.latitude ?? null,
      referenceLongitude: location?.longitude ?? null,
      referenceAccuracyMeters: location?.accuracyMeters ?? null,
      referenceCapturedAt: location?.capturedAt ?? null,
      locationSource: location?.source ?? null,
      maximumDistanceMeters: MAX_DISTANCE_METERS,
      studentMaxAccuracyM: MAX_DISTANCE_METERS, // retired column, still required by the schema
      locationVerificationEnabled,
      selfieRequired: input.selfieRequired ?? settings.selfieRequired,
      requireEnrollment: input.requireEnrollment ?? settings.requireEnrollment,
      lateAfter: lateAfterMin ? new Date(now.getTime() + lateAfterMin * 60_000) : null,
      allowLate: input.allowLate ?? settings.allowLateAttendance,
      replacesSessionId: replaces ?? null,
      configSnapshot: {
        durationMinutes: duration,
        qrRotationSeconds: input.qrRotationSeconds ?? null,
        studentIdFormat: {
          exactLength: settings.studentIdExactLength, min: settings.studentIdMinLength, max: settings.studentIdMaxLength,
          charset: settings.studentIdCharset, prefix: settings.studentIdPrefix, suffix: settings.studentIdSuffix,
        },
        imageRetentionDays: settings.imageRetentionDays,
        timezone: ctx.timezone,
      },
    },
  });
  const qr = await mintToken(ctx, session);
  await audit({
    action: 'attendance_session.created', targetType: 'AttendanceSession', targetId: session.id,
    metadata: {
      classId: session.classId, eventId: session.eventId, expiresAt: session.expiresAt.toISOString(), replaces: replaces ?? null,
      locationVerificationEnabled, maximumDistanceMeters: session.maximumDistanceMeters,
    },
    req,
  });
  return { session: { ...session, effectiveStatus: effectiveStatus(session) }, qr };
}

export async function issueQr(ctx: TenantContext, id: string, req: Request) {
  const s = await loadSession(ctx, id, 'manage');
  const st = effectiveStatus(s);
  if (st !== 'ACTIVE') throw conflict(`This session is ${st.toLowerCase()}`, `SESSION_${st}`);
  const qr = await mintToken(ctx, s);
  await audit({ action: 'qr.generated', targetType: 'AttendanceSession', targetId: s.id, req });
  return qr;
}

export async function listSessions(
  ctx: TenantContext,
  q: { page: number; pageSize: number; status?: EffectiveStatus; classId?: string; eventId?: string; from?: Date; to?: Date; mine?: boolean },
) {
  const now = new Date();
  const statusWhere: Prisma.AttendanceSessionWhereInput =
    q.status === 'ACTIVE' ? { status: 'ACTIVE', expiresAt: { gt: now } }
      : q.status === 'EXPIRED' ? { status: 'ACTIVE', expiresAt: { lte: now } }
        : q.status ? { status: q.status } : {};
  const where: Prisma.AttendanceSessionWhereInput = {
    AND: [
      sessionScopeWhere(ctx, 'read'),
      statusWhere,
      q.classId ? { classId: q.classId } : {},
      q.eventId ? { eventId: q.eventId } : {},
      q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {},
      q.mine ? { OR: [{ createdByUserId: ctx.userId }, ...(ctx.lecturerId ? [{ lecturerId: ctx.lecturerId }] : [])] } : {},
    ],
  };
  const [items, total] = await Promise.all([
    ctx.db.attendanceSession.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: {
        class: { select: { id: true, name: true, code: true, course: { select: { code: true, title: true } } } },
        event: { select: { id: true, name: true } },
        lecturer: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { records: true } },
      },
    }),
    ctx.db.attendanceSession.count({ where }),
  ]);
  return { items: items.map((s) => ({ ...s, configSnapshot: undefined, effectiveStatus: effectiveStatus(s, now) })), total };
}

async function expectedCount(ctx: TenantContext, s: { classId: string | null; eventId: string | null }) {
  if (s.classId) return ctx.db.enrollment.count({ where: { classId: s.classId, status: 'ACTIVE', student: { status: 'ACTIVE' } } });
  if (s.eventId) return ctx.db.eventParticipant.count({ where: { eventId: s.eventId } });
  return 0;
}

export async function sessionStats(ctx: TenantContext, s: { id: string; classId: string | null; eventId: string | null }) {
  const [expected, byStatus, failures, verifiedLoc] = await Promise.all([
    expectedCount(ctx, s),
    ctx.db.attendanceRecord.groupBy({ by: ['status'], where: { sessionId: s.id }, _count: { _all: true } }),
    ctx.db.attendanceVerification.groupBy({ by: ['step'], where: { sessionId: s.id, success: false }, _count: { _all: true } }),
    ctx.db.attendanceRecord.count({ where: { sessionId: s.id, locationVerified: true } }),
  ]);
  const count = (st: string) => byStatus.find((b) => b.status === st)?._count._all ?? 0;
  const present = count('PRESENT') + count('LATE');
  return {
    expected,
    present,
    late: count('LATE'),
    excused: count('EXCUSED'),
    invalidated: count('INVALIDATED'),
    absent: Math.max(0, expected - present - count('EXCUSED')),
    attendanceRate: expected ? Math.round((present / expected) * 1000) / 10 : null,
    totalSubmissions: byStatus.reduce((a, b) => a + b._count._all, 0),
    locationVerified: verifiedLoc,
    failedAttempts: Object.fromEntries(failures.map((f) => [f.step, f._count._all])),
    failedAttemptsTotal: failures.reduce((a, b) => a + b._count._all, 0),
  };
}

export async function getSession(ctx: TenantContext, id: string) {
  const s = await loadSession(ctx, id, 'read');
  const canManage = await loadSession(ctx, id, 'manage').then(() => true, () => false);
  return { ...s, effectiveStatus: effectiveStatus(s), serverTime: new Date(), canManage, stats: await sessionStats(ctx, s) };
}

async function transition(ctx: TenantContext, id: string, to: 'CLOSED' | 'REVOKED', req: Request) {
  const s = await loadSession(ctx, id, 'manage');
  if (s.status !== 'ACTIVE') throw conflict(`This session is already ${s.status.toLowerCase()}`, 'SESSION_NOT_ACTIVE');
  const now = new Date();
  const updated = await ctx.db.attendanceSession.update({
    where: { id: s.id },
    data: to === 'CLOSED' ? { status: 'CLOSED', closedAt: now } : { status: 'REVOKED', revokedAt: now },
  });
  if (to === 'REVOKED') await ctx.db.qRToken.updateMany({ where: { sessionId: s.id, revokedAt: null }, data: { revokedAt: now } });
  await audit({ action: to === 'CLOSED' ? 'attendance_session.closed' : 'qr.revoked', targetType: 'AttendanceSession', targetId: s.id, req });
  emitToSession(ctx.organizationId, s.id, 'session:updated', { sessionId: s.id, status: to });
  return { ...updated, effectiveStatus: effectiveStatus(updated) };
}

export const closeSession = (ctx: TenantContext, id: string, req: Request) => transition(ctx, id, 'CLOSED', req);
export const revokeSession = (ctx: TenantContext, id: string, req: Request) => transition(ctx, id, 'REVOKED', req);

/** Revokes the old session's QR codes and creates a fresh session with the same configuration. */
export async function replaceSession(ctx: TenantContext, id: string, durationMinutes: number | undefined, req: Request) {
  const s = await loadSession(ctx, id, 'manage');
  if (s.status === 'ACTIVE') await transition(ctx, id, 'REVOKED', req);
  const snap = s.configSnapshot as { durationMinutes?: number; qrRotationSeconds?: number | null };
  return createSession(
    ctx,
    {
      classId: s.classId, eventId: s.eventId, title: s.title, durationMinutes: durationMinutes ?? snap.durationMinutes,
      locationVerificationEnabled: s.locationVerificationEnabled, selfieRequired: s.selfieRequired, requireEnrollment: s.requireEnrollment,
      allowLate: s.allowLate, qrRotationSeconds: snap.qrRotationSeconds ?? null,
      lateAfterMinutes: s.lateAfter ? Math.max(1, Math.round((s.lateAfter.getTime() - s.startsAt.getTime()) / 60_000)) : null,
    },
    req,
    s.id,
    // Same room, same lecturer: the replacement keeps the saved location.
    s.referenceLatitude != null && s.referenceLongitude != null
      ? { latitude: s.referenceLatitude, longitude: s.referenceLongitude, accuracyMeters: s.referenceAccuracyMeters, capturedAt: s.referenceCapturedAt, source: s.locationSource }
      : null,
  );
}

/** Saves the lecturer's current location as the point students are compared with. */
export async function saveLecturerLocation(ctx: TenantContext, id: string, input: LocationInput, req: Request) {
  const s = await loadSession(ctx, id, 'manage');
  const st = effectiveStatus(s);
  if (st !== 'ACTIVE') throw conflict(`This session is ${st.toLowerCase()}`, `SESSION_${st}`);
  if (!s.locationVerificationEnabled) throw conflict('Location verification is off for this session', 'LOCATION_VERIFICATION_DISABLED');
  if (!isValidPoint(input)) throw unprocessable('Your device did not return a usable location. Turn on location services and try again.', 'LOCATION_INVALID');
  const now = new Date();
  const accuracy = reportedAccuracy(input);
  const updated = await ctx.db.attendanceSession.update({
    where: { id: s.id },
    data: { referenceLatitude: input.latitude, referenceLongitude: input.longitude, referenceAccuracyMeters: accuracy, referenceCapturedAt: now, locationSource: 'LECTURER_DEVICE' },
  });
  const movedMeters = s.referenceLatitude != null && s.referenceLongitude != null
    ? Math.round(haversineMeters(s.referenceLatitude, s.referenceLongitude, input.latitude, input.longitude) * 10) / 10
    : null;
  await audit({
    action: 'attendance_session.location_saved', targetType: 'AttendanceSession', targetId: s.id,
    metadata: { movedMeters, accuracyMeters: accuracy, capturedAt: now.toISOString() },
    req,
  });
  emitToSession(ctx.organizationId, s.id, 'session:updated', { sessionId: s.id, locationSaved: true });
  return { ...updated, effectiveStatus: effectiveStatus(updated) };
}

// ── Records ──────────────────────────────────────────────────────────────

export type RecordQuery = {
  page: number; pageSize: number; sessionId?: string; classId?: string; eventId?: string; courseId?: string; programId?: string;
  levelId?: string; departmentId?: string; lecturerId?: string; studentId?: string; status?: 'PRESENT' | 'LATE' | 'EXCUSED' | 'INVALIDATED';
  from?: Date; to?: Date; search?: string; sort?: string;
};

export function recordWhere(ctx: TenantContext, q: Omit<RecordQuery, 'page' | 'pageSize' | 'sort'>): Prisma.AttendanceRecordWhereInput {
  return {
    AND: [
      recordScopeWhere(ctx),
      q.sessionId ? { sessionId: q.sessionId } : {},
      q.classId ? { classId: q.classId } : {},
      q.eventId ? { eventId: q.eventId } : {},
      q.courseId ? { session: { class: { courseId: q.courseId } } } : {},
      q.programId ? { student: { programId: q.programId } } : {},
      q.levelId ? { student: { levelId: q.levelId } } : {},
      q.departmentId ? { student: { departmentId: q.departmentId } } : {},
      q.lecturerId ? { lecturerId: q.lecturerId } : {},
      q.studentId ? { studentId: q.studentId } : {},
      q.status ? { status: q.status } : {},
      q.from || q.to ? { submittedAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {},
      q.search
        ? { OR: [{ studentNameSnapshot: { contains: q.search, mode: 'insensitive' } }, { studentNumberSnapshot: { contains: q.search, mode: 'insensitive' } }, { referenceNumber: { contains: q.search, mode: 'insensitive' } }] }
        : {},
    ],
  };
}

const SORTABLE = new Set(['submittedAt', 'studentNameSnapshot', 'studentNumberSnapshot', 'status']);

export async function listRecords(ctx: TenantContext, q: RecordQuery) {
  if (q.sessionId) await loadSession(ctx, q.sessionId, 'read');
  const where = recordWhere(ctx, q);
  const [field, dir] = (q.sort ?? 'submittedAt:desc').split(':');
  const [items, total] = await Promise.all([
    ctx.db.attendanceRecord.findMany({
      where,
      orderBy: { [SORTABLE.has(field) ? field : 'submittedAt']: dir === 'asc' ? 'asc' : 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true, referenceNumber: true, sessionId: true, studentId: true, studentNumberSnapshot: true, studentNameSnapshot: true,
        studentEmailSnapshot: true, programSnapshot: true, levelSnapshot: true, contextSnapshot: true, submittedAt: true,
        attendanceDate: true, status: true, locationVerified: true, distanceM: true, gpsAccuracyM: true, verificationMeta: true,
        correctionReason: true, selfie: { select: { storageKey: true, deletedAt: true } },
      },
    }),
    ctx.db.attendanceRecord.count({ where }),
  ]);
  const canSeeSelfies = ctx.has('selfies.read');
  const out = await Promise.all(
    items.map(async ({ selfie, ...r }) => ({
      ...r,
      attendanceTime: timeInZone(r.submittedAt, ctx.timezone),
      attendanceDate: r.attendanceDate.toISOString().slice(0, 10),
      selfieUrl: canSeeSelfies && selfie && !selfie.deletedAt ? await imageStorage.signedUrl(selfie.storageKey, 300) : null,
      verificationStatus: r.locationVerified === false ? 'LOCATION_UNVERIFIED' : selfie ? 'VERIFIED_WITH_SELFIE' : 'VERIFIED',
    })),
  );
  return { items: out, total };
}

export async function absentees(ctx: TenantContext, sessionId: string, q: { page: number; pageSize: number }) {
  const s = await loadSession(ctx, sessionId, 'read');
  const notPresent = { attendance: { none: { sessionId: s.id, status: { in: ['PRESENT' as const, 'LATE' as const, 'EXCUSED' as const] } } } };
  const where: Prisma.StudentWhereInput = s.classId
    ? { status: 'ACTIVE', enrollments: { some: { classId: s.classId, status: 'ACTIVE' } }, ...notPresent }
    : { eventEntries: { some: { eventId: s.eventId! } }, ...notPresent };
  const [items, total] = await Promise.all([
    ctx.db.student.findMany({
      where, orderBy: { fullName: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      select: { id: true, studentNumber: true, fullName: true, email: true, program: { select: { name: true } }, level: { select: { name: true } } },
    }),
    ctx.db.student.count({ where }),
  ]);
  return { items, total };
}

export async function correctRecord(ctx: TenantContext, id: string, input: { status: 'PRESENT' | 'LATE' | 'EXCUSED' | 'INVALIDATED'; reason: string }, req: Request) {
  const rec = await ctx.db.attendanceRecord.findFirst({ where: { AND: [{ id }, recordScopeWhere(ctx)] } });
  if (!rec) throw notFound('Attendance record');
  const updated = await ctx.db.attendanceRecord.update({
    where: { id: rec.id },
    data: { status: input.status, correctionReason: input.reason, correctedById: ctx.userId },
  });
  await audit({ action: 'attendance.corrected', targetType: 'AttendanceRecord', targetId: id, metadata: { from: rec.status, to: input.status, reason: input.reason }, req });
  emitToSession(ctx.organizationId, rec.sessionId, 'attendance:corrected', { sessionId: rec.sessionId, recordId: id, status: input.status });
  return updated;
}

/** Manually mark a student present (e.g. device failure) — audited, never anonymous. */
export async function manualRecord(ctx: TenantContext, sessionId: string, input: { studentId: string; reason: string; status: 'PRESENT' | 'LATE' | 'EXCUSED' }, req: Request) {
  const s = await loadSession(ctx, sessionId, 'manage');
  const student = await ctx.db.student.findUnique({ where: { id: input.studentId }, include: { program: true, level: true } });
  if (!student) throw notFound('Student');
  const { referenceNumber } = await import('../../lib/crypto.js');
  const rec = await ctx.db.attendanceRecord.create({
    data: {
      organizationId: ctx.organizationId, sessionId: s.id, studentId: student.id, classId: s.classId, eventId: s.eventId, lecturerId: s.lecturerId,
      referenceNumber: referenceNumber(), confirmationTokenHash: sha256(randomToken(32)), idempotencyKey: `manual-${crypto.randomUUID()}`,
      studentNumberSnapshot: student.studentNumber, studentNameSnapshot: student.fullName, studentEmailSnapshot: student.email,
      programSnapshot: student.program?.name ?? null, levelSnapshot: student.level?.name ?? null,
      contextSnapshot: s.class ? `${s.class.course?.code ?? s.class.code} ${s.class.name}` : (s.event?.name ?? s.title),
      attendanceDate: new Date(dateInZone(new Date(), ctx.timezone)), status: input.status, locationVerified: null,
      correctedById: ctx.userId, correctionReason: input.reason, verificationMeta: { manual: true },
    },
  });
  await audit({ action: 'attendance.manual_entry', targetType: 'AttendanceRecord', targetId: rec.id, metadata: { studentId: student.id, reason: input.reason }, req });
  emitToSession(ctx.organizationId, s.id, 'attendance:recorded', { sessionId: s.id, recordId: rec.id, studentName: rec.studentNameSnapshot, manual: true });
  return rec;
}

export async function getSelfieUrl(ctx: TenantContext, recordId: string, req: Request) {
  ctx.require('selfies.read');
  const rec = await ctx.db.attendanceRecord.findFirst({ where: { AND: [{ id: recordId }, recordScopeWhere(ctx)] }, include: { selfie: true } });
  if (!rec?.selfie || rec.selfie.deletedAt) throw notFound('Selfie');
  await audit({ action: 'selfie.viewed', targetType: 'AttendanceRecord', targetId: recordId, req });
  return { url: await imageStorage.signedUrl(rec.selfie.storageKey, 300), expiresInSeconds: 300 };
}
