/**
 * The Journey World planner.
 *
 * Pure and deterministic, like every planner here: time, plan and conditions
 * are injected, nothing calls a model, and the same inputs always produce the
 * same route. It turns the pickup plan into *one time-and-space world*:
 *
 *   - a route path from the origin, through any stops the user added, to the
 *     Cell Phone Lot and then the arrivals curb;
 *   - an alternate path, so "the corridor is blocked" has somewhere to point;
 *   - traffic as coloured density along the route, with the incident placed on
 *     the segment that is actually worst;
 *   - weather as a projected cell over the airport, with the wind bearing;
 *   - airport rules and disruptions as markers where they physically apply;
 *   - **time mapped onto space**: every route segment carries the clock window
 *     you would be inside it, and NOW is a point on the path, not a column.
 *
 * Nothing in here is a live provider: the overlays are all local fixtures,
 * each carrying its own truth tag. The one real thing it computes is the Bing
 * Maps base URL — built from coordinates, never from text — so the geography
 * under the overlays is the actual world rather than a drawing of it.
 */
import { bingBase, type BingBase } from './bingMap';
import {
  ARRIVALS_CURB_POINT,
  CELL_PHONE_LOT_POINT,
  CORRIDOR_INCIDENTS,
  MAP_LABEL,
  SEA_AIRPORT,
  TYPED_ORIGIN_POINT,
  corridorFor,
  project,
  type GeoPoint,
  type MapNote
} from './journeyFixtures';
import { AIRPORT_NOTES, MAP_NOTE_IDS } from './journeyFixtures';
import { CELL_PHONE_LOT } from './pickupFixtures';
import { formatClock, formatMinuteRange, formatRangeLabel } from './timeFormat';
import type { JourneyStop, MinuteRange, PickupPlan, TimeRange, TravelConditions, TruthKind } from './types';

const MINUTE = 60_000;

export interface Point {
  x: number;
  y: number;
}

export type WaypointKind = 'origin' | 'stop' | 'lot' | 'curb';

export interface JourneyWaypoint {
  id: string;
  kind: WaypointKind;
  label: string;
  /** One line under the marker: why it is on the route. */
  detail: string;
  at: Point;
  /** The real coordinate this waypoint stands on. Never fitted, never rotated. */
  geo: GeoPoint;
  /** Vertical label offset, in plane units, so labels never stack. */
  labelDy: number;
  /** When you are expected to be here, when the plan can say. */
  window: TimeRange | null;
  truth: TruthKind;
}

export interface JourneySegment {
  id: string;
  /** `Origin → Coffee`, `Cell Phone Lot → Arrivals curb`. */
  label: string;
  path: Point[];
  /** The same stretch in real coordinates, for the Bing-aligned overlay. */
  geoPath: GeoPoint[];
  /** 0–1 congestion on this stretch. */
  load: number;
  /** Minutes spent on this stretch. */
  minutes: MinuteRange;
  /** The clock window you are inside it, when a leave-by exists. */
  window: TimeRange | null;
  /** Direction particles travel: 1 forward, always along the route. */
  flow: number;
}

export interface WeatherCell {
  at: Point;
  /** The coordinate the cell is projected over: the airport itself. */
  geo: GeoPoint;
  /** 0–1 radius, as a share of the plane. */
  radius: number;
  /** The same footprint as a real distance, so it can be drawn on a real map. */
  radiusKm: number;
  intensity: number;
  kind: string;
  label: string;
  /** `projected over the arrival window` — the *time* this cell refers to. */
  timeLabel: string;
  windDegrees: number;
  windLabel: string;
  truth: 'sample' | 'live';
}

export interface JourneyMarker {
  id: string;
  kind: MapNote['kind'];
  label: string;
  detail: string;
  at: Point;
  /** Where this note physically applies. Projected, never fitted. */
  geo: GeoPoint;
  labelDy: number;
  truth: 'sample' | 'official';
}

export interface TrafficBand {
  id: string;
  path: Point[];
  /** The same stretch of corridor in real coordinates. */
  geoPath: GeoPoint[];
  /** 0–1 congestion on this short stretch of the route. */
  load: number;
}

export interface JourneyWorld {
  label: string;
  /** Null until an origin exists — the map states the gap instead of faking it. */
  origin: JourneyWaypoint | null;
  waypoints: JourneyWaypoint[];
  segments: JourneySegment[];
  /** Short stretches used to paint congestion along the route. */
  trafficBands: TrafficBand[];
  mainPath: Point[];
  alternatePath: Point[];
  /**
   * The same two corridors in real coordinates.
   *
   * The plane geometry above is a *fit*: it stretches the route to fill the
   * frame, which is honest as a schematic and wrong as a map. These are the
   * coordinates themselves, so the overlay can be re-projected through Bing's
   * own viewport and land on the actual roads.
   */
  mainGeoPath: GeoPoint[];
  alternateGeoPath: GeoPoint[];
  mainLabel: string;
  alternateLabel: string;
  mainDistanceLabel: string;
  alternateDistanceLabel: string;
  driveMinutes: MinuteRange | null;
  weather: WeatherCell | null;
  markers: JourneyMarker[];
  /** Where NOW is on the route: 0 at the origin, 1 at the curb. */
  nowOnRoute: number;
  /** The leave-by moment, when the plan can commit to one. */
  departByMs: number | null;
  /** The staging window at the lot — the decision this whole world serves. */
  lotWindow: TimeRange | null;
  curbWindow: TimeRange | null;
  /**
   * True only when the next check is due or overdue. The scan is an
   * attention state, not a metronome: a cadence of 5, 15 or 60 minutes is
   * said in words and drawn as a draining dial, never as constant sweeping.
   */
  refreshDue: boolean;
  /** The real Bing Maps base this world is drawn over. Built from numbers. */
  base: BingBase;
  seaAt: Point;
  /** The airport's actual coordinate, for the Bing-aligned overlay. */
  seaGeo: GeoPoint;
}

export interface JourneyInput {
  plan: PickupPlan;
  originLabel: string | null;
  originId: string | null;
  originPoint: GeoPoint | null;
  conditions: TravelConditions | null;
  /** True when the next automatic check is due or overdue. */
  refreshDue: boolean;
}

function toPoint(geo: GeoPoint): Point {
  return project(geo);
}

/**
 * Chaikin-style smoothing so a waypoint chain reads as a road, not a zigzag.
 *
 * It runs on the *coordinates*, before any projection, so the smoothed chain
 * is still a chain of real places: the same list can be drawn as a schematic
 * or re-projected through Bing's viewport and land on the actual road.
 */
function smoothGeo(points: GeoPoint[], passes = 2): GeoPoint[] {
  let current = points;
  for (let pass = 0; pass < passes; pass++) {
    if (current.length < 3) break;
    const next: GeoPoint[] = [current[0]];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i];
      const b = current[i + 1];
      next.push({ lat: a.lat * 0.75 + b.lat * 0.25, lon: a.lon * 0.75 + b.lon * 0.25 });
      next.push({ lat: a.lat * 0.25 + b.lat * 0.75, lon: a.lon * 0.25 + b.lon * 0.75 });
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current.map((point) => ({
    lat: Math.round(point.lat * 1e6) / 1e6,
    lon: Math.round(point.lon * 1e6) / 1e6
  }));
}

export function toPathData(points: Point[]): string {
  if (points.length === 0) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

/**
 * Congestion along the route.
 *
 * The corridor is not uniformly jammed: an approach to an airport tightens as
 * it gets closer, and a deterministic per-stretch variation keeps it from
 * reading as a flat wash. Both factors are stated here rather than chosen by
 * the renderer, so the picture and the number can never disagree.
 */
function bandLoad(index: number, count: number, congestion: number): number {
  const share = count <= 1 ? 1 : index / (count - 1);
  const proximity = 0.78 + 0.5 * share;
  const variation = 0.92 + 0.16 * Math.sin(share * Math.PI * 2.3 + 0.7);
  return Math.min(1, congestion * proximity * variation);
}

/**
 * Fit the world to the route.
 *
 * A pickup does not care about the whole Sound; it cares about the corridor it
 * is actually driving. So the plane rescales to the bounding box of the route
 * itself, with a margin, which is why a Bellevue run and an Everett run both
 * fill the frame instead of one of them being a smudge in the corner.
 *
 * Returned as a transform rather than applied inside `project`, so the
 * projection stays a pure geographic function and the fit stays a pure
 * presentation decision.
 */
interface Fit {
  apply(point: Point): Point;
  /** How much a circular radius grew, averaged across the two axes. */
  radiusScale: number;
}

function fitTo(points: Point[]): Fit {
  if (points.length === 0) return { apply: (point) => point, radiusScale: 1 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // A degenerate route (everything at the airport) must not divide by zero,
  // and must not blow a two-kilometre hop up to fill a continent either.
  const spanX = Math.max(8, maxX - minX);
  const spanY = Math.max(8, maxY - minY);
  const pad = 9;
  const scale = 100 - pad * 2;
  return {
    apply: (point) => ({
      x: Math.round((pad + ((point.x - minX) / spanX) * scale) * 100) / 100,
      y: Math.round((pad + ((point.y - minY) / spanY) * scale) * 100) / 100
    }),
    radiusScale: (scale / spanX + scale / spanY) / 2
  };
}

/**
 * Label de-collision.
 *
 * The airport, the cell-phone lot and the arrivals curb are genuinely within a
 * mile of each other, so on any plane that holds the whole drive their dots
 * land on top of one another. The *dots* stay where the geography puts them —
 * moving those would be a lie — and only the labels fan out,
 * deterministically, downward.
 *
 * Exported because the Bing-aligned overlay re-projects the same anchors into
 * a different frame and has to fan the same way, from one implementation.
 */
export function fanLabels<T extends { at: Point }>(items: T[]): Array<T & { labelDy: number }> {
  const placed: Array<{ x: number; y: number }> = [];
  return items.map((item) => {
    // Near the foot of the plane a fan downward would walk the label off the
    // map, so the fan direction follows the space that actually exists.
    const step = item.at.y > 55 ? -18 : 18;
    let dy = 0;
    for (let attempt = 0; attempt < 6; attempt++) {
      const y = item.at.y + dy;
      const clash = placed.some((box) => Math.abs(box.x - item.at.x) < 26 && Math.abs(box.y - y) < 17);
      if (!clash) break;
      dy += step;
    }
    placed.push({ x: item.at.x, y: item.at.y + dy });
    return { ...item, labelDy: dy };
  });
}

function splitPath<T>(path: T[], parts: number): T[][] {
  if (path.length < 2 || parts < 1) return [path];
  const perPart = Math.max(1, Math.floor((path.length - 1) / parts));
  const chunks: T[][] = [];
  for (let i = 0; i < parts; i++) {
    const start = i * perPart;
    const end = i === parts - 1 ? path.length - 1 : Math.min(path.length - 1, start + perPart);
    chunks.push(path.slice(start, end + 1));
  }
  return chunks.filter((chunk) => chunk.length >= 2);
}

function scaleRange(range: MinuteRange, share: number): MinuteRange {
  return { min: Math.round(range.min * share), max: Math.round(range.max * share) };
}

/**
 * The whole world, in one pass.
 *
 * When there is no origin the map still exists: SEA, the lot and the curb are
 * drawn, and the missing half of the route is returned as an empty `origin`
 * so the surface can state the gap rather than invent a starting point.
 */
export function planJourney(input: JourneyInput): JourneyWorld {
  const { plan, conditions } = input;
  const corridor = corridorFor(input.originId);
  const lotPoint = toPoint(CELL_PHONE_LOT_POINT);
  const curbPoint = toPoint(ARRIVALS_CURB_POINT);
  const seaAt = toPoint(SEA_AIRPORT);
  const traffic = conditions?.traffic ?? null;
  const load = traffic?.congestion ?? 0;

  const stops = plan.stops ?? [];
  const originGeo = input.originPoint ?? (input.originLabel ? TYPED_ORIGIN_POINT : null);
  const originAt = originGeo ? toPoint(originGeo) : null;

  const waypoints: JourneyWaypoint[] = [];
  const departByMs = plan.travel?.departByMs ?? null;
  const lotWindow = plan.envelope?.lotWindow ?? null;
  const curbWindow = plan.envelope?.curbWindow ?? null;
  const driveMinutes = plan.travel?.driveMinutes ?? null;

  let originWaypoint: JourneyWaypoint | null = null;
  if (originAt && originGeo && input.originLabel) {
    originWaypoint = {
      id: 'origin',
      kind: 'origin',
      label: input.originLabel,
      detail:
        departByMs === null
          ? 'Your starting point. The leave-by appears once an actual landing exists.'
          : plan.travel?.lateForIdealWindow
            ? `Leave now · expected Cell Phone Lot arrival ${formatRangeLabel(plan.travel.arrivalWindow)}`
            : `Leave here by ${formatClock(departByMs)}`,
      at: originAt,
      geo: originGeo,
      labelDy: 0,
      window: departByMs === null ? null : { startMs: departByMs, endMs: departByMs },
      truth: input.originId && input.originId !== 'typed-origin' ? 'inferred' : 'unknown'
    };
    waypoints.push(originWaypoint);
  }

  // Stops sit between the origin and the lot, in the order they were added.
  const stopWaypoints: JourneyWaypoint[] = stops.map((stop) => ({
    id: `stop-${stop.id}`,
    kind: 'stop' as const,
    label: stop.label,
    detail: `${stop.reason} · ${formatMinuteRange(stop.minutes)} — SAMPLE estimate`,
    at: toPoint({ lat: stop.lat, lon: stop.lon }),
    geo: { lat: stop.lat, lon: stop.lon },
    labelDy: 0,
    window: null,
    truth: stop.truth
  }));
  waypoints.push(...stopWaypoints);

  waypoints.push({
    id: 'cell-lot',
    kind: 'lot',
    label: 'SEA Cell Phone Lot',
    detail: plan.travel?.lateForIdealWindow
      ? `Expected arrival ${formatRangeLabel(plan.travel.arrivalWindow)} · ideal staging was ${formatRangeLabel(lotWindow!)}`
      : lotWindow
        ? `Be here ${formatRangeLabel(lotWindow)}`
        : 'Your staging point once a landing time exists',
    at: lotPoint,
    geo: CELL_PHONE_LOT_POINT,
    labelDy: 0,
    window: lotWindow,
    truth: lotWindow ? 'modeled' : 'unknown'
  });
  waypoints.push({
    id: 'arrivals',
    kind: 'curb',
    label: 'SEA Arrivals curb',
    detail: curbWindow
      ? `Move here when they text — expected ${formatRangeLabel(curbWindow)}`
      : 'Active-load only. Move here only after they text.',
    at: curbPoint,
    geo: ARRIVALS_CURB_POINT,
    labelDy: 0,
    window: curbWindow,
    truth: curbWindow ? 'modeled' : 'unknown'
  });

  // The drawn route, as coordinates: origin → corridor → stops → lot → curb.
  // It is smoothed here, in degrees, so the very same chain can be laid out as
  // a schematic *or* re-projected onto the real base.
  const corridorGeo = corridor.main.via;
  const mainGeoChain: GeoPoint[] = [];
  if (originGeo) mainGeoChain.push(originGeo);
  if (originGeo) mainGeoChain.push(...corridorGeo.slice(0, Math.max(1, corridorGeo.length - 1)));
  mainGeoChain.push(...stopWaypoints.map((waypoint) => waypoint.geo));
  if (originGeo && corridorGeo.length > 0) mainGeoChain.push(corridorGeo[corridorGeo.length - 1]);
  mainGeoChain.push(CELL_PHONE_LOT_POINT, ARRIVALS_CURB_POINT);
  const mainGeoPath = smoothGeo(mainGeoChain, originGeo ? 2 : 1);
  const mainPath = mainGeoPath.map(toPoint);

  const alternateGeoChain: GeoPoint[] = originGeo
    ? [originGeo, ...corridor.alternate.via, CELL_PHONE_LOT_POINT]
    : [];
  const alternateGeoPath = originGeo ? smoothGeo(alternateGeoChain, 2) : [];
  const alternatePath = alternateGeoPath.map(toPoint);

  // Time mapped onto space: the drive range is shared across the route in
  // proportion to how much of the path each stretch takes.
  const legLabels: string[] = [];
  if (originWaypoint) {
    let previous = originWaypoint.label;
    for (const stop of stopWaypoints) {
      legLabels.push(`${previous} → ${stop.label}`);
      previous = stop.label;
    }
    legLabels.push(`${previous} → Cell Phone Lot`);
  }
  legLabels.push('Cell Phone Lot → Arrivals curb');

  const geoChunks = splitPath(mainGeoPath, Math.max(1, legLabels.length));
  const totalMinutes: MinuteRange = driveMinutes ?? { min: 0, max: 0 };
  const driveLegCount = originWaypoint ? Math.max(1, legLabels.length - 1) : 0;
  const segments: JourneySegment[] = geoChunks.map((chunk, index) => {
    const isCurbLeg = index >= driveLegCount;
    const share = driveLegCount > 0 ? 1 / driveLegCount : 1;
    const minutes = isCurbLeg ? CELL_PHONE_LOT.driveToCurbMinutes : scaleRange(totalMinutes, share);
    const window = isCurbLeg
      ? curbWindow
        ? { startMs: curbWindow.startMs, endMs: curbWindow.endMs + minutes.max * MINUTE }
        : null
      : departByMs === null
        ? null
        : {
            startMs: departByMs + index * share * totalMinutes.min * MINUTE,
            endMs: departByMs + (index + 1) * share * totalMinutes.max * MINUTE
          };
    return {
      id: `leg-${index + 1}`,
      label: legLabels[index] ?? `Leg ${index + 1}`,
      path: chunk.map(toPoint),
      geoPath: chunk,
      load: bandLoad(index, geoChunks.length, load),
      minutes,
      window,
      flow: 1
    };
  });

  // The painted congestion is finer-grained than the semantic legs, so the
  // corridor reads as a gradient rather than as two flat blocks.
  const bandChunks = splitPath(mainGeoPath, 8);
  const trafficBands: TrafficBand[] = bandChunks.map((chunk, index) => ({
    id: `band-${index + 1}`,
    path: chunk.map(toPoint),
    geoPath: chunk,
    load: bandLoad(index, bandChunks.length, load)
  }));

  // NOW as a position on the route rather than a column on an axis.
  let nowOnRoute = 0;
  if (plan.travel) {
    const span = Math.max(1, plan.travel.range.endMs - plan.travel.range.startMs);
    nowOnRoute = Math.min(1, Math.max(0, (plan.nowMs - plan.travel.range.startMs) / span));
  }

  const weatherProjection = conditions?.weather ?? null;
  const weatherReach = Math.min(
    1,
    (weatherProjection?.precipitationChance ?? 0) + (weatherProjection?.windMph ?? 0) / 60
  );
  const weather: WeatherCell | null = weatherProjection
    ? {
        at: seaAt,
        geo: SEA_AIRPORT,
        radius: 14 + 16 * weatherReach,
        // The same footprint stated as a real distance, so the cell can be
        // drawn over real geography instead of over a fitted plane.
        radiusKm: Math.round((5 + 11 * weatherReach) * 10) / 10,
        intensity: Math.min(1, (weatherProjection.precipitationChance ?? 0) * 0.7 + (weatherProjection.windMph ?? 0) / 45),
        kind: weatherProjection.kind,
        label: `${weatherProjection.condition}${
          weatherProjection.temperatureF === null ? '' : ` ${weatherProjection.temperatureF}°F`
        }`,
        timeLabel: curbWindow
          ? `projected over ${formatRangeLabel(curbWindow)}`
          : 'projected over the arrival window',
        windDegrees: weatherProjection.windFromDegrees ?? 180,
        windLabel: weatherProjection.windMph === null ? 'wind unknown' : `wind ${weatherProjection.windMph} mph`,
        truth: weatherProjection.provenance === 'sample' ? 'sample' : 'live'
      }
    : null;

  const notes: MapNote[] = AIRPORT_NOTES.filter((note) => MAP_NOTE_IDS.has(note.id));
  const incident = traffic ? CORRIDOR_INCIDENTS[traffic.level] ?? null : null;
  if (incident) notes.push(incident);

  const rawMarkers = notes.map((note) => ({
    id: note.id,
    kind: note.kind,
    label: note.label,
    detail: note.detail,
    at: toPoint(note.point),
    geo: note.point,
    truth: note.truth
  }));

  // The plane is fitted to the route it is actually drawing, so a Bellevue run
  // and an Everett run both fill the frame instead of one of them being a
  // smudge in a corner. With no origin there is no route to fit to, so the
  // geographic projection stands as it is and the empty half of the plane is
  // the spatial gap, honestly drawn.
  const fit: Fit = originAt
    ? fitTo([
        ...mainPath,
        ...alternatePath,
        ...waypoints.map((waypoint) => waypoint.at),
        ...rawMarkers.map((marker) => marker.at),
        seaAt
      ])
    : { apply: (point) => point, radiusScale: 1 };
  const fitPath = (path: Point[]): Point[] => path.map((point) => fit.apply(point));

  // Waypoints and notes share one plane, so they are fanned in one pass —
  // otherwise the curb label and the curb-works note would each think they
  // had the corner to themselves.
  const anchored = fanLabels([
    ...waypoints.map((waypoint) => ({
      kindTag: 'waypoint' as const,
      waypoint,
      marker: null as JourneyMarker | null,
      at: fit.apply(waypoint.at)
    })),
    ...rawMarkers.map((marker) => ({
      kindTag: 'note' as const,
      waypoint: null as JourneyWaypoint | null,
      marker: marker as JourneyMarker,
      at: fit.apply(marker.at)
    }))
  ]);
  const fittedWaypoints: JourneyWaypoint[] = anchored
    .filter((entry) => entry.waypoint !== null)
    .map((entry) => ({ ...(entry.waypoint as JourneyWaypoint), at: entry.at, labelDy: entry.labelDy }));
  const fittedMarkers: JourneyMarker[] = anchored
    .filter((entry) => entry.marker !== null)
    .map((entry) => ({ ...(entry.marker as JourneyMarker), at: entry.at, labelDy: entry.labelDy }));
  const fittedMain = fitPath(mainPath);
  const fittedAlternate = fitPath(alternatePath);
  const fittedSea = fit.apply(seaAt);
  const fittedSegments = segments.map((segment) => ({ ...segment, path: fitPath(segment.path) }));
  const fittedBands = trafficBands.map((band) => ({ ...band, path: fitPath(band.path) }));
  const fittedWeather = weather
    ? {
        ...weather,
        at: fittedSea,
        // The cell is a projection, not a measured footprint, so it is scaled
        // with the plane and then held inside legible bounds.
        radius: Math.min(46, Math.max(12, weather.radius * Math.min(2.4, fit.radiusScale)))
      }
    : null;

  return {
    label: MAP_LABEL,
    origin: fittedWaypoints.find((waypoint) => waypoint.kind === 'origin') ?? null,
    waypoints: fittedWaypoints,
    segments: fittedSegments,
    trafficBands: fittedBands,
    mainPath: fittedMain,
    alternatePath: fittedAlternate,
    mainGeoPath,
    alternateGeoPath,
    mainLabel: corridor.main.label,
    alternateLabel: corridor.alternate.label,
    mainDistanceLabel: originAt
      ? `${corridor.main.distanceMiles} mi · ${driveMinutes ? formatMinuteRange(driveMinutes) : 'drive unknown'}`
      : 'route appears once you say where you are starting from',
    alternateDistanceLabel: originAt ? `${corridor.alternate.distanceMiles} mi · alternate` : '',
    driveMinutes,
    weather: fittedWeather,
    markers: fittedMarkers,
    nowOnRoute,
    departByMs,
    lotWindow,
    curbWindow,
    refreshDue: input.refreshDue,
    // The base is real geography, so it is built from the same coordinates the
    // projection uses — never from the projected plane, and never from text.
    base: bingBase(originGeo, CELL_PHONE_LOT_POINT),
    seaAt: fittedSea,
    seaGeo: SEA_AIRPORT
  };
}

/** Where a point sits along a path, 0–1, for placing the NOW dot. */
export function pointAlong(path: Point[], t: number): Point {
  if (path.length === 0) return { x: 50, y: 50 };
  if (path.length === 1) return path[0];
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (path.length - 1);
  const index = Math.floor(scaled);
  const next = Math.min(path.length - 1, index + 1);
  const frac = scaled - index;
  return {
    x: path[index].x + (path[next].x - path[index].x) * frac,
    y: path[index].y + (path[next].y - path[index].y) * frac
  };
}

/** The same walk along a chain of real coordinates, for a projected overlay. */
export function geoAlong(path: GeoPoint[], t: number): GeoPoint | null {
  if (path.length === 0) return null;
  if (path.length === 1) return path[0];
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (path.length - 1);
  const index = Math.floor(scaled);
  const next = Math.min(path.length - 1, index + 1);
  const frac = scaled - index;
  return {
    lat: path[index].lat + (path[next].lat - path[index].lat) * frac,
    lon: path[index].lon + (path[next].lon - path[index].lon) * frac
  };
}

/** The bearing of the route at its midpoint, so the GPU plane can align to it. */
export function routeBearing(path: Point[]): { x: number; y: number } {
  if (path.length < 2) return { x: 0, y: -1 };
  const a = path[Math.floor(path.length * 0.25)];
  const b = path[Math.floor(path.length * 0.75)];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: Math.round((dx / length) * 100) / 100, y: Math.round((dy / length) * 100) / 100 };
}

export type { GeoPoint, JourneyStop };
