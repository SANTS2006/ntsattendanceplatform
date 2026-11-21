import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { formatSatisfied, type StudentIdFormat } from './api';

const fmt: StudentIdFormat = { exactLength: 8, minLength: 8, maxLength: 8, charset: 'NUMERIC', prefix: null, suffix: null, caseSensitive: false, allowSpaces: false, example: '20240001' };

describe('formatSatisfied (client mirror of server rules)', () => {
  it('only accepts complete IDs in the configured format', () => {
    expect(formatSatisfied('2024000', fmt)).toBe(false);
    expect(formatSatisfied('20240001', fmt)).toBe(true);
    expect(formatSatisfied('2024000A', fmt)).toBe(false);
    expect(formatSatisfied(' 2024 0001 ', fmt)).toBe(true);
  });
  it('handles ranges, prefixes and case', () => {
    const f: StudentIdFormat = { ...fmt, exactLength: null, minLength: 5, maxLength: 10, charset: 'ALPHANUMERIC', prefix: 'UNI' };
    expect(formatSatisfied('uni12', f)).toBe(true);
    expect(formatSatisfied('abc12', f)).toBe(false);
  });
});

const validate = vi.fn();
const verifyStudent = vi.fn();
const verifyLocation = vi.fn();
const submit = vi.fn();
vi.mock('./api', async (orig) => {
  const real = await orig<typeof import('./api')>();
  return {
    ...real,
    attendApi: { validate: (...a: unknown[]) => validate(...a), verifyStudent: (...a: unknown[]) => verifyStudent(...a), verifyLocation: (...a: unknown[]) => verifyLocation(...a), submit: (...a: unknown[]) => submit(...a), uploadSelfie: vi.fn(), confirmation: vi.fn() },
  };
});
// Reading the location is unit-tested in src/lib/geo.test.ts; here it returns a controllable point.
const acquire = vi.fn();
vi.mock('@/lib/geo', async (orig) => {
  const real = await orig<typeof import('@/lib/geo')>();
  return { ...real, getCurrentLocation: (...a: unknown[]) => acquire(...a) };
});
const point = { latitude: 8.4844, longitude: -13.2344, accuracy: 8 };

const { AttendPage } = await import('./AttendPage');

const session = (over: Partial<{ locationVerificationEnabled: boolean; selfieRequired: boolean }> = {}) => ({
  attemptToken: 'attempt-1',
  organization: { name: 'Demo University', logoUrl: null },
  session: { title: 'CS201', context: 'CS201 — Data Structures', type: 'CLASS', lecturer: 'Dr. K', expiresAt: new Date(Date.now() + 600_000).toISOString(), serverTime: new Date().toISOString(), locationVerificationEnabled: false, selfieRequired: false, ...over, maximumDistanceMeters: 20 },
  studentIdFormat: fmt,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/attend/tok']}>
      <Routes>
        <Route path="/attend/:token" element={<AttendPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AttendPage', () => {
  it('shows a live character counter and verifies automatically when the ID is complete', async () => {
    validate.mockResolvedValue(session());
    verifyStudent.mockResolvedValue({ attemptToken: 'attempt-2', student: { fullName: 'Aminata Sesay', studentId: '20240001', email: 'aminata@x.test', program: 'BSc CS', level: 'Year 2' } });
    renderPage();
    const input = await screen.findByLabelText('Student ID');
    expect(screen.getByText('0/8')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(input, '2024000');
    expect(screen.getByText('7/8')).toBeInTheDocument();
    expect(verifyStudent).not.toHaveBeenCalled(); // no lookup before the format is satisfied
    await user.type(input, '1');
    await waitFor(() => expect(verifyStudent).toHaveBeenCalledWith('tok', 'attempt-1', '20240001'));
    expect(await screen.findByText('Aminata Sesay')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /look ?up/i })).toBeNull();
  });

  it('shows the not-found message from the server', async () => {
    validate.mockResolvedValue(session());
    verifyStudent.mockRejectedValue(new ApiError(404, 'STUDENT_NOT_FOUND', 'Student ID not found. Please check your ID and try again.'));
    renderPage();
    await userEvent.setup().type(await screen.findByLabelText('Student ID'), '20249999');
    expect(await screen.findByText('Student ID not found. Please check your ID and try again.')).toBeInTheDocument();
  });

  it('renders the expired QR screen', async () => {
    validate.mockRejectedValue(new ApiError(410, 'QR_EXPIRED', 'This attendance QR code has expired. Ask your lecturer for a new code.'));
    renderPage();
    expect(await screen.findByText('QR code expired')).toBeInTheDocument();
  });

  it('asks for the location automatically and blocks a student more than 20 m away', async () => {
    validate.mockResolvedValue(session({ locationVerificationEnabled: true }));
    acquire.mockResolvedValue(point);
    verifyLocation.mockRejectedValue(new ApiError(403, 'NOT_IN_CLASS', 'You are not in class. You are about 64 m from your lecturer and must be within 20 m to record attendance.', { distanceM: 64, maximumDistanceMeters: 20 }));
    renderPage();
    const alert = await screen.findByTestId('location-error');
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(alert).toHaveAttribute('data-code', 'NOT_IN_CLASS');
    expect(alert.textContent).toMatch(/You are not in class/);
    expect(screen.getByLabelText('Student ID').closest('fieldset')).toBeDisabled();
    expect(screen.getByRole('button', { name: /record my attendance/i })).toBeDisabled();
  });

  it('lets a student within 20 m continue', async () => {
    validate.mockResolvedValue(session({ locationVerificationEnabled: true }));
    acquire.mockResolvedValue(point);
    verifyLocation.mockResolvedValue({ attemptToken: 'attempt-loc', accepted: true, distanceM: 6, maximumDistanceMeters: 20 });
    renderPage();
    expect(await screen.findByTestId('location-accepted')).toHaveTextContent(/You are in class.*about 6 m away/);
    expect(verifyLocation.mock.calls[0][1]).toBe('attempt-1');
    expect(screen.getByLabelText('Student ID').closest('fieldset')).not.toBeDisabled();
  });

  it('can try again after the lecturer shares their location', async () => {
    validate.mockResolvedValue(session({ locationVerificationEnabled: true }));
    acquire.mockResolvedValue(point);
    verifyLocation.mockRejectedValueOnce(new ApiError(409, 'LECTURER_LOCATION_MISSING', "Your lecturer's location is not available yet."));
    renderPage();
    expect(await screen.findByTestId('location-error')).toHaveAttribute('data-code', 'LECTURER_LOCATION_MISSING');
    verifyLocation.mockResolvedValueOnce({ attemptToken: 'attempt-loc', accepted: true, distanceM: 3, maximumDistanceMeters: 20 });
    await act(async () => { await userEvent.setup().click(screen.getByRole('button', { name: /try again/i })); });
    expect(await screen.findByTestId('location-accepted')).toBeInTheDocument();
  });

  it('explains permission denial', async () => {
    validate.mockResolvedValue(session({ locationVerificationEnabled: true }));
    const { GeoError, GEO_MESSAGES } = await import('@/lib/geo');
    acquire.mockRejectedValueOnce(new GeoError('DENIED', GEO_MESSAGES.DENIED));
    renderPage();
    expect(await screen.findByText(/Location permission was denied/)).toBeInTheDocument();
  });

  it('submits with an idempotency key and shows the success page', async () => {
    validate.mockResolvedValue(session());
    verifyStudent.mockResolvedValue({ attemptToken: 'attempt-2', student: { fullName: 'Aminata Sesay', studentId: '20240001', email: null, program: null, level: null } });
    submit.mockResolvedValue({
      success: true, message: 'Your attendance has been successfully recorded.', referenceNumber: 'NTS-AAAA-BBBB-CCCC', confirmationToken: 'x'.repeat(32),
      organization: 'Demo University', student: { fullName: 'Aminata Sesay', studentId: '20240001', email: null, program: null, level: null },
      context: 'CS201', status: 'PRESENT', attendanceDate: '2026-11-14', attendanceTime: '10:00:00', submittedAt: new Date().toISOString(), timezone: 'UTC', locationVerified: null, selfieUrl: null,
    });
    renderPage();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Student ID'), '20240001');
    await screen.findByText('Aminata Sesay');
    await user.click(screen.getByRole('button', { name: /record my attendance/i }));
    expect(await screen.findByText('Attendance recorded')).toBeInTheDocument();
    expect(screen.getByText('NTS-AAAA-BBBB-CCCC')).toBeInTheDocument();
    const [, attempt, key] = submit.mock.calls[0];
    expect(attempt).toBe('attempt-2');
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });
});
