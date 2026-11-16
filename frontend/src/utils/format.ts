/** Display helpers. Timestamps are UTC from the API and shown in the organization time zone. */
export function fmtDateTime(iso: string | null | undefined, timeZone?: string) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
}
export function fmtDate(iso: string | null | undefined, timeZone?: string) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone }).format(new Date(iso));
}
export function fmtTime(iso: string | null | undefined, timeZone?: string) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'short', timeZone }).format(new Date(iso));
}
export const fmtNumber = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());
export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${u[i]}`;
}
export const humanize = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
/**
 * "Newton Tamba" + "Sam" → "Newton T. Sam": the first given name in full, any middle names as an
 * initial with a dot, then the last name.
 */
export function displayName(first?: string | null, last?: string | null) {
  const given = (first ?? '').trim().split(/\s+/).filter(Boolean);
  const middles = given.slice(1).map((m) => `${m[0].toUpperCase()}.`);
  return [given[0], ...middles, (last ?? '').trim()].filter(Boolean).join(' ');
}
export const initials = (first?: string, last?: string) => `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();

export const ORG_TYPES = [
  { value: 'UNIVERSITY', label: 'University' },
  { value: 'COLLEGE', label: 'College' },
  { value: 'SCHOOL', label: 'School' },
  { value: 'TRAINING_INSTITUTION', label: 'Training institution' },
  { value: 'EVENT_ORGANIZER', label: 'Event organizer' },
  { value: 'OTHER', label: 'Other' },
];

export const timeZones = (): string[] => {
  try {
    return ['UTC', ...Intl.supportedValuesOf('timeZone').filter((z) => z !== 'UTC')];
  } catch {
    return ['UTC'];
  }
};
