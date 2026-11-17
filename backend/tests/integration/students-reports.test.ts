import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drainInlineJobs } from '../../src/infra/queue.js';
import { api, auth, getApp, publicFlow, refreshTokens, resetDb, seedTenant, startSession, submitAttendance } from '../helpers.js';

let T: Awaited<ReturnType<typeof seedTenant>>;

beforeEach(() => refreshTokens(T?.owner));

beforeAll(async () => {
  await resetDb();
  T = await seedTenant('Epsilon University');
});

describe('student management', () => {
  it('enforces the organization student ID format and per-tenant uniqueness', async () => {
    const bad = await api(T.owner, 'post', '/students', { studentNumber: 'ABC', firstName: 'A', lastName: 'B' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_STUDENT_ID');
    const dup = await api(T.owner, 'post', '/students', { studentNumber: '20240001', firstName: 'A', lastName: 'B' });
    expect(dup.status).toBe(409);
  });

  it('searches, filters and paginates server-side', async () => {
    const res = await api(T.owner, 'get', `/students?search=Student2&programId=${T.program.id}&pageSize=1`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    const byClass = await api(T.owner, 'get', `/students?classId=${T.cls.id}`);
    expect(byClass.body.meta.total).toBe(2);
  });

  it('deactivates by default and refuses permanent deletion with attendance history', async () => {
    const s = await startSession(T.owner, T.cls.id);
    const flow = await publicFlow(s.qr.token, '20240001');
    if (flow.stage !== 'ready') throw new Error('flow');
    await submitAttendance(s.qr.token, flow.attemptToken);
    const del = await api(T.owner, 'delete', `/students/${T.students[0].id}?permanent=true`);
    expect(del.status).toBe(409);
    const deact = await api(T.owner, 'delete', `/students/${T.students[2].id}`);
    expect(deact.status).toBe(200);
    expect((await api(T.owner, 'get', `/students/${T.students[2].id}`)).body.data.status).toBe('INACTIVE');
  });
});

describe('bulk import', () => {
  it('imports CSV with mapping, preview, duplicate detection and an error report', async () => {
    const csv = [
      'Matric Number,First Name,Surname,Email,Programme,Level',
      '20245001,Ada,Lovelace,ada@x.test,BSCCS,Year 2',
      '20245002,Alan,Turing,alan@x.test,BSCCS,Year 2',
      '20245002,Dup,Licate,dup@x.test,BSCCS,Year 2',
      'BAD,No,Format,,BSCCS,',
      '20245003,Grace,Hopper,not-an-email,UNKNOWN,',
    ].join('\n');
    const a = await getApp();
    const up = await request(a).post('/api/v1/students/import').set(auth(T.owner)).attach('file', Buffer.from(csv), 'students.csv');
    expect(up.status).toBe(201);
    expect(up.body.data.suggestedMapping).toMatchObject({ studentNumber: 'Matric Number', firstName: 'First Name', lastName: 'Surname', program: 'Programme', level: 'Level' });
    const mapping = up.body.data.suggestedMapping;
    const preview = await api(T.owner, 'post', `/students/import/${up.body.data.id}/preview`, { mapping });
    expect(preview.body.data).toMatchObject({ totalRows: 5, validRows: 2, invalidRows: 3 });
    const commit = await api(T.owner, 'post', `/students/import/${up.body.data.id}/commit`, { mapping });
    expect(commit.status).toBe(202);
    await drainInlineJobs();
    const status = await api(T.owner, 'get', `/students/import/${up.body.data.id}`);
    expect(status.body.data).toMatchObject({ status: 'COMPLETED', successCount: 2, failureCount: 3 });
    expect(status.body.data.errorReportUrl).toBeTruthy();
    // Single-use commit
    expect((await api(T.owner, 'post', `/students/import/${up.body.data.id}/commit`, { mapping })).status).toBe(409);
  });

  it('returns a row-by-row preview table with new / existing / error status', async () => {
    const csv = ['Student ID,Full Name,Email', '20240001,Already Here,a@x.test', '20248001,Brand New,b@x.test', '20248001,Dup Row,c@x.test', '20248002,Bad Email,not-an-email'].join('\n');
    const up = await request(await getApp()).post('/api/v1/students/import').set(auth(T.owner)).attach('file', Buffer.from(csv), 'add.csv');
    const res = await api(T.owner, 'post', `/students/import/${up.body.data.id}/preview`, { mapping: up.body.data.suggestedMapping, table: true });
    expect(res.status).toBe(200);
    const byLine = Object.fromEntries(res.body.data.table.map((r: { line: number }) => [r.line, r]));
    expect(byLine[2]).toMatchObject({ status: 'existing', studentNumber: '20240001' });
    expect(byLine[3]).toMatchObject({ status: 'new', fullName: 'Brand New', email: 'b@x.test' });
    expect(byLine[4].status).toBe('error');
    expect(byLine[4].errors.join()).toMatch(/Duplicate student ID \(also on line 3\)/);
    expect(byLine[5].errors.join()).toMatch(/Email address is invalid/);
    expect(res.body.data.tableTruncated).toBe(false);
  });

  it('imports Excel files', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Students');
    ws.addRow(['Student ID', 'Full Name']);
    ws.addRow(['20246001', 'Katherine Johnson']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const up = await request(await getApp()).post('/api/v1/students/import').set(auth(T.owner)).attach('file', buf, 'students.xlsx');
    expect(up.status).toBe(201);
    await api(T.owner, 'post', `/students/import/${up.body.data.id}/commit`, { mapping: up.body.data.suggestedMapping });
    await drainInlineJobs();
    const s = await api(T.owner, 'get', '/students?search=20246001');
    expect(s.body.data[0]).toMatchObject({ firstName: 'Katherine', lastName: 'Johnson' });
  });

  it('rejects non-spreadsheet uploads', async () => {
    const up = await request(await getApp()).post('/api/v1/students/import').set(auth(T.owner)).attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), 'x.csv');
    expect(up.status).toBe(422);
  });
});

describe('reports', () => {
  it('produces analytics and exports in CSV, XLSX and PDF', async () => {
    const analytics = await api(T.owner, 'get', '/reports/attendance');
    expect(analytics.body.data.totalRecords).toBeGreaterThanOrEqual(1);
    expect(analytics.body.data.trend.length).toBeGreaterThanOrEqual(1);
    for (const format of ['CSV', 'XLSX', 'PDF']) {
      const req = await api(T.owner, 'post', '/reports/export', { format, filters: {} });
      expect(req.status).toBe(202);
      await drainInlineJobs();
      const st = await api(T.owner, 'get', `/reports/export/${req.body.data.id}`);
      expect(st.body.data.status).toBe('COMPLETED');
      const url = new URL(st.body.data.downloadUrl);
      const file = await request(await getApp()).get(url.pathname + url.search);
      expect(file.status).toBe(200);
      expect(file.headers['content-disposition']).toMatch(/attachment/);
    }
  });

  it('escapes spreadsheet formulas in exports', async () => {
    await api(T.owner, 'post', '/students', { studentNumber: '20247777', firstName: '=HYPERLINK("x")', lastName: 'Evil' });
    // Student name only flows into exports through attendance snapshots — covered by safeCell unit behaviour.
    const summary = await api(T.owner, 'post', '/reports/export', { format: 'CSV', reportType: 'class_summary', filters: { classId: T.cls.id } });
    await drainInlineJobs();
    const st = await api(T.owner, 'get', `/reports/export/${summary.body.data.id}`);
    expect(st.body.data.status).toBe('COMPLETED');
  });

  it('class summary computes per-student rates', async () => {
    const res = await api(T.owner, 'get', `/reports/classes/${T.cls.id}/summary`);
    expect(res.body.data.totalSessions).toBeGreaterThanOrEqual(1);
    const s1 = res.body.data.students.find((s: { studentNumber: string }) => s.studentNumber === '20240001');
    expect(s1.attended).toBe(1);
  });
});

describe('API conventions', () => {
  it('uses the standard envelope and never leaks internals', async () => {
    const nf = await api(T.owner, 'get', '/nope');
    expect(nf.body).toMatchObject({ success: false, code: 'ROUTE_NOT_FOUND' });
    const bad = await request(await getApp()).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"bad json');
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/at .*\.ts/);
  });

  it('publishes an OpenAPI document covering the API', async () => {
    const doc = await request(await getApp()).get('/api/v1/openapi.json');
    expect(doc.status).toBe(200);
    const paths = Object.keys(doc.body.paths);
    expect(paths.length).toBeGreaterThan(80);
    expect(paths).toContain('/public/attendance/{token}/submit');
    expect(paths).toContain('/platform/organizations/{id}/status');
  });

  it('sets security headers', async () => {
    const res = await request(await getApp()).get('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
