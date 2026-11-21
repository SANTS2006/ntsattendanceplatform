/**
 * Attendance burst benchmark (no k6 required).
 *
 * Simulates N students scanning the same QR code at once and running the full public flow
 * (validate → verify-location → verify-student → submit), with bounded client concurrency, against an
 * in-process API instance on the TEST database. Also fires a duplicate-submission storm for one
 * student to prove only one record is created.
 *
 *   npm run load:burst --workspace backend -- --students 1000 --concurrency 200
 *
 * Results depend entirely on the machine, PostgreSQL configuration and pool size. Numbers from a
 * developer laptop with embedded PostgreSQL are NOT production capacity figures.
 */
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const envFile = path.resolve(import.meta.dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((a) => a.trim().split(/\s+/)));
const N = Number(args.students ?? 1000);
const C = Number(args.concurrency ?? 200);
const POOL = Number(args.pool ?? 40);
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required (the benchmark writes data)');
process.env.DATABASE_URL = `${process.env.TEST_DATABASE_URL}${process.env.TEST_DATABASE_URL.includes('?') ? '&' : '?'}connection_limit=${POOL}&pool_timeout=30`;
process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_DISABLED = 'true';
delete process.env.REDIS_URL;

const { prisma } = await import('../src/db/prisma.js');
const { createApp } = await import('../src/app.js');
const { sha256 } = await import('../src/lib/crypto.js');
const { ensurePermissionCatalogue } = await import('../src/modules/organizations/organizations.service.js');

await ensurePermissionCatalogue();
const owner = await prisma.user.create({ data: { email: `bench-${Date.now()}@example.test`, firstName: 'Bench', lastName: 'Owner', passwordHash: 'x', emailVerifiedAt: new Date() } });
const org = await prisma.organization.create({
  data: { slug: `bench-${Date.now()}`, name: 'Benchmark University', type: 'UNIVERSITY', officialEmail: 'b@example.test', country: 'SL', timezone: 'UTC', createdById: owner.id,
    settings: { create: { studentIdExactLength: 8, studentIdCharset: 'NUMERIC', selfieRequired: false } } },
});
const cls = await prisma.class.create({ data: { organizationId: org.id, name: 'Bench', code: 'BENCH-1' } });
const numbers = Array.from({ length: N + 1 }, (_, i) => String(30000000 + i));
await prisma.student.createMany({ data: numbers.map((n) => ({ organizationId: org.id, studentNumber: n, normalizedNumber: n, firstName: 'S', lastName: n, fullName: `S ${n}` })) });
const studentIds = await prisma.student.findMany({ where: { organizationId: org.id }, select: { id: true } });
await prisma.enrollment.createMany({ data: studentIds.map((s) => ({ organizationId: org.id, classId: cls.id, studentId: s.id })) });
const session = await prisma.attendanceSession.create({
  data: { organizationId: org.id, title: 'Bench', classId: cls.id, createdByUserId: owner.id, expiresAt: new Date(Date.now() + 3600_000),
    referenceLatitude: 8.4844, referenceLongitude: -13.2344, referenceAccuracyMeters: 5, referenceCapturedAt: new Date(), locationSource: 'LECTURER_DEVICE',
    maximumDistanceMeters: 20, studentMaxAccuracyM: 20, locationVerificationEnabled: true, selfieRequired: false, requireEnrollment: true, configSnapshot: {} },
});
const raw = crypto.randomBytes(32).toString('base64url');
await prisma.qRToken.create({ data: { organizationId: org.id, sessionId: session.id, tokenHash: sha256(raw), expiresAt: session.expiresAt } });

const server = createApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/public/attendance/${raw}`;
const lat: Record<string, number[]> = { validate: [], location: [], verify: [], submit: [], flow: [] };
const errors: Record<string, number> = {};

async function timed<T>(bucket: string, fn: () => Promise<T>) {
  const t = performance.now();
  const r = await fn();
  lat[bucket].push(performance.now() - t);
  return r;
}
async function json(res: Response) {
  const body = (await res.json()) as { data?: Record<string, unknown>; code?: string };
  if (!res.ok) throw new Error(body.code ?? String(res.status));
  return body.data!;
}

/** A location about 5.6 m from the lecturer (accepted). */
const reading = () => JSON.stringify({ latitude: 8.48445, longitude: -13.2344, accuracy: 8 });
const located = async (attempt: unknown) =>
  fetch(`${base}/verify-location`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-attempt-token': String(attempt) }, body: reading() }).then(json);

async function flow(studentNumber: string) {
  const start = performance.now();
  try {
    const v = await timed('validate', () => fetch(`${base}/validate`, { method: 'POST' }).then(json));
    const l = await timed('location', () => located(v.attemptToken));
    const s = await timed('verify', () =>
      fetch(`${base}/verify-student`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-attempt-token': String(l.attemptToken) }, body: JSON.stringify({ studentId: studentNumber }) }).then(json),
    );
    await timed('submit', () =>
      fetch(`${base}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-attempt-token': String(s.attemptToken), 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({}),
      }).then(json),
    );
    lat.flow.push(performance.now() - start);
  } catch (e) {
    const k = e instanceof Error ? e.message : 'unknown';
    errors[k] = (errors[k] ?? 0) + 1;
  }
}

const pct = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};

console.log(`Running ${N} student flows with concurrency ${C} (DB pool ${POOL})…`);
const t0 = performance.now();
let next = 0;
await Promise.all(Array.from({ length: C }, async () => {
  while (next < N) await flow(numbers[next++]);
}));
const elapsed = (performance.now() - t0) / 1000;

// Duplicate storm: one student, 50 simultaneous submissions with different idempotency keys.
const dupNumber = numbers[N];
const v = await fetch(`${base}/validate`, { method: 'POST' }).then(json);
const l = await located(v.attemptToken);
const s = await fetch(`${base}/verify-student`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-attempt-token': String(l.attemptToken) }, body: JSON.stringify({ studentId: dupNumber }) }).then(json);
const dup = await Promise.all(Array.from({ length: 50 }, () =>
  fetch(`${base}/submit`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-attempt-token': String(s.attemptToken), 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({}) }).then((r) => r.status),
));
const recorded = await prisma.attendanceRecord.count({ where: { sessionId: session.id } });
const dupRecords = await prisma.attendanceRecord.count({ where: { sessionId: session.id, studentNumberSnapshot: dupNumber } });

const report = {
  machine: { node: process.version, platform: process.platform, cpus: (await import('node:os')).cpus().length },
  config: { students: N, concurrency: C, dbPool: POOL, redis: false, rateLimits: 'disabled for benchmark' },
  totals: { seconds: Math.round(elapsed * 10) / 10, completedFlows: lat.flow.length, failedFlows: N - lat.flow.length, flowsPerSecond: Math.round((lat.flow.length / elapsed) * 10) / 10, recorded: recorded - dupRecords },
  latencyMs: Object.fromEntries(Object.entries(lat).map(([k, a]) => [k, { p50: pct(a, 50), p95: pct(a, 95), p99: pct(a, 99), max: pct(a, 100) }])),
  errors,
  duplicateStorm: { requests: 50, created201: dup.filter((x) => x === 201).length, conflict409: dup.filter((x) => x === 409).length, recordsInDb: dupRecords },
};
console.log(JSON.stringify(report, null, 2));
const out = path.resolve(import.meta.dirname, '..', 'tests', 'performance', 'last-burst-result.json');
fs.writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), ...report }, null, 2));
server.close();
await prisma.$disconnect();
process.exit(0);
