/**
 * Living News planner — pure, deterministic, no clock and no model.
 *
 * The Signal Field's geometry is **reach**, not time. Distance from the centre
 * is how close a signal actually gets to the person standing in the middle;
 * size is impact; a tether states whether the thing reaches you through the
 * ground under your feet or through the market axis.
 *
 * Everything here is computed locally from a labelled fixture set, which is
 * why hiding a layer, tightening the radius, or moving the centre is instant
 * and costs no model call.
 */
import {
  DEFAULT_RADIUS_MILES,
  LAYER_LABELS,
  sampleSignalsForPlace,
  type NewsPlace,
  type SampleSignal
} from './newsFixtures';
import type { LayerId, NewsHorizon, NewsScope } from './newsIntent';
import { formatClock } from './timeFormat';
import type { Citation, TruthKind } from './types';

export type ReachId = 'immediate' | 'metro' | 'region' | 'market';

export interface ReachRing {
  id: ReachId;
  label: string;
  /** Half-width / half-height in percent of the field box. */
  rx: number;
  ry: number;
  /** Outer edge of the band, in miles. Null for the market ring. */
  maxMiles: number | null;
  /** How many visible signals live on this ring right now. */
  count: number;
  /** Bearing of the widest empty gap, so the ring's name never collides. */
  labelAngle: number;
}

export interface PositionedSignal {
  id: string;
  layer: LayerId;
  reach: ReachId;
  short: string;
  headline: string;
  detail: string;
  truth: TruthKind;
  method: string;
  source: Citation | null;
  provenance: 'sample' | 'live';
  retrievedAt: string | null;
  /** "14 min ago", or the reason there is no stamp. */
  stamp: string;
  impact: number;
  /** Percent coordinates inside the field box. */
  x: number;
  y: number;
  /** Relative size multiplier driven by impact. */
  size: number;
  tether: 'center' | 'market';
  /** Final bearing on the ring, after spreading. Drives label placement. */
  angleDeg: number;
  /** Where the tether ends, in the same percent space. */
  tetherX: number;
  tetherY: number;
  distanceMiles: number | null;
  distanceLabel: string;
  /** Geographic anchor for the Bing aerial base. */
  lat: number;
  lon: number;
  weatherArea: SampleSignal['weatherArea'] | null;
  anchorPrecision: 'exact' | 'coarse';
  unavailable: { reason: string; unblocker: string } | null;
}

export interface AxisSignal {
  id: string;
  short: string;
  headline: string;
  move: string;
  direction: 'up' | 'down' | 'flat';
  when: string;
  truth: TruthKind;
  stamp: string;
  source: Citation | null;
  provenance: 'sample' | 'live';
  /** Percent position down the axis: soonest at the top. */
  y: number;
}

export interface Consequence {
  id: string;
  text: string;
  layer: LayerId;
  truth: TruthKind;
  sourceLabel: string;
  provenance: 'sample' | 'live';
  weight: number;
}

export interface Absence {
  id: string;
  title: string;
  reason: string;
  unblocker: string;
}

export interface SignalFieldInput {
  nowMs: number;
  place: NewsPlace;
  scope: NewsScope;
  horizon: NewsHorizon;
  layers: Record<LayerId, boolean>;
  radiusMiles: number;
  focus: 'all' | 'commute';
  signals?: SampleSignal[];
  contextRevision?: number;
}

export interface SignalWorld {
  nowMs: number;
  place: NewsPlace;
  clockLabel: string;
  /** `YOU · Seattle · 5:12 PM` */
  centerLabel: string;
  scope: NewsScope;
  horizon: NewsHorizon;
  /** The dominant outcome heading, e.g. "Your next 6 hours". */
  horizonLabel: string;
  centerX: number;
  rings: ReachRing[];
  signals: PositionedSignal[];
  axis: AxisSignal[] | null;
  consequences: Consequence[];
  absences: Absence[];
  freshnessLine: string;
  layers: Record<LayerId, boolean>;
  radiusMiles: number;
  focus: 'all' | 'commute';
  hiddenCount: number;
  provenance: 'sample' | 'live' | 'mixed';
  retrievedAt: string | null;
}

/**
 * Ring radii are generous on purpose: the immediate band has to clear the
 * centre anchor by enough that a signal's *name* — not just its dot — never
 * lands on `YOU · place · time`.
 */
const RING_SHAPE: Record<ReachId, { rx: number; ry: number; label: string; maxMiles: number | null }> = {
  immediate: { rx: 25, ry: 28, label: 'Immediate', maxMiles: 5 },
  metro: { rx: 37, ry: 39, label: 'Metro', maxMiles: 25 },
  region: { rx: 47, ry: 46, label: 'Region', maxMiles: 120 },
  market: { rx: 54, ry: 51, label: 'Market', maxMiles: null }
};

const RING_ORDER: ReachId[] = ['immediate', 'metro', 'region', 'market'];

/** Scope decides which forces start switched on. Every layer stays togglable. */
export function layersForScope(scope: NewsScope): Record<LayerId, boolean> {
  if (scope === 'near-me') return { local: true, markets: false, weather: true, mobility: true };
  if (scope === 'work-markets') return { local: false, markets: true, weather: false, mobility: true };
  return { local: true, markets: true, weather: true, mobility: true };
}

export function horizonLabel(horizon: NewsHorizon): string {
  return horizon === 'now' ? 'Your next hour' : horizon === 'week' ? 'Your next few days' : 'Your next 6 hours';
}

const MILES_PER_DEGREE = 69.0;

export function milesBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const midLat = ((aLat + bLat) / 2) * (Math.PI / 180);
  const dLat = (bLat - aLat) * MILES_PER_DEGREE;
  const dLon = (bLon - aLon) * MILES_PER_DEGREE * Math.cos(midLat);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/** Compass bearing in degrees, 0 = north, 90 = east. */
export function bearingBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const midLat = ((aLat + bLat) / 2) * (Math.PI / 180);
  const dLat = (bLat - aLat) * MILES_PER_DEGREE;
  const dLon = (bLon - aLon) * MILES_PER_DEGREE * Math.cos(midLat);
  const deg = (Math.atan2(dLon, dLat) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function reachForMiles(miles: number): ReachId {
  if (miles <= RING_SHAPE.immediate.maxMiles!) return 'immediate';
  if (miles <= RING_SHAPE.metro.maxMiles!) return 'metro';
  return 'region';
}

function stampFor(signal: SampleSignal): string {
  if (signal.unavailable) return 'no stamp — nothing observed';
  if (signal.minutesAgo === null) return 'scheduled, not yet observed';
  if (signal.minutesAgo < 60) return `${signal.minutesAgo} min ago`;
  const hours = Math.round(signal.minutesAgo / 60);
  return `${hours} hr ago`;
}

/**
 * Spreads a ring's signals so nothing overlaps, while keeping real bearing
 * order. Because the spread depends on which signals survive the filters,
 * hiding a layer genuinely repositions the ones that remain.
 */
function spreadAngles(bearings: number[], minGapDeg: number): number[] {
  const count = bearings.length;
  if (count === 0) return [];
  if (count === 1) return [bearings[0]];
  if (count * minGapDeg >= 360) {
    // Too crowded to honour bearings: distribute evenly from the first one.
    return bearings.map((_, index) => (bearings[0] + (index * 360) / count) % 360);
  }
  const order = bearings.map((bearing, index) => ({ bearing, index })).sort((a, b) => a.bearing - b.bearing);
  const placed = order.map((entry) => entry.bearing);
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < placed.length; i++) {
      const gap = placed[i] - placed[i - 1];
      if (gap < minGapDeg) placed[i] = placed[i - 1] + minGapDeg;
    }
    const wrap = placed[0] + 360 - placed[placed.length - 1];
    if (wrap >= minGapDeg) break;
    const shift = (minGapDeg - wrap) / 2;
    for (let i = 0; i < placed.length; i++) placed[i] -= shift;
  }
  const result = new Array<number>(count);
  order.forEach((entry, slot) => {
    result[entry.index] = ((placed[slot] % 360) + 360) % 360;
  });
  return result;
}

/** Middle of the widest empty arc, so a ring's name never lands on a signal. */
function widestGapAngle(angles: number[]): number {
  if (angles.length === 0) return 215;
  const sorted = [...angles].sort((a, b) => a - b);
  let best = sorted[0] + 180;
  let bestGap = -1;
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 360;
    const gap = next - current;
    if (gap > bestGap) {
      bestGap = gap;
      best = current + gap / 2;
    }
  }
  return ((best % 360) + 360) % 360;
}

function keepsSignal(signal: SampleSignal, input: SignalFieldInput, miles: number | null): boolean {  if (!input.layers[signal.layer]) return false;
  if (!signal.horizons.includes(input.horizon)) return false;
  if (input.focus === 'commute' && signal.layer !== 'mobility') return false;
  if (miles !== null && miles > input.radiusMiles) return false;
  return true;
}

/**
 * Builds the whole world. Same inputs, same world — no clock read, no
 * randomness, no I/O.
 */
export function planSignalField(input: SignalFieldInput): SignalWorld {
  const centerX = 50;
  const signalSet = input.signals ?? sampleSignalsForPlace(input.place);

  interface Candidate {
    signal: SampleSignal;
    miles: number | null;
    bearing: number | null;
    reach: ReachId;
    visible: boolean;
  }

  const candidates: Candidate[] = signalSet.map((signal) => {
    const geographic = signal.lat !== null && signal.lon !== null;
    const miles = geographic ? milesBetween(input.place.lat, input.place.lon, signal.lat!, signal.lon!) : null;
    const bearing = geographic ? bearingBetween(input.place.lat, input.place.lon, signal.lat!, signal.lon!) : null;
    const reach: ReachId = miles === null ? 'market' : reachForMiles(miles);
    return { signal, miles, bearing, reach, visible: keepsSignal(signal, input, miles) };
  });

  const positioned: PositionedSignal[] = [];
  const ringCounts: Record<ReachId, number> = { immediate: 0, metro: 0, region: 0, market: 0 };
  const ringAngles: Record<ReachId, number[]> = { immediate: [], metro: [], region: [], market: [] };

  for (const ring of RING_ORDER) {
    if (ring === 'market') continue; // the market ring is the axis boundary
    const members = candidates.filter((entry) => entry.visible && entry.reach === ring);
    const angles = spreadAngles(
      members.map((entry) => entry.bearing ?? 0),
      ring === 'immediate' ? 70 : ring === 'metro' ? 52 : 46
    );
    ringAngles[ring] = angles;
    members.forEach((entry, index) => {
      const shape = RING_SHAPE[ring];
      // A little radial stagger so neighbouring labels never collide.
      const nudge = index % 2 === 0 ? 0.93 : 1.07;
      const radians = (angles[index] * Math.PI) / 180;
      const x = centerX + shape.rx * nudge * Math.sin(radians);
      const y = 50 - shape.ry * nudge * Math.cos(radians);
      const marketTether = entry.signal.layer === 'markets';
      positioned.push({
        id: entry.signal.id,
        layer: entry.signal.layer,
        reach: ring,
        short: entry.signal.short,
        headline: entry.signal.headline,
        detail: entry.signal.detail,
        truth: entry.signal.truth,
        method: entry.signal.method,
        source: entry.signal.source,
        provenance: entry.signal.provenance ?? 'sample',
        retrievedAt: entry.signal.retrievedAt ?? null,
        stamp: stampFor(entry.signal),
        impact: entry.signal.impact,
        x,
        y,
        size: 0.62 + entry.signal.impact * 0.85,
        tether: marketTether ? 'market' : 'center',
        angleDeg: angles[index],
        tetherX: marketTether ? 100 : centerX,
        tetherY: marketTether ? y : 50,
        distanceMiles: entry.miles,
        distanceLabel:
          entry.signal.anchorPrecision === 'coarse'
            ? 'coarse local context'
            : entry.miles === null
              ? 'no address'
              : `${entry.miles < 10 ? entry.miles.toFixed(1) : Math.round(entry.miles)} mi`,
        lat: entry.signal.lat!,
        lon: entry.signal.lon!,
        weatherArea: entry.signal.weatherArea ?? null,
        anchorPrecision: entry.signal.anchorPrecision ?? 'exact',
        unavailable: entry.signal.unavailable ?? null
      });
      ringCounts[ring] += 1;
    });
  }

  const axisMembers = candidates.filter((entry) => entry.visible && entry.signal.axis);
  const axis: AxisSignal[] | null = input.layers.markets
    ? axisMembers
        .slice()
        .sort((a, b) => (a.signal.axis!.slot ?? 0) - (b.signal.axis!.slot ?? 0))
        .map((entry, index, all) => ({
          id: entry.signal.id,
          short: entry.signal.short,
          headline: entry.signal.headline,
          move: entry.signal.axis!.move,
          direction: entry.signal.axis!.direction,
          when: entry.signal.axis!.when,
          truth: entry.signal.truth,
          stamp: stampFor(entry.signal),
          source: entry.signal.source,
          provenance: entry.signal.provenance ?? 'sample',
          y: all.length === 1 ? 50 : 22 + (index * 56) / Math.max(1, all.length - 1)
        }))
    : null;
  ringCounts.market = axis?.length ?? 0;

  const consequences: Consequence[] = candidates
    .filter((entry) => entry.visible && entry.signal.consequence)
    .map((entry) => ({
      id: entry.signal.id,
      text: entry.signal.consequence!.text,
      layer: entry.signal.layer,
      truth: entry.signal.truth,
      sourceLabel: entry.signal.source?.label ?? 'no claim-level source',
      provenance: entry.signal.provenance ?? 'sample',
      weight: entry.signal.consequence!.weight
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  const absences: Absence[] = candidates
    .filter((entry) => entry.visible && entry.signal.unavailable)
    .map((entry) => ({
      id: entry.signal.id,
      title: entry.signal.headline,
      reason: entry.signal.unavailable!.reason,
      unblocker: entry.signal.unavailable!.unblocker
    }));

  for (const layer of Object.keys(LAYER_LABELS) as LayerId[]) {
    if (input.layers[layer]) continue;
    const muted = candidates.filter((entry) => entry.signal.layer === layer).length;
    if (muted === 0) continue;
    absences.push({
      id: `layer-${layer}`,
      title: `${LAYER_LABELS[layer]} layer is off`,
      reason: `${muted} signal${muted === 1 ? '' : 's'} in this layer are not being drawn.`,
      unblocker: `Turn ${LAYER_LABELS[layer]} back on.`
    });
  }

  const visibleCount = positioned.length + (axis?.length ?? 0);
  const liveCount = signalSet.filter((signal) => signal.provenance === 'live').length;
  const sampleCount = signalSet.length - liveCount;
  const provenance: SignalWorld['provenance'] =
    liveCount === 0 ? 'sample' : sampleCount === 0 ? 'live' : 'mixed';
  const retrievedAt =
    signalSet
      .map((signal) => signal.retrievedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  return {
    nowMs: input.nowMs,
    place: input.place,
    clockLabel: formatClock(input.nowMs),
    centerLabel: `YOU · ${input.place.label} · ${formatClock(input.nowMs)}`,
    scope: input.scope,
    horizon: input.horizon,
    horizonLabel: horizonLabel(input.horizon),
    centerX,
    rings: RING_ORDER.map((id) => ({
      id,
      label: RING_SHAPE[id].label,
      rx: RING_SHAPE[id].rx,
      ry: RING_SHAPE[id].ry,
      maxMiles: RING_SHAPE[id].maxMiles,
      count: ringCounts[id],
      labelAngle: widestGapAngle(ringAngles[id])
    })),
    signals: positioned,
    axis,
    consequences,
    absences,
    freshnessLine:
      `MODE: ${provenance === 'sample' ? 'SAMPLE STATIC' : provenance === 'live' ? 'LIVE CONTEXT' : 'MIXED LIVE + SAMPLE'} · ` +
      `MAP: BING AERIAL · DATA: ${visibleCount}/${signalSet.length} · ` +
      `${liveCount} LIVE / ${sampleCount} SAMPLE · ` +
      `RETRIEVAL: ${retrievedAt ? formatClock(Date.parse(retrievedAt)) : 'LOCAL'} · ` +
      `REFRESH: ${(input.contextRevision ?? 0) > 0 ? 'CENTER CHANGE' : 'INITIAL PACK'}`,
    layers: { ...input.layers },
    radiusMiles: input.radiusMiles,
    focus: input.focus,
    hiddenCount: signalSet.length - visibleCount,
    provenance,
    retrievedAt
  };
}

export const DEFAULT_FIELD_RADIUS = DEFAULT_RADIUS_MILES;
