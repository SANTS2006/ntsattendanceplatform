export type OrgType = 'UNIVERSITY' | 'COLLEGE' | 'SCHOOL' | 'TRAINING_INSTITUTION' | 'EVENT_ORGANIZER' | 'OTHER';

export type User = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  emailVerified: boolean;
  mfaEnabled: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
  avatarUrl: string | null;
  status: string;
  createdAt: string;
};

export type OrgSummary = {
  id: string;
  name: string;
  slug: string;
  type: OrgType;
  status: string;
  timezone: string;
  isOwner: boolean;
  isLecturer: boolean;
  roles: { key: string; name: string }[];
};

export type Me = {
  user: User;
  platformRole: 'SUPER_ADMIN' | 'PLATFORM_ADMIN' | null;
  activeOrganizationId: string | null;
  organizations: OrgSummary[];
  pendingEmailChange?: { newEmail: string; expiresAt: string; resendAvailableAt: string } | null;
};

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { link?: string; [k: string]: unknown } | null;
  createdAt: string;
  readAt: string | null;
};

export type CurrentOrg = {
  id: string;
  name: string;
  slug: string;
  type: OrgType;
  officialEmail: string;
  contactNumber: string | null;
  country: string;
  address: string | null;
  timezone: string;
  website: string | null;
  description: string | null;
  status: string;
  logoUrl: string | null;
  createdAt: string;
  myPermissions: 'ALL' | string[];
  isOwner: boolean;
  lecturerId: string | null;
};

export type OrgSettings = {
  organizationId: string;
  studentIdExactLength: number | null;
  studentIdMinLength: number;
  studentIdMaxLength: number;
  studentIdCharset: 'NUMERIC' | 'ALPHA' | 'ALPHANUMERIC' | 'CUSTOM';
  studentIdCustomPattern: string | null;
  studentIdPrefix: string | null;
  studentIdSuffix: string | null;
  studentIdCaseSensitive: boolean;
  studentIdAllowSpaces: boolean;
  studentIdExample: string | null;
  locationRequired: boolean;
  defaultGeofenceRadiusM: number;
  minGpsAccuracyM: number;
  selfieRequired: boolean;
  requireEnrollment: boolean;
  defaultSessionDurationMin: number;
  defaultQrExpiryMin: number;
  lateAfterMin: number | null;
  allowLateAttendance: boolean;
  imageRetentionDays: number;
  maxFailedLocationAttempts: number;
};

export type Ref = { id: string; name: string };

export type Student = {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  programId: string | null;
  departmentId: string | null;
  levelId: string | null;
  academicYear: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'GRADUATED' | 'SUSPENDED';
  program: (Ref & { code: string }) | null;
  department: Ref | null;
  level: Ref | null;
  createdAt: string;
};

export type ClassItem = {
  id: string;
  name: string;
  code: string;
  room: string | null;
  status: string;
  courseId: string | null;
  defaultLatitude: number | null;
  defaultLongitude: number | null;
  course: { id: string; code: string; title: string } | null;
  semester: Ref | null;
  lecturers: { lecturerId: string; role: string; lecturer: { id: string; firstName: string; lastName: string; title: string | null; email: string } }[];
  _count: { enrollments: number };
};

export type EventItem = {
  id: string;
  name: string;
  description: string | null;
  venue: string | null;
  startsAt: string;
  endsAt: string;
  requireRegistration: boolean;
  defaultLatitude: number | null;
  defaultLongitude: number | null;
  status: string;
  _count?: { participants: number; attendanceSessions: number };
};

export type SessionStatus = 'ACTIVE' | 'EXPIRED' | 'CLOSED' | 'REVOKED';

export type SessionStats = {
  expected: number;
  present: number;
  late: number;
  excused: number;
  invalidated: number;
  absent: number;
  attendanceRate: number | null;
  totalSubmissions: number;
  locationVerified: number;
  failedAttempts: Record<string, number>;
  failedAttemptsTotal: number;
};

export type AttendanceSession = {
  id: string;
  title: string;
  classId: string | null;
  eventId: string | null;
  status: 'ACTIVE' | 'CLOSED' | 'REVOKED';
  effectiveStatus: SessionStatus;
  startsAt: string;
  expiresAt: string;
  closedAt: string | null;
  revokedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusM: number;
  minAccuracyM: number;
  locationRequired: boolean;
  selfieRequired: boolean;
  requireEnrollment: boolean;
  lateAfter: string | null;
  createdAt: string;
  class: { id: string; name: string; code: string; course: { code: string; title: string } | null } | null;
  event: { id: string; name: string } | null;
  lecturer: { id: string; firstName: string; lastName: string } | null;
  _count?: { records: number };
  stats?: SessionStats;
  serverTime?: string;
  canManage?: boolean;
};

export type QrInfo = { token: string; url: string; expiresAt: string; sessionExpiresAt: string; rotationSeconds: number | null; serverTime: string };

export type AttendanceRecord = {
  id: string;
  referenceNumber: string;
  sessionId: string;
  studentId: string;
  studentNumberSnapshot: string;
  studentNameSnapshot: string;
  studentEmailSnapshot: string | null;
  programSnapshot: string | null;
  levelSnapshot: string | null;
  contextSnapshot: string;
  submittedAt: string;
  attendanceDate: string;
  attendanceTime: string;
  status: 'PRESENT' | 'LATE' | 'EXCUSED' | 'INVALIDATED';
  locationVerified: boolean | null;
  distanceM: number | null;
  gpsAccuracyM: number | null;
  selfieUrl: string | null;
  verificationStatus: string;
  verificationMeta: { flags?: string[]; manual?: boolean } | null;
  correctionReason: string | null;
};

export type Member = {
  id: string;
  status: 'ACTIVE' | 'SUSPENDED';
  isOwner: boolean;
  title: string | null;
  createdAt: string;
  user: { id: string; email: string; firstName: string; lastName: string; status: string; lastLoginAt: string | null };
  roles: { id: string; roleId: string; departmentId: string | null; role: { id: string; key: string; name: string }; department: Ref | null }[];
  lecturer: { id: string } | null;
};

export type Role = { id: string; key: string; name: string; description: string | null; isSystem: boolean; permissions: string[]; memberCount: number };
export type Permission = { id: string; key: string; group: string; description: string };
