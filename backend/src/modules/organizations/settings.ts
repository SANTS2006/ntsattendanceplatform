import type { OrganizationSettings } from '@prisma/client';
import { tenantDb } from '../../db/tenant.js';
import { cacheKeys, cached } from '../../infra/cache.js';

/** Tenant settings, cached per tenant (key namespaced by organization id). */
export async function settingsFor(organizationId: string): Promise<OrganizationSettings> {
  return cached(cacheKeys.tenant(organizationId, 'settings'), 60, () =>
    tenantDb(organizationId).organizationSettings.findUniqueOrThrow({ where: { organizationId } }),
  );
}
