-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('UNIVERSITY', 'COLLEGE', 'SCHOOL', 'TRAINING_INSTITUTION', 'EVENT_ORGANIZER', 'OTHER');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserTokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "StudentIdCharset" AS ENUM ('NUMERIC', 'ALPHA', 'ALPHANUMERIC', 'CUSTOM');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'GRADUATED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'DROPPED');

-- CreateEnum
CREATE TYPE "LecturerAssignmentRole" AS ENUM ('PRIMARY', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "AttendanceSessionStatus" AS ENUM ('ACTIVE', 'CLOSED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'EXCUSED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "VerificationStep" AS ENUM ('QR_VALIDATE', 'STUDENT_ID', 'LOCATION', 'SELFIE', 'SUBMIT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('CSV', 'XLSX', 'PDF');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'PLATFORM_ADMIN', 'SYSTEM', 'PUBLIC');

-- CreateEnum
CREATE TYPE "SecuritySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerifiedAt" TIMESTAMP(3),
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admins" (
    "userId" UUID NOT NULL,
    "role" "PlatformRole" NOT NULL DEFAULT 'SUPER_ADMIN',
    "grantedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "user_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "UserTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "activeOrganizationId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "replacedById" UUID,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "userId" UUID,
    "ip" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "officialEmail" TEXT NOT NULL,
    "contactNumber" TEXT,
    "country" TEXT NOT NULL,
    "address" TEXT,
    "logoKey" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "website" TEXT,
    "description" TEXT,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_settings" (
    "organizationId" UUID NOT NULL,
    "studentIdExactLength" INTEGER,
    "studentIdMinLength" INTEGER NOT NULL DEFAULT 1,
    "studentIdMaxLength" INTEGER NOT NULL DEFAULT 32,
    "studentIdCharset" "StudentIdCharset" NOT NULL DEFAULT 'ALPHANUMERIC',
    "studentIdCustomPattern" TEXT,
    "studentIdPrefix" TEXT,
    "studentIdSuffix" TEXT,
    "studentIdCaseSensitive" BOOLEAN NOT NULL DEFAULT false,
    "studentIdAllowSpaces" BOOLEAN NOT NULL DEFAULT false,
    "studentIdExample" TEXT,
    "locationRequired" BOOLEAN NOT NULL DEFAULT true,
    "defaultGeofenceRadiusM" INTEGER NOT NULL DEFAULT 100,
    "minGpsAccuracyM" INTEGER NOT NULL DEFAULT 100,
    "selfieRequired" BOOLEAN NOT NULL DEFAULT true,
    "requireEnrollment" BOOLEAN NOT NULL DEFAULT true,
    "defaultSessionDurationMin" INTEGER NOT NULL DEFAULT 60,
    "defaultQrExpiryMin" INTEGER NOT NULL DEFAULT 15,
    "lateAfterMin" INTEGER,
    "allowLateAttendance" BOOLEAN NOT NULL DEFAULT true,
    "imageRetentionDays" INTEGER NOT NULL DEFAULT 180,
    "maxFailedLocationAttempts" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_settings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "membership_roles" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "departmentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "roleId" UUID NOT NULL,
    "departmentId" UUID,
    "createLecturer" BOOLEAN NOT NULL DEFAULT false,
    "tokenHash" TEXT NOT NULL,
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculties" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "facultyId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "departmentId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "durationYears" INTEGER,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_levels" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semesters" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "semesters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "credits" INTEGER,
    "departmentId" UUID,
    "programId" UUID,
    "levelId" UUID,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "courseId" UUID,
    "academicYearId" UUID,
    "semesterId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "room" TEXT,
    "defaultLatitude" DOUBLE PRECISION,
    "defaultLongitude" DOUBLE PRECISION,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "studentNumber" TEXT NOT NULL,
    "normalizedNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "programId" UUID,
    "departmentId" UUID,
    "levelId" UUID,
    "academicYear" TEXT,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lecturers" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "membershipId" UUID,
    "staffNumber" TEXT,
    "title" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "departmentId" UUID,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lecturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_lecturers" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "lecturerId" UUID NOT NULL,
    "role" "LecturerAssignmentRole" NOT NULL DEFAULT 'PRIMARY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_lecturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "venue" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "requireRegistration" BOOLEAN NOT NULL DEFAULT true,
    "defaultLatitude" DOUBLE PRECISION,
    "defaultLongitude" DOUBLE PRECISION,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_participants" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_managers" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "lecturerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_managers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "classId" UUID,
    "eventId" UUID,
    "lecturerId" UUID,
    "createdByUserId" UUID NOT NULL,
    "status" "AttendanceSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radiusM" INTEGER NOT NULL,
    "minAccuracyM" INTEGER NOT NULL,
    "locationRequired" BOOLEAN NOT NULL,
    "selfieRequired" BOOLEAN NOT NULL,
    "requireEnrollment" BOOLEAN NOT NULL,
    "lateAfter" TIMESTAMP(3),
    "allowLate" BOOLEAN NOT NULL DEFAULT true,
    "configSnapshot" JSONB NOT NULL,
    "replacesSessionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_tokens" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "classId" UUID,
    "eventId" UUID,
    "lecturerId" UUID,
    "referenceNumber" TEXT NOT NULL,
    "confirmationTokenHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "studentNumberSnapshot" TEXT NOT NULL,
    "studentNameSnapshot" TEXT NOT NULL,
    "studentEmailSnapshot" TEXT,
    "programSnapshot" TEXT,
    "levelSnapshot" TEXT,
    "contextSnapshot" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendanceDate" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "locationVerified" BOOLEAN,
    "distanceM" DOUBLE PRECISION,
    "gpsAccuracyM" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "selfieId" UUID,
    "verificationMeta" JSONB,
    "correctedById" UUID,
    "correctionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_selfies" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "retainUntil" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_selfies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_verifications" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "studentId" UUID,
    "step" "VerificationStep" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reasonCode" TEXT,
    "distanceM" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "clientHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_imports" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "mapping" JSONB,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "errorReportKey" TEXT,
    "errorSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "student_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_exports" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "reportType" TEXT NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "filters" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT,
    "rowCount" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "actorUserId" UUID,
    "actorType" "ActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "userId" UUID,
    "type" TEXT NOT NULL,
    "severity" "SecuritySeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "ip" TEXT,
    "requestId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_tokens_tokenHash_key" ON "user_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "user_tokens_userId_type_idx" ON "user_tokens"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_revokedAt_idx" ON "refresh_tokens"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "login_attempts_email_createdAt_idx" ON "login_attempts"("email", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempts_ip_createdAt_idx" ON "login_attempts"("ip", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_status_idx" ON "organizations"("status");

-- CreateIndex
CREATE INDEX "organizations_createdAt_idx" ON "organizations"("createdAt");

-- CreateIndex
CREATE INDEX "organization_memberships_userId_idx" ON "organization_memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_organizationId_userId_key" ON "organization_memberships"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_organizationId_id_key" ON "organization_memberships"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organizationId_key_key" ON "roles"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organizationId_id_key" ON "roles"("organizationId", "id");

-- CreateIndex
CREATE INDEX "membership_roles_organizationId_idx" ON "membership_roles"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "membership_roles_membershipId_roleId_departmentId_key" ON "membership_roles"("membershipId", "roleId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_organizationId_email_idx" ON "invitations"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "faculties_organizationId_code_key" ON "faculties"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "faculties_organizationId_id_key" ON "faculties"("organizationId", "id");

-- CreateIndex
CREATE INDEX "departments_organizationId_facultyId_idx" ON "departments"("organizationId", "facultyId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_organizationId_code_key" ON "departments"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_organizationId_id_key" ON "departments"("organizationId", "id");

-- CreateIndex
CREATE INDEX "programs_organizationId_departmentId_idx" ON "programs"("organizationId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "programs_organizationId_code_key" ON "programs"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "programs_organizationId_id_key" ON "programs"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_levels_organizationId_name_key" ON "academic_levels"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "academic_levels_organizationId_id_key" ON "academic_levels"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_organizationId_name_key" ON "academic_years"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_organizationId_id_key" ON "academic_years"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "semesters_organizationId_academicYearId_name_key" ON "semesters"("organizationId", "academicYearId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "semesters_organizationId_id_key" ON "semesters"("organizationId", "id");

-- CreateIndex
CREATE INDEX "courses_organizationId_departmentId_idx" ON "courses"("organizationId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "courses_organizationId_code_key" ON "courses"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "courses_organizationId_id_key" ON "courses"("organizationId", "id");

-- CreateIndex
CREATE INDEX "classes_organizationId_courseId_idx" ON "classes"("organizationId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "classes_organizationId_code_key" ON "classes"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "classes_organizationId_id_key" ON "classes"("organizationId", "id");

-- CreateIndex
CREATE INDEX "students_organizationId_status_idx" ON "students"("organizationId", "status");

-- CreateIndex
CREATE INDEX "students_organizationId_programId_idx" ON "students"("organizationId", "programId");

-- CreateIndex
CREATE INDEX "students_organizationId_departmentId_idx" ON "students"("organizationId", "departmentId");

-- CreateIndex
CREATE INDEX "students_organizationId_levelId_idx" ON "students"("organizationId", "levelId");

-- CreateIndex
CREATE INDEX "students_organizationId_fullName_idx" ON "students"("organizationId", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "students_organizationId_normalizedNumber_key" ON "students"("organizationId", "normalizedNumber");

-- CreateIndex
CREATE UNIQUE INDEX "students_organizationId_id_key" ON "students"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lecturers_membershipId_key" ON "lecturers"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "lecturers_organizationId_email_key" ON "lecturers"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "lecturers_organizationId_id_key" ON "lecturers"("organizationId", "id");

-- CreateIndex
CREATE INDEX "class_lecturers_organizationId_lecturerId_idx" ON "class_lecturers"("organizationId", "lecturerId");

-- CreateIndex
CREATE UNIQUE INDEX "class_lecturers_classId_lecturerId_key" ON "class_lecturers"("classId", "lecturerId");

-- CreateIndex
CREATE INDEX "enrollments_organizationId_studentId_idx" ON "enrollments"("organizationId", "studentId");

-- CreateIndex
CREATE INDEX "enrollments_organizationId_classId_status_idx" ON "enrollments"("organizationId", "classId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_classId_studentId_key" ON "enrollments"("classId", "studentId");

-- CreateIndex
CREATE INDEX "events_organizationId_startsAt_idx" ON "events"("organizationId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "events_organizationId_id_key" ON "events"("organizationId", "id");

-- CreateIndex
CREATE INDEX "event_participants_organizationId_studentId_idx" ON "event_participants"("organizationId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "event_participants_eventId_studentId_key" ON "event_participants"("eventId", "studentId");

-- CreateIndex
CREATE INDEX "event_managers_organizationId_lecturerId_idx" ON "event_managers"("organizationId", "lecturerId");

-- CreateIndex
CREATE UNIQUE INDEX "event_managers_eventId_lecturerId_key" ON "event_managers"("eventId", "lecturerId");

-- CreateIndex
CREATE INDEX "attendance_sessions_organizationId_status_expiresAt_idx" ON "attendance_sessions"("organizationId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "attendance_sessions_organizationId_classId_createdAt_idx" ON "attendance_sessions"("organizationId", "classId", "createdAt");

-- CreateIndex
CREATE INDEX "attendance_sessions_organizationId_eventId_createdAt_idx" ON "attendance_sessions"("organizationId", "eventId", "createdAt");

-- CreateIndex
CREATE INDEX "attendance_sessions_organizationId_lecturerId_createdAt_idx" ON "attendance_sessions"("organizationId", "lecturerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_organizationId_id_key" ON "attendance_sessions"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "qr_tokens_tokenHash_key" ON "qr_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "qr_tokens_organizationId_sessionId_idx" ON "qr_tokens"("organizationId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_referenceNumber_key" ON "attendance_records"("referenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_selfieId_key" ON "attendance_records"("selfieId");

-- CreateIndex
CREATE INDEX "attendance_records_organizationId_submittedAt_idx" ON "attendance_records"("organizationId", "submittedAt");

-- CreateIndex
CREATE INDEX "attendance_records_organizationId_classId_submittedAt_idx" ON "attendance_records"("organizationId", "classId", "submittedAt");

-- CreateIndex
CREATE INDEX "attendance_records_organizationId_eventId_submittedAt_idx" ON "attendance_records"("organizationId", "eventId", "submittedAt");

-- CreateIndex
CREATE INDEX "attendance_records_organizationId_studentId_submittedAt_idx" ON "attendance_records"("organizationId", "studentId", "submittedAt");

-- CreateIndex
CREATE INDEX "attendance_records_organizationId_status_idx" ON "attendance_records"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_sessionId_studentId_key" ON "attendance_records"("sessionId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_sessionId_idempotencyKey_key" ON "attendance_records"("sessionId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_selfies_storageKey_key" ON "attendance_selfies"("storageKey");

-- CreateIndex
CREATE INDEX "attendance_selfies_organizationId_sessionId_studentId_idx" ON "attendance_selfies"("organizationId", "sessionId", "studentId");

-- CreateIndex
CREATE INDEX "attendance_selfies_retainUntil_deletedAt_idx" ON "attendance_selfies"("retainUntil", "deletedAt");

-- CreateIndex
CREATE INDEX "attendance_selfies_organizationId_sha256_idx" ON "attendance_selfies"("organizationId", "sha256");

-- CreateIndex
CREATE INDEX "attendance_verifications_organizationId_sessionId_step_succ_idx" ON "attendance_verifications"("organizationId", "sessionId", "step", "success");

-- CreateIndex
CREATE INDEX "attendance_verifications_sessionId_studentId_step_idx" ON "attendance_verifications"("sessionId", "studentId", "step");

-- CreateIndex
CREATE INDEX "student_imports_organizationId_createdAt_idx" ON "student_imports"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "student_imports_organizationId_id_key" ON "student_imports"("organizationId", "id");

-- CreateIndex
CREATE INDEX "report_exports_organizationId_requestedById_createdAt_idx" ON "report_exports"("organizationId", "requestedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "report_exports_organizationId_id_key" ON "report_exports"("organizationId", "id");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "security_events_organizationId_createdAt_idx" ON "security_events"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "security_events_severity_resolvedAt_createdAt_idx" ON "security_events"("severity", "resolvedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "organization_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "faculties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "academic_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "semesters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "academic_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lecturers" ADD CONSTRAINT "lecturers_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lecturers" ADD CONSTRAINT "lecturers_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_lecturers" ADD CONSTRAINT "class_lecturers_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_lecturers" ADD CONSTRAINT "class_lecturers_lecturerId_fkey" FOREIGN KEY ("lecturerId") REFERENCES "lecturers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_managers" ADD CONSTRAINT "event_managers_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_managers" ADD CONSTRAINT "event_managers_lecturerId_fkey" FOREIGN KEY ("lecturerId") REFERENCES "lecturers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_lecturerId_fkey" FOREIGN KEY ("lecturerId") REFERENCES "lecturers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "attendance_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_selfieId_fkey" FOREIGN KEY ("selfieId") REFERENCES "attendance_selfies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_selfies" ADD CONSTRAINT "attendance_selfies_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_selfies" ADD CONSTRAINT "attendance_selfies_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_verifications" ADD CONSTRAINT "attendance_verifications_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
