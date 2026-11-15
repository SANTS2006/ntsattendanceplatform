import { env } from '../config/env.js';
import { scheduleRepeatable, startWorkers } from '../infra/queue.js';
import { logger } from '../lib/logger.js';

const CONCURRENCY = { email: 5, 'student-import': 1, 'report-export': 1, 'selfie-retention': 1, backup: 1, restore: 1 } as const;

/**
 * Starts the BullMQ workers and the repeatable maintenance schedules (selfie retention, backups).
 * Used by the standalone worker process and — when WORKERS_IN_API is on (the default, e.g. on a
 * single free Render web service) — by the API process itself. Requires REDIS_URL.
 * Returns a function that stops the workers gracefully.
 */
export async function startBackgroundProcessing(where: 'api' | 'worker') {
  const workers = startWorkers(CONCURRENCY);
  await scheduleRepeatable('selfie-retention', 6 * 3600_000);
  if (env.backupsEnabled && env.BACKUP_INTERVAL_HOURS > 0) await scheduleRepeatable('backup', env.BACKUP_INTERVAL_HOURS * 3600_000, { kind: 'SCHEDULED' });
  logger.info({ queues: workers.length, where }, 'background workers started');
  return async () => {
    await Promise.all(workers.map((w) => w.close()));
  };
}
