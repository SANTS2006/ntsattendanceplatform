import http from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma, reportRlsStatus } from './db/prisma.js';
import { closeQueues } from './infra/queue.js';
import { closeRealtime, initRealtime } from './infra/realtime.js';
import { closeRedis } from './infra/redis.js';
import { startBackgroundProcessing } from './jobs/background.js';
import { registerJobs, runSelfieRetention } from './jobs/index.js';
import { runBackupJob } from './modules/backups/backups.service.js';
import { logger } from './lib/logger.js';
import { ensurePermissionCatalogue } from './modules/organizations/organizations.service.js';

registerJobs();
await reportRlsStatus(logger);
await ensurePermissionCatalogue();

const app = createApp();
const server = http.createServer(app);
initRealtime(server);
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

// One-service hosting (e.g. Render free): process queued jobs here instead of a separate worker.
const stopWorkers = env.REDIS_URL && env.WORKERS_IN_API ? await startBackgroundProcessing('api') : null;

server.listen(env.PORT, () => logger.info({ port: env.PORT, env: env.NODE_ENV, redis: !!env.REDIS_URL }, 'NTS API listening'));

// Without Redis there is no separate worker process, so run maintenance in-process (dev only).
const maintenance = !env.REDIS_URL ? setInterval(() => runSelfieRetention().catch(() => undefined), 6 * 3600_000) : null;
const backups =
  !env.REDIS_URL && env.backupsEnabled && env.BACKUP_INTERVAL_HOURS > 0
    ? setInterval(() => runBackupJob({ kind: 'SCHEDULED' }).catch((e) => logger.error({ err: e instanceof Error ? e.message : e }, 'scheduled backup failed')), env.BACKUP_INTERVAL_HOURS * 3600_000)
    : null;

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  if (maintenance) clearInterval(maintenance);
  if (backups) clearInterval(backups);
  server.close();
  if (stopWorkers) await stopWorkers();
  await closeRealtime();
  await closeQueues();
  await closeRedis();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error({ err: err instanceof Error ? err.message : err }, 'unhandled rejection'));
