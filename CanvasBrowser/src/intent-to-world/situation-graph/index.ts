/**
 * The Situation Graph — the shared contract of the Intent-to-World architecture.
 *
 *   Prompt + user/context
 *     → Situation Intelligence Engine   (what is actually going on, what is
 *                                        missing, what is worth asking)
 *     → **Situation Graph**             (this file: typed, evidence-aware)
 *     → Experience Synthesis Engine     (what world that deserves)
 *
 * This module is deliberately inert. It declares types and a handful of pure
 * accessors; it never fetches, never renders, and never decides anything. Both
 * engines depend on it and neither engine depends on the other, which is the
 * whole point: information gathering and presentation cannot leak into one
 * another through a shared implementation.
 *
 * Every node carries the same three honesty fields the rest of CanvasBrowser
 * carries — a truth kind, the authority that stated it, and how fresh that
 * statement is — plus a stated `materialEffect`, because a node that cannot say
 * what it changes has no business shaping a world or costing a person a
 * question.
 */
import type { NewsSituation } from '../../newsIntent';
import type { ArrivalSituation } from '../../pickupIntent';
import type { TruthKind } from '../../types';

export const SITUATION_GRAPH_VERSION = 1;

/**
 * Which shape of world the situation has. This is the *only* routing key the
 * app is allowed to switch on — the regex detectors live inside the Situation
 * Intelligence Engine and are never called from the shell.
 */
export type SituationKind = 'travel-arrival' | 'living-news' | 'literal';

/**
 * What the engine actually *does* with a recognized situation — distinct from
 * the template family it renders. Most modes degrade to an honest literal
 * answer today (`supportedToday = literal`); they are recorded so the Source
 * sheet can name the world a scenario deserves even when this build cannot yet
 * assemble it. This is the generalized "name it honestly, render the honest
 * fallback" rule the pickup→Coordination-Constellation path already follows.
 */
export type ResolutionMode =
  | 'answer'
  | 'triage'
  | 'field'
  | 'place-field'
  | 'journey'
  | 'schedule'
  | 'transact'
  | 'navigate';

/** Who said it. Authority is separate from truth kind on purpose. */
export type SourceAuthority =
  | 'official'
  | 'live-research'
  | 'device'
  | 'fixture'
  | 'connector'
  | 'user'
  | 'none';

/** How old the statement is allowed to be before it stops counting. */
export type Freshness = 'live' | 'minutes' | 'hours' | 'static' | 'stale' | 'unknown';

/** Where and when a node acts. Empty strings are not allowed. */
export interface GraphAnchor {
  spatial: string;
  temporal: string;
}

export type SituationEntityKind = 'flight' | 'airport' | 'person' | 'place' | 'market' | 'topic';

export interface SituationEntity {
  id: string;
  label: string;
  kind: SituationEntityKind;
  truth: TruthKind;
  authority: SourceAuthority;
}

export interface SituationEvent {
  id: string;
  label: string;
  /** Epoch ms when a source stated one; null when nobody has. */
  whenMs: number | null;
  whenLabel: string;
  truth: TruthKind;
  authority: SourceAuthority;
  freshness: Freshness;
}

/** A candidate job, with the evidence that raised it. Never auto-committed. */
export interface JobHypothesisNode {
  id: string;
  label: string;
  /** False when this build cannot actually assemble that world yet. */
  supported: boolean;
  evidence: string[];
  /** 0–1. A prior, not a probability anybody measured. */
  confidence: number;
}

export interface SituationFact {
  id: string;
  label: string;
  statement: string;
  truth: TruthKind;
  authority: SourceAuthority;
  freshness: Freshness;
  anchor: GraphAnchor;
  /** What this fact moves if it changes. */
  materialEffect: string;
  /** True when the person can correct it in one click, without a question. */
  editable: boolean;
}

/** Same vocabulary the visual compiler already speaks. */
export type SituationForceType =
  | 'flight'
  | 'weather'
  | 'traffic'
  | 'airport'
  | 'disruption'
  | 'person'
  | 'market'
  | 'local';

export interface SituationForce {
  id: string;
  type: SituationForceType;
  /** 0–1 — how much this force can actually move the outcome. */
  relevance: number;
  truth: TruthKind;
  authority: SourceAuthority;
  freshness: Freshness;
  anchor: GraphAnchor;
  materialEffect: string;
}

export interface SituationConstraint {
  id: string;
  label: string;
  statement: string;
  truth: TruthKind;
  materialEffect: string;
}

export interface SituationUnknown {
  id: string;
  label: string;
  reason: string;
  truth: TruthKind;
  authority: SourceAuthority;
  freshness: Freshness;
  anchor: GraphAnchor;
  materialEffect: string;
  /** What would resolve it: a provider, an assumption control, or time. */
  resolvedBy: string;
  /** True when nothing can be committed until it is resolved. */
  blocking: boolean;
}

/* ------------------------------------------------------ information needs */

/**
 * Every source the graph is allowed to want something from.
 *
 * `microsoft-graph` is listed here so the *need* can be stated honestly in P0.
 * Stating a need is not the same as having the data: a Graph need can never
 * leave `needs-consent` until a connector exists and the person has said yes.
 */
export type ContextProviderId =
  | 'web-search'
  | 'bing-maps'
  | 'geolocation'
  | 'weather'
  | 'airport'
  | 'local-news'
  | 'market-data'
  | 'microsoft-graph'
  | 'local-fixture'
  | 'user';

export type InformationNeedStatus =
  | 'available'
  | 'needs-consent'
  | 'planned'
  | 'unavailable'
  | 'satisfied';

export type ConsentState = 'not-required' | 'granted' | 'required' | 'declined';

export interface InformationNeed {
  id: string;
  /** What the graph would do with it, in the user's language. */
  purpose: string;
  provider: ContextProviderId;
  /** The specific fields wanted — never "everything from the mailbox". */
  fields: string[];
  /** The permission or scope this would cost, when it costs one. */
  permission: string | null;
  consent: ConsentState;
  /** 0–1 ordering weight for the acquisition plan. */
  priority: number;
  materialEffect: string;
  status: InformationNeedStatus;
  /** Exactly which node of the graph this would change, and how. */
  changesGraphBy: string;
  /** True when the world still resolves honestly without it. */
  optional: boolean;
}

/* ---------------------------------------------------- question economics */

export interface SituationQuestionChoice {
  id: string;
  label: string;
  detail?: string;
}

/**
 * A question the graph is *considering*. Being here is not permission to ask:
 * `QuestionPlan.verdicts` records what survived question economics and why.
 */
/**
 * The decision levers a clarifying question can move.
 *
 * The first four are the pickup world's original levers; the rest generalize
 * them across scenarios so a "which city / which date / which ticker / which
 * unit" question can declare what it changes instead of hoping the right word
 * appears in its prose. Question economics weights these by how decisive they
 * are. This is the shared contract both engines speak.
 */
export type Lever =
  | 'template'
  | 'route'
  | 'envelope'
  | 'handoff'
  | 'outcome-template'
  | 'scope'
  | 'place'
  | 'time-window'
  | 'entity-identity';

export interface SituationQuestion {
  id: string;
  prompt: string;
  whyNeeded: string;
  materialEffect: string;
  expectedInformationGain: number;
  userCost: number;
  choices: SituationQuestionChoice[];
  /** `graph` for a question the engine raised, `blueprint` for a model's. */
  origin: 'graph' | 'blueprint';
  /** The information need this question would satisfy, when it satisfies one. */
  satisfiesNeedId: string | null;
  /**
   * Which levers answering this moves, declared rather than inferred from prose.
   * Optional: the pickup-world questions still let question economics read their
   * effect text, so leaving this unset preserves the original behaviour exactly.
   */
  movesLevers?: Lever[];
}

export interface SituationQuestionVerdict {
  question: SituationQuestion;
  selected: boolean;
  score: number;
  verdict: string;
  levers: string[];
}

export interface QuestionPlan {
  /** The global budget. Never more than two, on any route, ever. */
  budget: number;
  /** Question ids already paid for in this intent session. */
  askedIds: string[];
  /** Full immutable audit records for questions already shown. */
  asked: SituationQuestion[];
  selected: SituationQuestion[];
  verdicts: SituationQuestionVerdict[];
}

/* ------------------------------------------------------------- the graph */

export interface RefreshNeed {
  targetEvent: string;
  cadenceHint: string;
  whyItMatters: string;
}

export interface DecisionGoal {
  id: string;
  statement: string;
  successCriterion: string;
  /** The unknown that currently prevents a commitment, if any. */
  commitBlockedBy: string | null;
}

export interface HandoffNeed {
  id: string;
  label: string;
  action: string;
  url: string | null;
  materialEffect: string;
}

export interface LocalMoment {
  nowMs: number;
  localTime: string;
  timeZone: string | null;
  truth: TruthKind;
  authority: SourceAuthority;
}

export interface LocalPlace {
  /** Stable local id when the engine recognized a known place. */
  id?: string | null;
  label: string;
  truth: TruthKind;
  authority: SourceAuthority;
  /** How the place came to be known. `device` is always coarse. */
  source: 'device' | 'chosen' | 'prompt' | 'inferred';
}

/**
 * The detector readings this graph was built from.
 *
 * They are carried so the shell can keep rendering the surfaces it already
 * has without re-running any detector of its own. The app reads these; it
 * never calls `detectArrivalSituation` or `detectNewsSituation` itself.
 */
export interface SituationReadings {
  arrival: ArrivalSituation | null;
  news: NewsSituation | null;
}

export interface SituationGraph {
  version: number;
  id: string;
  prompt: string;
  kind: SituationKind;
  /**
   * The recognized scenario id from the scenario registry, when one matched
   * (e.g. `airport-pickup`, `local-news-briefing`, `how-to`). Absent on a bare
   * literal fallback. Never a routing key on its own — `kind` still decides
   * which surface renders — but it carries scenario identity, needs and
   * handoffs through a graph whose `kind` had to stay renderable.
   */
  scenarioId?: string;
  /** What the engine does with this situation; see {@link ResolutionMode}. */
  resolutionMode?: ResolutionMode;
  moment: LocalMoment;
  place: LocalPlace;
  entities: SituationEntity[];
  events: SituationEvent[];
  hypotheses: JobHypothesisNode[];
  /** Null until the person says which world they are in. */
  chosenJob: string | null;
  facts: SituationFact[];
  forces: SituationForce[];
  constraints: SituationConstraint[];
  unknowns: SituationUnknown[];
  informationNeeds: InformationNeed[];
  questionPlan: QuestionPlan;
  refreshNeed: RefreshNeed;
  decisionGoal: DecisionGoal;
  handoffNeeds: HandoffNeed[];
  readings: SituationReadings;
}

/* --------------------------------------------------------------- helpers */

export function findNeed(graph: SituationGraph, id: string): InformationNeed | null {
  return graph.informationNeeds.find((need) => need.id === id) ?? null;
}

export function needsByProvider(graph: SituationGraph, provider: ContextProviderId): InformationNeed[] {
  return graph.informationNeeds.filter((need) => need.provider === provider);
}

export function selectedQuestions(graph: SituationGraph): SituationQuestion[] {
  return graph.questionPlan.selected;
}

export function rejectedVerdicts(graph: SituationGraph): SituationQuestionVerdict[] {
  return graph.questionPlan.verdicts.filter((verdict) => !verdict.selected);
}

/** True when any Microsoft Graph need exists but none of it may be used yet. */
export function graphConnectorPending(graph: SituationGraph): boolean {
  const needs = needsByProvider(graph, 'microsoft-graph');
  return needs.length > 0 && needs.every((need) => need.status !== 'satisfied');
}
