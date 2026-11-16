/**
 * Test environment: loads backend/.env for secrets, then points at the dedicated test database.
 * Mail is captured in memory, Redis is not used (jobs run in-process), rate limits are disabled
 * except in the dedicated rate-limit test which re-enables them.
 */
import fs from 'node:fs';
import path from 'node:path';

const envFile = path.resolve(import.meta.dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must be set for tests');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_URL = process.env.TEST_DIRECT_URL ?? process.env.TEST_DATABASE_URL;
process.env.RATE_LIMIT_DISABLED ??= 'true';
process.env.APP_URL ??= 'http://localhost:5173';
process.env.API_URL ??= 'http://localhost:4000';
// Blank rather than deleted: Prisma's client loads backend/.env for any variable that is *missing*,
// which would silently reconnect tests to the real Redis (minutes of latency per test file).
process.env.REDIS_URL = '';
