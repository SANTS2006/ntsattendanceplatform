import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => auth.value }));
vi.mock('@/api/client', async (orig) => ({ ...(await orig<object>()), getPaged: () => Promise.resolve({ items: [], meta: { unread: 0 } }) }));

const { AppLayout } = await import('@/layouts/AppLayout');
const { RequireAuth, RequirePermission } = await import('./guards');

function asUser(perms: string[] | 'ALL', extra: Record<string, unknown> = {}) {
  auth.value = {
    status: 'authenticated',
    me: { user: { firstName: 'Lamin', lastName: 'K', email: 'l@x.test' }, organizations: [{ id: 'o1', name: 'Demo' }], platformRole: null, activeOrganizationId: 'o1' },
    org: { id: 'o1', name: 'Demo', myPermissions: perms },
    can: (p: string) => perms === 'ALL' || perms.includes(p),
    logout: vi.fn(),
    switchOrganization: vi.fn(),
    ...extra,
  };
}

const renderLayout = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route path="/app" element={<AppLayout />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('role-aware navigation', () => {
  it('shows a lecturer only attendance-related sections', () => {
    asUser(['attendance.sessions.create', 'attendance.read_assigned', 'academics.read', 'reports.read']);
    renderLayout();
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0];
    expect(nav).toHaveTextContent('Attendance');
    expect(nav).toHaveTextContent('Classes');
    expect(nav).not.toHaveTextContent('Students');
    expect(nav).not.toHaveTextContent('Settings');
    expect(nav).not.toHaveTextContent('Platform admin');
  });

  it('shows everything to an owner and the platform link only to platform admins', () => {
    asUser('ALL', { me: { user: { firstName: 'O', lastName: 'W', email: 'o@x.test' }, organizations: [], platformRole: 'SUPER_ADMIN', activeOrganizationId: 'o1' } });
    renderLayout();
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0];
    for (const item of ['Students', 'Settings', 'Reports', 'Lecturers', 'Platform admin']) expect(nav).toHaveTextContent(item);
  });
});

describe('route guards', () => {
  it('redirects anonymous users to login', () => {
    auth.value = { status: 'anonymous' };
    render(
      <MemoryRouter initialEntries={['/app/students']}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/app/students" element={<p>students</p>} />
          </Route>
          <Route path="/login" element={<p>login page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('blocks pages without the permission', () => {
    asUser(['attendance.read_assigned']);
    render(<RequirePermission any={['students.read']}><p>secret</p></RequirePermission>);
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.getByText(/don’t have access/)).toBeInTheDocument();
  });
});
