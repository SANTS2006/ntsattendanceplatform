import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Applies all migrations to the test database once per run. */
export default function setup() {
  const root = path.resolve(import.meta.dirname, '..');
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set (see .env.example)');
  execSync('npx prisma migrate deploy', { cwd: root, env: { ...process.env, DATABASE_URL: url, DIRECT_URL: process.env.TEST_DIRECT_URL ?? url }, stdio: 'pipe' });
}
