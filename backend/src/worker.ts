/**
 * Background worker process (scale horizontally, independent of the API).
 * Requires Redis. Start with `npm run worker` (dev) or `npm run start:worker` (prod).
 */
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { closeQueues } from './infra/queue.js';
import { closeRedis } from './infra/redis.js';
import { startBackgroundProcessing } from './jobs/background.js';
import { registerJobs } from './jobs/index.js';
import { logger } from './lib/logger.js';

if (!env.REDIS_URL) {
  logger.error('The worker requires REDIS_URL. Without Redis, jobs run inside the API process (development only).');
  process.exit(1);
}

registerJobs();
const stopWorkers = await startBackgroundProcessing('worker');

async function shutdown() {
  await stopWorkers();
  await closeQueues();
  await closeRedis();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
