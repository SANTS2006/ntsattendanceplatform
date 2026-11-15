import { gunzipSync, gzipSync } from 'node:zlib';
import crypto from 'node:crypto';
import type { Request } from 'express';
import type { BackupKind, Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { backupStore } from '../../infra/backupStore.js';
import { enqueue } from '../../infra/queue.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { audit } from '../audit/audit.service.js';
import { notifyUser } from '../notifications/notify.js';

/**
 * Logical database backups to Cloudflare R2.
 *
 * Format: gzip(JSON) { format, version, createdAt, migration, tables: { <table>: rows[] } }
 * Restore: one transaction — TRUNCATE every table, then re-insert in foreign-key order using
 * json_populate_recordset, so column types round-trip exactly. A safety backup of the current
 * data is always taken first. The `backups` table itself is never backed up or restored, so the
 * restore history survives.
 */
const FORMAT = 'ntsattend-backup';
const VERSION = 1;
const EXCLUDED = new Set(['_prisma_migrations', 'backups']);

function requireStore() {
  if (!backupStore) throw badRequest('Backups are not configured. Set the R2_* environment variables.', 'BACKUPS_DISABLED');
  return backupStore;
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Tables in insertion order (parents before children), computed from live foreign keys. */
export async function tablesInDependencyOrder(db: Prisma.TransactionClient | typeof prisma = prisma) {
  const tables = (await db.$queryRaw<{ t: string }[]>`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public'`).map((r) => r.t).filter((t) => !EXCLUDED.has(t));
  const fks = await db.$queryRaw<{ child: string; parent: string }[]>`
    SELECT cl.relname AS child, pr.relname AS parent
    FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class pr ON pr.oid = c.confrelid
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`;
  const deps = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const f of fks) if (f.child !== f.parent && deps.has(f.child) && deps.has(f.parent)) deps.get(f.child)!.add(f.parent);
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (t: string) => {
    if (state.get(t) === 'done') return;
    if (state.get(t) === 'visiting') throw new Error(`Foreign-key cycle involving ${t}`);
    state.set(t, 'visiting');
    for (const p of [...deps.get(t)!].sort()) visit(p);
    state.set(t, 'done');
    order.push(t);
  };
  for (const t of [...tables].sort()) visit(t);
  return order;
}

async function latestMigration() {
  const rows = await prisma.$queryRaw<{ name: string }[]>`SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1`;
  return rows[0]?.name ?? null;
}

const backupKey = (id: string) => {
  const d = new Date();
  return `backups/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${id}.json.gz`;
};

/** Performs a backup synchronously (used by the job and before restores). */
export async function performBackup(kind: BackupKind, createdById: string | null, existingId?: string) {
  const store = requireStore();
  const id = existingId ?? crypto.randomUUID();
  if (!existingId) await prisma.backup.create({ data: { id, kind, createdById, status: 'RUNNING' } });
  try {
    const tables: Record<string, unknown[]> = {};
    const rowCounts: Record<string, number> = {};
    for (const t of await tablesInDependencyOrder()) {
      const [{ rows }] = await prisma.$queryRawUnsafe<{ rows: unknown[] }[]>(`SELECT coalesce(json_agg(x), '[]'::json) AS rows FROM ${q(t)} x`);
      tables[t] = rows;
      rowCounts[t] = rows.length;
    }
    const body = gzipSync(Buffer.from(JSON.stringify({ format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), migration: await latestMigration(), tables })));
    const key = backupKey(id);
    await store.put(key, body);
    return prisma.backup.update({ where: { id }, data: { status: 'COMPLETED', storageKey: key, sizeBytes: body.length, rowCounts, completedAt: new Date() } });
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : 'Backup failed';
    await prisma.backup.update({ where: { id }, data: { status: 'FAILED', error: msg, completedAt: new Date() } });
    throw err;
  }
}

export async function requestBackup(userId: string, req: Request) {
  requireStore();
  if (await prisma.backup.findFirst({ where: { status: 'RUNNING' } })) throw conflict('A backup is already running', 'BACKUP_RUNNING');
  const b = await prisma.backup.create({ data: { kind: 'MANUAL', createdById: userId, status: 'RUNNING' } });
  await enqueue('backup', { backupId: b.id, userId });
  await audit({ action: 'platform.backup_requested', targetType: 'Backup', targetId: b.id, actorType: 'PLATFORM_ADMIN', req });
  return b;
}

export async function runBackupJob(data: { backupId?: string; userId?: string; kind?: BackupKind }) {
  if (!backupStore) return;
  const b = data.backupId
    ? await performBackup('MANUAL', data.userId ?? null, data.backupId)
    : await performBackup(data.kind ?? 'SCHEDULED', null);
  if (data.userId) {
    await notifyUser({ userId: data.userId, type: 'backup.completed', title: 'Backup completed', body: `${Math.round((b.sizeBytes ?? 0) / 1024)} KB saved to R2`, data: { backupId: b.id, link: '/platform/backups' } });
  }
  await pruneBackups();
}

/** Retention: delete backups older than BACKUP_RETENTION_DAYS, always keeping the newest three. */
export async function pruneBackups() {
  if (!backupStore) return 0;
  const keep = await prisma.backup.findMany({ where: { status: 'COMPLETED' }, orderBy: { createdAt: 'desc' }, take: 3, select: { id: true } });
  const old = await prisma.backup.findMany({
    where: { createdAt: { lt: new Date(Date.now() - env.BACKUP_RETENTION_DAYS * 86_400_000) }, id: { notIn: keep.map((k) => k.id) } },
  });
  for (const b of old) {
    if (b.storageKey) await backupStore.delete(b.storageKey).catch((e) => logger.warn({ id: b.id, err: e instanceof Error ? e.message : e }, 'backup delete failed'));
    await prisma.backup.delete({ where: { id: b.id } });
  }
  return old.length;
}

export async function listBackups(q2: { page: number; pageSize: number }) {
  const [items, total, last] = await Promise.all([
    prisma.backup.findMany({ orderBy: { createdAt: 'desc' }, skip: (q2.page - 1) * q2.pageSize, take: q2.pageSize }),
    prisma.backup.count(),
    prisma.backup.findFirst({ where: { status: 'COMPLETED' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: items.flatMap((i) => [i.createdById, i.restoredById]).filter(Boolean) as string[] } }, select: { id: true, firstName: true, lastName: true } });
  const who = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  return {
    items: items.map((i) => ({ ...i, createdBy: i.createdById ? who.get(i.createdById) ?? null : null, restoredBy: i.restoredById ? who.get(i.restoredById) ?? null : null })),
    total,
    config: {
      enabled: !!backupStore,
      destination: backupStore?.description ?? null,
      retentionDays: env.BACKUP_RETENTION_DAYS,
      intervalHours: env.BACKUP_INTERVAL_HOURS,
      lastBackupAt: last?.createdAt ?? null,
    },
  };
}

export async function downloadUrl(id: string, req: Request) {
  const store = requireStore();
  const b = await prisma.backup.findUnique({ where: { id } });
  if (!b?.storageKey || b.status !== 'COMPLETED') throw notFound('Backup');
  await audit({ action: 'platform.backup_downloaded', targetType: 'Backup', targetId: id, actorType: 'PLATFORM_ADMIN', req });
  return { url: await store.signedUrl(b.storageKey, 300, `ntsattend-backup-${b.createdAt.toISOString().slice(0, 10)}-${id.slice(0, 8)}.json.gz`), expiresInSeconds: 300 };
}

export async function deleteBackup(id: string, role: string | undefined, req: Request) {
  const store = requireStore();
  if (role !== 'SUPER_ADMIN') throw forbidden('Only Super Admins can delete backups', 'SUPER_ADMIN_REQUIRED');
  const b = await prisma.backup.findUnique({ where: { id } });
  if (!b) throw notFound('Backup');
  if (b.status === 'RUNNING') throw conflict('This backup is still running', 'BACKUP_RUNNING');
  if (b.storageKey) await store.delete(b.storageKey);
  await prisma.backup.delete({ where: { id } });
  await audit({ action: 'platform.backup_deleted', targetType: 'Backup', targetId: id, actorType: 'PLATFORM_ADMIN', req });
}

export async function requestRestore(id: string, userId: string, role: string | undefined, req: Request) {
  requireStore();
  if (role !== 'SUPER_ADMIN') throw forbidden('Only Super Admins can restore backups', 'SUPER_ADMIN_REQUIRED');
  const b = await prisma.backup.findUnique({ where: { id } });
  if (!b?.storageKey || b.status !== 'COMPLETED') throw notFound('Backup');
  if (await prisma.backup.findFirst({ where: { OR: [{ status: 'RUNNING' }, { restoreStatus: 'RUNNING' }] } })) {
    throw conflict('Another backup or restore is in progress', 'BACKUP_RUNNING');
  }
  await prisma.backup.update({ where: { id }, data: { restoreStatus: 'RUNNING', restoredById: userId } });
  await enqueue('restore', { backupId: id, userId });
  await audit({ action: 'platform.restore_requested', targetType: 'Backup', targetId: id, actorType: 'PLATFORM_ADMIN', req });
  return { id, restoreStatus: 'RUNNING' };
}

/** Restores a backup. Takes a PRE_RESTORE safety backup first; everything else is one transaction. */
export async function performRestore(backupId: string, userId: string | null) {
  const store = requireStore();
  const b = await prisma.backup.findUniqueOrThrow({ where: { id: backupId } });
  try {
    const payload = JSON.parse(gunzipSync(await store.get(b.storageKey!)).toString('utf8')) as { format: string; version: number; migration: string | null; tables: Record<string, unknown[]> };
    if (payload.format !== FORMAT || payload.version !== VERSION) throw new Error('Not an NTSAttend backup file');
    const current = await latestMigration();
    if (payload.migration !== current) throw new Error(`Backup was taken at schema ${payload.migration}, database is at ${current}`);
    await performBackup('PRE_RESTORE', userId);
    await prisma.$transaction(
      async (tx) => {
        const order = await tablesInDependencyOrder(tx);
        await tx.$executeRawUnsafe(`TRUNCATE ${order.map(q).join(', ')} CASCADE`);
        for (const t of order) {
          const rows = payload.tables[t] ?? [];
          for (let i = 0; i < rows.length; i += 1000) {
            await tx.$executeRawUnsafe(`INSERT INTO ${q(t)} SELECT * FROM json_populate_recordset(NULL::${q(t)}, $1::json)`, JSON.stringify(rows.slice(i, i + 1000)));
          }
        }
      },
      { timeout: 10 * 60_000, maxWait: 30_000 },
    );
    await prisma.backup.update({ where: { id: backupId }, data: { restoreStatus: 'COMPLETED', restoredAt: new Date(), restoredById: userId } });
    await audit({ action: 'platform.restore_completed', actorUserId: userId, targetType: 'Backup', targetId: backupId, actorType: 'PLATFORM_ADMIN' });
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 250) : 'Restore failed';
    await prisma.backup.update({ where: { id: backupId }, data: { restoreStatus: `FAILED: ${msg}` } });
    throw err;
  }
}

export async function runRestoreJob(data: { backupId: string; userId?: string }) {
  await performRestore(data.backupId, data.userId ?? null);
}
