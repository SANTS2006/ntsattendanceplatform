import type { Request } from 'express';
import type { ActorType, Prisma, SecuritySeverity } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';

export type AuditInput = {
  action: string;
  organizationId?: string | null;
  actorUserId?: string | null;
  actorType?: ActorType;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
  req?: Request;
};

/**
 * Append-only audit trail (UPDATE/DELETE blocked by a database trigger).
 * Metadata must never include secrets, tokens or full student records.
 */
export async function audit(input: AuditInput): Promise<void> {
  const req = input.req;
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        organizationId: input.organizationId ?? req?.ctx?.organizationId ?? null,
        actorUserId: input.actorUserId ?? req?.auth?.sub ?? null,
        actorType: input.actorType ?? (req?.platformRole ? 'PLATFORM_ADMIN' : req?.auth ? 'USER' : 'PUBLIC'),
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata,
        ip: req?.ip,
        userAgent: req?.headers['user-agent']?.slice(0, 300),
        requestId: req?.id != null ? String(req.id) : undefined,
      },
    });
  } catch (err) {
    // Auditing must not take the request down, but failures are always visible in logs.
    logger.error({ action: input.action, err: err instanceof Error ? err.message : err }, 'audit write failed');
  }
}

export async function securityEvent(input: {
  type: string;
  severity: SecuritySeverity;
  description: string;
  organizationId?: string | null;
  userId?: string | null;
  metadata?: Prisma.InputJsonValue;
  req?: Request;
}) {
  try {
    await prisma.securityEvent.create({
      data: {
        type: input.type,
        severity: input.severity,
        description: input.description,
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        metadata: input.metadata,
        ip: input.req?.ip,
        requestId: input.req?.id != null ? String(input.req.id) : undefined,
      },
    });
  } catch (err) {
    logger.error({ type: input.type, err: err instanceof Error ? err.message : err }, 'security event write failed');
  }
}
