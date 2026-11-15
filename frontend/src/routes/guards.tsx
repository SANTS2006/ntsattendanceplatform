import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { EmptyState } from '@/components/ui';
import { PageLoader } from '@/components/brand';
import { ShieldOff } from 'lucide-react';

/** Route guards control navigation only; the API enforces every permission independently. */
export function RequireAuth() {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <PageLoader label="Loading your workspace…" />;
  if (status === 'anonymous') return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <Outlet />;
}

export function RequireOrg() {
  const { me } = useAuth();
  if (!me?.activeOrganizationId) return <Navigate to={me?.platformRole ? '/platform' : '/onboarding'} replace />;
  return <Outlet />;
}

export function RequirePlatform() {
  const { me } = useAuth();
  if (!me?.platformRole) return <Navigate to="/app" replace />;
  return <Outlet />;
}

export function RequirePermission({ any, children }: { any: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!any.some(can)) {
    return <EmptyState icon={<ShieldOff className="h-6 w-6" />} title="You don’t have access to this page" description="Ask an organization administrator to grant you the required permission." />;
  }
  return <>{children}</>;
}

/** Owner, or a member with organization.manage (support & feedback with the platform team). */
export function RequireOrgAdmin({ children }: { children: ReactNode }) {
  const { org, can } = useAuth();
  if (!org || !(org.isOwner || can('organization.manage'))) {
    return <EmptyState icon={<ShieldOff className="h-6 w-6" />} title="Only organization owners and administrators can use this page" description="Ask your organization owner to contact NTSAttend support for you." />;
  }
  return <>{children}</>;
}
