/**
 * Tier 1 — the general intention engine.
 *
 * The domain-agnostic thought process. It shapes the intention graph by
 * *resolution mode*, because the mode — not the topic — is what decides what a
 * good assembly looks like: a definition wants a direct answer and a couple of
 * useful next things; a shipment wants the current state and when it changes; a
 * possible emergency wants "do this now"; a purchase wants a shortlist and a
 * pick. Only genuinely forking jobs (a purchase, a place, a trip) branch into
 * competing "why" directions; the rest commit to one and lead with the answer.
 *
 * It is comprehensive but not vacuous: every recognized scenario gets a usable,
 * mode-appropriate graph here, and Tier 2 (`topics.ts`) deepens it where a topic
 * is known. Nothing here is topic-specific.
 */
import type { ResolutionMode } from '../../situation-graph';
import type { IntentClass, ScenarioDefinition } from './types';

/** A candidate "why" behind the ask, with the forces it would assemble. */
export interface IntentionDirection {
  id: string;
  label: string;
  base: number;
  /** Regexes that raise this direction's prior, each with a weight and reason. */
  signals: Array<{ re: RegExp; weight: number; because: string }>;
  /** The forces this direction assembles, most decisive first. */
  forces: string[];
}

export interface IntentionGraph {
  scenarioId: string;
  intentClass: IntentClass;
  resolutionMode: ResolutionMode;
  /** The decision or answer the surface leads with. */
  decision: string;
  /** How the request should frame the assembly for this mode. */
  lead: string;
  /** The single carry-it-out action, or null when the job needs none. */
  actionLabel: string | null;
  directions: IntentionDirection[];
  /** True when the job forks into competing directions worth choosing between. */
  branches: boolean;
  /** Signals that dampen a direction after its base + signals. */
  dampen: Array<{ re: RegExp; direction: string; factor: number }>;
  /** True once a Tier-2 topic has deepened this graph. */
  specialized: boolean;
}

/** What a good assembly looks like for each resolution mode. */
interface ModeProfile {
  forces: string[];
  actionLabel: string | null;
  /** True when the mode forks into competing "why" directions. */
  branches: boolean;
  /** The instruction that frames the request for this mode. */
  lead: string;
}

const MODE_PROFILES: Record<ResolutionMode, ModeProfile> = {
  answer: {
    forces: ['The answer', 'Why it is so / how it works', 'A common mistake to avoid', 'What you will likely want next'],
    actionLabel: null,
    branches: false,
    lead: 'Give the direct answer as the headline, then the few things that actually help next. No links.'
  },
  schedule: {
    forces: ['Right now', 'What could change it', 'Next / when', 'Worth knowing'],
    actionLabel: null,
    branches: false,
    lead: 'Lead with the current status, then what moves it and when. State the as-of time. No links.'
  },
  triage: {
    forces: [
      'Do this now',
      'When it is an emergency — go immediately',
      'The likely explanations',
      'Once the urgency passes'
    ],
    actionLabel: 'Get emergency help',
    branches: false,
    lead: 'Assess urgency safely. Lead with what to do now and the clear escalate-now criteria. No links.'
  },
  transact: {
    forces: ['Top options', 'The key trade-offs', 'Cost to expect', 'What to watch out for', 'Your best pick'],
    actionLabel: 'See the options',
    branches: true,
    lead: 'Lead with a clear recommendation, then the shortlist and the trade-offs behind it. No links.'
  },
  'place-field': {
    forces: ['Best options nearby', 'What sets them apart', 'Cost', 'What to check', 'The pick'],
    actionLabel: 'See the options',
    branches: true,
    lead: 'Lead with the best nearby option, then the alternatives and why. Concrete places. No links.'
  },
  journey: {
    forces: ['The plan', 'When to leave / act', 'What could disrupt it', 'The one thing to prepare'],
    actionLabel: 'Open directions',
    branches: true,
    lead: 'Lead with the plan and when to act, then what could disrupt it. No links.'
  },
  field: {
    forces: ['What changed', 'Why it matters to you', 'What to do about it'],
    actionLabel: null,
    branches: false,
    lead: 'Lead with what changed that reaches this person, then what to do. No links.'
  },
  navigate: {
    forces: ['Where to go', 'What to have ready'],
    actionLabel: 'Open the destination',
    branches: false,
    lead: 'Name the verified destination and what to have ready. Never invent a URL. No links.'
  }
};

/** The forking directions each intent class splits into, with generic priors. */
const BRANCH_ARCHETYPES: Record<IntentClass, IntentionDirection[]> = {
  commercial: [
    {
      id: 'compare',
      label: 'Comparing options',
      base: 0.4,
      signals: [{ re: /\b(best|vs|versus|compare|which|review|top\s?\d)\b/i, weight: 0.4, because: 'you are weighing options' }],
      forces: []
    },
    {
      id: 'ready',
      label: 'Ready to choose',
      base: 0.3,
      signals: [{ re: /\b(buy|order|purchase|get|deal|cheapest|price of)\b/i, weight: 0.5, because: 'you sound ready to buy' }],
      forces: []
    },
    {
      id: 'explore',
      label: 'Still exploring',
      base: 0.28,
      signals: [{ re: /\b(ideas|options|kinds? of|types? of|inspiration|examples)\b/i, weight: 0.4, because: 'you are exploring the space' }],
      forces: []
    }
  ],
  local: [
    {
      id: 'going',
      label: 'Going there',
      base: 0.38,
      signals: [{ re: /\b(directions?|how (?:do i|to) get|route|drive|near me now|open now)\b/i, weight: 0.4, because: 'you are heading there' }],
      forces: []
    },
    {
      id: 'choosing',
      label: 'Choosing where',
      base: 0.34,
      signals: [{ re: /\b(best|which|compare|recommend|top\s?\d)\b/i, weight: 0.4, because: 'you are choosing between places' }],
      forces: []
    },
    {
      id: 'checking',
      label: 'Checking before going',
      base: 0.28,
      signals: [{ re: /\b(hours|open|closed|menu|price|reservation|wait)\b/i, weight: 0.4, because: 'you are checking details first' }],
      forces: []
    }
  ],
  transactional: [
    {
      id: 'do-now',
      label: 'Complete it now',
      base: 0.55,
      signals: [{ re: /\b(now|today|checkout|pay|submit|apply|book)\b/i, weight: 0.4, because: 'you want to complete it now' }],
      forces: []
    },
    {
      id: 'prepare',
      label: 'Getting ready to',
      base: 0.35,
      signals: [{ re: /\b(before|prepare|what (?:do i )?need|requirements|documents)\b/i, weight: 0.4, because: 'you are preparing first' }],
      forces: []
    }
  ],
  informational: [
    { id: 'understand', label: 'Understand it', base: 0.4, signals: [], forces: [] },
    { id: 'apply', label: 'Do something with it', base: 0.3, signals: [], forces: [] },
    { id: 'decide', label: 'Decide something', base: 0.28, signals: [], forces: [] }
  ],
  navigational: [{ id: 'reach', label: 'Reach the destination', base: 1, signals: [], forces: [] }]
};

/**
 * Build the general intention graph for a scenario, shaped by its resolution
 * mode. Branching modes fork into the intent-class archetypes (each assembling
 * the mode's forces); the rest commit to a single direction and lead with the
 * answer.
 */
export function buildGeneralIntention(scenario: ScenarioDefinition): IntentionGraph {
  const profile = MODE_PROFILES[scenario.resolutionMode] ?? MODE_PROFILES.answer;

  const directions: IntentionDirection[] = profile.branches
    ? BRANCH_ARCHETYPES[scenario.intent].map((direction) => ({ ...direction, forces: profile.forces }))
    : [{ id: 'primary', label: scenario.label, base: 1, signals: [], forces: profile.forces }];

  return {
    scenarioId: scenario.id,
    intentClass: scenario.intent,
    resolutionMode: scenario.resolutionMode,
    decision: scenario.decisionGoal.statement,
    lead: profile.lead,
    actionLabel: profile.actionLabel,
    directions,
    branches: profile.branches,
    dampen: [],
    specialized: false
  };
}
