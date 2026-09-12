/**
 * The Scenario Registry contract.
 *
 * A scenario is one recognizable browser job — "define a word", "convert
 * units", "look up a package", "compare products". Each declares, in the user's
 * language: what it is, which real providers it would consult, what decision it
 * is trying to close, which (at most two) questions could be worth a person's
 * attention, and — honestly — which *world* it deserves versus what this build
 * can render today.
 *
 * The registry is the "post-trained" recognition layer: it generalizes the
 * engine from three hand-built situations to the top browser scenarios, grounded
 * in the evidence taxonomy (see session artifact `scenario-taxonomy.v2.md`).
 * Nothing here renders. A scenario produces a `SituationGraph`; the Experience
 * Synthesis Engine decides the surface, and unsupported worlds degrade to the
 * honest literal answer — the same rule the pickup→Coordination-Constellation
 * path already follows.
 */
import type {
  ContextProviderId,
  HandoffNeed,
  Lever,
  ResolutionMode
} from '../../situation-graph';
import type { ProviderCapabilities } from '../contextProviders';

/** The five search-intent classes the taxonomy is grounded in. */
export type IntentClass =
  | 'informational'
  | 'navigational'
  | 'transactional'
  | 'commercial'
  | 'local';

/** The world a scenario *deserves* (may exceed what this build renders). */
export type DeservedFamily =
  | 'journey-world'
  | 'signal-field'
  | 'time-terrain'
  | 'place-field'
  | 'literal'
  | 'navigation';

/** How much real browser demand backs this scenario; see the taxonomy. */
export type DemandTier = 'A' | 'B' | 'C';

/** A provider need a scenario would open, before consent/availability is folded in. */
export interface ScenarioNeedSpec {
  id: string;
  purpose: string;
  provider: ContextProviderId;
  fields: string[];
  permission?: string | null;
  priority: number;
  materialEffect: string;
  changesGraphBy: string;
  optional?: boolean;
}

/** A clarifying-question candidate a scenario may raise; economics still decides. */
export interface ScenarioQuestionSpec {
  id: string;
  prompt: string;
  whyNeeded: string;
  materialEffect: string;
  expectedInformationGain: number;
  userCost: number;
  choices: Array<{ id: string; label: string; detail?: string }>;
  /** Declared levers — no longer inferred from prose. */
  movesLevers: Lever[];
  satisfiesNeedId?: string | null;
}

export interface ScenarioBuildContext {
  nowMs: number;
  capabilities: ProviderCapabilities;
  placeLabel?: string | null;
}

export interface ScenarioDefinition {
  id: string;
  label: string;
  intent: IntentClass;
  resolutionMode: ResolutionMode;
  deservedFamily: DeservedFamily;
  /** What this build actually renders today for this scenario. */
  supportedToday: 'literal';
  demandTier: DemandTier;
  /** One line naming the world it deserves, honest about the current render. */
  deservedWorld: string;
  /**
   * Detector confidence in [0, 1]. 0 means "not this scenario". Pure and
   * deterministic — regex/keyword only, no clock, no network.
   */
  detect(prompt: string): number;
  /** The providers this scenario would consult. `web-search` is always added. */
  needs?(ctx: ScenarioBuildContext): ScenarioNeedSpec[];
  /** At most two of these can ever survive question economics. */
  questions?(prompt: string, ctx: ScenarioBuildContext): ScenarioQuestionSpec[];
  decisionGoal: { statement: string; successCriterion: string };
  handoffs?(prompt: string): HandoffNeed[];
  refresh?: { targetEvent: string; cadenceHint: string; whyItMatters: string };
}

export interface ScenarioMatch {
  scenario: ScenarioDefinition;
  confidence: number;
}
