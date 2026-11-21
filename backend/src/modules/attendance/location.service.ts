import { haversineMeters, isValidLatitude, isValidLongitude } from '../../lib/geo.js';

/**
 * Location check for attendance.
 *
 * The lecturer's device shares its location right after the session and QR code are created. When
 * a student scans the QR code, their device shares its location and the server compares the two:
 * 20 m apart or less means the student is in class; anything further and attendance is refused.
 *
 * Browser coordinates are untrusted and can be spoofed, so this is a deterrent, not proof of presence.
 */
export const MAX_DISTANCE_METERS = 20;

export type LocationInput = { latitude?: number | null; longitude?: number | null; accuracy?: number | null };
export type Point = { latitude: number; longitude: number };

/** (0, 0) is what some broken location providers report when they have no fix. */
export function isValidPoint(p: LocationInput | null | undefined): p is LocationInput & Point {
  return !!p && isValidLatitude(p.latitude) && isValidLongitude(p.longitude) && !(p.latitude === 0 && p.longitude === 0);
}

/** The accuracy a device reported, kept for staff to read. It never affects the decision. */
export const reportedAccuracy = (p: LocationInput) =>
  typeof p.accuracy === 'number' && Number.isFinite(p.accuracy) && p.accuracy >= 0 ? p.accuracy : null;

/** Distances are compared at 1 cm resolution so floating-point noise cannot decide a boundary case. */
export function compareLocations(lecturer: Point, student: Point) {
  const distanceMeters = haversineMeters(lecturer.latitude, lecturer.longitude, student.latitude, student.longitude);
  return { distanceMeters, inClass: Math.round(distanceMeters * 100) / 100 <= MAX_DISTANCE_METERS };
}

export const LOCATION_MESSAGES = {
  LECTURER_LOCATION_MISSING: "Your lecturer's location is not available yet. Ask your lecturer to allow location access on the session page, then try again.",
  LOCATION_INVALID: 'Your device did not return a usable location. Turn on location services, allow this site to use your location, and try again.',
  notInClass: (distanceMeters: number) =>
    `You are not in class. You are about ${Math.round(distanceMeters).toLocaleString('en')} m from your lecturer and must be within ${MAX_DISTANCE_METERS} m to record attendance.`,
} as const;
