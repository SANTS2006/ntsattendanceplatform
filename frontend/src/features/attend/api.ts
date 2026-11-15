import { http, toApiError, type ApiSuccess } from '@/api/client';

/** Anonymous student attendance API (no account; chained by a short-lived attempt token). */
export type StudentIdFormat = {
  exactLength: number | null;
  minLength: number;
  maxLength: number;
  charset: 'NUMERIC' | 'ALPHA' | 'ALPHANUMERIC' | 'CUSTOM';
  prefix: string | null;
  suffix: string | null;
  caseSensitive: boolean;
  allowSpaces: boolean;
  example: string | null;
};

export type ValidateResult = {
  attemptToken: string;
  organization: { name: string; logoUrl: string | null };
  session: {
    title: string;
    context: string;
    type: 'CLASS' | 'EVENT';
    lecturer: string | null;
    expiresAt: string;
    serverTime: string;
    locationRequired: boolean;
    selfieRequired: boolean;
    radiusM: number;
    minAccuracyM: number;
  };
  studentIdFormat: StudentIdFormat;
};

export type VerifiedStudent = { fullName: string; studentId: string; email: string | null; program: string | null; level: string | null };

export type SuccessResult = {
  success: true;
  message: string;
  referenceNumber: string;
  confirmationToken: string | null;
  organization: string;
  student: VerifiedStudent;
  context: string;
  status: string;
  attendanceDate: string;
  attendanceTime: string;
  submittedAt: string;
  timezone: string;
  locationVerified: boolean | null;
  selfieUrl: string | null;
  idempotentReplay?: boolean;
};

export type Coords = { latitude: number; longitude: number; accuracy: number };

const base = (token: string) => `/public/attendance/${encodeURIComponent(token)}`;
const call = async <T>(p: Promise<{ data: ApiSuccess<T> }>) => {
  try {
    return (await p).data.data;
  } catch (e) {
    throw toApiError(e);
  }
};

export const attendApi = {
  validate: (token: string) => call<ValidateResult>(http.post(`${base(token)}/validate`)),
  verifyStudent: (token: string, attempt: string, studentId: string) =>
    call<{ attemptToken: string; student: VerifiedStudent }>(http.post(`${base(token)}/verify-student`, { studentId }, { headers: { 'X-Attempt-Token': attempt } })),
  verifyLocation: (token: string, attempt: string, c: Coords) =>
    call<{ withinGeofence: boolean; distanceM: number | null; accuracyM: number | null; radiusM: number }>(
      http.post(`${base(token)}/verify-location`, c, { headers: { 'X-Attempt-Token': attempt } }),
    ),
  uploadSelfie: (token: string, attempt: string, blob: Blob) => {
    const fd = new FormData();
    fd.append('file', blob, 'selfie.jpg');
    return call<{ selfieId: string; previewUrl: string }>(http.post(`${base(token)}/upload-selfie`, fd, { headers: { 'X-Attempt-Token': attempt } }));
  },
  submit: (token: string, attempt: string, idempotencyKey: string, body: Partial<Coords> & { selfieId?: string | null }) =>
    call<SuccessResult>(http.post(`${base(token)}/submit`, body, { headers: { 'X-Attempt-Token': attempt, 'Idempotency-Key': idempotencyKey } })),
  confirmation: (reference: string, token: string) => call<SuccessResult>(http.get(`/public/attendance/confirmation/${encodeURIComponent(reference)}`, { params: { token } })),
};

/** Mirrors the server's format rules so we only auto-verify once the ID can be valid. */
export function formatSatisfied(value: string, f: StudentIdFormat): boolean {
  let v = value.trim();
  v = f.allowSpaces ? v.replace(/\s+/g, ' ') : v.replace(/\s+/g, '');
  if (!f.caseSensitive) v = v.toUpperCase();
  if (f.exactLength != null ? v.length !== f.exactLength : v.length < f.minLength || v.length > f.maxLength) return false;
  const pre = f.prefix ? (f.caseSensitive ? f.prefix : f.prefix.toUpperCase()) : '';
  const suf = f.suffix ? (f.caseSensitive ? f.suffix : f.suffix.toUpperCase()) : '';
  if (pre && !v.startsWith(pre)) return false;
  if (suf && !v.endsWith(suf)) return false;
  const body = v.slice(pre.length, v.length - suf.length);
  const re = f.charset === 'NUMERIC' ? /^[0-9 ]*$/ : f.charset === 'ALPHA' ? /^[A-Za-z ]*$/ : f.charset === 'ALPHANUMERIC' ? /^[A-Za-z0-9 ]*$/ : /^.*$/;
  return re.test(body);
}

export function getPosition(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(Object.assign(new Error('unsupported'), { code: 'UNSUPPORTED' }));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(Object.assign(new Error(e.message), { code: e.code === 1 ? 'DENIED' : e.code === 3 ? 'TIMEOUT' : 'UNAVAILABLE' })),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
}
