/**
 * The Journey World fixtures — a stylised, illustrative SEA map.
 *
 * Everything here is geometry the product owns: real coordinates for the
 * anchors, hand-authored corridor waypoints that read as roads, and SAMPLE
 * projections for the things a live build would read from a provider. No map
 * tiles are fetched, nothing is requested from a third party, and the plane is
 * labelled `SAMPLE MAP` wherever it is drawn, because approximate geography
 * that pretends to be survey-accurate would be a lie.
 */
import type { Citation, MinuteRange } from './types';

export const MAP_LABEL = 'SAMPLE MAP';

export interface GeoPoint {
  lat: number;
  lon: number;
}

/**
 * The projection.
 *
 * Puget Sound is a *vertical* place — Everett to Tacoma is ninety kilometres
 * north to south inside twenty east to west — and a browser world is a
 * horizontal box. A north-up map of it would be a thin ribbon down the middle
 * of an empty screen.
 *
 * So the plane is rotated, the way a transit diagram is: an equirectangular
 * projection into kilometres, a fixed 55° rotation, then a normalisation over
 * a constant anchor set so the corridor lays itself diagonally across a
 * landscape frame. Rotation is an isometry, so relative distances and the
 * shape of the corridor survive it; only the compass does not, which is one
 * more reason the plane is stamped `SAMPLE MAP`.
 */
const BOUNDS = { north: 48.02, west: -122.56 };
const KM_PER_DEG_LAT = 111;
/** Longitude shrinks with latitude; 47.6°N is the middle of this world. */
const KM_PER_DEG_LON = 74.9;
const ROTATION = (55 * Math.PI) / 180;
const PAD = 8;

function rotated(point: GeoPoint): { x: number; y: number } {
  const x = (point.lon - BOUNDS.west) * KM_PER_DEG_LON;
  const y = (BOUNDS.north - point.lat) * KM_PER_DEG_LAT;
  return {
    x: x * Math.cos(ROTATION) - y * Math.sin(ROTATION),
    y: x * Math.sin(ROTATION) + y * Math.cos(ROTATION)
  };
}

export const SEA_AIRPORT: GeoPoint = { lat: 47.4502, lon: -122.3088 };
export const CELL_PHONE_LOT_POINT: GeoPoint = { lat: 47.4356, lon: -122.296 };
export const ARRIVALS_CURB_POINT: GeoPoint = { lat: 47.4436, lon: -122.3016 };

/**
 * The frame is normalised over these anchors — the four origins plus the
 * airport — so every world this product can build fills the plane the same
 * way, and no route ever leaves the box.
 */
const ANCHORS: GeoPoint[] = [
  { lat: 47.9789, lon: -122.2021 },
  { lat: 47.6101, lon: -122.2015 },
  { lat: 47.6062, lon: -122.3321 },
  { lat: 47.2529, lon: -122.4443 },
  SEA_AIRPORT
];

const FRAME = (() => {
  const points = ANCHORS.map(rotated);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    minX,
    minY,
    spanX: Math.max(1, Math.max(...xs) - minX),
    spanY: Math.max(1, Math.max(...ys) - minY)
  };
})();

/** Project a coordinate into the 0–100 plane. Illustrative, never survey. */
export function project(point: GeoPoint): { x: number; y: number } {
  const r = rotated(point);
  const x = PAD + ((r.x - FRAME.minX) / FRAME.spanX) * (100 - PAD * 2);
  const y = PAD + ((r.y - FRAME.minY) / FRAME.spanY) * (100 - PAD * 2);
  return {
    x: Math.round(Math.min(99, Math.max(1, x)) * 100) / 100,
    y: Math.round(Math.min(99, Math.max(1, y)) * 100) / 100
  };
}

/**
 * Terrain, not coastline.
 *
 * The plane is rotated and stretched, so drawing a "real" Puget Sound outline
 * on it would be a claim the geometry cannot support. Instead the ground is
 * abstract relief: soft bands that give the route somewhere to sit. It is
 * scenery, it is `aria-hidden`, and it asserts nothing.
 */
export const TERRAIN_SHAPES: string[] = [
  'M -5 78 C 18 66, 34 82, 52 72 C 70 62, 84 74, 105 62 L 105 105 L -5 105 Z',
  'M -5 34 C 16 26, 30 40, 48 32 C 66 24, 82 34, 105 24 L 105 4 L -5 4 Z',
  'M 12 58 C 30 50, 44 62, 62 54 C 78 47, 92 56, 105 48'
];

export interface MapPlace {
  id: string;
  label: string;
  point: GeoPoint;
  kind: 'city' | 'airport' | 'lot' | 'curb';
}

export const MAP_PLACES: MapPlace[] = [
  { id: 'downtown-seattle', label: 'Seattle', point: { lat: 47.6062, lon: -122.3321 }, kind: 'city' },
  { id: 'bellevue', label: 'Bellevue', point: { lat: 47.6101, lon: -122.2015 }, kind: 'city' },
  { id: 'redmond', label: 'Redmond', point: { lat: 47.674, lon: -122.1215 }, kind: 'city' },
  { id: 'tacoma', label: 'Tacoma', point: { lat: 47.2529, lon: -122.4443 }, kind: 'city' },
  { id: 'everett', label: 'Everett', point: { lat: 47.9789, lon: -122.2021 }, kind: 'city' },
  { id: 'sea', label: 'SEA', point: SEA_AIRPORT, kind: 'airport' },
  { id: 'cell-lot', label: 'Cell Phone Lot', point: CELL_PHONE_LOT_POINT, kind: 'lot' },
  { id: 'arrivals', label: 'Arrivals curb', point: ARRIVALS_CURB_POINT, kind: 'curb' }
];

/**
 * The corridor each origin actually takes, as waypoints. Hand-placed to follow
 * the real highway geometry closely enough to be recognisable, and no closer.
 */
interface Corridor {
  main: { label: string; via: GeoPoint[]; distanceMiles: number };
  alternate: { label: string; via: GeoPoint[]; distanceMiles: number };
}

const CORRIDORS: Record<string, Corridor> = {
  'downtown-seattle': {
    main: {
      label: 'I-5 south',
      via: [
        { lat: 47.5905, lon: -122.3237 },
        { lat: 47.5401, lon: -122.3121 },
        { lat: 47.4901, lon: -122.2996 }
      ],
      distanceMiles: 14
    },
    alternate: {
      label: 'WA-99 / East Marginal Way',
      via: [
        { lat: 47.5766, lon: -122.3452 },
        { lat: 47.5238, lon: -122.3339 },
        { lat: 47.4772, lon: -122.3211 }
      ],
      distanceMiles: 16
    }
  },
  bellevue: {
    main: {
      label: 'I-405 south → I-518',
      via: [
        { lat: 47.5673, lon: -122.1866 },
        { lat: 47.4966, lon: -122.2201 },
        { lat: 47.4655, lon: -122.2749 }
      ],
      distanceMiles: 19
    },
    alternate: {
      label: 'I-90 → I-5 south',
      via: [
        { lat: 47.5905, lon: -122.2401 },
        { lat: 47.5771, lon: -122.3159 },
        { lat: 47.4966, lon: -122.3009 }
      ],
      distanceMiles: 22
    }
  },
  redmond: {
    main: {
      label: 'WA-520 west → I-405 south → I-518',
      via: [
        { lat: 47.6507, lon: -122.1369 },
        { lat: 47.6245, lon: -122.1872 },
        { lat: 47.5673, lon: -122.1866 },
        { lat: 47.4966, lon: -122.2201 },
        { lat: 47.4655, lon: -122.2749 }
      ],
      distanceMiles: 27
    },
    alternate: {
      label: 'WA-520 west → I-5 south',
      via: [
        { lat: 47.6507, lon: -122.1369 },
        { lat: 47.6415, lon: -122.2452 },
        { lat: 47.6224, lon: -122.3291 },
        { lat: 47.5401, lon: -122.3121 },
        { lat: 47.4901, lon: -122.2996 }
      ],
      distanceMiles: 30
    }
  },
  tacoma: {
    main: {
      label: 'I-5 north',
      via: [
        { lat: 47.3129, lon: -122.3941 },
        { lat: 47.3766, lon: -122.3211 },
        { lat: 47.4266, lon: -122.2985 }
      ],
      distanceMiles: 26
    },
    alternate: {
      label: 'WA-509 north',
      via: [
        { lat: 47.3211, lon: -122.4319 },
        { lat: 47.3901, lon: -122.3599 },
        { lat: 47.4359, lon: -122.3241 }
      ],
      distanceMiles: 29
    }
  },
  everett: {
    main: {
      label: 'I-5 south',
      via: [
        { lat: 47.8501, lon: -122.2321 },
        { lat: 47.7201, lon: -122.3011 },
        { lat: 47.5401, lon: -122.3121 },
        { lat: 47.4801, lon: -122.2996 }
      ],
      distanceMiles: 47
    },
    alternate: {
      label: 'I-405 south → I-518',
      via: [
        { lat: 47.8301, lon: -122.2011 },
        { lat: 47.6701, lon: -122.1911 },
        { lat: 47.5001, lon: -122.2201 },
        { lat: 47.4655, lon: -122.2749 }
      ],
      distanceMiles: 52
    }
  }
};

/** A typed origin has no known corridor, so it gets an honest generic one. */
const GENERIC_CORRIDOR: Corridor = {
  main: {
    label: 'Approach to SEA',
    via: [
      { lat: 47.5601, lon: -122.3221 },
      { lat: 47.4901, lon: -122.3021 }
    ],
    distanceMiles: 20
  },
  alternate: {
    label: 'Surface streets to SEA',
    via: [
      { lat: 47.5401, lon: -122.3521 },
      { lat: 47.4801, lon: -122.3221 }
    ],
    distanceMiles: 23
  }
};

export function corridorFor(originId: string | null): Corridor {
  if (!originId) return GENERIC_CORRIDOR;
  return CORRIDORS[originId] ?? GENERIC_CORRIDOR;
}

/**
 * Where a typed origin is placed on the plane. It is deliberately vague: a
 * point north of the airport on the main corridor, drawn with an `approximate`
 * truth so nothing claims to know an address it was never given.
 */
export const TYPED_ORIGIN_POINT: GeoPoint = { lat: 47.6301, lon: -122.3701 };

/* -------------------------------------------------------------------- stops */

export interface StopOption {
  id: string;
  label: string;
  /** Why anyone adds this stop — shown on the control, never guessed at. */
  reason: string;
  minutes: MinuteRange;
  /** Roughly where it sits relative to the corridor. */
  point: GeoPoint;
}

/**
 * The P0 stops. Each one is a real reason a pickup drive changes shape, and
 * each carries a clearly-sample time cost that moves the leave-by window.
 */
export const STOP_OPTIONS: StopOption[] = [
  {
    id: 'fuel',
    label: 'Gas or charge',
    reason: 'A fill or a charge before the airport run — adds a stop to the route and moves your leave-by.',
    minutes: { min: 7, max: 14 },
    point: { lat: 47.5201, lon: -122.3301 }
  },
  {
    id: 'second-person',
    label: 'Pick up another person',
    reason: 'A second pickup on the way — the route detours and the curb party gets larger.',
    minutes: { min: 8, max: 18 },
    point: { lat: 47.5501, lon: -122.2801 }
  },
  {
    id: 'coffee',
    label: 'Coffee',
    reason: 'A short stop while you wait out the arrival — cheap in time, still real.',
    minutes: { min: 5, max: 11 },
    point: { lat: 47.4901, lon: -122.3201 }
  }
];

export function findStopOption(id: string): StopOption | null {
  return STOP_OPTIONS.find((option) => option.id === id) ?? null;
}

/* ------------------------------------------------- airport & disruption feed */

export type MapNoteKind = 'airport' | 'disruption' | 'rule';

export interface MapNote {
  id: string;
  kind: MapNoteKind;
  label: string;
  detail: string;
  point: GeoPoint;
  /** `SAMPLE` for a projection, `live` when an official page states it. */
  truth: 'sample' | 'official';
  source: Citation | null;
}

export const AIRPORT_NOTES: MapNote[] = [
  {
    id: 'lot-rule',
    kind: 'rule',
    label: 'Cell Phone Lot · free, 30 min max',
    detail: 'Free while you wait, occupied-vehicle only.',
    point: CELL_PHONE_LOT_POINT,
    truth: 'official',
    source: {
      label: 'SEA Cell Phone Lot — Port of Seattle',
      url: 'https://www.portseattle.org/places/sea-tac-airport-cell-phone-lot'
    }
  },
  {
    id: 'curb-works',
    kind: 'airport',
    label: 'Arrivals curb lane work',
    detail: 'SAMPLE airport update: one arrivals lane narrowed, so curb pickup runs slower at peak.',
    point: { lat: 47.4462, lon: -122.3049 },
    truth: 'sample',
    source: null
  },
  {
    id: 'curb-rule',
    kind: 'rule',
    label: 'Curb is active-load only',
    detail: 'SEA arrivals curb does not allow waiting. Stage in the Cell Phone Lot until they text.',
    point: ARRIVALS_CURB_POINT,
    truth: 'official',
    source: {
      label: 'Dropping off / picking up at SEA — Port of Seattle',
      url: 'https://www.portseattle.org/sea/dropping-off-picking-up'
    }
  }
];

/**
 * Which notes are drawn on the plane.
 *
 * All of them reach the Source sheet, but the curb rule is already said in
 * full by the arrivals waypoint and again by the decision envelope, so
 * repeating it as a third floating label on a crowded corner of the map would
 * be noise rather than information.
 */
export const MAP_NOTE_IDS = new Set(['curb-works']);

/**
 * Corridor incidents, by traffic level. Nothing here is invented per render:
 * a level maps to a fixed, labelled incident so the world changes for a stated
 * reason instead of shimmering.
 */
export const CORRIDOR_INCIDENTS: Record<string, MapNote | null> = {
  light: null,
  moderate: null,
  heavy: {
    id: 'incident-heavy',
    kind: 'disruption',
    label: 'Slowdown on the approach',
    detail: 'SAMPLE disruption: stop-and-go on the last miles into SEA. Already inside the drive range below.',
    point: { lat: 47.4901, lon: -122.2996 },
    truth: 'sample',
    source: null
  },
  severe: {
    id: 'incident-severe',
    kind: 'disruption',
    label: 'Blocking incident on the corridor',
    detail: 'SAMPLE disruption: a lane-blocking incident on the main corridor. The alternate route is worth a look.',
    point: { lat: 47.5101, lon: -122.3081 },
    truth: 'sample',
    source: null
  }
};

export const TRAFFIC_MAP_SOURCE: Citation = {
  label: 'WSDOT real-time travel map (official)',
  url: 'https://wsdot.com/travel/real-time/map'
};
