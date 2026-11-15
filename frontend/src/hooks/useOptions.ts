import { useQuery } from '@tanstack/react-query';
import { getPaged } from '@/api/client';

/** Loads up to 100 records of a resource as select options (for forms and filters). */
export function useOptions<T extends { id: string }>(url: string, label: (row: T) => string, params: Record<string, unknown> = {}, enabled = true) {
  const q = useQuery({
    queryKey: ['options', url, JSON.stringify(params)],
    queryFn: () => getPaged<T>(url, { pageSize: 100, ...params }),
    staleTime: 60_000,
    enabled,
  });
  return { options: (q.data?.items ?? []).map((r) => ({ value: r.id, label: label(r) })), rows: q.data?.items ?? [], loading: q.isLoading };
}
