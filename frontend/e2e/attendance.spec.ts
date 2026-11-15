import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Seed data (backend/prisma/seed.ts): owner@demo.localhost, class CS201-A with students
 * 20240001–20240030 enrolled, venue at 8.4844, -13.2344. Password comes from backend/.env.
 */
const backendEnv = path.resolve(import.meta.dirname, '..', '..', 'backend', '.env');
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? fs.readFileSync(backendEnv, 'utf8').match(/^SEED_PASSWORD=(.*)$/m)?.[1]?.trim();
const OWNER = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.localhost';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app/);
}

/**
 * Reads the newest email captured by the sandbox API (`npm run dev:sandbox`, NODE_ENV=test):
 * nothing is sent through Brevo, and the test-only endpoint below does not exist in production.
 */
async function latestMail(request: APIRequestContext, email: string) {
  let mail: { subject: string; text: string } | null = null;
  await expect
    .poll(async () => {
      const r = await request.get(`/api/v1/__test__/mail?to=${encodeURIComponent(email)}`);
      mail = r.ok() ? (await r.json()).data : null;
      return !!mail;
    }, { timeout: 15_000 })
    .toBe(true);
  return mail!;
}

test('register → 6-character email code → account created → onboard a new organization', async ({ page, request }) => {
  const email = `e2e-${Date.now()}@example.test`;
  await page.goto('/register');
  await page.getByLabel('First name').fill('Eve');
  await page.getByLabel('Last name').fill('Tester');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('E2e-Passw0rd-123');
  await page.getByLabel('Confirm password').fill('E2e-Passw0rd-123');
  await expect(page.getByText('Excellent')).toBeVisible(); // strength meter
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('You must agree to the Terms of Service and Privacy Policy')).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  const code = (await latestMail(request, email)).subject.match(/^([A-Z0-9]{6}) /)![1];
  await page.getByLabel('Character 1').click();
  await page.keyboard.type(code.toLowerCase()); // auto-uppercases, auto-advances, auto-submits
  await page.waitForURL(/\/onboarding/);

  await page.getByRole('button', { name: 'College' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Organization name').fill(`E2E College ${Date.now()}`);
  await page.getByLabel('Country').fill('Sierra Leone');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create organization' }).click();
  await page.waitForURL(/\/app\/settings/);
  await expect(page.getByText('Student ID format')).toBeVisible();
});

test('lecturer QR session → student check-in on a phone → live dashboard update', async ({ page, browser }) => {
  test.skip(!SEED_PASSWORD, 'Seed the database and set SEED_PASSWORD');
  await login(page, OWNER, SEED_PASSWORD!);
  await page.goto('/app/attendance/new');
  await page.getByLabel('Class').selectOption({ label: 'CS201 · Group A' });
  await page.getByRole('switch', { name: 'Require a selfie' }).click();
  await page.getByRole('button', { name: 'Generate QR code' }).click();
  await page.waitForURL(/\/app\/attendance\/[0-9a-f-]{36}/);
  await expect(page.getByLabel('Attendance QR code')).toBeVisible();
  const sessionId = page.url().split('/').pop()!;
  const qrUrl = await page.evaluate((id) => JSON.parse(sessionStorage.getItem(`nts-qr-${id}`)!).url as string, sessionId);

  // Student phone: mobile viewport + device geolocation ~6 m from the venue.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    geolocation: { latitude: 8.48445, longitude: -13.23442, accuracy: 15 }, permissions: ['geolocation'],
  });
  const student = await phone.newPage();
  await student.goto(new URL(qrUrl).pathname);
  await student.getByRole('button', { name: 'Share my location' }).click();
  await expect(student.getByText('You are within the attendance area.')).toBeVisible();
  const idInput = student.getByRole('textbox', { name: 'Student ID' });
  const studentNumber = `202400${String(10 + Math.floor(Math.random() * 20)).padStart(2, '0')}`;
  await idInput.pressSequentially(studentNumber.slice(0, 7));
  await expect(student.getByText('7/8')).toBeVisible();
  await idInput.pressSequentially(studentNumber.slice(7));
  await expect(student.getByText(studentNumber)).toBeVisible(); // auto-verified, no button press
  await student.getByRole('button', { name: 'Record my attendance' }).click();
  await expect(student.getByText('Attendance recorded')).toBeVisible();
  await expect(student.getByText(/^NTS-/)).toBeVisible();

  // Lecturer sees the check-in without reloading.
  await expect(page.getByText('Live check-ins').locator('..').locator('..')).not.toContainText('New check-ins will appear here instantly', { timeout: 10_000 });
  await phone.close();
});

test('student outside the geofence is rejected', async ({ page, browser }) => {
  test.skip(!SEED_PASSWORD, 'Seed the database and set SEED_PASSWORD');
  await login(page, OWNER, SEED_PASSWORD!);
  await page.goto('/app/attendance/new');
  await page.getByLabel('Class').selectOption({ label: 'CS201 · Group A' });
  await page.getByRole('button', { name: 'Generate QR code' }).click();
  await page.waitForURL(/\/app\/attendance\/[0-9a-f-]{36}/);
  const sessionId = page.url().split('/').pop()!;
  const qrUrl = await page.evaluate((id) => JSON.parse(sessionStorage.getItem(`nts-qr-${id}`)!).url as string, sessionId);
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 8.5, longitude: -13.2344, accuracy: 10 }, permissions: ['geolocation'] });
  const student = await phone.newPage();
  await student.goto(new URL(qrUrl).pathname);
  await student.getByRole('button', { name: 'Share my location' }).click();
  await expect(student.getByText('You are not within the class attendance location. You cannot record your attendance.')).toBeVisible();
  await phone.close();
});

test('invalid QR codes show an error screen', async ({ page }) => {
  await page.goto(`/attend/${'x'.repeat(43)}`);
  await expect(page.getByText('Invalid QR code')).toBeVisible();
});

test('Add students window: upload a file, review the table, add the new students', async ({ page }) => {
  test.skip(!SEED_PASSWORD, 'Seed the database and set SEED_PASSWORD');
  await login(page, OWNER, SEED_PASSWORD!);
  await page.goto('/app/students');
  await page.getByRole('button', { name: 'Add students' }).click();
  await page.getByRole('tab', { name: 'Upload a file' }).click();
  const n = String(Date.now()).slice(-4);
  const csv = ['Student ID,Full Name,Email', `2025${n},E2E Upload One,one${n}@example.test`, '20240001,Already Exists,x@example.test', `2025${n},Duplicate,dup@example.test`].join('\n');
  await page.locator('input[type=file]').setInputFiles({ name: 'intake.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('Duplicate student ID (also on line 2)')).toBeVisible();
  await expect(page.getByText('Will be skipped')).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 student' }).click();
  await expect(page.getByText('Import complete')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByPlaceholder('Name, ID or email…').fill(`2025${n}`);
  await expect(page.getByText('E2E Upload One').locator('visible=true').first()).toBeVisible(); // table + phone-card layouts both render
});

test('sign out shows the branded animation and ends the session', async ({ page }) => {
  test.skip(!SEED_PASSWORD, 'Seed the database and set SEED_PASSWORD');
  await login(page, OWNER, SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page.getByText('Signing you out securely…')).toBeVisible();
  await page.waitForURL(/\/login/);
  await page.goto('/app');
  await page.waitForURL(/\/login/); // session cookie was revoked server-side
});
