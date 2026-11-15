import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { errorMessage, getPaged } from '@/api/client';

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Server-side paginated list with search + filters. */
export function usePaged<T>(key: string, url: string, filters: Record<string, unknown> = {}, opts: { pageSize?: number; enabled?: boolean } = {}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<string | undefined>(undefined);
  const debounced = useDebounced(search);
  const filterKey = JSON.stringify(filters);
  useEffect(() => setPage(1), [debounced, filterKey]);
  const q = useQuery({
    queryKey: [key, url, page, debounced, filterKey, sort],
    queryFn: () => getPaged<T>(url, { page, pageSize: opts.pageSize ?? 20, search: debounced || undefined, sort, ...filters }),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
  return {
    ...q,
    rows: q.data?.items,
    meta: q.data?.meta,
    page,
    setPage,
    search,
    setSearch,
    sort,
    setSort,
    errorText: q.error ? errorMessage(q.error) : null,
  };
}
