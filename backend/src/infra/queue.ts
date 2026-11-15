import { Queue, Worker, type JobsOptions } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { newRedisConnection } from './redis.js';

/**
 * Background jobs (BullMQ on Redis).
 * Every job payload carries `organizationId` when it touches tenant data; handlers re-load the
 * target row through the tenant-scoped client, so a forged/mismatched payload finds nothing.
 *
 * Without Redis (development/test only) jobs run in-process after the response is sent.
 */
export type JobName = 'email' | 'student-import' | 'report-export' | 'selfie-retention' | 'notify' | 'backup' | 'restore';
export type JobHandler = (data: Record<string, unknown>) => Promise<void>;

const handlers = new Map<JobName, JobHandler>();
const queues = new Map<JobName, Queue>();
const inflight = new Set<Promise<void>>();

export function registerJobHandler(name: JobName, handler: JobHandler) {
  handlers.set(name, handler);
}

function queue(name: JobName) {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: newRedisConnection(), prefix: 'nts' });
    queues.set(name, q);
  }
  return q;
}

export async function enqueue(name: JobName, data: Record<string, unknown>, opts: JobsOptions = {}) {
  if (env.REDIS_URL) {
    await queue(name).add(name, data, {
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

export function startWorkers(concurrency: Partial<Record<JobName, number>> = {}) {
  if (!env.REDIS_URL) throw new Error('Workers require REDIS_URL');
  const workers: Worker[] = [];
  for (const [name, handler] of handlers) {
    const w = new Worker(name, async (job) => handler(job.data), {
      connection: newRedisConnection(),
      prefix: 'nts',
      concurrency: concurrency[name] ?? 4,
    });
    w.on('failed', (job, err) => logger.error({ job: name, id: job?.id, err: err.message }, 'job failed'));
    workers.push(w);
  }
  return workers;
}

export async function jobCounts() {
  if (!env.REDIS_URL) return { mode: 'inline', pending: inflight.size };
  const out: Record<string, unknown> = { mode: 'bullmq' };
  for (const name of handlers.keys()) {
    out[name] = await queue(name).getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  }
  return out;
}

export async function scheduleRepeatable(name: JobName, everyMs: number, data: Record<string, unknown> = {}) {
  if (!env.REDIS_URL) return;
  await queue(name).upsertJobScheduler(`${name}-schedule`, { every: everyMs }, { name, data });
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
