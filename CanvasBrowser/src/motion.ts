/**
 * What is allowed to move, and why.
 *
 * CanvasBrowser's worlds are dense, but density is not motion. A coordinate
 * system — a graticule, a perspective floor, a NOW rule, a reach ring — is a
 * *place to read values against*, so it holds still. Motion is reserved for
 * two things and nothing else:
 *
 *   - something is **ongoing** right now (vehicles are moving on the corridor,
 *     rain is falling, the aircraft is still in the air), or
 *   - something **needs attention** (a check is due, a disruption is live, the
 *     world just changed under you).
 *
 * This module is the single place that decides which of those are true. Both
 * the GPU layer and the words under the map read the same list, so the legend
 * can never promise a motion the world is not actually running — and a person
 * can point at anything that moves and be told what it means.
 */
import type { AppState } from './ui/state';
import { refreshCountdown } from './refreshPolicy';
import { weatherIntensity } from './travelConditionsFixtures';
import type { RefreshStatus } from './types';

/** The complete vocabulary. Nothing outside this list is allowed to animate. */
export type MotionId = 'traffic' | 'weather' | 'flight' | 'disruption' | 'refresh-due' | 'world-update';

/** Below this the projection is a tint, not weather worth animating. */
export const WEATHER_MOTION_THRESHOLD = 0.3;
/** The countdown share at which the next check reads as due rather than far. */
export const REFRESH_DUE_AT = 0.12;

/** Phases in which the aircraft is genuinely still moving. */
const MOVING_PHASES = new Set(['scheduled', 'enroute', 'approaching']);

export interface MotionState {
  active: MotionId[];
  /** Traffic is moving on the corridor: 0–1 load, only when it is drawn. */
  trafficLoad: number;
  /** 0–1 precipitation/wind density, only when it is over the threshold. */
  weatherIntensity: number;
  /** The aircraft is airborne, so its marker travels; otherwise it is a dot. */
  flightMoving: boolean;
  /** A disruption exists and is being drawn. */
  disruption: boolean;
  /** The next automatic check is due or overdue. */
  refreshDue: boolean;
}

/**
 * Whether the next check is due.
 *
 * A watched world that has just been checked is *not* due, no matter how tight
 * its cadence is — five-minute watching is said in words and drawn as a
 * draining dial, not as a permanently sweeping radar.
 *
 * Pure, so the rule can be checked at every boundary it claims.
 */
export function refreshIsDue(refresh: RefreshStatus, nowMs: number): boolean {
  if (!refresh.active || refresh.urgency === 'stopped' || refresh.paused) return false;
  if (refresh.lastCheckedMs === null || refresh.nextCheckMs === null) return false;
  return refreshCountdown(nowMs, refresh.lastCheckedMs, refresh.nextCheckMs) <= REFRESH_DUE_AT;
}

export function isRefreshDue(state: AppState): boolean {
  return refreshIsDue(state.refresh, state.plan?.nowMs ?? Date.now());
}

/**
 * The motion the current situation actually justifies.
 *
 * Every branch below is a reading, never a taste: delete the datum and the
 * motion disappears with it. A hidden layer counts as deleted, because a
 * person who switched traffic off has said they do not want the corridor
 * animating at them.
 */
export function motionState(state: AppState): MotionState {
  const active: MotionId[] = [];
  const plan = state.plan;
  const conditions = plan?.conditions ?? state.conditions ?? null;
  const compiled = state.compiled;

  /*
   * Traffic motion is a claim about *CanvasBrowser's* corridor.
   *
   * Over a live base that corridor is not drawn at all — the geography is
   * real, the route belongs to the Bing map the handoff opens, and an authored
   * line over real streets is exactly the claim this world gave up. Particles
   * running along a corridor nobody can see would be motion with no referent.
   * So the motion stops with the drawing: the datum is still in the plan and
   * still moves the leave-by, and nothing on screen pretends to be showing it.
   */
  const trafficDrawn =
    Boolean(conditions) &&
    !state.bingRouteLive &&
    state.conditionLayers.traffic &&
    (compiled?.layers.traffic ?? true);
  const load = trafficDrawn ? conditions?.traffic.congestion ?? 0 : 0;
  if (trafficDrawn && load > 0) active.push('traffic');

  const weatherDrawn = Boolean(conditions) && state.conditionLayers.weather && (compiled?.layers.weather ?? true);
  const intensity = weatherDrawn && conditions ? weatherIntensity(conditions.weather) : 0;
  const weatherMoving = intensity > WEATHER_MOTION_THRESHOLD;
  if (weatherMoving) active.push('weather');

  // A landed or at-gate aircraft is an observation, not an event: one still
  // marker where it is, and nothing orbiting or breathing around it.
  const flightMoving = MOVING_PHASES.has(plan?.phase ?? state.reading?.phase ?? 'unknown');
  if (flightMoving) active.push('flight');

  // Airport rules — curb lane work, cell-lot policy — are informational and
  // stay still. Only a live corridor disruption earns a pulse.
  const disruption =
    Boolean(conditions) &&
    (compiled?.layers.disruption ?? false) &&
    (conditions?.traffic.level === 'heavy' || conditions?.traffic.level === 'severe');
  if (disruption) active.push('disruption');

  const refreshDue = isRefreshDue(state);
  if (refreshDue) active.push('refresh-due');

  return {
    active,
    trafficLoad: load,
    weatherIntensity: weatherMoving ? intensity : 0,
    flightMoving,
    disruption,
    refreshDue
  };
}

/** One clause per active motion, in the world's own words. */
const CLAUSES: Record<MotionId, string> = {
  traffic: 'the corridor dashes drift because traffic is flowing on your route — speed follows the load',
  weather: 'precipitation streaks run along the sample wind vector while the projection is wet',
  flight: 'the arrival marker trails inbound because the aircraft is still in the air',
  disruption: 'the incident marker pulses because a corridor disruption is live',
  'refresh-due': 'the scan sweeps because the next check is due now',
  'world-update': 'one ripple runs when the world is rebuilt, then stops'
};

/**
 * The legend under the map.
 *
 * It lists what is moving *now* and nothing else. When the world is still, it
 * says so — a still world is a claim about the situation, not an omission.
 */
export function motionClauses(active: MotionId[]): string[] {
  return active.map((id) => CLAUSES[id]);
}

export function motionSentence(active: MotionId[]): string {
  if (active.length === 0) {
    return 'Nothing is moving: no traffic flow, no weather, the aircraft is down and no check is due. Coordinates, routes and markers hold still because they are places to read, not events.';
  }
  return `Motion in this world is data: ${motionClauses(active).join('; ')}. Coordinates, routes and markers hold still.`;
}
