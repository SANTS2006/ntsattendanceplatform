import axios, { AxiosError, type AxiosRequestConfig } from 'axios';

/**
 * Centralized API client.
 * - Access token lives only in memory (never localStorage).
 * - The refresh token is an HttpOnly cookie scoped to /api/v1/auth; refresh requests carry the
 *   CSRF header the backend requires.
 * - 401 TOKEN_EXPIRED triggers ONE shared refresh, then the request is retried.
 */
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export type ApiSuccess<T> = { success: true; message: string; data: T; meta: Record<string, unknown> };
export type ApiErrorBody = { success: false; message: string; errors: Record<string, string[] | unknown>; code: string };
export type PageMeta = { page: number; pageSize: number; total: number; totalPages: number };
export type Paged<T> = { items: T[]; meta: PageMeta };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public errors: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;
export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => {
    accessToken = t;
  },
  onExpired: (fn: () => void) => {
    onSessionExpired = fn;
  },
};

export const http = axios.create({ baseURL: API_BASE, withCredentials: true, timeout: 30_000 });

http.interceptors.request.use((config) => {
  if (accessToken && !config.headers.Authorization) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= axios
    .post<ApiSuccess<{ accessToken: string }>>(`${API_BASE}/auth/refresh`, null, { withCredentials: true, headers: { 'X-NTS-CSRF': '1' } })
    .then((r) => {
      accessToken = r.data.data.accessToken;
      return accessToken;
    })
    .catch(() => {
      accessToken = null;
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const code = error.response?.data?.code;
    if (error.response?.status === 401 && original && !original._retried && (code === 'TOKEN_EXPIRED' || code === 'INVALID_TOKEN' || code === 'UNAUTHORIZED')) {
      original._retried = true;
      const t = await refreshAccessToken();
      if (t) {
        original.headers = { ...(original.headers ?? {}), Authorization: `Bearer ${t}` };
        return http(original);
      }
      onSessionExpired?.();
    }
    throw toApiError(error);
  },
);

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as Partial<ApiErrorBody> | undefined;
    if (body && body.success === false) return new ApiError(error.response!.status, body.code ?? 'ERROR', body.message ?? 'Request failed', (body.errors as Record<string, unknown>) ?? {});
    if (!error.response) return new ApiError(0, 'NETWORK_ERROR', 'Network error. Check your connection and try again.');
    return new ApiError(error.response.status, 'ERROR', 'Request failed');
  }
  return new ApiError(0, 'ERROR', 'Unexpected error');
}

/** Typed helpers that unwrap the standard envelope. */
export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return (await http.get<ApiSuccess<T>>(url, { params: clean(params) })).data.data;
}
export async function getPaged<T>(url: string, params?: Record<string, unknown>): Promise<Paged<T>> {
  const r = (await http.get<ApiSuccess<T[]>>(url, { params: clean(params) })).data;
  return { items: r.data, meta: r.meta as PageMeta };
}
export async function post<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return (await http.post<ApiSuccess<T>>(url, body, config)).data.data;
}
export async function patch<T>(url: string, body?: unknown): Promise<T> {
  return (await http.patch<ApiSuccess<T>>(url, body)).data.data;
}
export async function put<T>(url: string, body?: unknown): Promise<T> {
  return (await http.put<ApiSuccess<T>>(url, body)).data.data;
}
export async function del<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return (await http.delete<ApiSuccess<T>>(url, { params: clean(params) })).data.data;
}

function clean(p?: Record<string, unknown>) {
  if (!p) return undefined;
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

export const errorMessage = (e: unknown) => toApiError(e).message;
