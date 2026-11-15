/**
 * Grant platform Super Admin access to an existing, verified account.
 *   npm run platform:grant-admin -- someone@example.com [SUPER_ADMIN|PLATFORM_ADMIN]
 * This is the only way to create the first platform administrator (there is no API for it).
 */
import { prisma } from '../src/db/prisma.js';
import { audit } from '../src/modules/audit/audit.service.js';

const [email, roleArg] = process.argv.slice(2);
if (!email) {
  console.error('Usage: npm run platform:grant-admin -- <email> [SUPER_ADMIN|PLATFORM_ADMIN]');
  process.exit(1);
}
const role = roleArg === 'PLATFORM_ADMIN' ? 'PLATFORM_ADMIN' : 'SUPER_ADMIN';
const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
if (!user) {
  console.error('No account with that email. Register it first.');
  process.exit(1);
}
if (!user.emailVerifiedAt) {
  console.error('The account email is not verified.');
  process.exit(1);
}
await prisma.platformAdmin.upsert({ where: { userId: user.id }, create: { userId: user.id, role }, update: { role } });
await audit({ action: 'platform.admin_granted_cli', actorType: 'SYSTEM', targetType: 'User', targetId: user.id, metadata: { role } });
console.log(`Granted ${role} to ${user.email}`);
await prisma.$disconnect();
