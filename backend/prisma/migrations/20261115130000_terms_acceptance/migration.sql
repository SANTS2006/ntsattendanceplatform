-- AlterTable
ALTER TABLE "pending_registrations" ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);

