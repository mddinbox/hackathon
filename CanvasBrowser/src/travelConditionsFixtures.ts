/**
 * SAMPLE weather and traffic projections around SEA.
 *
 * CanvasBrowser has no structured weather or traffic feed in P0. The live
 * gateway returns prose, and prose is not allowed to become a structured fact
 * here — so these are **fixtures**, every one of them tagged `SAMPLE DATA`,
 * and every one of them carrying the real source a live version would have to
 * read from.
 *
 * They exist for one honest reason: the forces have to be *visible* and have
 * to *move the plan* for the world to be judged at all. Nothing in this file
 * is ever presented as observed.
 */
import type {
  Citation,
  ConditionTrend,
  TrafficLevel,
  TrafficProjection,
  TravelConditions,
  WeatherKind,
  WeatherProjection
} from './types';

export const CONDITIONS_LABEL = 'SAMPLE DATA';

/** Where a live version of each projection would have to come from. */
export const WEATHER_SOURCE: Citation = {
  label: 'National Weather Service — Seattle/Tacoma forecast office (official)',
  url: 'https://www.weather.gov/sew/'
};

export const WEATHER_API_SOURCE: Citation = {
  label: 'Open-Meteo forecast API documentation',
  url: 'https://open-meteo.com/en/docs'
};

export const TRAFFIC_SOURCE: Citation = {
  label: 'WSDOT real-time travel map (official)',
  url: 'https://wsdot.com/travel/real-time/map'
};

/**
 * How much each weather kind is allowed to widen airport processing.
 *
 * Deliberately small and deliberately one-sided: weather widens the *upper*
 * bound of a single named segment and does nothing else. A ramp hold or a
 * gate-return would be a different, observed fact — not a fixture.
 */
const WEATHER_VARIANTS: Record<WeatherKind, Omit<WeatherProjection, 'checkedAtMs'>> = {
  clear: {
    kind: 'clear',
    condition: 'Clear',
    temperatureF: 58,
    precipitationChance: 0.05,
    windMph: 6,
    windFromDegrees: 200,
    visibilityEffect: 'Good visibility — nothing here widens the ramp or the curb.',
    widenMinutes: 0,
    widenedSegment: 'curb',
    truth: 'modeled',
    provenance: 'sample',
    source: WEATHER_SOURCE,
    note: 'SAMPLE projection near SEA. A live build would read this from NWS Seattle or a structured forecast API.'
  },
  cloud: {
    kind: 'cloud',
    condition: 'Overcast',
    temperatureF: 54,
    precipitationChance: 0.2,
    windMph: 9,
    windFromDegrees: 210,
    visibilityEffect: 'Low cloud, no measurable effect on ramp or curb time.',
    widenMinutes: 0,
    widenedSegment: 'curb',
    truth: 'modeled',
    provenance: 'sample',
    source: WEATHER_SOURCE,
    note: 'SAMPLE projection near SEA. A live build would read this from NWS Seattle or a structured forecast API.'
  },
  rain: {
    kind: 'rain',
    condition: 'Steady rain',
    temperatureF: 49,
    precipitationChance: 0.8,
    windMph: 14,
    windFromDegrees: 190,
    visibilityEffect: 'Wet ramp and a slower, more crowded arrivals curb.',
    widenMinutes: 5,
    widenedSegment: 'curb',
    truth: 'modeled',
    provenance: 'sample',
    source: WEATHER_SOURCE,
    note: 'SAMPLE projection near SEA. Rain widens the curb tail by a stated 5 minutes and changes nothing else.'
  },
  wind: {
    kind: 'wind',
    condition: 'Gusty south wind',
    temperatureF: 51,
    precipitationChance: 0.35,
    windMph: 31,
    windFromDegrees: 175,
    visibilityEffect: 'Gusts slow ramp handling, so taxi-in can run long.',
    widenMinutes: 6,
    widenedSegment: 'taxi',
    truth: 'modeled',
    provenance: 'sample',
    source: WEATHER_SOURCE,
    note: 'SAMPLE projection near SEA. Wind widens the taxi tail by a stated 6 minutes and changes nothing else.'
  },
  snow: {
    kind: 'snow',
    condition: 'Wet snow',
    temperatureF: 33,
    precipitationChance: 0.7,
    windMph: 12,
    windFromDegrees: 20,
    visibilityEffect: 'De-icing and a slow ramp; every ground segment runs long.',
    widenMinutes: 12,
    widenedSegment: 'taxi',
    truth: 'modeled',
    provenance: 'sample',
    source: WEATHER_SOURCE,
    note: 'SAMPLE projection near SEA. Snow widens the taxi tail by a stated 12 minutes and changes nothing else.'
  }
};

interface TrafficVariant {
  level: TrafficLevel;
  congestion: number;
  delay: { min: number; max: number };
  note: string;
}

/**
 * Corridor delay by level, added on top of the origin's fixture drive range.
 * Expressing traffic as a delay keeps the fixture range visible underneath and
 * works for a typed origin that has no corridor of its own.
 */
const TRAFFIC_VARIANTS: Record<TrafficLevel, TrafficVariant> = {
  light: { level: 'light', congestion: 0.15, delay: { min: 0, max: 3 }, note: 'Corridor is running free.' },
  moderate: { level: 'moderate', congestion: 0.45, delay: { min: 4, max: 9 }, note: 'Normal build-up on the approach to SEA.' },
  heavy: { level: 'heavy', congestion: 0.75, delay: { min: 8, max: 14 }, note: 'Slow going on the airport approach.' },
  severe: { level: 'severe', congestion: 0.95, delay: { min: 16, max: 28 }, note: 'An incident-grade backup on the corridor.' }
};

/** The corridor each coarse origin actually uses to reach SEA. */
const CORRIDORS: Record<string, string> = {
  'downtown-seattle': 'I-5 south → SEA',
  bellevue: 'I-405 → I-518 → SEA',
  redmond: 'WA-520 → I-405 → I-518 → SEA',
  tacoma: 'I-5 north → SEA',
  everett: 'I-5 south → SEA'
};

export function corridorLabel(originId: string | null): string {
  if (!originId) return 'Approach to SEA';
  return CORRIDORS[originId] ?? 'Your route → SEA';
}

export function sampleWeather(kind: WeatherKind, checkedAtMs: number | null): WeatherProjection {
  return { ...WEATHER_VARIANTS[kind], checkedAtMs };
}

export function sampleTraffic(
  level: TrafficLevel,
  trend: ConditionTrend,
  originId: string | null,
  checkedAtMs: number | null
): TrafficProjection {
  const variant = TRAFFIC_VARIANTS[level];
  return {
    level: variant.level,
    congestion: variant.congestion,
    trend,
    delayMinutes: { ...variant.delay },
    corridorLabel: corridorLabel(originId),
    truth: 'modeled',
    provenance: 'sample',
    source: TRAFFIC_SOURCE,
    checkedAtMs,
    note: `${variant.note} SAMPLE projection — a live build would read this from the WSDOT real-time map.`
  };
}

/**
 * The deterministic condition sequence a session walks through.
 *
 * Each automatic re-check advances one step, so the world visibly changes for
 * a real reason instead of shimmering. The steps are authored to be legible:
 * calm → wet and jammed → windy but clearing → clear and free.
 */
const SEQUENCE: Array<{ weather: WeatherKind; traffic: TrafficLevel; trend: ConditionTrend }> = [
  { weather: 'cloud', traffic: 'moderate', trend: 'steady' },
  { weather: 'rain', traffic: 'heavy', trend: 'building' },
  { weather: 'wind', traffic: 'severe', trend: 'building' },
  { weather: 'rain', traffic: 'moderate', trend: 'easing' },
  { weather: 'clear', traffic: 'light', trend: 'easing' }
];

export const CONDITION_STEPS = SEQUENCE.length;

/** The SAMPLE conditions for a given step. Wraps, so a long session keeps moving. */
export function sampleConditions(step: number, originId: string | null, checkedAtMs: number | null): TravelConditions {
  const index = ((step % SEQUENCE.length) + SEQUENCE.length) % SEQUENCE.length;
  const entry = SEQUENCE[index];
  return {
    weather: sampleWeather(entry.weather, checkedAtMs),
    traffic: sampleTraffic(entry.traffic, entry.trend, originId, checkedAtMs),
    label: CONDITIONS_LABEL,
    step: index
  };
}

/** `Traffic heavy, building` — one compact phrase for the world label. */
export function trafficLabel(traffic: TrafficProjection): string {
  return `Traffic ${traffic.level}, ${traffic.trend}`;
}

/** `Steady rain 49°F` — one compact phrase for the world label. */
export function weatherLabel(weather: WeatherProjection): string {
  return weather.temperatureF === null ? weather.condition : `${weather.condition} ${weather.temperatureF}°F`;
}

/**
 * What this weather does to the plan, in four words. The full ramp/visibility
 * reasoning lives in the sources sheet; the world only needs the consequence.
 */
export function weatherEffectLabel(weather: WeatherProjection): string {
  return weather.widenMinutes > 0
    ? `+${weather.widenMinutes} min ${weather.widenedSegment}`
    : 'no effect on the plan';
}

/**
 * Wind as a screen-space direction, for the atmospheric wash.
 * Compass degrees are "from"; the wash travels the other way.
 */
export function windVector(weather: WeatherProjection): { x: number; y: number } {
  const strength = Math.min(1, (weather.windMph ?? 0) / 35);
  const from = ((weather.windFromDegrees ?? 180) * Math.PI) / 180;
  return { x: -Math.sin(from) * strength, y: -Math.cos(from) * strength };
}

/** 0–1 atmospheric density: how much weather there is to see. */
export function weatherIntensity(weather: WeatherProjection): number {
  const precip = weather.precipitationChance ?? 0;
  const wind = Math.min(1, (weather.windMph ?? 0) / 35);
  const base = weather.kind === 'clear' ? 0.08 : weather.kind === 'cloud' ? 0.25 : 0.55;
  return Math.min(1, base + precip * 0.35 + wind * 0.3);
}
