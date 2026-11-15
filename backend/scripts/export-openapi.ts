/** Writes the generated OpenAPI document to documentation/openapi.json. */
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { buildOpenApiDocument } from '../src/openapi/registry.js';

createApp(); // registers every route (and its OpenAPI operation)
const doc = buildOpenApiDocument();
const out = path.resolve(import.meta.dirname, '..', '..', 'documentation', 'openapi.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`OpenAPI written to ${out} (${Object.keys(doc.paths ?? {}).length} paths)`);
process.exit(0);
