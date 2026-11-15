import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { getRedis } from '../../infra/redis.js';

/**
 * Liveness/readiness for load balancers and process managers. Deliberately terse: detailed
 * diagnostics are only available to platform admins at /api/v1/platform/system-health.
 */
export const healthRouter = Router();

healthRouter.get('/live', (_req, res) => {
  res.json({ status: 'ok' });
});

healthRouter.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const redis = getRedis();
    if (redis) await redis.ping();
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});
