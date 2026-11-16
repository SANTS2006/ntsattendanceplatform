import { checkVenueReading, VENUE_MESSAGES } from '../../lib/geo.js';
import { AppError } from '../../lib/errors.js';
import type { TenantContext } from '../../middleware/context.js';
import { settingsFor } from './settings.js';

/**
 * Validates and normalises venue fields on a class/event create or update (mutates `data`).
 * GPS readings must meet the organization's capture accuracy policy; MAP placements are allowed
 * and recorded as manual. Clearing the coordinates clears the provenance too.
 */
export async function applyVenueFields(ctx: TenantContext, data: Record<string, unknown>) {
  const touched = ['defaultLatitude', 'defaultLongitude', 'venueLocationSource', 'venueAccuracyM'].some((k) => k in data);
  if (!touched) return;
  const lat = data.defaultLatitude as number | null | undefined;
  const lng = data.defaultLongitude as number | null | undefined;
  if ((lat == null) !== (lng == null)) throw new AppError(400, 'INVALID_COORDINATES', 'Provide both latitude and longitude, or neither.');
  if (lat == null) {
    if (!('defaultLatitude' in data)) {
      // Provenance fields without coordinates are ignored.
      delete data.venueLocationSource;
      delete data.venueAccuracyM;
      return;
    }
    Object.assign(data, { defaultLatitude: null, defaultLongitude: null, venueLocationSource: null, venueAccuracyM: null, venueCapturedAt: null });
    return;
  }
  const settings = await settingsFor(ctx.organizationId);
  const r = checkVenueReading(
    { maxCaptureAccuracyM: settings.venueCaptureMaxAccuracyM },
    { latitude: lat, longitude: lng, source: data.venueLocationSource as string | undefined, accuracy: data.venueAccuracyM as number | undefined },
  );
  if (!r.ok) {
    throw new AppError(r.code === 'VENUE_ACCURACY_INSUFFICIENT' ? 422 : 400, r.code, VENUE_MESSAGES[r.code](r.accuracyM, settings.venueCaptureMaxAccuracyM), {
      ...(r.accuracyM != null ? { accuracyM: Math.round(r.accuracyM) } : {}),
      maxAccuracyM: settings.venueCaptureMaxAccuracyM,
    });
  }
  Object.assign(data, { venueLocationSource: r.source, venueAccuracyM: r.accuracyM, venueCapturedAt: new Date() });
}
