/**
 * CanvasBrowser core types.
 *
 * The shared intelligence grammar is:
 *   Situation → Job hypotheses → Template resolver → Shared world →
  *   Decision envelope → Adaptive watch → User handoff.
 *
 * Everything the user sees carries a truth kind. Nothing in this file
 * allows a claim to be promoted to `observed` without a claim-level source.
 */

/** How a value came to be known. Drives colour, hatching, and copy. */
export type TruthKind = 'observed' | 'modeled' | 'inferred' | 'unknown';

/** Where a fact came from. `sample` is always visibly tagged SAMPLE DATA. */
export type Provenance = 'live-research' | 'sample' | 'local-estimate' | 'user';

export interface Citation {
  label: string;
  url: string;
}

export type LandingStatus = 'landed' | 'enroute' | 'unknown';

/**
 * Where the aircraft is in its own life, as distinct from `status`.
 *
 * `status` answers the only question the P0 commit rule cares about — is there
 * an *actual* landing? — while `phase` carries the finer state the refresh
 * policy and the visual layer need. A phase is only ever promoted past
 * `unknown` when a source said so; it is never inferred from a clock.
 */
export type FlightPhase = 'scheduled' | 'enroute' | 'landed' | 'at-gate' | 'unknown';

/**
 * The literal, source-level reading of a flight. `landingMs` is only ever
 * populated when a source stated an actual landing/arrival time, or when the
 * user explicitly asked for the clearly-labelled sample scenario.
 *
 * Scheduled and estimated arrivals are *planning* targets only. They can move
 * the horizon and the refresh cadence; they can never produce a commitment.
 */
export interface FlightReading {
  status: LandingStatus;
  phase: FlightPhase;
  /** Actual wheels-down, when a source stated one. Same value as `landingMs`. */
  actualLandingMs: number | null;
  /** The published scheduled arrival, when a source stated one. */
  scheduledArrivalMs: number | null;
  /** The current estimated arrival, when a source stated one. */
  estimatedArrivalMs: number | null;
  landingMs: number | null;
  landingLabel: string | null;
  truth: TruthKind;
  /** Plain-language description of the method or the missing piece. */
  note: string;
  citations: Citation[];
  provenance: Provenance;
  flightLabel: string;
  retrievedAt: string | null;
}

/** The literal answer surface shown before any template is offered. */
export interface LiteralAnswer {
  prompt: string;
  text: string;
  model: string | null;
  contextTier: string | null;
  reasoningEffort: string | null;
  normalization: string | null;
  retrievedAt: string | null;
  citations: Citation[];
  status: 'answered' | 'unavailable';
  reading: FlightReading | null;
}

export type JobHypothesisId = 'track' | 'connect' | 'pickup';

export interface Assumptions {
  checkedBag: boolean;
  passengerCount: number;
  internationalArrival: boolean;
}

export interface MinuteRange {
  min: number;
  max: number;
}

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export interface OriginOption {
  id: string;
  label: string;
  /** Estimated driving minutes to the SEA cell phone lot — fixture, not live traffic. */
  driveMinutes: MinuteRange;
  lat: number;
  lon: number;
}

export type SegmentId = 'taxi' | 'deplane' | 'cbp' | 'bags' | 'curb';

export interface TerrainSegment {
  id: SegmentId;
  label: string;
  truth: TruthKind;
  /** Earliest possible start → latest possible end, in epoch ms. */
  range: TimeRange;
  duration: MinuteRange;
  method: string;
  /** Relative uncertainty 0–1; the widest segment reads as the dominant unknown. */
  uncertainty: number;
}

export interface DecisionEnvelope {
  primary: string;
  secondary: string;
  lotWindow: TimeRange;
  curbWindow: TimeRange;
  truth: TruthKind;
  method: string;
  /**
   * Which live-ish conditions actually moved this range, in the user's words:
   * `+8–14 min traffic`, `rain widens curb uncertainty by 5 min`. Empty when
   * nothing but the base model shaped the window.
   */
  conditionNotes: string[];
}

/**
 * A stop the user added to the drive.
 *
 * A stop is never asked for. It is offered inside the world, and adding one
 * deforms the route and moves the leave-by window locally — no model call,
 * no question, and every minute of it clearly a sample estimate.
 */
export interface JourneyStop {
  id: string;
  label: string;
  /** Why this stop exists, in the user's words. Shown on the map marker. */
  reason: string;
  minutes: MinuteRange;
  lat: number;
  lon: number;
  truth: TruthKind;
}

export interface TravelBlock {
  originLabel: string;
  range: TimeRange;
  /** Achievable Cell Phone Lot arrival range from the departure used by this plan. */
  arrivalWindow: TimeRange;
  /** The latest departure that still lands inside the lot window. */
  departByMs: number;
  /** True when the ideal departure already passed and the plan shifted to an honest leave-now path. */
  lateForIdealWindow: boolean;
  /** The drive range actually used — fixture plus traffic plus any stops. */
  driveMinutes: MinuteRange;
  /** The fixture range before traffic was applied. */
  baseDriveMinutes: MinuteRange;
  /** Minutes traffic added, when a traffic projection is loaded. */
  trafficDelay: MinuteRange | null;
  /** Minutes the user's own stops added. Zero-width when there are none. */
  stopMinutes: MinuteRange;
  truth: TruthKind;
  method: string;
}

export interface PickupPlan {
  resolved: boolean;
  nowMs: number;
  horizon: TimeRange;
  segments: TerrainSegment[];
  envelope: DecisionEnvelope | null;
  travel: TravelBlock | null;
  lotStagingMs: number | null;
  /** The stops the user added to this drive, in order. */
  stops: JourneyStop[];
  /** Present when the plan cannot commit: reason + the explicit unblocker. */
  blocked: { reason: string; unblocker: string } | null;
  provenance: Provenance;
  assumptions: Assumptions;
  flightLabel: string;
  /** The conditions this world was built under. Null when none are loaded. */
  conditions: TravelConditions | null;
  /**
   * The best target the world is currently shaped around, and how it is known.
   * `actual` is the only kind that can produce a commitment.
   */
  anchor: { ms: number; kind: 'actual' | 'estimated' | 'scheduled' | 'none' };
  /** Where the passenger is, as far as any source has said. */
  phase: FlightPhase;
}

export interface ChangeEntry {
  id: string;
  label: string;
}

/* --------------------------------------------------------------- conditions */

/** How a projection is moving. Shown as a word, never as a fake gradient. */
export type ConditionTrend = 'easing' | 'steady' | 'building';

export type WeatherKind = 'clear' | 'cloud' | 'rain' | 'wind' | 'snow';

export type TrafficLevel = 'light' | 'moderate' | 'heavy' | 'severe';

/**
 * Weather near SEA, over the airport-processing horizon.
 *
 * The only thing weather is allowed to do to the plan is widen one stated
 * segment by a stated number of minutes. It never moves a landing, never
 * shifts a commitment, and never invents a temperature it was not given.
 */
export interface WeatherProjection {
  kind: WeatherKind;
  /** Short human label: `Rain`, `Gusty wind`, `Clear`. */
  condition: string;
  temperatureF: number | null;
  /** 0–1. Null when no source stated one. */
  precipitationChance: number | null;
  windMph: number | null;
  /** Wind direction in compass degrees (0 = from the north). */
  windFromDegrees: number | null;
  /** Plain-language visibility / ramp effect. */
  visibilityEffect: string;
  /** Minutes this condition adds to the *upper* bound of `widenedSegment`. */
  widenMinutes: number;
  widenedSegment: SegmentId;
  truth: TruthKind;
  provenance: Provenance;
  source: Citation;
  checkedAtMs: number | null;
  note: string;
}

/**
 * Traffic on the user's corridor into SEA.
 *
 * Expressed as a *delay range added to the origin fixture*, so it works for a
 * typed origin as well as the four coarse ones, and so the fixture drive range
 * stays visible underneath instead of being silently replaced.
 */
export interface TrafficProjection {
  level: TrafficLevel;
  /** 0–1 congestion, used for both the label and the visual load. */
  congestion: number;
  trend: ConditionTrend;
  /** Minutes added to the origin's fixture drive range. */
  delayMinutes: MinuteRange;
  corridorLabel: string;
  truth: TruthKind;
  provenance: Provenance;
  source: Citation;
  checkedAtMs: number | null;
  note: string;
}

/** The two forces that sit over the airport world, plus their honesty tag. */
export interface TravelConditions {
  weather: WeatherProjection;
  traffic: TrafficProjection;
  /** `SAMPLE DATA` until a structured live source exists. */
  label: string;
  /** Which fixture step produced this, so a refresh can move to the next one. */
  step: number;
}

/** Whether a force is drawn. Visibility only — never whether it is computed. */
export interface ConditionLayers {
  weather: boolean;
  traffic: boolean;
}

/* ------------------------------------------------------------------ refresh */

/**
 * The four cadences the world can be in. `stopped` is a terminal state: the
 * curb-ready window has passed, so there is nothing left to watch.
 */
export type RefreshUrgency = 'hourly' | 'quarter-hourly' | 'five-minute' | 'stopped';

export interface RefreshStatus {
  lastCheckedMs: number | null;
  nextCheckMs: number | null;
  intervalMs: number;
  /** Why this cadence, in the user's words. */
  reason: string;
  urgency: RefreshUrgency;
  /** True while a timer is armed. False when stopped, hidden, or off-view. */
  active: boolean;
  /** True while the document is hidden and the schedule is parked. */
  paused: boolean;
  /** How many automatic re-checks have landed in this session. */
  checks: number;
}
