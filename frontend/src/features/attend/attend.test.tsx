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
    getPosition: () => Promise.resolve({ latitude: 8.48, longitude: -13.23, accuracy: 10 }),
  };
});

const { AttendPage } = await import('./AttendPage');

const session = (over: Partial<{ locationRequired: boolean; selfieRequired: boolean }> = {}) => ({
  attemptToken: 'attempt-1',
  organization: { name: 'Demo University', logoUrl: null },
  session: { title: 'CS201', context: 'CS201 — Data Structures', type: 'CLASS', lecturer: 'Dr. K', expiresAt: new Date(Date.now() + 600_000).toISOString(), serverTime: new Date().toISOString(), locationRequired: false, selfieRequired: false, radiusM: 100, minAccuracyM: 50, ...over },
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
    verifyStudent.mockResolvedValue({ attemptToken: 'attempt-2', student: { fullName: 'Aminata Sesay', studentId: '20240001', email: 'am***@x.test', program: 'BSc CS', level: 'Year 2' } });
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

  it('requires location first when the session demands it and reports geofence failures', async () => {
    validate.mockResolvedValue(session({ locationRequired: true }));
    verifyLocation.mockRejectedValue(new ApiError(403, 'OUTSIDE_GEOFENCE', 'You are not within the class attendance location. You cannot record your attendance.'));
    renderPage();
    const input = await screen.findByLabelText('Student ID');
    expect(input.closest('fieldset')).toBeDisabled();
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: /share my location/i }));
    });
    expect(await screen.findByText(/not within the class attendance location/)).toBeInTheDocument();
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
