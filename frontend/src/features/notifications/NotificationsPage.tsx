import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCheck, Inbox } from 'lucide-react';
import { getPaged } from '@/api/client';
import { Button, Card, EmptyState, PageHeader, Pagination, Tabs } from '@/components/ui';
import { TableSkeleton } from '@/components/brand';
import { NotificationDetailModal, NotificationItem, useMarkAllRead, useUnreadCount } from '@/components/HeaderMenus';
import type { AppNotification } from '@/types';

export function NotificationsPage() {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<string | null>(null);
  const unread = useUnreadCount();
  const readAll = useMarkAllRead();
  const q = useQuery({
    queryKey: ['notifications', 'page', filter, page],
    queryFn: () => getPaged<AppNotification>('/notifications', { page, pageSize: 20, unread: filter === 'unread' ? 'true' : undefined }),
  });
  return (
    <div>
      <PageHeader
        title="Notifications"
        description={unread ? `You have ${unread} unread notification${unread === 1 ? '' : 's'}.` : 'You’re all caught up.'}
        actions={<Button variant="secondary" icon={<CheckCheck className="h-4 w-4" />} disabled={!unread} loading={readAll.isPending} onClick={() => readAll.mutate()}>Mark all as read</Button>}
      />
      <Tabs tabs={[{ key: 'all', label: 'All' }, { key: 'unread', label: `Unread${unread ? ` (${unread})` : ''}` }]} active={filter} onChange={(k) => { setFilter(k as 'all' | 'unread'); setPage(1); }} />
      <Card padded={false}>
        {q.isLoading ? (
          <TableSkeleton columns={2} rows={5} />
        ) : q.data?.items.length ? (
          <>
            <div className="divide-y divide-slate-100">
              {q.data.items.map((n) => <NotificationItem key={n.id} n={n} onClick={() => setDetail(n.id)} />)}
            </div>
            {q.data.meta.totalPages > 1 && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
          </>
        ) : (
          <EmptyState icon={<Inbox />} title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'} description="Updates about imports, reports, backups and support replies appear here." />
        )}
      </Card>
      <NotificationDetailModal id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
