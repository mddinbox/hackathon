/**
 * The adaptive refresh policy.
 *
 * This is the difference between a search result and a situation. A search
 * result is answered once. A pickup is *watched*: the world decides how often
 * to look again from how close the arrival is, whether the airport is actively
 * processing the passenger, and whether the trip is already over.
 *
 * Pure and deterministic — `now` and every timestamp are injected, there is no
 * `Date.now()`, no timer, and no model call in this file. The runtime
 * scheduler in the shell owns timers; this owns the decision.
 */
import type { FlightPhase, RefreshUrgency } from './types';

const MINUTE = 60_000;

export const REFRESH_INTERVALS: Record<Exclude<RefreshUrgency, 'stopped'>, number> = {
  hourly: 60 * MINUTE,
  'quarter-hourly': 15 * MINUTE,
  'five-minute': 5 * MINUTE
};

/** Boundaries the policy is written against, exported so tests can be exact. */
export const REFRESH_BOUNDARIES = {
  closeMs: 60 * MINUTE,
  nearMs: 120 * MINUTE
};

export interface RefreshPolicyInput {
  nowMs: number;
  /** Where the aircraft is, as far as a source has said. */
  phase: FlightPhase;
  scheduledArrivalMs: number | null;
  estimatedArrivalMs: number | null;
  actualLandingMs: number | null;
  /**
   * The end of the curb-ready window, when the world has computed one. Once
   * `now` is past it the trip is done and automatic refresh stops entirely.
   */
  curbReadyEndMs: number | null;
}

export interface RefreshPolicy {
  /** 0 when the policy has stopped. */
  intervalMs: number;
  /** Absolute epoch ms of the next check, or null when stopped. */
  nextRefreshMs: number | null;
  /** Why this cadence, phrased to be read after the word "because". */
  reason: string;
  urgency: RefreshUrgency;
}

const STOPPED: Omit<RefreshPolicy, 'reason'> = {
  intervalMs: 0,
  nextRefreshMs: null,
  urgency: 'stopped'
};

function at(nowMs: number, urgency: Exclude<RefreshUrgency, 'stopped'>, reason: string): RefreshPolicy {
  const intervalMs = REFRESH_INTERVALS[urgency];
  return { intervalMs, nextRefreshMs: nowMs + intervalMs, reason, urgency };
}

/** The best target the world can be shaped around, and how it is known. */
export function bestTarget(input: {
  scheduledArrivalMs: number | null;
  estimatedArrivalMs: number | null;
  actualLandingMs: number | null;
}): { ms: number; kind: 'actual' | 'estimated' | 'scheduled' | 'none' } {
  if (typeof input.actualLandingMs === 'number') return { ms: input.actualLandingMs, kind: 'actual' };
  if (typeof input.estimatedArrivalMs === 'number') return { ms: input.estimatedArrivalMs, kind: 'estimated' };
  if (typeof input.scheduledArrivalMs === 'number') return { ms: input.scheduledArrivalMs, kind: 'scheduled' };
  return { ms: 0, kind: 'none' };
}

/**
 * How often this situation deserves to be looked at again.
 *
 * The ladder, in order:
 *   1. the curb-ready window has passed → stop; there is nothing left to watch
 *   2. on the ground, processing still running → every 5 minutes
 *   3. arrival inside an hour (inclusive) → every 5 minutes
 *   4. arrival inside two hours (inclusive) → every 15 minutes
 *   5. further out than that → every hour
 *   6. no arrival time known at all → every 15 minutes, because the missing
 *      fact *is* the thing being watched
 */
export function computeRefreshPolicy(input: RefreshPolicyInput): RefreshPolicy {
  const { nowMs, phase, curbReadyEndMs } = input;
  const target = bestTarget(input);

  const onGround = target.kind === 'actual' || phase === 'landed' || phase === 'at-gate';

  if (onGround) {
    if (typeof curbReadyEndMs === 'number' && nowMs > curbReadyEndMs) {
      return { ...STOPPED, reason: 'the curb-ready window has passed and this trip is done' };
    }
    return at(nowMs, 'five-minute', 'they are on the ground and moving through the airport');
  }

  // A trip whose curb window is already behind us is over regardless of phase.
  if (typeof curbReadyEndMs === 'number' && nowMs > curbReadyEndMs) {
    return { ...STOPPED, reason: 'the curb-ready window has passed and this trip is done' };
  }

  if (target.kind === 'none') {
    return at(nowMs, 'quarter-hourly', 'no arrival time is established yet');
  }

  const untilMs = target.ms - nowMs;
  const word = target.kind === 'estimated' ? 'the estimated arrival' : 'the scheduled arrival';

  if (untilMs <= REFRESH_BOUNDARIES.closeMs) {
    return at(nowMs, 'five-minute', `${word} is inside an hour`);
  }
  if (untilMs <= REFRESH_BOUNDARIES.nearMs) {
    return at(nowMs, 'quarter-hourly', `${word} is inside two hours`);
  }
  return at(nowMs, 'hourly', `${word} is still more than two hours out`);
}

/** `every 15 min` — the cadence on its own, for compact status lines. */
export function formatCadence(policy: RefreshPolicy): string {
  if (policy.urgency === 'stopped') return 'not checking again';
  return `every ${Math.round(policy.intervalMs / MINUTE)} min`;
}

/** `every 15 min because the estimated arrival is inside two hours` */
export function describeCadence(policy: RefreshPolicy): string {
  if (policy.urgency === 'stopped') return `not checking again — ${policy.reason}`;
  return `${formatCadence(policy)} because ${policy.reason}`;
}

/**
 * How hard the world should be watching, 0–1. Feeds the scan cadence in the
 * visual layer, so 60 / 15 / 5 minutes read as three visibly different speeds.
 */
export function urgencyLevel(urgency: RefreshUrgency): number {
  switch (urgency) {
    case 'five-minute':
      return 1;
    case 'quarter-hourly':
      return 0.55;
    case 'hourly':
      return 0.2;
    default:
      return 0;
  }
}

/** 1 immediately after a check, falling to 0 as the next one comes due. */
export function refreshCountdown(nowMs: number, lastCheckedMs: number | null, nextCheckMs: number | null): number {
  if (lastCheckedMs === null || nextCheckMs === null) return 0;
  const span = nextCheckMs - lastCheckedMs;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (nextCheckMs - nowMs) / span));
}
