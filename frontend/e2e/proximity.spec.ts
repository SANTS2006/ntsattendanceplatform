import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Lecturer-generated QR proximity verification, end to end (real API + web app, no mocks).
 * The lecturer's emulated GPS position when "Generate QR code" is pressed becomes the session
 * reference point; students' emulated positions are checked by the server against it (20 m rule).
 *
 * Seed data (backend/prisma/seed.ts): owner@demo.localhost, class CS201-A (students 20240001–30).
 * Run ONLY against the test database (see TESTING.md → End-to-end): the API is started by
 * Playwright from the environment it inherits.
 */
const backendEnv = path.resolve(import.meta.dirname, '..', '..', 'backend', '.env');
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? fs.readFileSync(backendEnv, 'utf8').match(/^SEED_PASSWORD=(.*)$/m)?.[1]?.trim();
const OWNER = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.localhost';

/** The lecturer stands here; 1e-5° of latitude ≈ 1.11 m. */
const LECTURER = { latitude: 8.4844, longitude: -13.2344 };
const north = (m: number) => ({ latitude: LECTURER.latitude + m / 111_195, longitude: LECTURER.longitude });
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

test.describe.configure({ mode: 'serial' });
test.skip(!SEED_PASSWORD, 'Seed the test database and set SEED_PASSWORD');

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(OWNER);
  await page.getByLabel('Password', { exact: true }).fill(SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app/);
}

async function lecturerContext(browser: Browser, accuracy: number) {
  const ctx = await browser.newContext({ ...PHONE, geolocation: { ...LECTURER, accuracy }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  await login(page);
  return { ctx, page };
}

/** Lecturer generates a QR code for CS201-A from a precise position; returns the student URL path. */
async function startSession(page: Page) {
  await page.goto('/app/attendance/new');
  await page.getByLabel('Class').selectOption({ label: 'CS201 · Group A' });
  await page.getByRole('button', { name: 'Generate QR code' }).click();
  await page.waitForURL(/\/app\/attendance\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const sessionId = page.url().split('/').pop()!;
  const qrUrl = await page.evaluate((id) => JSON.parse(sessionStorage.getItem(`nts-qr-${id}`)!).url as string, sessionId);
  return new URL(qrUrl).pathname;
}

async function studentAt(browser: Browser, position: { latitude: number; longitude: number }, accuracy: number, qrPath: string): Promise<[BrowserContext, Page]> {
  const ctx = await browser.newContext({ ...PHONE, geolocation: { ...position, accuracy }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  await page.goto(qrPath);
  return [ctx, page];
}

test('setup: shorter location acquisition for emulated devices', async ({ page }) => {
  // Emulated geolocation reports one fix, so devices would otherwise wait for the full timeout.
  await login(page);
  await page.goto('/app/settings?tab=attendance');
  const timeout = page.getByLabel('Acquisition timeout (seconds)');
  await timeout.fill('10');
  await page.getByRole('button', { name: 'Save attendance settings' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
});

test('lecturer: a poor GPS reading is refused (no QR code); a precise one registers the location and generates the QR', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await lecturerContext(browser, 20_000); // laptop-style network fix
  await page.goto('/app/attendance/new');
  await page.getByLabel('Class').selectOption({ label: 'CS201 · Group A' });
  await expect(page.getByText(/Classroom: .*make sure you are in this room/)).toBeVisible();
  await expect(page.getByText(/The 20-metre rule:/)).toBeVisible();
  await page.getByRole('button', { name: 'Generate QR code' }).click();
  await expect(page.getByText(/approximately 20,000 m\. This reading was not saved\./)).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/app\/attendance\/new$/); // nothing generated

  // Better fix (phone GPS near a window): the location is registered, then the QR is generated.
  await ctx.setGeolocation({ ...LECTURER, accuracy: 6 });
  await page.getByRole('button', { name: /Try again: capture location and generate QR/ }).click();
  await page.waitForURL(/\/app\/attendance\/[0-9a-f-]{36}/, { timeout: 60_000 });
  await expect(page.getByLabel('Attendance QR code')).toBeVisible();
  const summary = page.getByTestId('reference-summary');
  await expect(summary).toContainText('8.484400, -13.234400');
  await expect(summary).toContainText('±6 m');
  await expect(page.getByText('Within 20 m of the lecturer')).toBeVisible();
  await ctx.close();
});

test('student within 20 m: location accepted → student ID → attendance recorded → live update', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await lecturerContext(browser, 5);
  const qrPath = await startSession(page);
  const [phone, student] = await studentAt(browser, north(6), 5, qrPath); // 6 + 5 ≤ 20
  const idInput = student.getByRole('textbox', { name: 'Student ID' });
  await expect(idInput).toBeDisabled(); // location comes first
  await student.getByRole('button', { name: 'Share my location' }).click();
  await expect(student.getByTestId('location-accepted')).toContainText(/Location accepted.*about 6 m away/, { timeout: 60_000 });
  const studentNumber = `202400${String(10 + Math.floor(Math.random() * 20)).padStart(2, '0')}`;
  await idInput.pressSequentially(studentNumber);
  await expect(student.getByText(studentNumber)).toBeVisible(); // auto-verified
  await student.getByRole('button', { name: 'Record my attendance' }).click();
  await expect(student.getByText('Attendance recorded')).toBeVisible();
  await expect(student.getByText(/^NTS-/)).toBeVisible();
  await expect(page.getByText('Live check-ins').locator('..').locator('..')).not.toContainText('New check-ins will appear here instantly', { timeout: 15_000 });
  await phone.close();
  await ctx.close();
});

test('student confidently more than 20 m away is rejected; student ID stays locked', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await lecturerContext(browser, 5);
  const qrPath = await startSession(page);
  const [phone, student] = await studentAt(browser, north(50), 5, qrPath); // 50 − 5 > 20
  await student.getByRole('button', { name: 'Share my location' }).click();
  const err = student.getByTestId('location-error');
  await expect(err).toHaveAttribute('data-code', 'LOCATION_OUTSIDE_RADIUS', { timeout: 60_000 });
  await expect(err).toContainText(/about 50 m from your lecturer, which is outside the 20 m attendance distance/);
  await expect(student.getByRole('textbox', { name: 'Student ID' })).toBeDisabled();
  await phone.close();
  await ctx.close();
});

test('student with poor accuracy gets retry guidance (never "outside") and succeeds after a better reading', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await lecturerContext(browser, 5);
  const qrPath = await startSession(page);
  const [phone, student] = await studentAt(browser, north(2), 60, qrPath); // indoors, ±60 m
  await student.getByRole('button', { name: 'Share my location' }).click();
  const err = student.getByTestId('location-error');
  await expect(err).toHaveAttribute('data-code', 'LOCATION_UNCERTAIN', { timeout: 60_000 });
  await expect(err).toContainText(/only accurate to about ±60 m/);
  await expect(err).not.toContainText(/outside/i);
  await phone.setGeolocation({ ...north(2), accuracy: 4 });
  await student.getByRole('button', { name: 'Try again' }).click();
  await expect(student.getByTestId('location-accepted')).toBeVisible({ timeout: 60_000 });
  await expect(student.getByRole('textbox', { name: 'Student ID' })).toBeEnabled();
  await phone.close();
  await ctx.close();
});

test('lecturer corrects the session location with a reason (audited)', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await lecturerContext(browser, 5);
  await startSession(page);
  await page.getByRole('button', { name: 'Update location' }).click();
  const save = page.getByRole('button', { name: 'Capture my location and save' });
  await expect(save).toBeDisabled(); // a reason is required
  await page.getByLabel('Reason *').fill('Moved to Lab 3');
  await ctx.setGeolocation({ ...north(30), accuracy: 7 });
  await save.click();
  await expect(page.getByText('Reference location updated')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('reference-summary')).toContainText('±7 m');
  await ctx.close();
});

test('QR codes for ended sessions are refused', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, page } = await lecturerContext(browser, 5);
  const qrPath = await startSession(page);
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Close session' }).click();
  await expect(page.getByText('Session closed')).toBeVisible();
  const [phone, student] = await studentAt(browser, north(1), 5, qrPath);
  await expect(student.getByText('Attendance closed')).toBeVisible();
  await phone.close();
  await ctx.close();
});
