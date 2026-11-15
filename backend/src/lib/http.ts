import type { Request, Response } from 'express';
import { z } from 'zod';

export type Meta = Record<string, unknown>;

export function ok<T>(res: Response, data: T, opts: { status?: number; message?: string; meta?: Meta } = {}) {
  return res.status(opts.status ?? 200).json({
    success: true,
    message: opts.message ?? 'Operation completed successfully',
    data,
    meta: opts.meta ?? {},
  });
}

export const created = <T>(res: Response, data: T, message = 'Created successfully') => ok(res, data, { status: 201, message });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function pageArgs(q: { page: number; pageSize: number }) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function pageMeta(q: { page: number; pageSize: number }, total: number) {
  return { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
}

export const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';

export const uuidParam = z.object({ id: z.string().uuid() });

/** Optional string from forms: empty string → undefined. */
export const optStr = (max = 255) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());
export const nullableStr = (max = 255) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
export const nullableUuid = () => z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
