/**
 * Gesture-gated coarse location.
 *
 * Rules enforced here:
 * - `navigator.geolocation` is only ever touched from an explicit user click;
 * - low accuracy is requested, with a short timeout and a long cache window;
 * - the *category* the product reasons with is the nearest fixture origin, and
 *   that is the only thing any label, plan or change entry is built from;
 * - the raw fix never leaves this function. Only the nearest coarse fixture
 *   origin is returned, so neither the app nor an embedded map can disclose
 *   precise device coordinates.
 */
import { ORIGIN_OPTIONS } from './pickupFixtures';
import type { OriginOption } from './types';

export const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 8000,
  maximumAge: 300000
};

export type CoarseOriginOutcome =
  | { status: 'granted'; origin: OriginOption }
  | { status: 'denied' }
  | { status: 'unsupported' }
  | { status: 'outside-region' }
  | { status: 'timeout' };

const MAX_SUPPORTED_DISTANCE_MILES = 120;

function milesBetween(latA: number, lonA: number, latB: number, lonB: number): number {
  const toRadians = (value: number): number => (value * Math.PI) / 180;
  const dLat = toRadians(latB - latA);
  const dLon = toRadians(lonB - lonA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Nearest supported coarse origin. A distant fix is rejected, never relabelled. */
export function nearestOrigin(lat: number, lon: number): OriginOption | null {
  let best = ORIGIN_OPTIONS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const option of ORIGIN_OPTIONS) {
    const distance = milesBetween(lat, lon, option.lat, option.lon);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option;
    }
  }
  return bestDistance <= MAX_SUPPORTED_DISTANCE_MILES ? best : null;
}

/** Must only be called synchronously from a user gesture handler. */
export function requestCoarseOrigin(): Promise<CoarseOriginOutcome> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ status: 'unsupported' });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: CoarseOriginOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // The coarse category is the only value allowed to survive this call.
        const origin = nearestOrigin(position.coords.latitude, position.coords.longitude);
        if (!origin) {
          finish({ status: 'outside-region' });
          return;
        }
        finish({
          status: 'granted',
          origin
        });
      },
      (error) => {
        finish({ status: error.code === error.TIMEOUT ? 'timeout' : 'denied' });
      },
      GEOLOCATION_OPTIONS
    );
  });
}
