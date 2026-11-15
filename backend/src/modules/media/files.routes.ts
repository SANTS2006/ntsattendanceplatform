import { Router } from 'express';
import { z } from 'zod';
import { memoryStorage, verifyMemorySignature } from '../../infra/storage.js';
import { AppError } from '../../lib/errors.js';

/**
 * Signed download endpoint for the TEST-ONLY in-memory storage driver.
 * In development and production files are served directly by Cloudinary through signed,
 * expiring URLs, and this router answers 404 for everything.
 */
export const filesRouter = Router();

const query = z.object({ key: z.string().max(300), exp: z.coerce.number().int(), sig: z.string().length(64), name: z.string().max(120).optional() });

filesRouter.get('/', (req, res) => {
  if (!memoryStorage) throw new AppError(404, 'NOT_FOUND', 'Not found');
  const q = query.safeParse(req.query);
  if (!q.success || !verifyMemorySignature(q.data.key, q.data.exp, q.data.name ?? '', q.data.sig)) {
    throw new AppError(403, 'LINK_EXPIRED', 'This link is invalid or has expired');
  }
  const file = memoryStorage.entry(q.data.key);
  if (!file) throw new AppError(404, 'NOT_FOUND', 'File not found');
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (q.data.name) res.setHeader('Content-Disposition', `attachment; filename="${q.data.name.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.send(file.body);
});
