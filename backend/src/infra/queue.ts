import { Queue, Worker, type JobsOptions } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { logRedisError, newRedisConnection } from './redis.js';

/**
 * Background jobs (BullMQ on Redis).
 * Every job payload carries `organizationId` when it touches tenant data; handlers re-load the
 * target row through the tenant-scoped client, so a forged/mismatched payload finds nothing.
 *
 * All job types share ONE queue ("jobs") and ONE worker that dispatches on the job name. Each
 * BullMQ worker holds two Redis connections, so one worker per type would exhaust small hosted
 * Redis plans (e.g. Redis Cloud free: 30 clients across every running instance).
 *
 * Without Redis (development/test only) jobs run in-process after the response is sent.
 */
export type JobName = 'email' | 'student-import' | 'report-export' | 'selfie-retention' | 'notify' | 'backup' | 'restore';
export type JobHandler = (data: Record<string, unknown>) => Promise<void>;

const QUEUE = 'jobs';
const LEGACY_QUEUES: JobName[] = ['email', 'student-import', 'report-export', 'selfie-retention', 'notify', 'backup', 'restore'];

const handlers = new Map<JobName, JobHandler>();
const inflight = new Set<Promise<void>>();
let producerConnection: ReturnType<typeof newRedisConnection> | null = null;
let jobsQueue: Queue | null = null;

export function registerJobHandler(name: JobName, handler: JobHandler) {
  handlers.set(name, handler);
}

function sharedConnection() {
  producerConnection ??= newRedisConnection();
  return producerConnection;
}

function queue() {
  if (!jobsQueue) {
    jobsQueue = new Queue(QUEUE, { connection: sharedConnection(), prefix: 'nts' });
    jobsQueue.on('error', logRedisError); // otherwise BullMQ prints every connection error itself
  }
  return jobsQueue;
}

export async function enqueue(name: JobName, data: Record<string, unknown>, opts: JobsOptions = {}) {
  if (env.REDIS_URL) {
    await queue().add(name, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 86_400, count: 1000 },
      removeOnFail: { age: 7 * 86_400 },
      ...opts,
    });
    return;
  }
  const handler = handlers.get(name);
  if (!handler) throw new Error(`No handler registered for job ${name}`);
  const p = new Promise<void>((resolve) => setImmediate(resolve))
    .then(() => handler(data))
    .catch((err) => logger.error({ job: name, err: err instanceof Error ? err.message : String(err) }, 'inline job failed'))
    .finally(() => inflight.delete(p));
  inflight.add(p);
}

/** Tests: wait for all in-process jobs. */
export async function drainInlineJobs() {
  while (inflight.size) await Promise.all([...inflight]);
}

/** One worker for every job type (two Redis connections in total). */
export function startWorker(concurrency = 4) {
  if (!env.REDIS_URL) throw new Error('Workers require REDIS_URL');
  const w = new Worker(
    QUEUE,
    async (job) => {
      const handler = handlers.get(job.name as JobName);
      if (!handler) throw new Error(`No handler registered for job ${job.name}`);
      await handler(job.data);
    },
    { connection: newRedisConnection(), prefix: 'nts', concurrency },
  );
  w.on('failed', (job, err) => logger.error({ job: job?.name, id: job?.id, err: err.message }, 'job failed'));
  w.on('error', logRedisError);
  return w;
}

export async function jobCounts() {
  if (!env.REDIS_URL) return { mode: 'inline', pending: inflight.size };
  return { mode: 'bullmq', queue: QUEUE, ...(await queue().getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed')) };
}

export async function scheduleRepeatable(name: JobName, everyMs: number, data: Record<string, unknown> = {}) {
  if (!env.REDIS_URL) return;
  await queue().upsertJobScheduler(`${name}-schedule`, { every: everyMs }, { name, data });
}

/**
 * Earlier versions used one queue per job type. Remove those queues (and their repeat schedules)
 * so nothing is left behind in Redis. Their jobs were never processed when no worker ran, so they
 * are stale (e.g. expired sign-up codes) and are dropped rather than replayed.
 */
export async function retireLegacyQueues() {
  if (!env.REDIS_URL) return;
  for (const name of LEGACY_QUEUES) {
    const q = new Queue(name, { connection: sharedConnection(), prefix: 'nts' });
    q.on('error', logRedisError);
    try {
      const counts = await q.getJobCounts('waiting', 'delayed', 'paused', 'active', 'completed', 'failed');
      const total = Object.values(counts).reduce((a, n) => a + n, 0);
      const schedulers = await q.getJobSchedulers().catch(() => []);
      if (total === 0 && schedulers.length === 0) continue;
      for (const s of schedulers) await q.removeJobScheduler(s.key).catch(() => undefined);
      await q.obliterate({ force: true });
      logger.info({ queue: name, droppedJobs: total }, 'removed legacy per-type queue');
    } catch (e) {
      logger.warn({ queue: name, err: e instanceof Error ? e.message : String(e) }, 'could not remove legacy queue');
    } finally {
      await q.close().catch(() => undefined);
    }
  }
}

export async function closeQueues() {
  if (jobsQueue) await jobsQueue.close().catch(() => undefined);
  jobsQueue = null;
  if (producerConnection) await producerConnection.quit().catch(() => undefined);
  producerConnection = null;
}
