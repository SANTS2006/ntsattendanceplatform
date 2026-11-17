import type { Request } from 'express';
import { Prisma, type AttendanceSession, type VerificationStep } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { tenantDb, withTenant, type TenantTx } from '../../db/tenant.js';
import { emitToSession } from '../../infra/realtime.js';
import { imageStorage, tenantKey } from '../../infra/storage.js';
import { hmac, randomToken, referenceNumber, safeEqual, sha256 } from '../../lib/crypto.js';
import { AppError, conflict, forbidden, gone, notFound, tooMany, unprocessable } from '../../lib/errors.js';
import { signAttemptToken, verifyAttemptToken, type AttemptClaims } from '../../lib/jwt.js';
import { logger } from '../../lib/logger.js';
import { publicStudentIdFormat, validateStudentId } from '../../lib/studentId.js';
import { dateInZone, timeInZone } from '../../lib/time.js';
import { audit, securityEvent } from '../audit/audit.service.js';
import { processImage } from '../media/image.js';
import { settingsFor } from '../organizations/settings.js';
import { evaluateProximity, proximityMessage, type GpsReading, type ProximityResult } from '../attendance/proximity.service.js';

/**
 * Anonymous student attendance workflow.
 *
 * Tenant resolution: the ONLY input that selects a tenant is the raw QR token, which is hashed
 * and looked up; the session row then fixes organizationId for every subsequent query.
 * Steps are chained with a short-lived signed "attempt token" (no student account needed).
 * Every condition is re-validated on submit — earlier step results are never trusted.
 */

export const MESSAGES = {
  STUDENT_NOT_FOUND: 'Student ID not found. Please check your ID and try again.',
  LOCATION_NOT_VERIFIED: 'Confirm your location first: you must be within 20 m of your lecturer to record attendance for this session.',
  QR_INVALID: 'This attendance QR code is not valid.',
  QR_EXPIRED: 'This attendance QR code has expired. Ask your lecturer for a new code.',
  ATTENDANCE_SESSION_EXPIRED: 'This attendance session has ended. Ask your lecturer for a new QR code.',
  SESSION_CLOSED: 'This attendance session has been closed.',
  SESSION_REVOKED: 'This attendance QR code has been revoked.',
  NOT_ENROLLED: 'You are not enrolled in this class or event, so you cannot record attendance here.',
  ALREADY_RECORDED: 'Your attendance has already been recorded for this session.',
  SUCCESS: 'Your attendance has been successfully recorded.',
} as const;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_ID_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
const ROTATION_GRACE_MS = 10 * 60_000;

type ResolvedSession = AttendanceSession & {
  class: { id: string; name: string; code: string; course: { code: string; title: string } | null } | null;
  event: { id: string; name: string; requireRegistration: boolean } | null;
  lecturer: { firstName: string; lastName: string; title: string | null } | null;
};

const clientHash = (req: Request, sessionId: string) => hmac(`${req.ip ?? 'unknown'}|${sessionId}`);

async function loadSessionTree(organizationId: string, sessionId: string): Promise<ResolvedSession> {
  const s = await tenantDb(organizationId).attendanceSession.findUnique({
    where: { id: sessionId },
    include: {
      class: { select: { id: true, name: true, code: true, course: { select: { code: true, title: true } } } },
      event: { select: { id: true, name: true, requireRegistration: true } },
      lecturer: { select: { firstName: true, lastName: true, title: true } },
    },
  });
  if (!s) throw notFound('Attendance session', 'QR_INVALID');
  return s;
}

function assertSessionOpen(s: AttendanceSession, now = new Date()) {
  if (s.status === 'REVOKED') throw gone(MESSAGES.SESSION_REVOKED, 'SESSION_REVOKED');
  if (s.status === 'CLOSED') throw gone(MESSAGES.SESSION_CLOSED, 'SESSION_CLOSED');
  if (s.expiresAt <= now) throw gone(MESSAGES.ATTENDANCE_SESSION_EXPIRED, 'ATTENDANCE_SESSION_EXPIRED');
}

/**
 * Resolve the tenant + session from a raw QR token. System-level lookup by token hash is the
 * only unscoped query in this module; everything afterwards is tenant-scoped.
 */
async function resolveToken(raw: string, opts: { allowRotatedExpiry?: boolean } = {}) {
  if (!TOKEN_RE.test(raw)) throw new AppError(404, 'QR_INVALID', MESSAGES.QR_INVALID);
  const token = await prisma.qRToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!token) throw new AppError(404, 'QR_INVALID', MESSAGES.QR_INVALID);
  const org = await prisma.organization.findUnique({ where: { id: token.organizationId }, select: { id: true, name: true, status: true, logoKey: true, timezone: true } });
  if (!org || org.status !== 'ACTIVE') throw new AppError(404, 'QR_INVALID', MESSAGES.QR_INVALID);
  const session = await loadSessionTree(org.id, token.sessionId);
  if (token.revokedAt) throw gone(MESSAGES.SESSION_REVOKED, 'SESSION_REVOKED');
  assertSessionOpen(session);
  const tokenDeadline = token.expiresAt.getTime() + (opts.allowRotatedExpiry ? ROTATION_GRACE_MS : 0);
  if (tokenDeadline <= Date.now()) throw gone(MESSAGES.QR_EXPIRED, 'QR_EXPIRED');
  return { token, org, session };
}

/** Attempt token must belong to the same QR token/session that is in the URL. */
async function resolveAttempt(raw: string, attemptHeader: string | undefined, needStudent: boolean) {
  const claims = verifyAttemptToken(attemptHeader);
  const resolved = await resolveToken(raw, { allowRotatedExpiry: true });
  if (claims.qrt !== resolved.token.id || claims.ses !== resolved.session.id || claims.org !== resolved.org.id) {
    throw forbidden('Attendance verification does not match this QR code. Please scan again.', 'ATTEMPT_MISMATCH');
  }
  if (needStudent && !claims.stu) throw forbidden('Verify your student ID first', 'STUDENT_NOT_VERIFIED');
  return { ...resolved, claims };
}

async function recordStep(
  organizationId: string,
  sessionId: string,
  step: VerificationStep,
  success: boolean,
  extra: { studentId?: string | null; reasonCode?: string; distanceM?: number | null; accuracyM?: number | null; clientHash?: string },
  tx?: TenantTx,
) {
  const data = {
    organizationId, sessionId, step, success, studentId: extra.studentId ?? null, reasonCode: extra.reasonCode,
    distanceM: extra.distanceM ?? null, accuracyM: extra.accuracyM ?? null, clientHash: extra.clientHash,
  };
  try {
    if (tx) await tx.attendanceVerification.create({ data });
    else await tenantDb(organizationId).attendanceVerification.create({ data });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'verification log failed');
  }
}

async function recentFailures(organizationId: string, sessionId: string, step: VerificationStep, ch: string, reasons?: { in?: string[]; notIn?: string[] }) {
  return tenantDb(organizationId).attendanceVerification.count({
    where: {
      sessionId, step, success: false, clientHash: ch, createdAt: { gte: new Date(Date.now() - FAILURE_WINDOW_MS) },
      ...(reasons ? { reasonCode: reasons } : {}),
    },
  });
}


const contextLabel = (s: ResolvedSession) =>
  s.class ? `${s.class.course ? `${s.class.course.code} — ${s.class.course.title}` : s.class.name} (${s.class.code})` : (s.event?.name ?? s.title);

// ── Step 1: validate the QR code ───────────────────────────────────────────

export async function validate(raw: string, req: Request) {
  const { token, org, session } = await resolveToken(raw);
  const settings = await settingsFor(org.id);
  await recordStep(org.id, session.id, 'QR_VALIDATE', true, { clientHash: clientHash(req, session.id) });
  return {
    attemptToken: signAttemptToken({ org: org.id, ses: session.id, qrt: token.id }),
    organization: { name: org.name, logoUrl: org.logoKey ? await imageStorage.signedUrl(org.logoKey, 900) : null },
    session: {
      title: session.title,
      context: contextLabel(session),
      type: session.classId ? 'CLASS' : 'EVENT',
      lecturer: session.lecturer ? `${session.lecturer.title ? `${session.lecturer.title} ` : ''}${session.lecturer.firstName} ${session.lecturer.lastName}` : null,
      expiresAt: session.expiresAt,
      serverTime: new Date(),
      locationVerificationEnabled: session.locationVerificationEnabled,
      selfieRequired: session.selfieRequired,
      // The rule only — the lecturer's reference coordinates are never sent to students.
      locationPolicy: session.locationVerificationEnabled
        ? {
            maximumDistanceMeters: session.maximumDistanceMeters,
            maxAccuracyM: session.studentMaxAccuracyM,
            maxLocationAgeSeconds: session.maxLocationAgeSeconds,
            timeoutSeconds: settings.locationTimeoutSeconds,
            sampleCount: settings.locationSampleCount,
            maxAttempts: settings.maxFailedLocationAttempts,
          }
        : null,
    },
    studentIdFormat: publicStudentIdFormat(settings),
  };
}

// ── Step 2: verify the student ID ──────────────────────────────────────────

async function assertEligible(db: TenantTx | ReturnType<typeof tenantDb>, session: ResolvedSession, studentId: string) {
  if (!session.requireEnrollment) return;
  if (session.classId) {
    const e = await db.enrollment.findFirst({ where: { classId: session.classId, studentId, status: 'ACTIVE' }, select: { id: true } });
    if (!e) throw forbidden(MESSAGES.NOT_ENROLLED, 'STUDENT_NOT_ENROLLED');
  } else if (session.eventId && session.event?.requireRegistration) {
    const p = await db.eventParticipant.findFirst({ where: { eventId: session.eventId, studentId }, select: { id: true } });
    if (!p) throw forbidden(MESSAGES.NOT_ENROLLED, 'STUDENT_NOT_ENROLLED');
  }
}

export async function verifyStudent(raw: string, attempt: string | undefined, studentIdInput: string, req: Request) {
  const { org, session, token, claims: prior } = await resolveAttempt(raw, attempt, false);
  // Location comes first: no student lookups until the server has accepted this device's location.
  if (session.locationVerificationEnabled && !verifiedLocation(prior)) throw forbidden(MESSAGES.LOCATION_NOT_VERIFIED, 'LOCATION_NOT_VERIFIED');
  const ch = clientHash(req, session.id);
  if ((await recentFailures(org.id, session.id, 'STUDENT_ID', ch)) >= MAX_ID_FAILURES) {
    await securityEvent({
      type: 'attendance.student_id_enumeration', severity: 'MEDIUM', organizationId: org.id,
      description: 'Repeated failed student ID lookups from one client on an attendance session', metadata: { sessionId: session.id }, req,
    });
    throw tooMany('Too many unsuccessful attempts. Please wait a few minutes or ask your lecturer for help.', 'TOO_MANY_ATTEMPTS');
  }
  const settings = await settingsFor(org.id);
  const format = validateStudentId(studentIdInput, settings);
  if (!format.valid) {
    await recordStep(org.id, session.id, 'STUDENT_ID', false, { reasonCode: 'INVALID_FORMAT', clientHash: ch });
    throw unprocessable(format.reason, 'INVALID_STUDENT_ID_FORMAT');
  }
  const db = tenantDb(org.id);
  const student = await db.student.findFirst({
    where: { normalizedNumber: format.normalized, status: 'ACTIVE' },
    include: { program: { select: { name: true } }, level: { select: { name: true } } },
  });
  if (!student) {
    await recordStep(org.id, session.id, 'STUDENT_ID', false, { reasonCode: 'NOT_FOUND', clientHash: ch });
    throw new AppError(404, 'STUDENT_NOT_FOUND', MESSAGES.STUDENT_NOT_FOUND);
  }
  try {
    await assertEligible(db, session, student.id);
  } catch (e) {
    await recordStep(org.id, session.id, 'STUDENT_ID', false, { studentId: student.id, reasonCode: 'NOT_ENROLLED', clientHash: ch });
    throw e;
  }
  const already = await db.attendanceRecord.findFirst({ where: { sessionId: session.id, studentId: student.id }, select: { id: true } });
  if (already) throw conflict(MESSAGES.ALREADY_RECORDED, 'ALREADY_RECORDED');
  await recordStep(org.id, session.id, 'STUDENT_ID', true, { studentId: student.id, clientHash: ch });
  return {
    attemptToken: signAttemptToken({ org: org.id, ses: session.id, qrt: token.id, stu: student.id, ...(prior.loc ? { loc: prior.loc } : {}) }),
    student: {
      fullName: student.fullName,
      studentId: student.studentNumber,
      email: student.email ?? null,
      program: student.program?.name ?? null,
      level: student.level?.name ?? null,
    },
  };
}

// ── Step 3 (first when enabled): verify location ──────────────────────────

/** An accepted location stays valid for the rest of the attempt (no second reading at submit). */
const VERIFIED_LOCATION_TTL_MS = 15 * 60_000;
const verifiedLocation = (c: AttemptClaims) => (c.loc && Date.now() - c.loc.at <= VERIFIED_LOCATION_TTL_MS ? c.loc : null);

const policyOf = (s: AttendanceSession, requireTimestamp: boolean) => ({
  maximumDistanceMeters: s.maximumDistanceMeters,
  studentMaxAccuracyM: s.studentMaxAccuracyM,
  maxLocationAgeSeconds: s.maxLocationAgeSeconds,
  requireTimestamp,
});
const referenceOf = (s: AttendanceSession) => ({ latitude: s.referenceLatitude, longitude: s.referenceLongitude });

const STATUS: Record<ProximityResult['outcome'], number> = {
  LOCATION_ACCEPTED: 200,
  LOCATION_OUTSIDE_RADIUS: 403,
  LOCATION_UNCERTAIN: 422,
  LOCATION_ACQUISITION_FAILED: 422,
  LOCATION_STALE: 422,
  LECTURER_REFERENCE_LOCATION_INVALID: 409,
  ATTENDANCE_SESSION_EXPIRED: 410,
};

/** Structured outcome for the client: the code, a clear message, and the numbers behind it. */
function proximityError(r: ProximityResult) {
  return new AppError(STATUS[r.outcome], r.outcome, proximityMessage(r), {
    outcome: r.outcome,
    retryable: r.retryable,
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.distanceMeters != null ? { distanceM: Math.round(r.distanceMeters) } : {}),
    ...(r.accuracyMeters != null ? { accuracyM: Math.round(r.accuracyMeters) } : {}),
    ...(r.ageSeconds != null ? { ageSeconds: r.ageSeconds } : {}),
    maximumDistanceMeters: r.maximumDistanceMeters,
  });
}

/** Uncertain readings are expected indoors, so they have a larger allowance than hard failures. */
const UNCERTAIN_ALLOWANCE = 3;

export async function verifyLocation(raw: string, attempt: string | undefined, loc: GpsReading, req: Request) {
  const { org, session, claims, token } = await resolveAttempt(raw, attempt, false);
  const ch = clientHash(req, session.id);
  const settings = await settingsFor(org.id);
  if (!session.locationVerificationEnabled) {
    // Nothing to check; keep the step idempotent for older clients.
    return { attemptToken: attempt!, outcome: 'LOCATION_NOT_REQUIRED' as const, accepted: true, maximumDistanceMeters: session.maximumDistanceMeters };
  }
  const [hard, uncertain] = await Promise.all([
    recentFailures(org.id, session.id, 'LOCATION', ch, { notIn: ['LOCATION_UNCERTAIN'] }),
    recentFailures(org.id, session.id, 'LOCATION', ch, { in: ['LOCATION_UNCERTAIN'] }),
  ]);
  if (hard >= settings.maxFailedLocationAttempts || uncertain >= settings.maxFailedLocationAttempts * UNCERTAIN_ALLOWANCE) {
    await securityEvent({
      type: 'attendance.location_attempts_exceeded', severity: 'LOW', organizationId: org.id,
      description: 'Repeated failed location checks from one client', metadata: { sessionId: session.id, hard, uncertain }, req,
    });
    throw tooMany('Too many unsuccessful location checks. Please ask your lecturer for help.', 'LOCATION_ATTEMPTS_EXCEEDED');
  }
  // Distance, accuracy and freshness are decided here, never by the client.
  const r = evaluateProximity({ session, reference: referenceOf(session), reading: loc, policy: policyOf(session, true) });
  await recordStep(org.id, session.id, 'LOCATION', r.accepted, {
    studentId: claims.stu, reasonCode: r.accepted ? undefined : r.outcome, distanceM: r.distanceMeters ?? null, accuracyM: r.accuracyMeters ?? null, clientHash: ch,
  });
  if (!r.accepted) throw proximityError(r);
  const accepted = { lat: loc.latitude!, lng: loc.longitude!, acc: loc.accuracy!, at: Date.now() };
  return {
    // Server-signed proof of this decision; the client presents it for the remaining steps.
    attemptToken: signAttemptToken({ org: org.id, ses: session.id, qrt: token.id, ...(claims.stu ? { stu: claims.stu } : {}), loc: accepted }),
    outcome: r.outcome,
    accepted: true,
    distanceM: Math.round(r.distanceMeters!),
    accuracyM: Math.round(r.accuracyMeters!),
    maximumDistanceMeters: r.maximumDistanceMeters,
    message: proximityMessage(r),
  };
}

// ── Step 4: selfie upload ──────────────────────────────────────────────────

export async function uploadSelfie(raw: string, attempt: string | undefined, file: Buffer | undefined, req: Request) {
  const { org, session, claims } = await resolveAttempt(raw, attempt, true);
  const db = tenantDb(org.id);
  const studentId = claims.stu!;
  const existing = await db.attendanceSelfie.count({ where: { sessionId: session.id, studentId } });
  if (existing >= 5) throw tooMany('Too many photos uploaded for this session', 'SELFIE_LIMIT');
  let img;
  try {
    img = await processImage(file, { maxDimension: 1024, minDimension: 120, quality: 80 });
  } catch (e) {
    await recordStep(org.id, session.id, 'SELFIE', false, { studentId, reasonCode: e instanceof AppError ? e.code : 'INVALID', clientHash: clientHash(req, session.id) });
    throw e;
  }
  const settings = await settingsFor(org.id);
  const key = tenantKey(org.id, 'selfies', 'jpg');
  await imageStorage.put(key, img.buffer, img.contentType);
  const selfie = await db.attendanceSelfie.create({
    data: {
      organizationId: org.id, sessionId: session.id, studentId, storageKey: key, contentType: img.contentType,
      sizeBytes: img.sizeBytes, width: img.width, height: img.height, sha256: img.sha256,
      retainUntil: new Date(Date.now() + settings.imageRetentionDays * 86_400_000),
    },
  });
  await recordStep(org.id, session.id, 'SELFIE', true, { studentId, clientHash: clientHash(req, session.id) });
  return { selfieId: selfie.id, previewUrl: await imageStorage.signedUrl(key, 600) };
}

// ── Step 5: submit ─────────────────────────────────────────────────────────

type SubmitInput = { selfieId?: string | null };

async function successPayload(organizationId: string, recordId: string, confirmationToken: string | null) {
  const db = tenantDb(organizationId);
  const rec = await db.attendanceRecord.findUniqueOrThrow({ where: { id: recordId }, include: { selfie: true } });
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, timezone: true } });
  return {
    success: true,
    message: MESSAGES.SUCCESS,
    referenceNumber: rec.referenceNumber,
    confirmationToken,
    organization: org.name,
    student: {
      fullName: rec.studentNameSnapshot,
      studentId: rec.studentNumberSnapshot,
      email: rec.studentEmailSnapshot ?? null,
      program: rec.programSnapshot,
      level: rec.levelSnapshot,
    },
    context: rec.contextSnapshot,
    status: rec.status,
    attendanceDate: dateInZone(rec.submittedAt, org.timezone),
    attendanceTime: timeInZone(rec.submittedAt, org.timezone),
    submittedAt: rec.submittedAt,
    timezone: org.timezone,
    locationVerified: rec.locationVerified,
    selfieUrl: rec.selfie && !rec.selfie.deletedAt ? await imageStorage.signedUrl(rec.selfie.storageKey, 600) : null,
  };
}

export async function submit(raw: string, attempt: string | undefined, idempotencyKey: string | undefined, input: SubmitInput, req: Request) {
  if (!idempotencyKey || !/^[A-Za-z0-9-]{16,64}$/.test(idempotencyKey)) {
    throw unprocessable('A valid Idempotency-Key header is required', 'IDEMPOTENCY_KEY_REQUIRED');
  }
  const { org, session, claims } = await resolveAttempt(raw, attempt, true);
  const studentId = claims.stu!;
  const ch = clientHash(req, session.id);
  const confirmationToken = randomToken(24);

  const outcome = await withTenant(org.id, async (tx) => {
    // Re-validate everything inside the transaction using the server clock.
    const fresh = await tx.attendanceSession.findUniqueOrThrow({ where: { id: session.id } });
    const now = new Date();
    assertSessionOpen(fresh, now);

    const prior = await tx.attendanceRecord.findFirst({ where: { sessionId: session.id, studentId }, select: { id: true, idempotencyKey: true } });
    if (prior) {
      if (prior.idempotencyKey === idempotencyKey) return { replay: true as const, recordId: prior.id };
      throw conflict(MESSAGES.ALREADY_RECORDED, 'ALREADY_RECORDED');
    }

    const student = await tx.student.findFirst({
      where: { id: studentId, status: 'ACTIVE' },
      include: { program: { select: { name: true } }, level: { select: { name: true } } },
    });
    if (!student) throw new AppError(404, 'STUDENT_NOT_FOUND', MESSAGES.STUDENT_NOT_FOUND);
    await assertEligible(tx, session, student.id);

    // The location accepted earlier in this attempt (server-signed claim) is re-checked against the
    // session's CURRENT reference point, so an audited reference correction applies to everyone.
    let proximity: ProximityResult | null = null;
    if (fresh.locationVerificationEnabled) {
      const v = verifiedLocation(claims);
      if (!v) throw forbidden(MESSAGES.LOCATION_NOT_VERIFIED, 'LOCATION_NOT_VERIFIED');
      proximity = evaluateProximity({
        session: fresh, reference: referenceOf(fresh), now,
        reading: { latitude: v.lat, longitude: v.lng, accuracy: v.acc, timestamp: v.at, clientTime: v.at },
        policy: policyOf(fresh, false),
      });
      if (!proximity.accepted) {
        await recordStep(org.id, session.id, 'SUBMIT', false, { studentId, reasonCode: proximity.outcome, distanceM: proximity.distanceMeters ?? null, accuracyM: proximity.accuracyMeters ?? null, clientHash: ch }, tx);
        throw proximityError(proximity);
      }
    }

    let selfieId: string | null = null;
    let duplicateImage = false;
    if (input.selfieId) {
      const selfie = await tx.attendanceSelfie.findFirst({ where: { id: input.selfieId, sessionId: session.id, studentId, deletedAt: null }, include: { record: { select: { id: true } } } });
      if (!selfie || selfie.record) throw unprocessable('The photo could not be found. Please take your selfie again.', 'SELFIE_INVALID');
      selfieId = selfie.id;
      duplicateImage = (await tx.attendanceSelfie.count({ where: { sessionId: session.id, sha256: selfie.sha256, NOT: { studentId } } })) > 0;
    } else if (fresh.selfieRequired) {
      throw unprocessable('A selfie is required to record attendance for this session.', 'SELFIE_REQUIRED');
    }

    const isLate = !!fresh.lateAfter && now > fresh.lateAfter;
    if (isLate && !fresh.allowLate) throw forbidden('The attendance window for on-time arrival has passed and late attendance is not allowed.', 'LATE_NOT_ALLOWED');

    const flags = [...(proximity?.flags ?? []), ...(duplicateImage ? ['DUPLICATE_SELFIE_IN_SESSION'] : [])];
    const v = verifiedLocation(claims);
    const record = await tx.attendanceRecord.create({
      data: {
        organizationId: org.id,
        sessionId: session.id,
        studentId: student.id,
        classId: fresh.classId,
        eventId: fresh.eventId,
        lecturerId: fresh.lecturerId,
        referenceNumber: referenceNumber(),
        confirmationTokenHash: sha256(confirmationToken),
        idempotencyKey,
        studentNumberSnapshot: student.studentNumber,
        studentNameSnapshot: student.fullName,
        studentEmailSnapshot: student.email,
        programSnapshot: student.program?.name ?? null,
        levelSnapshot: student.level?.name ?? null,
        contextSnapshot: contextLabel(session),
        submittedAt: now,
        attendanceDate: new Date(dateInZone(now, org.timezone)),
        status: isLate ? 'LATE' : 'PRESENT',
        locationVerified: proximity ? proximity.accepted : null,
        distanceM: proximity?.distanceMeters ?? null,
        gpsAccuracyM: proximity?.accuracyMeters ?? null,
        latitude: proximity && v ? v.lat : null,
        longitude: proximity && v ? v.lng : null,
        selfieId,
        verificationMeta: {
          flags,
          selfie: selfieId ? 'CAPTURED_NOT_BIOMETRICALLY_VERIFIED' : 'NONE',
          locationSource: 'BROWSER_GEOLOCATION',
          proximity: proximity
            ? {
                outcome: proximity.outcome, maximumDistanceMeters: proximity.maximumDistanceMeters,
                referenceCapturedAt: fresh.referenceCapturedAt?.toISOString() ?? null, referenceAccuracyMeters: fresh.referenceAccuracyMeters,
              }
            : null,
          qrTokenId: claims.qrt,
        },
      },
    });
    await recordStep(org.id, session.id, 'SUBMIT', true, { studentId, distanceM: proximity?.distanceMeters ?? null, accuracyM: proximity?.accuracyMeters ?? null, clientHash: ch }, tx);
    return { replay: false as const, recordId: record.id, record, flags };
  }).catch(async (err) => {
    // Concurrent duplicate: the unique (sessionId, studentId) constraint is the final arbiter.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await tenantDb(org.id).attendanceRecord.findFirst({ where: { sessionId: session.id, studentId }, select: { id: true, idempotencyKey: true } });
      if (existing && existing.idempotencyKey === idempotencyKey) return { replay: true as const, recordId: existing.id };
      throw conflict(MESSAGES.ALREADY_RECORDED, 'ALREADY_RECORDED');
    }
    throw err;
  });

  if (outcome.replay) return { ...(await successPayload(org.id, outcome.recordId, null)), idempotentReplay: true };

  const rec = outcome.record;
  emitToSession(org.id, session.id, 'attendance:recorded', {
    sessionId: session.id,
    record: {
      id: rec.id, studentNameSnapshot: rec.studentNameSnapshot, studentNumberSnapshot: rec.studentNumberSnapshot,
      programSnapshot: rec.programSnapshot, levelSnapshot: rec.levelSnapshot, status: rec.status, submittedAt: rec.submittedAt,
      locationVerified: rec.locationVerified, flagged: outcome.flags.length > 0,
    },
  });
  await audit({
    action: 'attendance.submitted', organizationId: org.id, actorType: 'PUBLIC', targetType: 'AttendanceRecord', targetId: rec.id,
    metadata: { sessionId: session.id, flags: outcome.flags }, req,
  });
  return { ...(await successPayload(org.id, rec.id, confirmationToken)), idempotentReplay: false };
}

// ── Confirmation retrieval ────────────────────────────────────────────────

/**
 * Requires BOTH the reference number and the 192-bit confirmation token that was returned only to
 * the submitting device, so reference numbers cannot be enumerated to read other students' records.
 */
export async function confirmation(reference: string, token: string | undefined) {
  const generic = new AppError(404, 'CONFIRMATION_NOT_FOUND', 'Attendance confirmation not found');
  if (!token || !/^[A-Za-z0-9_-]{32}$/.test(token) || !/^NTS-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(reference)) throw generic;
  const rec = await prisma.attendanceRecord.findUnique({ where: { referenceNumber: reference }, select: { id: true, organizationId: true, confirmationTokenHash: true } });
  if (!rec || !safeEqual(rec.confirmationTokenHash, sha256(token))) throw generic;
  return successPayload(rec.organizationId, rec.id, null);
}

export type { AttemptClaims };
