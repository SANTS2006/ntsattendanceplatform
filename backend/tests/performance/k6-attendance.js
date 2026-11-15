/**
 * k6 load test for the public attendance flow and lecturer polling.
 *
 *   k6 run -e BASE=https://staging.example.edu/api/v1 -e QR_TOKEN=<raw token> \
 *          -e ID_PREFIX=3000 -e ID_LEN=8 -e STUDENTS=2000 backend/tests/performance/k6-attendance.js
 *
 * Prepare a dedicated organization whose students are numbered ID_PREFIX + zero padding
 * (e.g. 30000000…30001999), enrolled in the class of the session behind QR_TOKEN, with
 * selfies disabled (or set SELFIE=1 to upload a small JPEG from ./selfie.jpg).
 * Rate limits are per client IP — run from multiple load generators or raise limits on staging.
 * Never run against production.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const BASE = __ENV.BASE || 'http://localhost:4000/api/v1';
const TOKEN = __ENV.QR_TOKEN;
const PREFIX = __ENV.ID_PREFIX || '3000';
const LEN = Number(__ENV.ID_LEN || 8);
const STUDENTS = Number(__ENV.STUDENTS || 2000);
const LAT = Number(__ENV.LAT || 8.4844);
const LNG = Number(__ENV.LNG || -13.2344);

const flowTime = new Trend('attendance_flow_ms', true);
const recorded = new Counter('attendance_recorded');
const failed = new Counter('attendance_failed');

export const options = {
  scenarios: {
    // 2,000 students arriving over ~2 minutes, peaking at 400 concurrent.
    students: {
      executor: 'per-vu-iterations',
      vus: Number(__ENV.VUS || 400),
      iterations: Math.ceil(STUDENTS / Number(__ENV.VUS || 400)),
      maxDuration: '10m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{step:submit}': ['p(95)<1500'],
    attendance_flow_ms: ['p(95)<4000'],
  },
};

const json = { headers: { 'Content-Type': 'application/json' } };

export default function () {
  if (!TOKEN) throw new Error('QR_TOKEN is required');
  const idx = exec.scenario.iterationInTest;
  if (idx >= STUDENTS) return;
  const studentId = PREFIX + String(idx).padStart(LEN - PREFIX.length, '0');
  const t0 = Date.now();
  sleep(Math.random() * 2); // stagger like real scans

  const v = http.post(`${BASE}/public/attendance/${TOKEN}/validate`, null, { tags: { step: 'validate' } });
  if (!check(v, { 'validate 200': (r) => r.status === 200 })) return failed.add(1);
  let attempt = v.json('data.attemptToken');

  const loc = http.post(`${BASE}/public/attendance/${TOKEN}/verify-location`, JSON.stringify({ latitude: LAT + 0.00003, longitude: LNG, accuracy: 15 }), {
    headers: { ...json.headers, 'X-Attempt-Token': attempt }, tags: { step: 'location' },
  });
  check(loc, { 'location 200': (r) => r.status === 200 });

  const s = http.post(`${BASE}/public/attendance/${TOKEN}/verify-student`, JSON.stringify({ studentId }), {
    headers: { ...json.headers, 'X-Attempt-Token': attempt }, tags: { step: 'verify' },
  });
  if (!check(s, { 'verify 200': (r) => r.status === 200 })) return failed.add(1);
  attempt = s.json('data.attemptToken');

  const key = `k6-${idx}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const sub = http.post(`${BASE}/public/attendance/${TOKEN}/submit`, JSON.stringify({ latitude: LAT + 0.00003, longitude: LNG, accuracy: 15 }), {
    headers: { ...json.headers, 'X-Attempt-Token': attempt, 'Idempotency-Key': key }, tags: { step: 'submit' },
  });
  if (check(sub, { 'submit 201': (r) => r.status === 201 })) recorded.add(1);
  else failed.add(1);
  flowTime.add(Date.now() - t0);
}
