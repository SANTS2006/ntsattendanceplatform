import { prisma } from '../db/prisma.js';
import { sendMail } from '../infra/mailer.js';
import { registerJobHandler } from '../infra/queue.js';
import { imageStorage } from '../infra/storage.js';
import { logger } from '../lib/logger.js';
import { runExportJob } from '../modules/reports/reports.service.js';
import { runBackupJob, runRestoreJob } from '../modules/backups/backups.service.js';
import { runImportJob } from '../modules/students/import.service.js';

/**
 * Selfie retention: deletes expired selfie objects across tenants. This is a system maintenance
 * job — it touches only rows whose retention window (set per tenant at upload time) has passed.
 */
export async function runSelfieRetention() {
  let deleted = 0;
  for (;;) {
    const due = await prisma.attendanceSelfie.findMany({ where: { retainUntil: { lt: new Date() }, deletedAt: null }, take: 200, select: { id: true, storageKey: true } });
    if (due.length === 0) break;
    for (const s of due) {
      await imageStorage.delete(s.storageKey).catch((e) => logger.warn({ id: s.id, err: e instanceof Error ? e.message : e }, 'selfie delete failed'));
      await prisma.attendanceSelfie.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
      deleted++;
    }
  }
  // Orphaned uploads (never attached to an attendance record) are removed after 24 hours.
  const orphans = await prisma.attendanceSelfie.findMany({
    where: { deletedAt: null, record: null, createdAt: { lt: new Date(Date.now() - 86_400_000) } },
    take: 1000, select: { id: true, storageKey: true },
  });
  for (const s of orphans) {
    await imageStorage.delete(s.storageKey).catch(() => undefined);
    await prisma.attendanceSelfie.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
    deleted++;
  }
  if (deleted) logger.info({ deleted }, 'selfie retention run');
  return deleted;
}

export function registerJobs() {
  registerJobHandler('email', async (d) => sendMail(d as { to: string; subject: string; text: string; html?: string }));
  registerJobHandler('student-import', async (d) => runImportJob(d as { organizationId: string; importId: string }));
  registerJobHandler('report-export', async (d) => runExportJob(d as { organizationId: string; exportId: string }));
  registerJobHandler('selfie-retention', async () => {
    await runSelfieRetention();
  });
  registerJobHandler('notify', async () => undefined);
  registerJobHandler('backup', async (d) => runBackupJob(d as { backupId?: string; userId?: string }));
  registerJobHandler('restore', async (d) => runRestoreJob(d as { backupId: string; userId?: string }));
}
