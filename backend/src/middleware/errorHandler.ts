import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger, redactUrl } from '../lib/logger.js';

function send(res: Response, status: number, code: string, message: string, errors: Record<string, unknown> = {}) {
  res.status(status).json({ success: false, message, errors, code });
}

export function notFoundHandler(_req: Request, res: Response) {
  send(res, 404, 'ROUTE_NOT_FOUND', 'The requested endpoint does not exist');
}

/** Maps known errors to the standard error envelope. Internal details never reach clients. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  if (err instanceof AppError) return send(res, err.status, err.code, err.message, err.errors);
  if (err instanceof ZodError) {
    const errors: Record<string, string[]> = {};
    for (const i of err.issues) (errors[i.path.join('.') || '_'] ??= []).push(i.message);
    return send(res, 422, 'VALIDATION_ERROR', 'The request contains invalid data', errors);
  }
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return send(res, 413, 'FILE_TOO_LARGE', 'The uploaded file is too large');
    return send(res, 400, 'UPLOAD_INVALID', 'The upload could not be processed');
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return send(res, 409, 'DUPLICATE', 'A record with these details already exists');
    if (err.code === 'P2025' || err.code === 'P2001') return send(res, 404, 'NOT_FOUND', 'Resource not found');
    if (err.code === 'P2003') return send(res, 409, 'REFERENCE_CONFLICT', 'The record is referenced by or references another record');
  }
  const msg = err instanceof Error ? err.message : String(err);
  // Cross-tenant references are reported as "not found" so they reveal nothing about other tenants.
  if (msg.includes('NTS_TENANT_IMMUTABLE')) {
    logger.warn({ reqId: req.id, url: redactUrl(req.originalUrl) }, 'tenant id change blocked by database');
    return send(res, 400, 'TENANT_IMMUTABLE', 'Organization ownership of a record cannot be changed');
  }
  if (msg.includes('NTS_CROSS_TENANT_REFERENCE')) {
    logger.warn({ reqId: req.id, url: redactUrl(req.originalUrl) }, 'cross-tenant reference blocked by database');
    return send(res, 404, 'NOT_FOUND', 'Referenced resource not found');
  }
  if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
    return send(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  }
  if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    return send(res, 400, 'MALFORMED_JSON', 'Malformed JSON body');
  }
  logger.error({ reqId: req.id, url: redactUrl(req.originalUrl), err: msg, stack: err instanceof Error ? err.stack : undefined }, 'unhandled error');
  return send(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred. Please try again later.');
}
