/**
 * Background worker process (scale horizontally, independent of the API).
 * Requires Redis. Start with `npm run worker` (dev) or `npm run start:worker` (prod).
 */
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { closeQueues, scheduleRepeatable, startWorkers } from './infra/queue.js';
import { closeRedis } from './infra/redis.js';
import { registerJobs } from './jobs/index.js';
import { logger } from './lib/logger.js';

if (!env.REDIS_URL) {
  logger.error('The worker requires REDIS_URL. Without Redis, jobs run inside the API process (development only).');
  process.exit(1);
}

registerJobs();
const workers = startWorkers({ email: 10, 'student-import': 2, 'report-export': 2, 'selfie-retention': 1, backup: 1, restore: 1 });
await scheduleRepeatable('selfie-retention', 6 * 3600_000);
if (env.backupsEnabled && env.BACKUP_INTERVAL_HOURS > 0) await scheduleRepeatable('backup', env.BACKUP_INTERVAL_HOURS * 3600_000, { kind: 'SCHEDULED' });
logger.info({ queues: workers.length }, 'NTS worker started');

async function shutdown() {
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues();
  await closeRedis();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
