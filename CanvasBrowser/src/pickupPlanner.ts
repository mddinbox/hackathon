/**
 * The Time Terrain planner.
 *
 * Pure and deterministic: every input — including the current time — is
 * injected, so the same inputs always produce the same world. There is no
 * `Date.now()`, no randomness, and no model call in here. The model
 * establishes live facts; this planner owns uncertainty and layout.
 *
 * Everything it emits is a range. It never invents minute-level precision,
 * and it refuses to produce a commit window without an observed landing.
 */
import {
  CELL_PHONE_LOT,
  PARTY_TAIL_MINUTES_PER_EXTRA_PASSENGER,
  PROCESSING_RANGES
} from './pickupFixtures';
import { bestTarget } from './refreshPolicy';
import { formatMinuteRange, formatRangeLabel } from './timeFormat';
import type {
  Assumptions,
  FlightReading,
  JourneyStop,
  MinuteRange,
  OriginOption,
  PickupPlan,
  SegmentId,
  TerrainSegment,
  TimeRange,
  TravelConditions,
  WeatherProjection
} from './types';

const MINUTE = 60_000;

export interface PlannerInput {
  nowMs: number;
  reading: FlightReading;
  assumptions: Assumptions;
  origin: OriginOption | null;
  /** SAMPLE weather + traffic. Null when no conditions are loaded. */
  conditions?: TravelConditions | null;
  /** Stops the user added inside the world. Each one moves the leave-by. */
  stops?: JourneyStop[];
}

function roundDown5(ms: number): number {
  return Math.floor(ms / (5 * MINUTE)) * 5 * MINUTE;
}

function roundUp5(ms: number): number {
  return Math.ceil(ms / (5 * MINUTE)) * 5 * MINUTE;
}

interface SegmentSpec {
  id: SegmentId;
  label: string;
  duration: MinuteRange;
  method: string;
  inferred: boolean;
}

function segmentSpecs(assumptions: Assumptions, weather: WeatherProjection | null): SegmentSpec[] {
  const specs: SegmentSpec[] = [
    {
      id: 'taxi',
      label: 'Landed · taxi to gate',
      duration: PROCESSING_RANGES.taxi,
      method: 'Modeled from typical SEA taxi times',
      inferred: false
    },
    {
      id: 'deplane',
      label: 'Gate · deplane',
      duration: PROCESSING_RANGES.deplane,
      method: 'Modeled from wide-body deplaning ranges',
      inferred: false
    }
  ];
  if (assumptions.internationalArrival) {
    specs.push({
      id: 'cbp',
      label: 'CBP · passport & customs',
      duration: PROCESSING_RANGES.cbp,
      method: 'Modeled range — the widest unknown in this world',
      inferred: false
    });
  }
  if (assumptions.checkedBag) {
    specs.push({
      id: 'bags',
      label: 'Baggage claim',
      duration: PROCESSING_RANGES.bags,
      method: 'Included because a checked bag is assumed',
      inferred: true
    });
  }
  const extraPassengers = Math.max(0, assumptions.passengerCount - 1);
  specs.push({
    id: 'curb',
    label: 'Walk to arrivals curb',
    duration: {
      min: PROCESSING_RANGES.curb.min,
      max: PROCESSING_RANGES.curb.max + extraPassengers * PARTY_TAIL_MINUTES_PER_EXTRA_PASSENGER
    },
    method:
      extraPassengers > 0
        ? `Modeled walk plus assembly time for ${assumptions.passengerCount} passengers`
        : 'Modeled walk from the hall to the arrivals curb',
    inferred: extraPassengers > 0
  });

  // Weather is allowed exactly one effect: it widens the upper bound of one
  // named segment by a stated number of minutes. Never a new segment, never a
  // moved landing, never a narrowing.
  if (weather && weather.widenMinutes > 0) {
    const target = specs.find((spec) => spec.id === weather.widenedSegment);
    if (target) {
      target.duration = { min: target.duration.min, max: target.duration.max + weather.widenMinutes };
      target.method = `${target.method}, widened ${weather.widenMinutes} min by ${weather.condition.toLowerCase()} (SAMPLE)`;
    }
  }
  return specs;
}

function widestSpan(specs: SegmentSpec[]): number {
  return specs.reduce((widest, spec) => Math.max(widest, spec.duration.max - spec.duration.min), 1);
}

/** Lays out the passenger pipeline. Position and width both carry meaning. */
function buildSegments(anchorMs: number, specs: SegmentSpec[], resolved: boolean): TerrainSegment[] {
  const widest = widestSpan(specs);
  let cumulativeMin = 0;
  let cumulativeMax = 0;
  return specs.map((spec) => {
    const range: TimeRange = {
      startMs: anchorMs + cumulativeMin * MINUTE,
      endMs: anchorMs + (cumulativeMax + spec.duration.max) * MINUTE
    };
    cumulativeMin += spec.duration.min;
    cumulativeMax += spec.duration.max;
    return {
      id: spec.id,
      label: spec.label,
      truth: resolved ? (spec.inferred ? 'inferred' : 'modeled') : 'unknown',
      range,
      duration: spec.duration,
      method: resolved ? spec.method : 'Unknown until an actual landing time exists',
      uncertainty: (spec.duration.max - spec.duration.min) / widest
    } satisfies TerrainSegment;
  });
}

function curbWindow(anchorMs: number, specs: SegmentSpec[]): TimeRange {
  const min = specs.reduce((total, spec) => total + spec.duration.min, 0);
  const max = specs.reduce((total, spec) => total + spec.duration.max, 0);
  return {
    startMs: roundDown5(anchorMs + min * MINUTE),
    endMs: roundUp5(anchorMs + max * MINUTE)
  };
}

function lotWindow(curb: TimeRange, nowMs: number): TimeRange {
  const beInLotBy = curb.startMs - (CELL_PHONE_LOT.driveToCurbMinutes.max + CELL_PHONE_LOT.stagingBufferMinutes) * MINUTE;
  const start = roundDown5(beInLotBy - 15 * MINUTE);
  const end = roundUp5(beInLotBy);
  if (end <= nowMs) {
    return { startMs: roundDown5(nowMs), endMs: roundUp5(nowMs + 10 * MINUTE) };
  }
  return { startMs: Math.max(start, roundDown5(nowMs)), endMs: end };
}

/**
 * Builds the shared world. When there is no observed landing time the world
 * still renders — as hatched unknown terrain with no commit window. A
 * scheduled or estimated arrival may shape the *horizon*, so the terrain sits
 * where the situation actually is, but it can never produce a commitment.
 */
export function planPickup(input: PlannerInput): PickupPlan {
  const { nowMs, reading, assumptions, origin } = input;
  const conditions = input.conditions ?? null;
  const stops = input.stops ?? [];
  const stopMinutes: MinuteRange = stops.reduce(
    (total, stop) => ({ min: total.min + stop.minutes.min, max: total.max + stop.minutes.max }),
    { min: 0, max: 0 }
  );
  const weather = conditions?.weather ?? null;
  const traffic = conditions?.traffic ?? null;
  const specs = segmentSpecs(assumptions, weather);
  const resolved = reading.status === 'landed' && typeof reading.landingMs === 'number';
  const target = bestTarget({
    scheduledArrivalMs: reading.scheduledArrivalMs ?? null,
    estimatedArrivalMs: reading.estimatedArrivalMs ?? null,
    actualLandingMs: resolved ? (reading.landingMs as number) : null
  });
  const anchorMs = resolved ? (reading.landingMs as number) : target.kind === 'none' ? nowMs : target.ms;
  const segments = buildSegments(anchorMs, specs, resolved);
  const phase = reading.phase ?? 'unknown';

  if (!resolved) {
    const lastSegment = segments[segments.length - 1];
    const tentative =
      target.kind === 'estimated'
        ? ' The terrain is placed against the estimated arrival so you can see the shape of it; nothing here is a commitment.'
        : target.kind === 'scheduled'
          ? ' The terrain is placed against the scheduled arrival so you can see the shape of it; nothing here is a commitment.'
          : '';
    return {
      resolved: false,
      nowMs,
      horizon: {
        startMs: roundDown5(Math.min(nowMs, anchorMs) - 15 * MINUTE),
        endMs: roundUp5(lastSegment.range.endMs + 20 * MINUTE)
      },
      segments,
      envelope: null,
      travel: null,
      lotStagingMs: null,
      stops,
      blocked: {
        reason:
          (reading.status === 'enroute'
            ? 'The flight is still en route, so there is no actual landing time to build a leave-time from.'
            : reading.note) + tentative,
        unblocker: 'Re-check arrival status'
      },
      provenance: reading.provenance,
      assumptions,
      flightLabel: reading.flightLabel,
      conditions,
      anchor: target.kind === 'none' ? { ms: nowMs, kind: 'none' } : target,
      phase
    };
  }

  const curb = curbWindow(anchorMs, specs);
  const lot = lotWindow(curb, nowMs);
  const baseDrive = origin?.driveMinutes ?? null;
  const driveMinutes: MinuteRange | null = baseDrive
    ? {
        min: baseDrive.min + (traffic?.delayMinutes.min ?? 0) + stopMinutes.min,
        max: baseDrive.max + (traffic?.delayMinutes.max ?? 0) + stopMinutes.max
      }
    : null;
  const travel =
    origin && baseDrive && driveMinutes
      ? (() => {
          const idealDepartByMs = lot.endMs - driveMinutes.max * MINUTE;
          const lateForIdealWindow = idealDepartByMs <= nowMs;
          const departureMs = lateForIdealWindow ? nowMs : idealDepartByMs;
          const arrivalWindow = {
            startMs: departureMs + driveMinutes.min * MINUTE,
            endMs: departureMs + driveMinutes.max * MINUTE
          };
          return {
            originLabel: origin.label,
            range: { startMs: departureMs, endMs: arrivalWindow.endMs },
            arrivalWindow,
            departByMs: departureMs,
            lateForIdealWindow,
            driveMinutes,
            baseDriveMinutes: baseDrive,
            trafficDelay: traffic ? { ...traffic.delayMinutes } : null,
            stopMinutes: { ...stopMinutes },
            truth: 'modeled' as const,
            method: [
              lateForIdealWindow
                ? `The ideal staging departure passed; arrival is recomputed from leaving ${origin.label} now`
                : null,
              traffic
                ? `Fixture drive from ${origin.label} plus ${formatMinuteRange(traffic.delayMinutes)} of SAMPLE ${
                    traffic.level
                  } traffic on ${traffic.corridorLabel}`
                : `Estimated drive from ${origin.label} — fixture estimate, not live traffic`,
              stops.length > 0
                ? `plus ${formatMinuteRange(stopMinutes)} for ${stops.length} stop${stops.length === 1 ? '' : 's'} you added`
                : null
            ]
              .filter(Boolean)
              .join(', ')
          };
        })()
      : null;

  const horizonStart = Math.min(anchorMs, travel?.range.startMs ?? anchorMs, nowMs) - 10 * MINUTE;
  const groundMinutes = {
    min: specs.reduce((total, spec) => total + spec.duration.min, 0),
    max: specs.reduce((total, spec) => total + spec.duration.max, 0)
  };
  const alreadyCurbReady = curb.endMs < nowMs;

  // Exactly which forces moved this range, in the words the user can check.
  const conditionNotes: string[] = [];
  if (traffic && travel && traffic.delayMinutes.max > 0) {
    conditionNotes.push(
      `+${formatMinuteRange(traffic.delayMinutes)} traffic on ${traffic.corridorLabel} (${traffic.level}, ${
        traffic.trend
      }) — SAMPLE`
    );
  }
  if (weather && weather.widenMinutes > 0) {
    const segment = segments.find((entry) => entry.id === weather.widenedSegment);
    conditionNotes.push(
      `${weather.condition.toLowerCase()} widens ${segment?.label.toLowerCase() ?? weather.widenedSegment} uncertainty by ${
        weather.widenMinutes
      } min — SAMPLE`
    );
  }
  if (stops.length > 0 && travel) {
    conditionNotes.push(
      `+${formatMinuteRange(stopMinutes)} for ${stops.map((stop) => stop.label.toLowerCase()).join(' + ')} — your stops, SAMPLE estimate`
    );
  }

  const envelope = {
    primary: alreadyCurbReady
      ? 'They are most likely already curb-ready'
      : travel?.lateForIdealWindow
        ? `Leave now for the ${CELL_PHONE_LOT.name}`
      : `Be in the ${CELL_PHONE_LOT.name} between ${formatRangeLabel(lot)}`,
    secondary: alreadyCurbReady
      ? `Their curb-ready window was ${formatRangeLabel(curb)}. Move to the curb when they text, not before.`
      : travel?.lateForIdealWindow
        ? `Expected lot arrival ${formatRangeLabel(travel.arrivalWindow)}. Their curb-ready text should arrive ${formatRangeLabel(
            curb
          )}.`
      : `Expect their curb-ready text ${formatRangeLabel(curb)}`,
    lotWindow: lot,
    curbWindow: curb,
    truth: 'modeled' as const,
    method: `Ranges built locally from the observed landing plus modeled processing (${formatMinuteRange(
      groundMinutes
    )} on the ground)`,
    conditionNotes
  };

  return {
    resolved: true,
    nowMs,
    horizon: { startMs: roundDown5(horizonStart), endMs: roundUp5(curb.endMs + 15 * MINUTE) },
    segments,
    envelope,
    travel,
    lotStagingMs: lot.startMs,
    stops,
    blocked: null,
    provenance: reading.provenance,
    assumptions,
    flightLabel: reading.flightLabel,
    conditions,
    anchor: { ms: anchorMs, kind: 'actual' },
    phase: phase === 'unknown' ? 'landed' : phase
  };
}

/** Where a moment sits on the terrain, as a 0–100 percentage of the horizon. */
export function positionPercent(horizon: TimeRange, ms: number): number {
  const span = Math.max(1, horizon.endMs - horizon.startMs);
  return Math.min(100, Math.max(0, ((ms - horizon.startMs) / span) * 100));
}

export function spanPercent(horizon: TimeRange, range: TimeRange): number {
  const span = Math.max(1, horizon.endMs - horizon.startMs);
  return Math.min(100, Math.max(1.5, ((range.endMs - range.startMs) / span) * 100));
}
