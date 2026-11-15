import { describe, expect, it } from 'vitest';
import { cleanDatabaseUrl } from '../../src/config/env.js';

describe('cleanDatabaseUrl', () => {
  const url = 'postgresql://neondb_owner:secret@ep-x-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
  it('keeps a plain URL unchanged', () => expect(cleanDatabaseUrl(url)).toBe(url));
  it.each([
    [`psql '${url}'`],
    [`"${url}"`],
    [`'${url}'`],
    [`  ${url}  `],
    [`DATABASE_URL=${url}`],
    [`DATABASE_URL="${url}"`],
  ])('extracts the URL from %s', (raw) => expect(cleanDatabaseUrl(raw)).toBe(url));
  it('leaves unrelated values for validation to reject', () => expect(cleanDatabaseUrl('not a url')).toBe('not a url'));
});
