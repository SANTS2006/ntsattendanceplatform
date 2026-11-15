/** YYYY-MM-DD for an instant in the given IANA time zone. */
export function dateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

export function timeInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(
    instant,
  );
}

const zones = new Set<string>(Intl.supportedValuesOf('timeZone'));
zones.add('UTC');
export const isValidTimeZone = (tz: string) => zones.has(tz);
