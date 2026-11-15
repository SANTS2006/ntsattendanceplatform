import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BookOpen, CalendarDays, ClipboardCheck, GraduationCap, QrCode, UserCog, Users } from 'lucide-react';
import { errorMessage, get, getPaged } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Card, EmptyState, ErrorState, Spinner, StatCard } from '@/components/ui';
import { LOGO_SRC } from '@/components/brand';
import type { AttendanceSession } from '@/types';
import { fmtDateTime, fmtNumber } from '@/utils/format';

type Overview = { students: number; lecturers: number; classes: number; events: number; activeSessions: number; attendanceLast30Days: number; members: number };
type Analytics = { trend: { date: string; count: number }[]; totalRecords: number; byStatus: Record<string, number> };

export function DashboardPage() {
  const { org, can, me } = useAuth();
  const canAttendance = can('attendance.sessions.create') || can('attendance.read_all') || can('attendance.read_assigned');
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => get<Overview>('/organizations/current/overview') });
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const analytics = useQuery({ queryKey: ['analytics', 'dash'], queryFn: () => get<Analytics>('/reports/attendance', { from: since }), enabled: can('reports.read') });
  const sessions = useQuery({ queryKey: ['sessions', 'recent'], queryFn: () => getPaged<AttendanceSession>('/attendance/sessions', { pageSize: 6 }), enabled: canAttendance });

  return (
    <div>
      {/* Hero banner */}
      <section className="bg-hero animate-gradient animate-fade-up relative mb-7 overflow-hidden rounded-3xl p-6 text-white shadow-[0_20px_50px_-20px_rgb(11_31_77/0.6)] sm:p-8">
        <img src={LOGO_SRC} alt="" className="pointer-events-none absolute -right-10 -bottom-14 h-64 w-64 rotate-[-8deg] opacity-[0.12] sm:h-72 sm:w-72" />
        <div className="animate-float pointer-events-none absolute -top-16 left-1/3 h-48 w-48 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-cyan-200 uppercase">{org?.name}</p>
            <h1 className="mt-2 text-2xl font-extrabold sm:text-3xl">
              Welcome back, <span className="text-gradient-light">{me?.user.firstName}</span>
            </h1>
            <p className="mt-1.5 max-w-lg text-sm text-white/75">Run secure QR attendance, watch check-ins arrive live, and keep every record audit-ready.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(can('attendance.sessions.create') || can('attendance.sessions.manage_all')) && (
              <Link to="/app/attendance/new">
                <Button className="!bg-none !bg-white !text-navy-900 !shadow-lg hover:!bg-cyan-50" icon={<QrCode className="h-4 w-4" />}>Start attendance</Button>
              </Link>
            )}
            {can('reports.read') && (
              <Link to="/app/reports">
                <Button variant="ghost" className="border border-white/25 !text-white hover:!bg-white/10">View reports</Button>
              </Link>
            )}
          </div>
        </div>
      </section>
      {overview.isLoading ? (
        <Spinner />
      ) : overview.error ? (
        <ErrorState message={errorMessage(overview.error)} onRetry={() => overview.refetch()} />
      ) : (
        overview.data && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Active students" value={fmtNumber(overview.data.students)} icon={<GraduationCap className="h-5 w-5" />} />
            <StatCard label="Live sessions" value={fmtNumber(overview.data.activeSessions)} icon={<QrCode className="h-5 w-5" />} tone="green" />
            <StatCard label="Check-ins (30 days)" value={fmtNumber(overview.data.attendanceLast30Days)} icon={<ClipboardCheck className="h-5 w-5" />} tone="amber" />
            <StatCard label="Classes" value={fmtNumber(overview.data.classes)} icon={<BookOpen className="h-5 w-5" />} tone="slate" />
            <StatCard label="Lecturers" value={fmtNumber(overview.data.lecturers)} icon={<UserCog className="h-5 w-5" />} tone="slate" />
            <StatCard label="Events" value={fmtNumber(overview.data.events)} icon={<CalendarDays className="h-5 w-5" />} tone="slate" />
            <StatCard label="Team members" value={fmtNumber(overview.data.members)} icon={<Users className="h-5 w-5" />} tone="slate" />
          </div>
        )
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {can('reports.read') && (
          <Card title="Attendance trend (last 30 days)" className="lg:col-span-2">
            {analytics.isLoading ? (
              <Spinner />
            ) : analytics.data && analytics.data.trend.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer>
                  <AreaChart data={analytics.data.trend}>
                    <defs>
                      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                    <Tooltip />
                    <Area type="monotone" dataKey="count" name="Check-ins" stroke="#4f46e5" fill="url(#g)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState title="No attendance yet" description="Start a session and check-ins will appear here." />
            )}
          </Card>
        )}
        {canAttendance && (
          <Card title="Recent sessions" actions={<Link to="/app/attendance" className="text-sm text-brand-700">View all</Link>} padded={false}>
            {sessions.isLoading ? (
              <Spinner />
            ) : sessions.data?.items.length ? (
              <ul className="divide-y divide-slate-100">
                {sessions.data.items.map((s) => (
                  <li key={s.id}>
                    <Link to={`/app/attendance/${s.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">{s.title}</p>
                        <p className="text-xs text-slate-500">{fmtDateTime(s.createdAt, org?.timezone)} · {s._count?.records ?? 0} present</p>
                      </div>
                      <Badge>{s.effectiveStatus}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No sessions yet" />
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
