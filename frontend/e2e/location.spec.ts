import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Lecturer and student location comparison, end to end (real API + web app, no mocks).
 * Seed data (backend/prisma/seed.ts): owner@demo.localhost, class CS201-A (students 20240001–30).
 * Run ONLY against the test database (see TESTING.md → End-to-end).
 */
const backendEnv = path.resolve(import.meta.dirname, '..', '..', 'backend', '.env');
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? fs.readFileSync(backendEnv, 'utf8').match(/^SEED_PASSWORD=(.*)$/m)?.[1]?.trim();
const OWNER = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.localhost';

const LECTURER = { latitude: 8.4844, longitude: -13.2344 };
const north = (m: number) => ({ latitude: LECTURER.latitude + m / 111_195, longitude: LECTURER.longitude });
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

test.describe.configure({ mode: 'serial' });
test.skip(!SEED_PASSWORD, 'Seed the test database and set SEED_PASSWORD');

/** Signs in from a computer, generates a QR code and waits for the lecturer location to be saved. */
async function lecturerSession(browser: Browser) {
  const ctx = await browser.newContext({ geolocation: { ...LECTURER, accuracy: 900 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email address').fill(OWNER);
  await page.getByLabel('Password', { exact: true }).fill(SEED_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app/);
  await page.goto('/app/attendance/new');
  await page.getByLabel('Class').selectOption({ label: 'CS201 · Group A' });
  await page.getByRole('button', { name: 'Generate QR code' }).click();
  await page.waitForURL(/\/app\/attendance\/[0-9a-f-]{36}/, { timeout: 60_000 });
  await expect(page.getByTestId('lecturer-location')).toContainText('Your location is saved', { timeout: 60_000 });
  const sessionId = page.url().split('/').pop()!;
  const qrUrl = await page.evaluate((id) => JSON.parse(sessionStorage.getItem(`nts-qr-${id}`)!).url as string, sessionId);
  return { ctx, page, qrPath: new URL(qrUrl).pathname };
}

async function studentAt(browser: Browser, position: { latitude: number; longitude: number }, qrPath: string): Promise<[BrowserContext, Page]> {
  const ctx = await browser.newContext({ ...PHONE, geolocation: { ...position, accuracy: 30 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  await page.goto(qrPath);
  return [ctx, page];
}

test('student within 20 m continues and records attendance', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page, qrPath } = await lecturerSession(browser);
  const [phone, student] = await studentAt(browser, north(6), qrPath);
  await expect(student.getByTestId('location-accepted')).toContainText(/You are in class.*about 6 m away/, { timeout: 60_000 });
  const studentNumber = `202400${String(10 + Math.floor(Math.random() * 20)).padStart(2, '0')}`;
  await student.getByRole('textbox', { name: 'Student ID' }).pressSequentially(studentNumber);
  await expect(student.getByText(studentNumber)).toBeVisible();
  await student.getByRole('button', { name: 'Record my attendance' }).click();
  await expect(student.getByText('Attendance recorded')).toBeVisible();
  await expect(page.getByText('Live check-ins').locator('..').locator('..')).not.toContainText('New check-ins will appear here instantly', { timeout: 15_000 });
  await phone.close();
  await ctx.close();
});

test('student more than 20 m away sees the error and cannot continue', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, qrPath } = await lecturerSession(browser);
  const [phone, student] = await studentAt(browser, north(50), qrPath);
  const err = student.getByTestId('location-error');
  await expect(err).toHaveAttribute('data-code', 'NOT_IN_CLASS', { timeout: 60_000 });
  await expect(err).toContainText(/You are not in class\. You are about 50 m from your lecturer/);
  await expect(student.getByRole('textbox', { name: 'Student ID' })).toBeDisabled();
  await expect(student.getByRole('button', { name: 'Record my attendance' })).toBeDisabled();
  await phone.close();
  await ctx.close();
});

test('QR codes for ended sessions are refused', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, page, qrPath } = await lecturerSession(browser);
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Close session' }).click();
  await expect(page.getByText('Session closed')).toBeVisible();
  const [phone, student] = await studentAt(browser, north(1), qrPath);
  await expect(student.getByText('Attendance closed')).toBeVisible();
  await phone.close();
  await ctx.close();
});
