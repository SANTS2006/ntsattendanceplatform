import { env } from '../config/env.js';
import { retireLegacyQueues, scheduleRepeatable, startWorker } from '../infra/queue.js';
import { logger } from '../lib/logger.js';

/**
 * Starts the single BullMQ worker and the repeatable maintenance schedules (selfie retention,
 * backups). Used by the standalone worker process and — when WORKERS_IN_API is on (the default,
 * e.g. on a single free Render web service) — by the API process itself. Requires REDIS_URL.
 * Returns a function that stops the worker gracefully.
 */
export async function startBackgroundProcessing(where: 'api' | 'worker') {
  await retireLegacyQueues();
  const worker = startWorker(4);
  await scheduleRepeatable('selfie-retention', 6 * 3600_000);
  if (env.backupsEnabled && env.BACKUP_INTERVAL_HOURS > 0) await scheduleRepeatable('backup', env.BACKUP_INTERVAL_HOURS * 3600_000, { kind: 'SCHEDULED' });
  logger.info({ where }, 'background worker started');
  return async () => {
    await worker.close();
  };
}
