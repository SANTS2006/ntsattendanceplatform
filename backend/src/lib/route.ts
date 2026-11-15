import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { z, type ZodTypeAny } from 'zod';
import type { PermissionKey } from '../config/permissions.js';
import { authenticate, requirePermission, requirePlatformAdmin, requireTenant } from '../middleware/auth.js';
import { errorEnvelope, registry, successEnvelope } from '../openapi/registry.js';

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
export type Access = 'public' | 'user' | 'tenant' | 'platform';

export type RouteSpec = {
  method: Method;
  path: string; // express syntax, relative to the router mount (e.g. '/:id')
  summary: string;
  tags: string[];
  access: Access;
  permission?: PermissionKey | PermissionKey[];
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
  multipart?: boolean;
  description?: string;
  middleware?: RequestHandler[];
  status?: number;
};

const validate = (spec: RouteSpec) => (req: Request, _res: Response, next: NextFunction) => {
  req.valid = {
    body: spec.body ? spec.body.parse(req.body ?? {}) : undefined,
    query: spec.query ? spec.query.parse(req.query) : undefined,
    params: spec.params ? spec.params.parse(req.params) : undefined,
  };
  next();
};

/**
 * Declares a route once: registers the Express handler chain (auth → tenant → permission →
 * validation → handler) AND its OpenAPI operation, so documentation cannot drift from code.
 * Unknown body keys are stripped by Zod (mass-assignment protection).
 */
export function defineRoute(router: Router, base: string, spec: RouteSpec, handler: (req: Request, res: Response) => unknown) {
  const chain: RequestHandler[] = [];
  if (spec.access !== 'public') chain.push(authenticate);
  if (spec.access === 'tenant') chain.push(requireTenant);
  if (spec.access === 'platform') chain.push(requirePlatformAdmin);
  if (spec.permission) chain.push(requirePermission(...(Array.isArray(spec.permission) ? spec.permission : [spec.permission])));
  if (spec.middleware) chain.push(...spec.middleware);
  chain.push(validate(spec));
  chain.push(handler as RequestHandler);
  router[spec.method](spec.path, ...chain);

  const openPath = (base + spec.path).replace(/:([A-Za-z]+)/g, '{$1}').replace(/\/$/, '') || '/';
  const perms = spec.permission ? (Array.isArray(spec.permission) ? spec.permission : [spec.permission]) : [];
  registry.registerPath({
    method: spec.method,
    path: openPath,
    summary: spec.summary,
    description: [
      spec.description,
      spec.access === 'tenant' ? `Requires organization membership${perms.length ? `; permission: ${perms.join(' or ')}` : ''}.` : '',
      spec.access === 'platform' ? 'Requires platform administrator (Super Admin) access.' : '',
    ]
      .filter(Boolean)
      .join(' '),
    tags: spec.tags,
    security: spec.access === 'public' ? [] : [{ bearerAuth: [] }],
    request: {
      params: spec.params instanceof z.ZodObject ? spec.params : undefined,
      query: spec.query instanceof z.ZodObject ? spec.query : undefined,
      body: spec.multipart
        ? { content: { 'multipart/form-data': { schema: z.object({ file: z.any().openapi({ type: 'string', format: 'binary' }) }) } } }
        : spec.body
          ? { content: { 'application/json': { schema: spec.body } } }
          : undefined,
    },
    responses: {
      [spec.status ?? 200]: { description: 'Success', content: { 'application/json': { schema: successEnvelope } } },
      400: { description: 'Bad request', content: { 'application/json': { schema: errorEnvelope } } },
      ...(spec.access !== 'public' ? { 401: { description: 'Unauthenticated' }, 403: { description: 'Forbidden' } } : {}),
      422: { description: 'Validation error', content: { 'application/json': { schema: errorEnvelope } } },
      429: { description: 'Rate limited' },
    },
  });
}

/** Small helper so modules write `const r = routes(router, '/students')` then `r({...}, handler)`. */
export const routes = (router: Router, base: string) => (spec: RouteSpec, handler: (req: Request, res: Response) => unknown) =>
  defineRoute(router, base, spec, handler);
