-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'AWAITING_ORGANIZATION', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('GENERAL', 'TECHNICAL', 'BILLING', 'ACCOUNT', 'FEATURE_REQUEST');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('BUG', 'FEATURE', 'IMPROVEMENT', 'PRAISE', 'OTHER');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'REVIEWED', 'PLANNED', 'DONE');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('MANUAL', 'SCHEDULED', 'PRE_RESTORE');

-- AlterTable
ALTER TABLE "student_imports" ADD COLUMN     "resource" TEXT NOT NULL DEFAULT 'students';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarKey" TEXT;

-- CreateTable
CREATE TABLE "email_change_requests" (
    "userId" UUID NOT NULL,
    "newEmail" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_change_requests_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "category" "SupportCategory" NOT NULL DEFAULT 'GENERAL',
    "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orgUnread" BOOLEAN NOT NULL DEFAULT false,
    "platformUnread" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "fromPlatform" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" "FeedbackCategory" NOT NULL DEFAULT 'OTHER',
    "rating" INTEGER,
    "message" TEXT NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backups" (
    "id" UUID NOT NULL,
    "kind" "BackupKind" NOT NULL DEFAULT 'MANUAL',
    "status" "BackupStatus" NOT NULL DEFAULT 'RUNNING',
    "storageKey" TEXT,
    "sizeBytes" INTEGER,
    "rowCounts" JSONB,
    "error" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),
    "restoredById" UUID,
    "restoreStatus" TEXT,

    CONSTRAINT "backups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_tickets_organizationId_lastMessageAt_idx" ON "support_tickets"("organizationId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "support_tickets_status_lastMessageAt_idx" ON "support_tickets"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "support_messages_ticketId_createdAt_idx" ON "support_messages"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "feedback_organizationId_createdAt_idx" ON "feedback"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "feedback_status_createdAt_idx" ON "feedback"("status", "createdAt");

-- CreateIndex
CREATE INDEX "backups_createdAt_idx" ON "backups"("createdAt");

-- AddForeignKey
ALTER TABLE "email_change_requests" ADD CONSTRAINT "email_change_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tenant protections for the new organization-owned tables (same model as tenant_integrity).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_tickets','feedback'] LOOP
    EXECUTE format('CREATE TRIGGER nts_tenant_immutable BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION nts_forbid_tenant_change()', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY nts_tenant_isolation ON %I USING (nts_tenant_visible("organizationId")) WITH CHECK (nts_tenant_visible("organizationId"))', t);
  END LOOP;
END $$;

ALTER TABLE feedback ADD CONSTRAINT feedback_rating_chk CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
