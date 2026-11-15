/**
 * One-time Neon setup: creates the runtime role the API connects as.
 *
 * Why: roles created in the Neon console are members of `neon_superuser`, which has BYPASSRLS —
 * PostgreSQL Row-Level Security (our database-level tenant isolation) would be ignored for them.
 * Migrations keep running as the owner role (DIRECT_URL); the API must use `nts_app`, which is
 * created here WITHOUT BYPASSRLS and only receives DML privileges.
 *
 *   NTS_APP_PASSWORD=<strong password> npm run db:neon:setup
 *
 * Then set DATABASE_URL to the *pooled* Neon host using nts_app:
 *   postgresql://nts_app:<password>@<endpoint>-pooler.<region>.aws.neon.tech/<db>?sslmode=require&pgbouncer=true&connect_timeout=15
 * Run it again after adding tables if you ever bypass ALTER DEFAULT PRIVILEGES (it is idempotent).
 */
import { PrismaClient } from '@prisma/client';

const direct = process.env.DIRECT_URL;
const password = process.env.NTS_APP_PASSWORD;
if (!direct) throw new Error('DIRECT_URL (the owner, non-pooled Neon connection string) is required');
if (!password || password.length < 16) throw new Error('Set NTS_APP_PASSWORD (at least 16 characters)');

const db = new PrismaClient({ datasources: { db: { url: direct } } });
const quoted = `'${password.replace(/'/g, "''")}'`;
const exists = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'nts_app'`;
if (exists[0].n === 0) {
  await db.$executeRawUnsafe(`CREATE ROLE nts_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${quoted}`);
  console.log('Created role nts_app');
} else {
  await db.$executeRawUnsafe(`ALTER ROLE nts_app WITH LOGIN NOBYPASSRLS PASSWORD ${quoted}`);
  console.log('Updated role nts_app');
}
const owner = (await db.$queryRaw<{ u: string }[]>`SELECT current_user AS u`)[0].u;
for (const sql of [
  'GRANT USAGE ON SCHEMA public TO nts_app',
  // TRUNCATE is needed by the Super Admin restore-from-backup feature.
  'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO nts_app',
  'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nts_app',
  'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO nts_app',
  `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO nts_app`,
  `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO nts_app`,
  `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO nts_app`,
]) await db.$executeRawUnsafe(sql);

const check = await db.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'nts_app'`;
console.log(`nts_app: superuser=${check[0].rolsuper} bypassrls=${check[0].rolbypassrls} (both must be false)`);
console.log('Grants applied. Point DATABASE_URL at the pooled endpoint as nts_app.');
await db.$disconnect();
