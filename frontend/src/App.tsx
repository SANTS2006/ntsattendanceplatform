import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PageLoader } from '@/components/brand';
import { AppLayout } from '@/layouts/AppLayout';
import { PlatformLayout } from '@/layouts/PlatformLayout';
import { PublicLayout } from '@/layouts/PublicLayout';
import { RequireAuth, RequireOrg, RequireOrgAdmin, RequirePermission, RequirePlatform } from '@/routes/guards';

// Route-level code splitting keeps the student attendance page small on mobile networks.
const lazyNamed = <T,>(load: () => Promise<T>, name: keyof T) =>
  lazy(async () => ({ default: (await load())[name] as unknown as ComponentType }));

const m = () => import('@/features/marketing/MarketingPages');
const LandingPage = lazyNamed(m, 'LandingPage');
const FeaturesPage = lazyNamed(m, 'FeaturesPage');
const PricingPage = lazyNamed(m, 'PricingPage');
const AboutPage = lazyNamed(m, 'AboutPage');
const ContactPage = lazyNamed(m, 'ContactPage');
const HowItWorksPage = lazyNamed(m, 'HowItWorksPage');
const NotFoundPage = lazyNamed(m, 'NotFoundPage');
const a = () => import('@/features/auth/AuthPages');
const LoginPage = lazyNamed(a, 'LoginPage');
const RegisterPage = lazyNamed(a, 'RegisterPage');
const VerifyEmailPage = lazyNamed(a, 'VerifyEmailPage');
const ForgotPasswordPage = lazyNamed(a, 'ForgotPasswordPage');
const ResetPasswordPage = lazyNamed(a, 'ResetPasswordPage');
const AcceptInvitationPage = lazyNamed(a, 'AcceptInvitationPage');
const at = () => import('@/features/attend/AttendPage');
const AttendPage = lazyNamed(at, 'AttendPage');
const ConfirmationPage = lazyNamed(at, 'ConfirmationPage');
const lg = () => import('@/features/legal/LegalPages');
const PrivacyPage = lazyNamed(lg, 'PrivacyPage');
const TermsPage = lazyNamed(lg, 'TermsPage');
const OnboardingPage = lazyNamed(() => import('@/features/organizations/OnboardingPage'), 'OnboardingPage');
const DashboardPage = lazyNamed(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage');
const SessionsPage = lazyNamed(() => import('@/features/attendance/SessionsPage'), 'SessionsPage');
const NewSessionPage = lazyNamed(() => import('@/features/attendance/NewSessionPage'), 'NewSessionPage');
const SessionLivePage = lazyNamed(() => import('@/features/attendance/SessionLivePage'), 'SessionLivePage');
const RecordsPage = lazyNamed(() => import('@/features/attendance/RecordsPage'), 'RecordsPage');
const st = () => import('@/features/students/StudentsPage');
const StudentsPage = lazyNamed(st, 'StudentsPage');
const StudentDetailPage = lazyNamed(st, 'StudentDetailPage');
const ImportPage = lazyNamed(() => import('@/features/students/ImportPage'), 'ImportPage');
const ac = () => import('@/features/academics/AcademicsPages');
const AcademicsPage = lazyNamed(ac, 'AcademicsPage');
const ClassesPage = lazyNamed(ac, 'ClassesPage');
const ClassDetailPage = lazyNamed(ac, 'ClassDetailPage');
const pe = () => import('@/features/people/LecturersEventsPages');
const LecturersPage = lazyNamed(pe, 'LecturersPage');
const EventsPage = lazyNamed(pe, 'EventsPage');
const EventDetailPage = lazyNamed(pe, 'EventDetailPage');
const ReportsPage = lazyNamed(() => import('@/features/reports/ReportsPage'), 'ReportsPage');
const SettingsPage = lazyNamed(() => import('@/features/settings/SettingsPage'), 'SettingsPage');
const AccountPage = lazyNamed(() => import('@/features/settings/AccountPage'), 'AccountPage');
const NotificationsPage = lazyNamed(() => import('@/features/notifications/NotificationsPage'), 'NotificationsPage');
const HistoryPage = lazyNamed(() => import('@/features/history/HistoryPage'), 'HistoryPage');
const PresentQrPage = lazyNamed(() => import('@/features/attendance/PresentQrPage'), 'PresentQrPage');
const sp = () => import('@/features/support/SupportPages');
const SupportPage = lazyNamed(sp, 'SupportPage');
const FeedbackPage = lazyNamed(sp, 'FeedbackPage');
const PlatformSupportPage = lazyNamed(sp, 'PlatformSupportPage');
const PlatformFeedbackPage = lazyNamed(sp, 'PlatformFeedbackPage');
const BackupsPage = lazyNamed(() => import('@/features/platform/BackupsPage'), 'BackupsPage');
const p = () => import('@/features/platform/PlatformPages');
const PlatformDashboardPage = lazyNamed(p, 'PlatformDashboardPage');
const PlatformOrganizationsPage = lazyNamed(p, 'PlatformOrganizationsPage');
const PlatformOrganizationDetailPage = lazyNamed(p, 'PlatformOrganizationDetailPage');
const PlatformUsersPage = lazyNamed(p, 'PlatformUsersPage');
const PlatformAnalyticsPage = lazyNamed(p, 'PlatformAnalyticsPage');
const PlatformSecurityPage = lazyNamed(p, 'PlatformSecurityPage');
const PlatformAuditPage = lazyNamed(p, 'PlatformAuditPage');
const PlatformSettingsPage = lazyNamed(p, 'PlatformSettingsPage');

const guard = (any: string[], el: React.ReactNode) => <RequirePermission any={any}>{el}</RequirePermission>;
const ATT_READ = ['attendance.read_all', 'attendance.read_assigned', 'attendance.sessions.create', 'attendance.sessions.manage_all'];
const ATT_CREATE = ['attendance.sessions.create', 'attendance.sessions.manage_all'];

export function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public student attendance (mobile-first, no account) */}
        <Route path="/attend/confirmation/:reference" element={<ConfirmationPage />} />
        <Route path="/attend/:token" element={<AttendPage />} />

        <Route element={<PublicLayout />}>
          <Route index element={<LandingPage />} />
          <Route path="features" element={<FeaturesPage />} />
          <Route path="how-it-works" element={<HowItWorksPage />} />
          <Route path="pricing" element={<PricingPage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="contact" element={<ContactPage />} />
          <Route path="privacy" element={<PrivacyPage />} />
          <Route path="terms" element={<TermsPage />} />
        </Route>

        {/* Authentication: full-screen split layout (AuthShell) */}
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="verify-email" element={<VerifyEmailPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route path="accept-invitation" element={<AcceptInvitationPage />} />

        <Route element={<RequireAuth />}>
          <Route path="onboarding" element={<OnboardingPage />} />
          <Route element={<RequireOrg />}>
            {/* Projector view: full page, outside the app shell */}
            <Route path="present/:id" element={guard(ATT_CREATE, <PresentQrPage />)} />
            <Route path="app" element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="attendance" element={guard(ATT_READ, <SessionsPage />)} />
              <Route path="attendance/new" element={guard(ATT_CREATE, <NewSessionPage />)} />
              <Route path="attendance/:id" element={guard(ATT_READ, <SessionLivePage />)} />
              <Route path="records" element={guard(['attendance.read_all', 'attendance.read_assigned'], <RecordsPage />)} />
              <Route path="students" element={guard(['students.read'], <StudentsPage />)} />
              <Route path="students/import" element={guard(['students.import'], <ImportPage />)} />
              <Route path="students/:id" element={guard(['students.read'], <StudentDetailPage />)} />
              <Route path="classes" element={guard(['academics.read', 'attendance.sessions.create'], <ClassesPage />)} />
              <Route path="classes/:id" element={guard(['academics.read', 'attendance.sessions.create'], <ClassDetailPage />)} />
              <Route path="academics" element={guard(['academics.manage'], <AcademicsPage />)} />
              <Route path="lecturers" element={guard(['lecturers.read'], <LecturersPage />)} />
              <Route path="events" element={guard(['events.read', 'attendance.sessions.create'], <EventsPage />)} />
              <Route path="events/:id" element={guard(['events.read', 'attendance.sessions.create'], <EventDetailPage />)} />
              <Route path="reports" element={guard(['reports.read'], <ReportsPage />)} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="history" element={guard(['audit.read'], <HistoryPage />)} />
              <Route path="support" element={<RequireOrgAdmin><SupportPage /></RequireOrgAdmin>} />
              <Route path="feedback" element={<RequireOrgAdmin><FeedbackPage /></RequireOrgAdmin>} />
            </Route>
          </Route>
          <Route element={<RequirePlatform />}>
            <Route path="platform" element={<PlatformLayout />}>
              <Route index element={<PlatformDashboardPage />} />
              <Route path="organizations" element={<PlatformOrganizationsPage />} />
              <Route path="organizations/:id" element={<PlatformOrganizationDetailPage />} />
              <Route path="users" element={<PlatformUsersPage />} />
              <Route path="analytics" element={<PlatformAnalyticsPage />} />
              <Route path="security" element={<PlatformSecurityPage />} />
              <Route path="audit" element={<PlatformAuditPage />} />
              <Route path="settings" element={<PlatformSettingsPage />} />
              <Route path="support" element={<PlatformSupportPage />} />
              <Route path="feedback" element={<PlatformFeedbackPage />} />
              <Route path="backups" element={<BackupsPage />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="dashboard" element={<Navigate to="/app" replace />} />
        <Route element={<PublicLayout />}>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
