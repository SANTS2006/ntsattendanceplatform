import type { Request, Router } from 'express';
import { z, type ZodTypeAny } from 'zod';
import type { PermissionKey } from '../config/permissions.js';
import { tenantCtx, type TenantContext } from '../middleware/context.js';
import { audit } from '../modules/audit/audit.service.js';
import { conflict, notFound } from './errors.js';
import { created, ok, pageMeta, paginationQuery, uuidParam } from './http.js';
import { routes } from './route.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type CrudConfig = {
  path: string; // e.g. '/departments'
  model: string; // prisma delegate name, e.g. 'department'
  entity: string; // e.g. 'Department'
  tag: string;
  readPermission: PermissionKey | PermissionKey[];
  managePermission: PermissionKey | PermissionKey[];
  create: z.AnyZodObject;
  update?: z.AnyZodObject;
  searchFields?: string[];
  filters?: Record<string, ZodTypeAny>;
  include?: Record<string, unknown>;
  orderBy?: Record<string, 'asc' | 'desc'> | Record<string, unknown>[];
  /** Extra WHERE for scoped readers (e.g. department administrators). */
  scopeWhere?: (ctx: TenantContext) => Record<string, unknown> | undefined;
  /** Validate create/update payloads against the caller's scope. */
  guardWrite?: (ctx: TenantContext, data: Record<string, unknown>, existing?: any) => Promise<void> | void;
  softDelete?: boolean; // set status ARCHIVED instead of deleting
  /** Runs after a successful create (e.g. assign the creating lecturer). */
  afterCreate?: (ctx: TenantContext, row: any, req: Request) => Promise<void> | void;
  /** Shapes each row before it leaves the API (e.g. derive a status, drop internal fields). */
  present?: (row: any) => any;
};

/**
 * Generic tenant-scoped CRUD endpoints. All data access goes through ctx.db (tenant-scoped
 * client) so the organization filter is always applied; ids from other tenants yield 404.
 */
export function registerCrud(router: Router, cfg: CrudConfig) {
  const r = routes(router, '');
  const T = [cfg.tag];
  const delegate = (ctx: TenantContext) => (ctx.db as any)[cfg.model];
  const filterSchema = z.object(cfg.filters ?? {});
  const listQuery = paginationQuery.extend({ search: z.string().trim().max(100).optional() }).merge(filterSchema);

  const present = (row: any) => (cfg.present ? cfg.present(row) : row);
  const findScoped = async (ctx: TenantContext, id: string) => {
    const row = await delegate(ctx).findFirst({ where: { id, ...(cfg.scopeWhere?.(ctx) ?? {}) }, include: cfg.include });
    if (!row) throw notFound(cfg.entity);
    return row;
  };

  r(
    { method: 'get', path: cfg.path, summary: `List ${cfg.entity.toLowerCase()}s`, tags: T, access: 'tenant', permission: cfg.readPermission, query: listQuery },
    async (req, res) => {
      const ctx = tenantCtx(req);
      const q = req.valid.query;
      const where: Record<string, unknown> = { ...(cfg.scopeWhere?.(ctx) ?? {}) };
      for (const k of Object.keys(cfg.filters ?? {})) if (q[k] !== undefined) where[k] = q[k];
      if (q.search && cfg.searchFields?.length) {
        where.OR = cfg.searchFields.map((f) => ({ [f]: { contains: q.search, mode: 'insensitive' } }));
      }
      const [items, total] = await Promise.all([
        delegate(ctx).findMany({ where, include: cfg.include, orderBy: cfg.orderBy ?? { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        delegate(ctx).count({ where }),
      ]);
      ok(res, items.map(present), { meta: pageMeta(q, total) });
    },
  );

  r(
    { method: 'get', path: `${cfg.path}/:id`, summary: `Get a ${cfg.entity.toLowerCase()}`, tags: T, access: 'tenant', permission: cfg.readPermission, params: uuidParam },
    async (req, res) => ok(res, present(await findScoped(tenantCtx(req), req.valid.params.id))),
  );

  r(
    { method: 'post', path: cfg.path, summary: `Create a ${cfg.entity.toLowerCase()}`, tags: T, access: 'tenant', permission: cfg.managePermission, body: cfg.create, status: 201 },
    async (req: Request, res) => {
      const ctx = tenantCtx(req);
      await cfg.guardWrite?.(ctx, req.valid.body);
      const row = await delegate(ctx).create({ data: { ...req.valid.body, organizationId: ctx.organizationId } });
      await cfg.afterCreate?.(ctx, row, req);
      if ('defaultLatitude' in req.valid.body) await auditVenue(req, cfg, row);
      await audit({ action: `${cfg.model}.created`, targetType: cfg.entity, targetId: row.id, metadata: { name: row.name ?? row.title ?? row.code ?? undefined }, req });
      created(res, row);
    },
  );

  r(
    {
      method: 'patch', path: `${cfg.path}/:id`, summary: `Update a ${cfg.entity.toLowerCase()}`, tags: T, access: 'tenant',
      permission: cfg.managePermission, params: uuidParam, body: (cfg.update ?? cfg.create).partial(),
    },
    async (req, res) => {
      const ctx = tenantCtx(req);
      const existing = await findScoped(ctx, req.valid.params.id);
      await cfg.guardWrite?.(ctx, req.valid.body, existing);
      const row = await delegate(ctx).update({ where: { id: existing.id }, data: req.valid.body });
      if ('defaultLatitude' in req.valid.body || 'defaultLongitude' in req.valid.body) await auditVenue(req, cfg, row);
      const statusChange = 'status' in req.valid.body && existing.status !== row.status ? { statusFrom: existing.status, statusTo: row.status } : {};
      await audit({
        action: Object.keys(statusChange).length ? `${cfg.model}.status_changed` : `${cfg.model}.updated`,
        targetType: cfg.entity, targetId: row.id, metadata: { fields: Object.keys(req.valid.body), ...statusChange }, req,
      });
      ok(res, row);
    },
  );

  r(
    {
      method: 'delete', path: `${cfg.path}/:id`, summary: cfg.softDelete ? `Archive a ${cfg.entity.toLowerCase()}` : `Delete a ${cfg.entity.toLowerCase()}`,
      tags: T, access: 'tenant', permission: cfg.managePermission, params: uuidParam,
    },
    async (req, res) => {
      const ctx = tenantCtx(req);
      const existing = await findScoped(ctx, req.valid.params.id);
      await cfg.guardWrite?.(ctx, {}, existing);
      if (cfg.softDelete) {
        await delegate(ctx).update({ where: { id: existing.id }, data: { status: 'ARCHIVED' } });
      } else {
        try {
          await delegate(ctx).delete({ where: { id: existing.id } });
        } catch (e: any) {
          if (e?.code === 'P2003' || e?.code === 'P2014') throw conflict(`This ${cfg.entity.toLowerCase()} is in use and cannot be deleted`, 'IN_USE');
          throw e;
        }
      }
      await audit({
        action: `${cfg.model}.${cfg.softDelete ? 'archived' : 'deleted'}`, targetType: cfg.entity, targetId: existing.id,
        metadata: { name: existing.name ?? existing.title ?? existing.code ?? undefined, ...(cfg.softDelete ? { statusFrom: existing.status, statusTo: 'ARCHIVED' } : {}) }, req,
      });
      ok(res, null, { message: cfg.softDelete ? 'Archived' : 'Deleted' });
    },
  );
}

/** Every venue (geofence anchor) change is audited with its provenance and accuracy. */
async function auditVenue(req: Request, cfg: CrudConfig, row: any) {
  await audit({
    action: `${cfg.model}.venue_location_set`, targetType: cfg.entity, targetId: row.id,
    metadata: {
      name: row.name ?? row.code ?? undefined,
      source: row.venueLocationSource ?? null,
      accuracyM: row.venueAccuracyM ?? null,
      latitude: row.defaultLatitude != null ? Math.round(row.defaultLatitude * 1e6) / 1e6 : null,
      longitude: row.defaultLongitude != null ? Math.round(row.defaultLongitude * 1e6) / 1e6 : null,
    },
    req,
  });
}
