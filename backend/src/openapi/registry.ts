import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
registry.registerComponent('securitySchemes', 'attemptToken', { type: 'apiKey', in: 'header', name: 'X-Attempt-Token' });

export const successEnvelope = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.any(),
  meta: z.record(z.any()),
});
export const errorEnvelope = z.object({
  success: z.literal(false),
  message: z.string(),
  errors: z.record(z.any()),
  code: z.string(),
});

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'NTSAttend API',
      version: '1.0.0',
      description:
        'NTSAttend — multi-tenant QR attendance platform. All responses use the standard envelope ' +
        '`{success, message, data, meta}` / `{success:false, message, errors, code}`. Organization context is ' +
        'taken from the authenticated access token, never from client input.',
    },
    servers: [{ url: '/api/v1' }],
  });
}
