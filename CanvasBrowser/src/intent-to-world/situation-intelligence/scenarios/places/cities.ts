/**
 * The place model — the space and time a "where to live" decision is made in,
 * for any city the product knows.
 *
 * A location decision is spatial before anything else: neighborhoods sit at real
 * coordinates and are ranked by *how far each is in minutes* from the places
 * that anchor a life — the office above all. Each city is a fixture of real
 * coordinates plus representative rents and school scores; the engine places the
 * neighborhoods, estimates the drive time from an anchor, scores the fit for the
 * chosen direction, and picks a recommendation. Pure and deterministic — the
 * geography is real, the figures are a labelled sample, nothing is fetched here.
 * Adding a city is adding a fixture; the machinery does not change.
 */

export interface GeoPt {
  lat: number;
  lon: number;
}

export interface Anchor extends GeoPt {
  id: string;
  name: string;
  /** Words that, in a refine phrase, mean "my anchor is here". */
  aliases: string[];
}

export interface Neighborhood extends GeoPt {
  id: string;
  name: string;
  /** Typical monthly 2-bedroom rent, USD. */
  rent2br: number;
  /** 1–5, higher is stronger. */
  schools: number;
  vibe: string;
}

export interface City {
  id: string;
  label: string;
  center: GeoPt;
  radiusMiles: number;
  /** Words in a prompt that select this city. */
  aliases: string[];
  anchors: Anchor[];
  neighborhoods: Neighborhood[];
}

export interface PlacedNeighborhood extends Neighborhood {
  distanceMiles: number;
  commuteMin: number;
  /** 0–1 fit for the chosen direction, for the bars. */
  fit: number;
}

export type PlaceDirection = 'relocate-family' | 'relocate-solo' | 'invest';

export interface PlaceWorld {
  cityId: string;
  cityLabel: string;
  center: GeoPt;
  radiusMiles: number;
  anchor: Anchor;
  anchors: Anchor[];
  direction: PlaceDirection;
  neighborhoods: PlacedNeighborhood[];
  recommendedId: string;
  rentMin: number;
  rentMax: number;
  commuteMax: number;
  /** True once real driving times have replaced the estimate. */
  routed?: boolean;
}

/* --------------------------------------------------------------- cities */

const AUSTIN: City = {
  id: 'austin',
  label: 'Austin',
  center: { lat: 30.2711, lon: -97.7437 },
  radiusMiles: 16,
  aliases: ['austin', 'atx'],
  anchors: [
    { id: 'downtown', name: 'Downtown', lat: 30.2672, lon: -97.7431, aliases: ['downtown', 'city center', 'centre'] },
    { id: 'domain', name: 'The Domain', lat: 30.401, lon: -97.723, aliases: ['domain', 'apple'] },
    { id: 'ut', name: 'UT', lat: 30.2849, lon: -97.7341, aliases: ['ut', 'university', 'campus'] },
    { id: 'airport', name: 'Airport', lat: 30.1975, lon: -97.6664, aliases: ['airport', 'abia'] }
  ],
  neighborhoods: [
    { id: 'mueller', name: 'Mueller', lat: 30.2999, lon: -97.7045, rent2br: 2100, schools: 4, vibe: 'Walkable, central, parks' },
    { id: 'east', name: 'East Austin', lat: 30.262, lon: -97.725, rent2br: 2000, schools: 3, vibe: 'Trendy, nightlife, food' },
    { id: 'soco', name: 'South Congress', lat: 30.248, lon: -97.751, rent2br: 2200, schools: 3, vibe: 'Iconic, lively, central' },
    { id: 'circlec', name: 'Circle C (SW)', lat: 30.2, lon: -97.88, rent2br: 1900, schools: 5, vibe: 'Suburban space, top schools' },
    { id: 'domainN', name: 'North / Domain', lat: 30.401, lon: -97.723, rent2br: 2300, schools: 4, vibe: 'Tech jobs, new, upscale' },
    { id: 'roundrock', name: 'Round Rock', lat: 30.5083, lon: -97.6789, rent2br: 1650, schools: 4, vibe: 'Value, families, space' },
    { id: 'pflugerville', name: 'Pflugerville', lat: 30.4394, lon: -97.62, rent2br: 1600, schools: 3, vibe: 'Affordable, roomy, NE' }
  ]
};

const SEATTLE: City = {
  id: 'seattle',
  label: 'Seattle',
  center: { lat: 47.61, lon: -122.28 },
  radiusMiles: 20,
  aliases: ['seattle', 'bellevue', 'redmond', 'kirkland', 'ballard', 'puget'],
  anchors: [
    { id: 'downtown', name: 'Downtown', lat: 47.6062, lon: -122.3321, aliases: ['downtown', 'city center'] },
    { id: 'slu', name: 'South Lake Union', lat: 47.625, lon: -122.337, aliases: ['amazon', 'slu', 'south lake union'] },
    { id: 'bellevue', name: 'Bellevue', lat: 47.6101, lon: -122.2015, aliases: ['bellevue', 'eastside'] },
    { id: 'redmond', name: 'Redmond', lat: 47.674, lon: -122.1215, aliases: ['microsoft', 'redmond'] },
    { id: 'seatac', name: 'SeaTac', lat: 47.4502, lon: -122.3088, aliases: ['airport', 'seatac'] }
  ],
  neighborhoods: [
    { id: 'ballard', name: 'Ballard', lat: 47.6685, lon: -122.3841, rent2br: 2400, schools: 4, vibe: 'Trendy, breweries, coast' },
    { id: 'caphill', name: 'Capitol Hill', lat: 47.6253, lon: -122.3222, rent2br: 2500, schools: 3, vibe: 'Nightlife, central, dense' },
    { id: 'queenanne', name: 'Queen Anne', lat: 47.637, lon: -122.357, rent2br: 2600, schools: 4, vibe: 'Upscale, views, quiet' },
    { id: 'bellevueN', name: 'Bellevue', lat: 47.6101, lon: -122.2015, rent2br: 2700, schools: 5, vibe: 'Tech, families, top schools' },
    { id: 'redmondN', name: 'Redmond', lat: 47.674, lon: -122.1215, rent2br: 2500, schools: 5, vibe: 'Microsoft, families, calm' },
    { id: 'westseattle', name: 'West Seattle', lat: 47.5707, lon: -122.3868, rent2br: 2100, schools: 4, vibe: 'Beachy, quieter, value' },
    { id: 'kirkland', name: 'Kirkland', lat: 47.6769, lon: -122.206, rent2br: 2600, schools: 5, vibe: 'Waterfront, families, eastside' }
  ]
};

export const CITIES: readonly City[] = [AUSTIN, SEATTLE];
export const DEFAULT_CITY = AUSTIN;

/** Choose the city a prompt is about; defaults to Austin. */
export function resolveCity(prompt: string): City {
  const value = prompt.toLowerCase();
  for (const city of CITIES) {
    if (city.aliases.some((alias) => new RegExp(`\\b${alias}\\b`, 'i').test(value))) return city;
  }
  return DEFAULT_CITY;
}

export function cityById(id: string | null | undefined): City {
  return CITIES.find((city) => city.id === id) ?? DEFAULT_CITY;
}

/* ------------------------------------------------------- space and time */

const R_EARTH_MILES = 3958.8;

export function haversineMiles(a: GeoPt, b: GeoPt): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A representative drive time, not a routed one. Straight-line miles are turned
 * into road miles (×1.3 for the grid) at an urban average with a fixed startup
 * cost. It is labelled an estimate everywhere it shows, and a real routing
 * provider can replace it without touching anything above.
 */
export function estimateDriveMinutes(straightMiles: number): number {
  const roadMiles = straightMiles * 1.3;
  const minutes = 4 + (roadMiles / 24) * 60;
  return Math.max(3, Math.round(minutes));
}

const DIRECTION_WEIGHTS: Record<PlaceDirection, { schools: number; commute: number; rent: number }> = {
  'relocate-family': { schools: 0.5, commute: 0.25, rent: 0.25 },
  'relocate-solo': { schools: 0.15, commute: 0.5, rent: 0.35 },
  invest: { schools: 0.1, commute: 0.2, rent: 0.7 }
};

/** Match a refine phrase to one of a city's anchors. */
export function resolveAnchor(city: City, text: string): Anchor | null {
  const value = text.toLowerCase();
  for (const anchor of city.anchors) {
    if (anchor.aliases.some((alias) => new RegExp(`\\b${alias}\\b`, 'i').test(value))) return anchor;
  }
  return null;
}

export function anchorById(city: City, id: string | null | undefined): Anchor {
  return city.anchors.find((anchor) => anchor.id === id) ?? city.anchors[0];
}

/**
 * Build the spatial world for a city: place each neighborhood, compute its drive
 * time from the anchor, score its fit for the direction, and pick the best one.
 */
export function buildPlaceWorld(city: City, anchorId: string | null, direction: PlaceDirection): PlaceWorld {
  const anchor = anchorById(city, anchorId);
  const weights = DIRECTION_WEIGHTS[direction];

  const priced = city.neighborhoods.map((n) => {
    const distanceMiles = Math.round(haversineMiles(anchor, n) * 10) / 10;
    return { ...n, distanceMiles, commuteMin: estimateDriveMinutes(distanceMiles) };
  });

  const rents = priced.map((n) => n.rent2br);
  const commutes = priced.map((n) => n.commuteMin);
  const rentMin = Math.min(...rents);
  const rentMax = Math.max(...rents);
  const commuteMax = Math.max(...commutes);

  const neighborhoods: PlacedNeighborhood[] = priced.map((n) => {
    const schoolScore = n.schools / 5;
    const commuteScore = commuteMax > 0 ? 1 - n.commuteMin / commuteMax : 1;
    const rentScore = rentMax > rentMin ? 1 - (n.rent2br - rentMin) / (rentMax - rentMin) : 1;
    const fit = weights.schools * schoolScore + weights.commute * commuteScore + weights.rent * rentScore;
    return { ...n, fit: Math.round(fit * 1000) / 1000 };
  });

  neighborhoods.sort((a, b) => b.fit - a.fit || a.commuteMin - b.commuteMin);

  return {
    cityId: city.id,
    cityLabel: city.label,
    center: city.center,
    radiusMiles: city.radiusMiles,
    anchor,
    anchors: city.anchors,
    direction,
    neighborhoods,
    recommendedId: neighborhoods[0]?.id ?? '',
    rentMin,
    rentMax,
    commuteMax
  };
}
