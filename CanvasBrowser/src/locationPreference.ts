/**
 * The one persistent location preference: "always use my location".
 *
 * What is stored is **consent, and nothing else**. The record is a version tag
 * and a boolean. No coordinates, no place label, no origin id, no route, and
 * nothing derived from a fix ever reaches this file — a fresh fix is requested
 * per session, coarsened locally, and discarded.
 *
 * The browser permission stays authoritative. This preference only says
 * whether a relevant world may ask for a fix without a second click.
 */
export interface LocationPreference {
  version: 1;
  alwaysUse: boolean;
}

const STORAGE_KEY = 'canvasbrowser.location.v1';

export const DEFAULT_LOCATION_PREFERENCE: LocationPreference = {
  version: 1,
  alwaysUse: false
};

/**
 * Anything that is not exactly the shape above is treated as absent. A
 * malformed, hostile, or half-written record can only ever mean "off".
 */
function validate(raw: unknown): LocationPreference {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_LOCATION_PREFERENCE };
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) return { ...DEFAULT_LOCATION_PREFERENCE };
  return { version: 1, alwaysUse: record.alwaysUse === true };
}

export function loadLocationPreference(): LocationPreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LOCATION_PREFERENCE };
    return validate(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_LOCATION_PREFERENCE };
  }
}

/** Writes the consent record only. The shape is the whole contract. */
export function saveLocationPreference(alwaysUse: boolean): void {
  try {
    const record: LocationPreference = { version: 1, alwaysUse };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* storage is optional */
  }
}
