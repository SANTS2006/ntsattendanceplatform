/**
 * Development seed: a platform Super Admin plus one demo university with students, a class,
 * a lecturer and enrollments. Credentials come ONLY from environment variables:
 *   SEED_PASSWORD           password for every seeded account (required)
 *   SEED_ADMIN_EMAIL        default admin@nts.localhost
 *   SEED_OWNER_EMAIL        default owner@demo.localhost
 *   SEED_LECTURER_EMAIL     default lecturer@demo.localhost
 * Refuses to run in production.
 */
import { SYSTEM_ROLES } from '../src/config/permissions.js';
import { prisma } from '../src/db/prisma.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { ensurePermissionCatalogue } from '../src/modules/organizations/organizations.service.js';

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 10) throw new Error('Set SEED_PASSWORD (min 10 chars, letters and digits) in backend/.env');

const emails = {
  admin: process.env.SEED_ADMIN_EMAIL ?? 'admin@nts.localhost',
  owner: process.env.SEED_OWNER_EMAIL ?? 'owner@demo.localhost',
  lecturer: process.env.SEED_LECTURER_EMAIL ?? 'lecturer@demo.localhost',
};

await ensurePermissionCatalogue();
const hash = await hashPassword(password);
const user = (email: string, firstName: string, lastName: string) =>
  prisma.user.upsert({ where: { email }, update: {}, create: { email, firstName, lastName, passwordHash: hash, emailVerifiedAt: new Date() } });

const admin = await user(emails.admin, 'Platform', 'Admin');
await prisma.platformAdmin.upsert({ where: { userId: admin.id }, update: {}, create: { userId: admin.id, role: 'SUPER_ADMIN' } });
const owner = await user(emails.owner, 'Olivia', 'Owner');
const lecturerUser = await user(emails.lecturer, 'Lamin', 'Kamara');

let org = await prisma.organization.findFirst({ where: { slug: 'demo-university' } });
if (!org) {
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.key, p.id]));
  org = await prisma.organization.create({
    data: {
      slug: 'demo-university', name: 'Demo University', type: 'UNIVERSITY', officialEmail: 'registrar@demo.localhost',
      country: 'Sierra Leone', address: 'Freetown', timezone: 'Africa/Freetown', createdById: owner.id,
      settings: { create: { studentIdExactLength: 8, studentIdCharset: 'NUMERIC', studentIdExample: '20240001', selfieRequired: true, locationRequired: true } },
    },
  });
  const orgId = org.id;
  for (const [key, def] of Object.entries(SYSTEM_ROLES)) {
    await prisma.role.create({
      data: { organizationId: orgId, key, name: def.name, description: def.description, isSystem: true, permissions: { create: def.permissions.map((p) => ({ permissionId: perms.get(p)! })) } },
    });
  }
  const role = (key: string) => prisma.role.findUniqueOrThrow({ where: { organizationId_key: { organizationId: orgId, key } } });
  const ownerM = await prisma.organizationMembership.create({ data: { organizationId: orgId, userId: owner.id, isOwner: true, title: 'Registrar' } });
  await prisma.membershipRole.create({ data: { organizationId: orgId, membershipId: ownerM.id, roleId: (await role('admin')).id } });
  const lecM = await prisma.organizationMembership.create({ data: { organizationId: orgId, userId: lecturerUser.id, title: 'Lecturer' } });
  await prisma.membershipRole.create({ data: { organizationId: orgId, membershipId: lecM.id, roleId: (await role('lecturer')).id } });

  const fac = await prisma.faculty.create({ data: { organizationId: orgId, name: 'Faculty of Engineering', code: 'ENG' } });
  const dept = await prisma.department.create({ data: { organizationId: orgId, name: 'Computer Science', code: 'CS', facultyId: fac.id } });
  const program = await prisma.program.create({ data: { organizationId: orgId, name: 'BSc Computer Science', code: 'BSCCS', departmentId: dept.id, durationYears: 4 } });
  const levels = [];
  for (const [i, name] of ['Year 1', 'Year 2', 'Year 3', 'Year 4'].entries()) levels.push(await prisma.academicLevel.create({ data: { organizationId: orgId, name, rank: i + 1 } }));
  const year = await prisma.academicYear.create({ data: { organizationId: orgId, name: '2026/2027', startDate: new Date('2026-09-01'), endDate: new Date('2027-07-31'), isCurrent: true } });
  const sem = await prisma.semester.create({ data: { organizationId: orgId, academicYearId: year.id, name: 'First Semester', startDate: new Date('2026-09-01'), endDate: new Date('2027-01-31'), isCurrent: true } });
  const course = await prisma.course.create({ data: { organizationId: orgId, code: 'CS201', title: 'Data Structures and Algorithms', departmentId: dept.id, programId: program.id, levelId: levels[1].id, credits: 3 } });
  const cls = await prisma.class.create({
    data: { organizationId: orgId, name: 'Group A', code: 'CS201-A', courseId: course.id, academicYearId: year.id, semesterId: sem.id, room: 'Lecture Hall 2', defaultLatitude: 8.4844, defaultLongitude: -13.2344, venueLocationSource: 'MAP', venueCapturedAt: new Date() },
  });
  const lecturer = await prisma.lecturer.create({ data: { organizationId: orgId, membershipId: lecM.id, firstName: 'Lamin', lastName: 'Kamara', title: 'Dr.', email: emails.lecturer, departmentId: dept.id } });
  await prisma.classLecturer.create({ data: { organizationId: orgId, classId: cls.id, lecturerId: lecturer.id } });
  const first = ['Aminata', 'Mohamed', 'Fatmata', 'Ibrahim', 'Mariama', 'Abdul', 'Hawa', 'Joseph', 'Isatu', 'Samuel', 'Kadiatu', 'Daniel'];
  const last = ['Sesay', 'Kamara', 'Conteh', 'Bangura', 'Koroma', 'Turay', 'Jalloh', 'Mansaray', 'Fofanah', 'Kargbo', 'Bah', 'Kanu'];
  for (let i = 0; i < 40; i++) {
    const n = `2024${String(i + 1).padStart(4, '0')}`;
    const fn = first[i % first.length];
    const ln = last[(i * 7) % last.length];
    const s = await prisma.student.create({
      data: {
        organizationId: orgId, studentNumber: n, normalizedNumber: n, firstName: fn, lastName: ln, fullName: `${fn} ${ln}`,
        email: `${fn}.${ln}.${i + 1}@students.demo.localhost`.toLowerCase(), programId: program.id, departmentId: dept.id, levelId: levels[1].id, academicYear: '2026/2027',
      },
    });
    if (i < 30) await prisma.enrollment.create({ data: { organizationId: orgId, studentId: s.id, classId: cls.id } });
  }
}

console.log('Seed complete:');
console.log(`  Super Admin : ${emails.admin}`);
console.log(`  Org owner   : ${emails.owner} (Demo University)`);
console.log(`  Lecturer    : ${emails.lecturer} (assigned to CS201-A)`);
console.log('  Password    : value of SEED_PASSWORD in backend/.env');
console.log('  Students    : IDs 20240001–20240040 (first 30 enrolled in CS201-A)');
await prisma.$disconnect();
