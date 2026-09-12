/**
 * Core 1 — the **Situation Intelligence Engine**.
 *
 * It answers four questions, in this order, and nothing else:
 *
 *   1. what is actually going on (the latent job behind the words);
 *   2. what information the world would need to be honest about it;
 *   3. which of that can be inferred, and which must come from a provider;
 *   4. which — at most two — of the remaining gaps are worth a human's
 *      attention, and which are not, with the argument recorded either way.
 *
 * It owns the detectors (`detectArrivalSituation`, `detectNewsSituation`), the
 * information needs, the acquisition plan and question economics. It owns no
 * pixels: it never names a template family, never chooses a geometry, and never
 * imports the compiler. Everything it produces is a `SituationGraph`.
 *
 * The Microsoft Graph rule is absolute here: a Graph need may be *stated* — with
 * the exact fields, the exact scope and the exact reason it would change the
 * graph — but it can never be planned as executable, and never treated as
 * satisfied, unless a connector is configured and consent has been given.
 */
import {
  MICROSOFT_GRAPH_PROVIDER,
  microsoftGraphProvider,
  providerAvailable,
  providerDescriptor,
  type ContextProviderDescriptor,
  type ContextResult,
  type ProviderCapabilities
} from './contextProviders';
import { detectNewsSituation, type NewsHorizon, type NewsScope, type NewsSituation } from '../../newsIntent';
import {
  detectArrivalSituation,
  jobHypotheses,
  parseFlightAnswer,
  parsePartyCount,
  type ArrivalSituation
} from '../../pickupIntent';
import { ORIGIN_OPTIONS } from '../../pickupFixtures';
import {
  SCENARIOS,
  buildScenarioGraph,
  classifyScenario
} from './scenarios';
import {
  selectQuestions,
  MAX_SELECTED_QUESTIONS,
  type QuestionCandidate
} from './questionEconomics';
import {
  SITUATION_GRAPH_VERSION,
  type ContextProviderId,
  type Freshness,
  type InformationNeed,
  type JobHypothesisNode,
  type LocalPlace,
  type QuestionPlan,
  type SituationFact,
  type SituationGraph,
  type SituationKind,
  type SituationQuestion,
  type SituationQuestionVerdict,
  type SourceAuthority
} from '../situation-graph';
import type { FlightReading } from '../../types';

/* --------------------------------------------------------------- context */

export interface DiscoveryContext {
  nowMs: number;
  capabilities: ProviderCapabilities;
  /** Set when the person has already chosen a job on a previous pass. */
  chosenJob?: string | null;
  hasOrigin?: boolean;
  originLabel?: string | null;
  /** The centre the Living News world currently stands on. */
  placeLabel?: string | null;
  placeSource?: LocalPlace['source'];
  checkedBag?: boolean;
  internationalArrival?: boolean;
  /** Questions already paid for in this intent session. */
  askedQuestionIds?: string[];
  /** Full audit records for questions already shown. */
  askedQuestions?: SituationQuestion[];
  /** The latest provider reading, used to keep graph and local planners aligned. */
  flightReading?: FlightReading | null;
}

/* ------------------------------------------------------------ small utils */

const AUTHORITY_RANK: Record<SourceAuthority, number> = {
  user: 6,
  official: 5,
  'live-research': 4,
  connector: 4,
  device: 3,
  fixture: 2,
  none: 0
};

const FRESHNESS_RANK: Record<Freshness, number> = {
  live: 4,
  minutes: 3,
  hours: 2,
  static: 1,
  stale: 0,
  unknown: 0
};

let graphSeq = 0;

function graphId(kind: SituationKind, nowMs: number): string {
  graphSeq += 1;
  return `${kind}-${nowMs.toString(36)}-${graphSeq}`;
}

function localTimeLabel(nowMs: number): string {
  return new Date(nowMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function timeZoneLabel(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/**
 * The status a need has *before* anything is fetched.
 *
 * A provider that needs consent and does not have it is `needs-consent`, never
 * `planned` — the difference is the whole point of the field.
 */
function needStatus(
  provider: ContextProviderId,
  capabilities: ProviderCapabilities,
  optional: boolean
): InformationNeed['status'] {
  if (providerAvailable(provider, capabilities)) return 'available';
  const descriptor = providerDescriptor(provider);
  if (descriptor.requiresConsent) return 'needs-consent';
  return optional ? 'planned' : 'unavailable';
}

function consentFor(
  provider: ContextProviderId,
  capabilities: ProviderCapabilities
): InformationNeed['consent'] {
  const descriptor = providerDescriptor(provider);
  if (!descriptor.requiresConsent) return 'not-required';
  return providerAvailable(provider, capabilities) ? 'granted' : 'required';
}

function need(
  spec: Omit<InformationNeed, 'status' | 'consent'> & {
    status?: InformationNeed['status'];
    consent?: InformationNeed['consent'];
  },
  capabilities: ProviderCapabilities
): InformationNeed {
  return {
    ...spec,
    consent: spec.consent ?? consentFor(spec.provider, capabilities),
    status: spec.status ?? needStatus(spec.provider, capabilities, spec.optional)
  };
}

/* ------------------------------------------------- question economics */

/**
 * Graph-native question selection.
 *
 * The ranking rules live in `selectQuestions` — a question must state what it
 * materially changes, that change must move the template, the route, the
 * envelope or the handoff, and it must buy more than it costs. This wrapper
 * keeps the graph's own metadata (`origin`, `satisfiesNeedId`) attached to the
 * verdicts, and enforces the same hard ceiling of two.
 */
export function planQuestions(
  candidates: SituationQuestion[],
  budget = MAX_SELECTED_QUESTIONS,
  askedQuestionIds: string[] = [],
  askedQuestions: SituationQuestion[] = []
): QuestionPlan {
  const remaining = Math.max(0, budget - new Set(askedQuestionIds).size);
  const result = selectQuestions(
    candidates.filter((question) => !askedQuestionIds.includes(question.id)),
    remaining
  );
  const byId = new Map(candidates.map((question) => [question.id, question]));
  const verdicts: SituationQuestionVerdict[] = result.verdicts.map((verdict) => ({
    question: byId.get(verdict.question.id) ?? {
      ...verdict.question,
      origin: 'blueprint' as const,
      satisfiesNeedId: null
    },
    selected: verdict.selected,
    score: verdict.score,
    verdict: verdict.verdict,
    levers: verdict.levers
  }));
  const selected = verdicts.filter((verdict) => verdict.selected).map((verdict) => verdict.question);
  return {
    budget,
    askedIds: [...new Set(askedQuestionIds)],
    asked: askedQuestions.filter(
      (question, index, all) => all.findIndex((entry) => entry.id === question.id) === index
    ),
    selected,
    verdicts
  };
}

/**
 * A presentation blueprint's questions, re-expressed as ordinary candidates.
 *
 * They arrive with no privileges: same fields, same economics, same budget.
 */
export function blueprintQuestionsAsCandidates(questions: QuestionCandidate[]): SituationQuestion[] {
  return questions.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    whyNeeded: question.whyNeeded,
    materialEffect: question.materialEffect,
    expectedInformationGain: question.expectedInformationGain,
    userCost: question.userCost,
    choices: question.choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      ...(choice.detail ? { detail: choice.detail } : {})
    })),
    origin: 'blueprint' as const,
    satisfiesNeedId: null
  }));
}

/* ---------------------------------------------------- travel-arrival graph */

const JOB_LABELS: Record<string, string> = {
  track: 'Tracking the arrival',
  connect: 'Making a connection',
  pickup: 'Picking someone up'
};

function travelHypotheses(prompt: string): JobHypothesisNode[] {
  const meeting = /\b(pick(?:ing)?\s?up|meet(?:ing)?|collect|curb|arrivals)\b/i.test(prompt);
  const connection = /\b(connect\w*|layover|onward|transfer)\b/i.test(prompt);
  return jobHypotheses().map((hypothesis) => {
    const evidence: string[] = ['an inbound flight was named'];
    if (hypothesis.id === 'pickup' && meeting) evidence.push('the words describe meeting someone');
    if (hypothesis.id === 'connect' && connection) evidence.push('an onward journey is mentioned');
    if (hypothesis.id === 'track') evidence.push('the question asks about status');
    const confidence =
      hypothesis.id === 'pickup' ? (meeting ? 0.7 : 0.45) : hypothesis.id === 'connect' ? (connection ? 0.5 : 0.1) : 0.4;
    return {
      id: hypothesis.id,
      label: hypothesis.label,
      supported: hypothesis.supported,
      evidence,
      confidence
    };
  });
}

function travelNeeds(
  context: DiscoveryContext,
  chosenJob: string | null,
  hasOrigin: boolean
): InformationNeed[] {
  const caps = context.capabilities;
  const needs: InformationNeed[] = [
    need(
      {
        id: 'flight-status',
        purpose: 'Whether the aircraft is actually on the ground, and when a source says it landed.',
        provider: 'web-search',
        fields: ['actual landing time', 'flight phase', 'scheduled arrival', 'estimated arrival'],
        permission: null,
        priority: 0.98,
        materialEffect: 'Decides whether the decision envelope can commit at all, and sets the refresh cadence.',
        changesGraphBy: 'Resolves the `actual-landing` unknown and re-anchors every arrival-processing segment.',
        optional: false,
        status: context.flightReading?.retrievedAt ? 'satisfied' : undefined
      },
      caps
    ),
    need(
      {
        id: 'travel-job',
        purpose: 'Which of the three jobs this arrival actually is.',
        provider: 'user',
        fields: ['track | connect | pickup'],
        permission: null,
        priority: 0.95,
        materialEffect: 'Chooses the template: a pickup builds a route world, tracking stays a reading.',
        changesGraphBy: 'Sets `chosenJob`, which re-derives every other need and the whole question plan.',
        optional: false,
        status: chosenJob ? 'satisfied' : 'planned'
      },
      caps
    ),
    need(
      {
        id: 'origin-location',
        purpose: 'Where the drive starts, so the route and the leave-by exist.',
        provider: 'geolocation',
        fields: ['coarse area'],
        permission: 'browser geolocation',
        priority: 0.88,
        materialEffect: 'Draws the route, applies traffic to it, and sets the leave-by time.',
        changesGraphBy: 'Fills the `origin` fact and unblocks the `leave-by` decision goal.',
        optional: false,
        status: hasOrigin ? 'satisfied' : undefined
      },
      caps
    ),
    need(
      {
        id: 'route-traffic',
        purpose: 'The road geometry into SEA and what the corridor is doing right now.',
        provider: 'bing-maps',
        fields: ['route geometry', 'traffic layer', 'corridor delay'],
        permission: null,
        priority: 0.8,
        materialEffect: 'Widens or narrows the drive range, and therefore the leave-by window.',
        changesGraphBy: 'Updates the `traffic` force and the drive range inside the travel block.',
        optional: false
      },
      caps
    ),
    need(
      {
        id: 'arrival-weather',
        purpose: 'Weather over the airport across the arrival-processing horizon.',
        provider: 'weather',
        fields: ['condition', 'wind', 'precipitation', 'visibility effect'],
        permission: null,
        priority: 0.6,
        materialEffect: 'Widens exactly one stated segment by a stated number of minutes.',
        changesGraphBy: 'Updates the `weather` force and the upper bound of the curb segment.',
        optional: false
      },
      caps
    ),
    need(
      {
        id: 'airport-conditions',
        purpose: 'Curb rules, cell-phone-lot policy and anything published about the arrivals drive.',
        provider: 'airport',
        fields: ['curb guidance', 'cell phone lot status', 'construction notices'],
        permission: null,
        priority: 0.5,
        materialEffect: 'Moves where the handoff points and how the curb window is described.',
        changesGraphBy: 'Updates the `airport` force and the handoff needs.',
        optional: false
      },
      caps
    ),
    /*
     * The Microsoft Graph needs.
     *
     * Stated precisely, scoped minimally, and never silently used: each one
     * stays `needs-consent` until a connector exists and the person says yes.
     */
    need(
      {
        id: 'graph-travel-itinerary',
        purpose: 'The calendar event or travel itinerary that already states this arrival.',
        provider: 'microsoft-graph',
        fields: ['calendar event', 'travel itinerary', 'flight number', 'scheduled arrival'],
        permission: 'Calendars.Read',
        priority: 0.75,
        materialEffect: 'Would replace a guessed flight and a guessed arrival day with a stated one.',
        changesGraphBy:
          'Would promote the flight entity from inferred to observed and remove the "which flight" ambiguity entirely.',
        optional: true
      },
      caps
    ),
    need(
      {
        id: 'graph-flight-confirmation',
        purpose: 'The airline confirmation email for this trip.',
        provider: 'microsoft-graph',
        fields: ['flight confirmation message', 'record locator', 'scheduled arrival', 'terminal'],
        permission: 'Mail.ReadBasic',
        priority: 0.65,
        materialEffect: 'Would state the flight and terminal without a web search or a question.',
        changesGraphBy:
          'Would satisfy `flight-status` from a first-party record instead of prose, and set the terminal on the curb handoff.',
        optional: true
      },
      caps
    ),
    need(
      {
        id: 'graph-traveler-contact',
        purpose: 'Who is being met, so the handoff can name them.',
        provider: 'microsoft-graph',
        fields: ['contact display name', 'preferred contact method'],
        permission: 'People.Read',
        priority: 0.45,
        materialEffect: 'Would turn "text them when you leave" into "text Mei when you leave".',
        changesGraphBy: 'Would add a `person` entity and re-point the curb handoff at them.',
        optional: true
      },
      caps
    ),
    need(
      {
        id: 'graph-shared-plan',
        purpose: 'Whether someone else already took this pickup.',
        provider: 'microsoft-graph',
        fields: ['shared calendar event', 'organiser', 'attendee status'],
        permission: 'Calendars.Read (shared)',
        priority: 0.3,
        materialEffect: 'Would stop the world planning a drive that another person has already committed to.',
        changesGraphBy: 'Would add a constraint that suppresses the leave-by commitment entirely.',
        optional: true
      },
      caps
    )
  ];

  if (chosenJob !== null && chosenJob !== 'pickup') {
    // Tracking or connecting has no drive, so the route needs stop being needs.
    for (const entry of needs) {
      if (entry.id === 'origin-location' || entry.id === 'route-traffic') {
        entry.status = 'planned';
        entry.priority = 0.2;
        entry.optional = true;
      }
    }
  }

  return needs;
}

function travelQuestionCandidates(
  chosenJob: string | null,
  hasOrigin: boolean,
  canAutoLocate: boolean
): SituationQuestion[] {
  const candidates: SituationQuestion[] = [];

  if (!chosenJob) {
    candidates.push({
      id: 'travel-job',
      prompt: 'Are you tracking the arrival, making a connection, or picking someone up?',
      whyNeeded: 'Each answer builds a different world, and only you know which one you are in.',
      materialEffect:
        'Chooses the template: a pickup builds a route world, tracking stays a reading, a connection is a different geometry entirely.',
      expectedInformationGain: 0.92,
      userCost: 0.12,
      choices: [
        { id: 'track', label: JOB_LABELS.track },
        { id: 'connect', label: JOB_LABELS.connect },
        { id: 'pickup', label: JOB_LABELS.pickup }
      ],
      origin: 'graph',
      satisfiesNeedId: 'travel-job'
    });
  }

  if (chosenJob === 'pickup' && !hasOrigin && !canAutoLocate) {
    candidates.push({
      id: 'travel-origin',
      prompt: 'Where are you starting from?',
      whyNeeded: 'Needed to build your route, traffic exposure and staging window. Coordinates stay local.',
      materialEffect:
        'Draws the route, applies traffic to it, and sets the leave-by time in the decision envelope.',
      expectedInformationGain: 0.88,
      userCost: 0.22,
      choices: [
        { id: 'use-location', label: 'Use my location' },
        { id: 'choose-place', label: 'Choose a place' }
      ],
      origin: 'graph',
      satisfiesNeedId: 'origin-location'
    });
  }

  /*
   * Considered, and argued down rather than silently dropped.
   *
   * Party size only moves a few minutes of curb assembly — no template, no
   * route, no envelope, no handoff — so question economics rejects it and the
   * Source sheet shows the argument. It is never asked, and it is only ever
   * *heard* when the person says it themselves.
   */
  candidates.push({
    id: 'passenger-count',
    prompt: 'How many people are you picking up?',
    whyNeeded: 'It would refine the assembly tail at the curb.',
    materialEffect: 'Adds roughly four minutes of assembly time per extra passenger.',
    expectedInformationGain: 0.18,
    userCost: 0.3,
    choices: [
      { id: '1', label: 'One' },
      { id: '2', label: 'Two' },
      { id: '3', label: 'Three or more' }
    ],
    origin: 'graph',
    satisfiesNeedId: null
  });

  return candidates;
}

function travelGraph(prompt: string, arrival: ArrivalSituation, context: DiscoveryContext): SituationGraph {
  const chosenJob = context.chosenJob ?? null;
  const promptOrigin =
    ORIGIN_OPTIONS.find((option) => {
      const names =
        option.id === 'downtown-seattle'
          ? ['downtown seattle', 'seattle']
          : [option.label.toLowerCase()];
      return names.some((name) =>
        new RegExp(`\\b(?:at|from|in|near)\\s+${name.replace(/\s+/g, '\\s+')}\\b`, 'i').test(prompt)
      );
    }) ?? null;
  const hasOrigin = (context.hasOrigin ?? false) || promptOrigin !== null;
  const international = context.internationalArrival ?? arrival.international;
  const checkedBag = context.checkedBag ?? true;
  const party = parsePartyCount(prompt);
  const reading = context.flightReading ?? null;
  const observedLandingMs =
    reading?.status === 'landed' || reading?.phase === 'at-gate'
      ? (reading.actualLandingMs ?? reading.landingMs)
      : null;

  const facts: SituationFact[] = [
    {
      id: 'flight-identity',
      label: 'Inbound flight',
      statement: arrival.flightLabel,
      truth: 'inferred',
      authority: 'none',
      freshness: 'unknown',
      anchor: { spatial: 'airport', temporal: 'arrival' },
      materialEffect: 'Names the aircraft every arrival reading is about.',
      editable: false
    },
    {
      id: 'checked-bag',
      label: 'Checked bag',
      statement: checkedBag
        ? 'A checked bag is assumed, which adds a bag-claim segment.'
        : 'No checked bag, so the bag-claim segment is removed.',
      truth: 'inferred',
      authority: 'none',
      freshness: 'static',
      anchor: { spatial: 'baggage hall', temporal: 'after landing' },
      materialEffect: 'Moves curb-ready by 12–28 minutes.',
      // The rule this whole architecture exists to protect: a correctable
      // assumption is never a question.
      editable: true
    },
    {
      id: 'arrival-kind',
      label: international ? 'International arrival' : 'Domestic arrival',
      statement: international
        ? 'An international arrival clears customs, which adds a CBP segment.'
        : 'A domestic arrival skips customs entirely.',
      truth: 'inferred',
      authority: 'none',
      freshness: 'static',
      anchor: { spatial: 'arrivals hall', temporal: 'after landing' },
      materialEffect: 'Adds or removes the CBP segment.',
      editable: true
    },
    {
      id: 'party-size',
      label: 'Party size',
      statement:
        party === null
          ? 'Held at one, because nobody said otherwise and it is not worth a question.'
          : `Heard as ${party} from the words themselves — not asked for.`,
      truth: 'inferred',
      authority: party === null ? 'none' : 'user',
      freshness: 'static',
      anchor: { spatial: 'curb', temporal: 'pickup' },
      materialEffect: 'A few minutes of curb assembly, and nothing else.',
      editable: true
    },
    ...(reading
      ? [
          {
            id: 'flight-status',
            label: 'Flight status',
            statement: reading.note,
            truth: reading.truth,
            authority: 'live-research' as const,
            freshness: reading.retrievedAt ? ('minutes' as const) : ('unknown' as const),
            anchor: { spatial: 'airport', temporal: 'arrival' },
            materialEffect: 'Anchors the arrival-processing horizon and refresh cadence.',
            editable: false
          }
        ]
      : [])
  ];

  return {
    version: SITUATION_GRAPH_VERSION,
    id: graphId('travel-arrival', context.nowMs),
    prompt,
    kind: 'travel-arrival',
    scenarioId: 'airport-pickup',
    resolutionMode: 'journey',
    moment: {
      nowMs: context.nowMs,
      localTime: localTimeLabel(context.nowMs),
      timeZone: timeZoneLabel(),
      truth: 'observed',
      authority: 'device'
    },
    place: {
      id: context.hasOrigin ? null : promptOrigin?.id ?? null,
      label: context.originLabel ?? promptOrigin?.label ?? 'Seattle–Tacoma International Airport',
      truth: hasOrigin ? 'observed' : 'inferred',
      authority: context.hasOrigin ? 'device' : promptOrigin ? 'user' : 'none',
      source: context.hasOrigin ? (context.placeSource ?? 'chosen') : promptOrigin ? 'prompt' : 'inferred'
    },
    entities: [
      { id: 'flight', label: arrival.flightLabel, kind: 'flight', truth: 'inferred', authority: 'none' },
      { id: 'sea', label: 'SEA — Seattle–Tacoma International', kind: 'airport', truth: 'observed', authority: 'official' },
      { id: 'traveler', label: 'The person being met', kind: 'person', truth: 'unknown', authority: 'none' }
    ],
    events: [
      {
        id: 'landing',
        label: 'Wheels-down',
        whenMs: observedLandingMs,
        whenLabel:
          observedLandingMs === null
            ? 'no source has stated an actual landing yet'
            : reading?.landingLabel ?? new Date(observedLandingMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        truth: observedLandingMs === null ? 'unknown' : 'observed',
        authority: observedLandingMs === null ? 'none' : 'live-research',
        freshness: reading?.retrievedAt ? 'minutes' : 'unknown'
      }
    ],
    hypotheses: travelHypotheses(prompt),
    chosenJob,
    facts,
    forces: [
      {
        id: 'flight',
        type: 'flight',
        relevance: 1,
        truth: reading?.truth ?? 'unknown',
        authority: 'live-research',
        freshness: reading?.retrievedAt ? 'minutes' : 'unknown',
        anchor: { spatial: 'airport', temporal: 'arrival' },
        materialEffect: 'Anchors the entire arrival-processing horizon.'
      },
      {
        id: 'traffic',
        type: 'traffic',
        relevance: 0.85,
        truth: 'modeled',
        authority: 'fixture',
        freshness: 'minutes',
        anchor: { spatial: 'route', temporal: 'leave-by window' },
        materialEffect: 'Adds minutes to the drive range and moves the leave-by.'
      },
      {
        id: 'weather',
        type: 'weather',
        relevance: 0.6,
        truth: 'modeled',
        authority: 'fixture',
        freshness: 'hours',
        anchor: { spatial: 'airport', temporal: 'arrival window' },
        materialEffect: 'Widens one stated segment by a stated number of minutes.'
      },
      {
        id: 'airport',
        type: 'airport',
        relevance: 0.55,
        truth: 'observed',
        authority: 'official',
        freshness: 'static',
        anchor: { spatial: 'curb', temporal: 'now' },
        materialEffect: 'Sets where the curb handoff points.'
      },
      {
        id: 'disruption',
        type: 'disruption',
        relevance: 0.4,
        truth: 'modeled',
        authority: 'fixture',
        freshness: 'minutes',
        anchor: { spatial: 'route', temporal: 'now' },
        materialEffect: 'Blocks a corridor segment and pushes the leave-by earlier.'
      }
    ],
    constraints: [
      {
        id: 'commit-on-actual-only',
        label: 'Only an actual landing can commit',
        statement:
          'A scheduled or estimated arrival can move the horizon and the refresh cadence, never the commitment.',
        truth: 'observed',
        materialEffect: 'Withholds the decision envelope until a source states wheels-down.'
      },
      {
        id: 'coarse-location-only',
        label: 'Coarse location only',
        statement: 'A granted fix is coarsened on this device, never stored, and never sent to a model.',
        truth: 'observed',
        materialEffect: 'Limits what the route may be built from, and what may leave the device.'
      }
    ],
    unknowns: [
      ...(observedLandingMs === null
        ? [{
        id: 'actual-landing',
        label: 'Actual landing time',
        reason: 'No source has stated an actual landing time yet.',
        truth: 'unknown',
        authority: 'none',
        freshness: 'unknown',
        anchor: { spatial: 'airport', temporal: 'arrival' },
        materialEffect: 'Without it there is no commitment, only a horizon.',
        resolvedBy: 'a flight-status page that publishes wheels-down',
        blocking: true
      } as const]
        : []),
      {
        id: 'checked-bag',
        label: 'Checked bag',
        reason: 'Nobody said whether there is a checked bag, and it moves curb-ready by 12–28 minutes.',
        truth: 'inferred',
        authority: 'none',
        freshness: 'static',
        anchor: { spatial: 'baggage hall', temporal: 'after landing' },
        materialEffect: 'Adds or removes the bag-claim segment.',
        resolvedBy: 'the assumption control on the situation line — one click, no question',
        blocking: false
      },
      {
        id: 'passenger-count',
        label: 'Party size',
        reason: 'Party size is unknown; it changes the curb assembly tail by a few minutes.',
        truth: 'inferred',
        authority: 'none',
        freshness: 'static',
        anchor: { spatial: 'curb', temporal: 'pickup' },
        materialEffect: 'A few minutes of assembly, which moves no template, route, envelope or handoff.',
        resolvedBy: 'inference, held at one, correctable in a follow-up phrase — not worth a question',
        blocking: false
      }
    ],
    informationNeeds: travelNeeds(context, chosenJob, hasOrigin),
    questionPlan: planQuestions(
      travelQuestionCandidates(chosenJob, hasOrigin, context.capabilities.locationConsent),
      MAX_SELECTED_QUESTIONS,
      context.askedQuestionIds,
      context.askedQuestions
    ),
    refreshNeed: {
      targetEvent: 'the curb-ready text',
      cadenceHint: 'hourly far out, every 15 minutes near arrival, every 5 minutes on the ground',
      whyItMatters: 'The only thing worth re-checking is what could still move the leave-by.'
    },
    decisionGoal: {
      id: 'leave-by',
      statement: 'Know when to leave so the curb is live when you get there.',
      successCriterion: 'A stated leave-by window built on an actual landing time.',
      commitBlockedBy: 'actual-landing'
    },
    handoffNeeds: [
      {
        id: 'cell-lot-directions',
        label: 'Directions to the SEA Cell Phone Lot',
        action: 'Opens a maps route in a new tab, only when you click it.',
        url: 'https://www.google.com/maps/dir/?api=1&destination=SEA+Cell+Phone+Lot+SeaTac+WA',
        materialEffect: 'Carries the plan out of this product and into the drive.'
      },
      {
        id: 'sea-pickup-rules',
        label: 'Dropping off / picking up at SEA',
        action: 'The official airport page for curb rules.',
        url: 'https://www.portseattle.org/sea/dropping-off-picking-up',
        materialEffect: 'States the curb rules this world assumes.'
      }
    ],
    readings: { arrival, news: null }
  };
}

/* ------------------------------------------------------ living-news graph */

function newsNeeds(context: DiscoveryContext, news: NewsSituation): InformationNeed[] {
  const caps = context.capabilities;
  const placeKnown = (context.placeSource ?? 'inferred') !== 'inferred';
  return [
    need(
      {
        id: 'local-signals',
        purpose: 'What changed near this place that could actually reach the day.',
        provider: 'local-news',
        fields: ['local incidents', 'civic changes', 'closures'],
        permission: null,
        priority: 0.9,
        materialEffect: 'Places signals in the field by distance and impact.',
        changesGraphBy: 'Fills the `local` force with claim-level signals.',
        optional: false
      },
      caps
    ),
    need(
      {
        id: 'market-moves',
        purpose: 'Index and watchlist moves that touch the person’s work.',
        provider: 'market-data',
        fields: ['index moves', 'watchlist moves', 'scheduled releases'],
        permission: null,
        priority: 0.7,
        materialEffect: 'Draws or removes the market axis beside the field.',
        changesGraphBy: 'Fills the `market` force and the axis entries.',
        optional: news.scope === 'near-me'
      },
      caps
    ),
    need(
      {
        id: 'local-weather',
        purpose: 'Weather and air quality where the person is.',
        provider: 'weather',
        fields: ['condition', 'air quality', 'alerts'],
        permission: null,
        priority: 0.65,
        materialEffect: 'Adds a weather signal and can change what the consequences say.',
        changesGraphBy: 'Fills the `weather` force with a placed signal.',
        optional: false
      },
      caps
    ),
    need(
      {
        id: 'mobility',
        purpose: 'Roads, transit and ferries on the routes this person uses.',
        provider: 'bing-maps',
        fields: ['incidents', 'closures', 'transit alerts'],
        permission: null,
        priority: 0.6,
        materialEffect: 'Adds mobility signals and the commute consequence line.',
        changesGraphBy: 'Fills the `traffic` force and the commute focus.',
        optional: false
      },
      caps
    ),
    need(
      {
        id: 'news-place',
        purpose: 'Where the centre of the field actually is.',
        provider: 'geolocation',
        fields: ['coarse area'],
        permission: 'browser geolocation',
        priority: 0.8,
        materialEffect: 'Moves the centre of the field, and therefore what counts as near.',
        changesGraphBy: 'Promotes the `place` node from inferred to a coarse device category.',
        optional: false,
        status: placeKnown ? 'satisfied' : undefined
      },
      caps
    ),
    need(
      {
        id: 'live-research',
        purpose: 'A claim-level source for anything the field asserts.',
        provider: 'web-search',
        fields: ['headline', 'publisher', 'timestamp'],
        permission: null,
        priority: 0.55,
        materialEffect: 'Promotes a SAMPLE signal to an observed one, or refuses to.',
        changesGraphBy: 'Raises the authority of a signal from fixture to live-research.',
        optional: false
      },
      caps
    ),
    /* Optional, consent-gated, and stated rather than used. */
    need(
      {
        id: 'graph-day-schedule',
        purpose: 'What the day actually contains, so "could this reach me" has a subject.',
        provider: 'microsoft-graph',
        fields: ['calendar events', 'meeting locations', 'travel between meetings'],
        permission: 'Calendars.Read',
        priority: 0.7,
        materialEffect:
          'Would decide which local signals are consequences and which are merely nearby news.',
        changesGraphBy:
          'Would turn the generic "your commute" consequence into the specific meeting the closure threatens.',
        optional: true
      },
      caps
    ),
    need(
      {
        id: 'graph-work-context',
        purpose: 'Which work topics a market or policy move would actually land on.',
        provider: 'microsoft-graph',
        fields: ['calendar subjects', 'flagged mail subjects'],
        permission: 'Mail.ReadBasic',
        priority: 0.4,
        materialEffect: 'Would rank market and policy signals by whether they touch this person’s work.',
        changesGraphBy: 'Would re-weight the `market` force instead of showing a generic index list.',
        optional: true
      },
      caps
    )
  ];
}

function newsQuestionCandidates(news: NewsSituation): SituationQuestion[] {
  const candidates: SituationQuestion[] = [];
  if (news.scope === null) {
    candidates.push({
      id: 'news-scope',
      prompt: 'What part of your world should this cover?',
      whyNeeded: 'It decides which forces the field is built from.',
      materialEffect: 'Chooses which world is assembled: the near-me field, the work axis, or both.',
      expectedInformationGain: 0.8,
      userCost: 0.15,
      choices: [
        { id: 'near-me', label: 'Near me', detail: 'Streets, weather, air, mobility' },
        { id: 'work-markets', label: 'My work & markets', detail: 'Indices, watchlist, releases' },
        { id: 'both', label: 'Both', detail: 'One field, both forces' }
      ],
      origin: 'graph',
      satisfiesNeedId: 'local-signals'
    });
  }
  if (news.horizon === null) {
    candidates.push({
      id: 'news-horizon',
      prompt: 'How far ahead does it have to reach?',
      whyNeeded: 'It decides which consequences still count as yours.',
      materialEffect: 'Sets the window of the world and which consequences stay in the envelope.',
      expectedInformationGain: 0.7,
      userCost: 0.15,
      choices: [
        { id: 'now', label: 'Right now', detail: 'The next hour' },
        { id: 'today', label: 'Today', detail: 'Through this evening' },
        { id: 'week', label: 'This week', detail: 'Consequences that keep running' }
      ],
      origin: 'graph',
      satisfiesNeedId: null
    });
  }
  return candidates;
}

function newsGraph(prompt: string, news: NewsSituation, context: DiscoveryContext): SituationGraph {
  const contextHasExplicitPlace =
    context.placeSource !== undefined && context.placeSource !== 'inferred';
  const placeLabel = contextHasExplicitPlace
    ? (context.placeLabel ?? news.placeHint ?? 'Seattle')
    : (news.placeHint ?? context.placeLabel ?? 'Seattle');
  const placeSource: LocalPlace['source'] = contextHasExplicitPlace
    ? context.placeSource!
    : news.placeHint
      ? 'prompt'
      : (context.placeSource ?? 'inferred');
  return {
    version: SITUATION_GRAPH_VERSION,
    id: graphId('living-news', context.nowMs),
    prompt,
    kind: 'living-news',
    scenarioId: 'local-news-briefing',
    resolutionMode: 'field',
    moment: {
      nowMs: context.nowMs,
      localTime: localTimeLabel(context.nowMs),
      timeZone: timeZoneLabel(),
      truth: 'observed',
      authority: 'device'
    },
    place: {
      label: placeLabel,
      truth: placeSource === 'inferred' ? 'inferred' : 'observed',
      authority: placeSource === 'device' ? 'device' : placeSource === 'inferred' ? 'none' : 'user',
      source: placeSource
    },
    entities: [
      { id: 'place', label: placeLabel, kind: 'place', truth: 'inferred', authority: 'none' },
      { id: 'markets', label: 'Indices and watchlist', kind: 'market', truth: 'modeled', authority: 'fixture' }
    ],
    events: [],
    hypotheses: [
      {
        id: 'briefing',
        label: 'Knowing what could reach my day',
        supported: true,
        evidence: [news.kind === 'briefing' ? 'the question asks what matters, not what happened' : 'a news-shaped question'],
        confidence: news.kind === 'briefing' ? 0.8 : 0.4
      },
      {
        id: 'lookup',
        label: 'One specific fact',
        supported: true,
        evidence: ['a named event would be asked for'],
        confidence: news.kind === 'briefing' ? 0.2 : 0.6
      }
    ],
    chosenJob: news.kind === 'briefing' ? 'briefing' : null,
    facts: [
      {
        id: 'scope',
        label: 'Scope',
        statement: news.scope ? `Read from the words: ${news.scope}.` : 'Not stated yet.',
        truth: news.scope ? 'inferred' : 'unknown',
        authority: news.scope ? 'user' : 'none',
        freshness: 'static',
        anchor: { spatial: 'region', temporal: 'today' },
        materialEffect: 'Chooses which forces the field is built from.',
        editable: true
      },
      {
        id: 'horizon',
        label: 'Horizon',
        statement: news.horizon ? `Read from the words: ${news.horizon}.` : 'Not stated yet.',
        truth: news.horizon ? 'inferred' : 'unknown',
        authority: news.horizon ? 'user' : 'none',
        freshness: 'static',
        anchor: { spatial: 'region', temporal: 'horizon' },
        materialEffect: 'Sets how far consequences have to reach to count.',
        editable: true
      }
    ],
    forces: [
      {
        id: 'local',
        type: 'local',
        relevance: 0.9,
        truth: 'modeled',
        authority: 'fixture',
        freshness: 'hours',
        anchor: { spatial: 'region', temporal: 'today' },
        materialEffect: 'Places signals by distance from the centre.'
      },
      {
        id: 'markets',
        type: 'market',
        relevance: 0.6,
        truth: 'modeled',
        authority: 'fixture',
        freshness: 'hours',
        anchor: { spatial: 'axis', temporal: 'today' },
        materialEffect: 'Draws the market axis beside the field.'
      },
      {
        id: 'weather',
        type: 'weather',
        relevance: 0.5,
        truth: 'modeled',
        authority: 'fixture',
        freshness: 'hours',
        anchor: { spatial: 'region', temporal: 'today' },
        materialEffect: 'Adds a weather signal and can change the consequences.'
      },
      {
        id: 'mobility',
        type: 'traffic',
        relevance: 0.55,
        truth: 'modeled',
        authority: 'fixture',
        freshness: 'minutes',
        anchor: { spatial: 'routes', temporal: 'commute' },
        materialEffect: 'Adds mobility signals and the commute consequence.'
      }
    ],
    constraints: [
      {
        id: 'sample-only',
        label: 'Sample data is labelled',
        statement: 'Every signal in this build is a labelled sample until a claim-level source exists.',
        truth: 'observed',
        materialEffect: 'Caps the truth kind of every signal in the field.'
      }
    ],
    unknowns: [
      {
        id: 'centre',
        label: 'Where the centre is',
        reason: 'The centre of the field is a sample place until a coarse fix or a choice says otherwise.',
        truth: placeSource === 'inferred' ? 'inferred' : 'observed',
        authority: placeSource === 'device' ? 'device' : 'none',
        freshness: 'static',
        anchor: { spatial: 'region', temporal: 'now' },
        materialEffect: 'Changes what counts as near, and therefore what reaches the person.',
        resolvedBy: 'a coarse fix, or one tap on a place',
        blocking: false
      }
    ],
    informationNeeds: newsNeeds(context, news),
    questionPlan: planQuestions(
      newsQuestionCandidates(news),
      MAX_SELECTED_QUESTIONS,
      context.askedQuestionIds,
      context.askedQuestions
    ),
    refreshNeed: {
      targetEvent: 'the next material local change',
      cadenceHint: 'hourly',
      whyItMatters: 'A briefing that never changes is a newspaper.'
    },
    decisionGoal: {
      id: 'what-reaches-me',
      statement: 'Know what changed that could reach this day, and what to do about it.',
      successCriterion: 'Consequences stated in the person’s own terms, each traceable to a signal.',
      commitBlockedBy: null
    },
    handoffNeeds: [],
    readings: { arrival: null, news }
  };
}

/* ---------------------------------------------------------- literal graph */

function literalGraph(prompt: string, context: DiscoveryContext, news: NewsSituation | null): SituationGraph {
  const offer: SituationQuestion[] = news
    ? [
        {
          id: 'news-offer',
          prompt: 'Do you want that as an answer, or as your world?',
          whyNeeded: 'Only you know whether this is a one-off lookup or a briefing that should organize your day.',
          materialEffect: 'Keeps a cited sentence, or changes the template to a living signal field.',
          expectedInformationGain: 0.84,
          userCost: 0.12,
          choices: [
            { id: 'literal', label: 'Keep it literal', detail: 'The answer stays as written' },
            { id: 'briefing', label: 'Build my living briefing', detail: 'Assemble the signal field' }
          ],
          origin: 'graph',
          satisfiesNeedId: null
        }
      ]
    : [];
  return {
    version: SITUATION_GRAPH_VERSION,
    id: graphId('literal', context.nowMs),
    prompt,
    kind: 'literal',
    resolutionMode: 'answer',
    moment: {
      nowMs: context.nowMs,
      localTime: localTimeLabel(context.nowMs),
      timeZone: timeZoneLabel(),
      truth: 'observed',
      authority: 'device'
    },
    place: {
      label: context.placeLabel ?? 'here',
      truth: 'inferred',
      authority: 'none',
      source: 'inferred'
    },
    entities: [],
    events: [],
    hypotheses: [
      {
        id: 'answer',
        label: 'A sentence is the right answer',
        supported: true,
        evidence: ['the question asks for a fact, not a world'],
        confidence: 0.7
      }
    ],
    chosenJob: 'answer',
    facts: [],
    forces: [],
    constraints: [
      {
        id: 'no-world-without-a-job',
        label: 'No world without a job',
        statement: 'A question with no latent job gets a sentence, not an assembled world.',
        truth: 'observed',
        materialEffect: 'Keeps the literal answer as the outcome.'
      }
    ],
    unknowns: [],
    informationNeeds: [
      need(
        {
          id: 'live-research',
          purpose: 'A cited answer to the question as asked.',
          provider: 'web-search',
          fields: ['answer', 'citations', 'retrieval time'],
          permission: null,
          priority: 0.95,
          materialEffect: 'It is the answer.',
          changesGraphBy: 'Produces the literal answer and its citations.',
          optional: false
        },
        context.capabilities
      )
    ],
    questionPlan: planQuestions(
      offer,
      MAX_SELECTED_QUESTIONS,
      context.askedQuestionIds,
      context.askedQuestions
    ),
    refreshNeed: {
      targetEvent: 'nothing in particular',
      cadenceHint: 'never',
      whyItMatters: 'A sentence does not need watching.'
    },
    decisionGoal: {
      id: 'answer',
      statement: 'Answer the question as asked.',
      successCriterion: 'A cited sentence, or an honest statement that nothing was retrieved.',
      commitBlockedBy: null
    },
    handoffNeeds: [],
    readings: { arrival: null, news }
  };
}

/* ------------------------------------------------- acquisition planning */

export interface AcquisitionStep {
  need: InformationNeed;
  provider: ContextProviderDescriptor;
  order: number;
  /** True only when this build may actually run it right now. */
  executable: boolean;
  reason: string;
}

export interface ContextAcquisitionPlan {
  graphId: string;
  /** Ordered by material effect, then permission cost, then provider cost. */
  steps: AcquisitionStep[];
  /** Everything that cannot run yet, with the reason it cannot. */
  deferred: AcquisitionStep[];
}

export interface LiveResearchInput {
  answer: string;
  nowMs: number;
  retrievedAt: string;
  flightLabel?: string;
}

export interface LiveResearchInterpretation {
  graph: SituationGraph;
  reading: FlightReading | null;
}

export interface GeolocationContextOutcome {
  status: 'granted' | 'denied' | 'unsupported' | 'outside-region' | 'timeout';
  coarseLabel?: string;
}

/* -------------------------------------------------------------- engine */

export class SituationIntelligenceEngine {
  /**
   * The deterministic first pass. No model call, no network, no clock beyond
   * the one it is handed. Same prompt plus same context always produces the
   * same graph (bar the id).
   */
  discover(prompt: string, context: DiscoveryContext): SituationGraph {
    const trimmed = prompt.trim();
    const arrival = detectArrivalSituation(trimmed);
    if (arrival) return travelGraph(trimmed, arrival, context);

    const news = detectNewsSituation(trimmed);
    if (news && news.kind === 'briefing') return newsGraph(trimmed, news, context);

    // Only when neither hero detector fires does the scenario registry get a
    // say. A news-shaped prompt keeps its literal-answer-plus-briefing-offer
    // path exactly as before; everything else — the large informational,
    // utility and commercial space — is now recognized and structured.
    if (news === null) {
      const match = classifyScenario(trimmed, SCENARIOS);
      if (match) {
        return buildScenarioGraph(trimmed, match.scenario, {
          nowMs: context.nowMs,
          capabilities: context.capabilities,
          placeLabel: context.placeLabel ?? null
        });
      }
    }

    return literalGraph(trimmed, context, news);
  }

  /**
   * Re-derive the same situation under changed context.
   *
   * Used whenever something the graph depends on moves — a job is chosen, an
   * origin becomes known, an assumption is corrected — so information needs,
   * their statuses and the question plan are all recomputed together instead of
   * drifting apart. The graph keeps its identity; only its shape changes.
   */
  refine(graph: SituationGraph, context: DiscoveryContext): SituationGraph {
    if (graph.kind === 'travel-arrival' && graph.readings.arrival) {
      const next = travelGraph(graph.prompt, graph.readings.arrival, {
        ...context,
        chosenJob: context.chosenJob ?? graph.chosenJob
      });
      return { ...next, id: graph.id };
    }
    if (graph.kind === 'living-news' && graph.readings.news) {
      const next = newsGraph(graph.prompt, graph.readings.news, context);
      return { ...next, id: graph.id };
    }
    return graph;
  }

  /**
   * The job answer is the one thing that re-derives everything: which needs
   * matter, which questions are still worth asking, and what the world is for.
   */
  chooseJob(graph: SituationGraph, jobId: string, context: DiscoveryContext): SituationGraph {
    if (graph.kind !== 'travel-arrival' || !graph.readings.arrival) {
      return { ...graph, chosenJob: jobId };
    }
    return this.refine(graph, { ...context, chosenJob: jobId });
  }

  /**
   * Interprets a web-research provider answer and folds it into the graph.
   *
   * The shell transports the response but does not decide what it means. For a
   * travel situation this engine owns the flight parser; for a literal answer it
   * records only that cited live research satisfied the answer need.
   */
  ingestLiveResearch(graph: SituationGraph, input: LiveResearchInput): LiveResearchInterpretation {
      const reading =
        graph.kind === 'travel-arrival' && graph.readings.arrival
          ? parseFlightAnswer({
              answer: input.answer,
              nowMs: input.nowMs,
              flightLabel: input.flightLabel ?? graph.readings.arrival.flightLabel,
              retrievedAt: input.retrievedAt
            })
          : null;
      const landingMs =
        reading?.status === 'landed' || reading?.phase === 'at-gate'
          ? (reading.actualLandingMs ?? reading.landingMs)
          : null;
      const result: ContextResult = {
        needId: graph.kind === 'travel-arrival' ? 'flight-status' : 'live-research',
        provider: 'web-search',
        status: 'satisfied',
        retrievedAtMs: Date.parse(input.retrievedAt) || input.nowMs,
        statements: reading
          ? [
              {
                nodeId: 'flight-status',
                label: 'Flight status',
                statement: reading.note,
                truth: reading.truth,
                authority: 'live-research',
                freshness: 'minutes'
              },
              ...(landingMs === null
                ? []
                : [
                    {
                      nodeId: 'landing',
                      label: 'Wheels-down',
                      statement: reading.landingLabel ?? 'A source states the aircraft landed.',
                      truth: 'observed' as const,
                      authority: 'live-research' as const,
                      freshness: 'minutes' as const,
                      whenMs: landingMs,
                      whenLabel: reading.landingLabel ?? 'actual landing',
                      resolvesUnknownIds: ['actual-landing']
                    }
                  ])
            ]
          : [
              {
                nodeId: 'live-answer',
                label: 'Live answer',
                statement: 'Live research returned a cited answer to the question as asked.',
                truth: 'observed',
                authority: 'live-research',
                freshness: 'minutes'
              }
            ],
        note: 'Live web research completed through the planned provider seam.'
      };
      return { graph: this.applyContextResult(graph, result), reading };
    }

  markContextUnavailable(graph: SituationGraph, needId: string, note: string): SituationGraph {
    return this.applyContextResult(graph, {
      needId,
      provider: 'web-search',
      status: 'unavailable',
      retrievedAtMs: null,
      statements: [],
      note
    });
  }

  /** Folds a gesture-gated geolocation provider result into the graph. */
  applyGeolocationOutcome(
    graph: SituationGraph,
    needId: 'origin-location' | 'news-place',
    outcome: GeolocationContextOutcome
  ): SituationGraph {
    const granted = outcome.status === 'granted' && Boolean(outcome.coarseLabel);
    const next = this.applyContextResult(graph, {
      needId,
      provider: 'geolocation',
      status: granted ? 'satisfied' : outcome.status === 'denied' ? 'declined' : 'unavailable',
      retrievedAtMs: granted ? graph.moment.nowMs : null,
      statements: granted
        ? [
            {
              nodeId: needId === 'origin-location' ? 'origin' : 'centre',
              label: needId === 'origin-location' ? 'Starting area' : 'Field centre',
              statement: `Coarsened on this device to ${outcome.coarseLabel}.`,
              truth: 'observed',
              authority: 'device',
              freshness: 'minutes',
              resolvesUnknownIds: needId === 'news-place' ? ['centre'] : []
            }
          ]
        : [],
      note: granted
        ? 'The device fix was coarsened locally; exact coordinates remain outside the graph.'
        : `The geolocation provider returned ${outcome.status}.`
    });
    return granted
      ? {
          ...next,
          place: {
            label: outcome.coarseLabel!,
            truth: 'observed',
            authority: 'device',
            source: 'device'
          }
        }
      : next;
  }

  /**
   * The person took the briefing offer on a news-shaped question that had been
   * answered literally first. The situation was always this; only now is it
   * stated, so the graph is rebuilt as the Living News situation it is.
   */
  promoteToBriefing(graph: SituationGraph, context: DiscoveryContext): SituationGraph {
    const reading = graph.readings.news;
    if (!reading) return graph;
    const next = newsGraph(graph.prompt, { ...reading, kind: 'briefing' }, context);
    return { ...next, id: graph.id };
  }

  /** A Living News answer lands in the graph before it lands in a world. */
  applyNewsAnswers(
    graph: SituationGraph,
    answers: { scope?: NewsScope | null; horizon?: NewsHorizon | null; placeLabel?: string | null; placeSource?: LocalPlace['source'] },
    context: DiscoveryContext
  ): SituationGraph {
    const reading = graph.readings.news;
    if (graph.kind !== 'living-news' || !reading) return graph;
    const news: NewsSituation = {
      ...reading,
      scope: answers.scope ?? reading.scope,
      horizon: answers.horizon ?? reading.horizon
    };
    const next = newsGraph(graph.prompt, news, {
      ...context,
      placeLabel: answers.placeLabel ?? context.placeLabel ?? graph.place.label,
      placeSource: answers.placeSource ?? context.placeSource ?? graph.place.source
    });
    return { ...next, id: graph.id };
  }

  /**
   * A presentation blueprint may *propose* questions. It cannot ask one.
   *
   * Model questions enter as ordinary candidates and go through exactly the
   * same economics as the engine's own, so a blueprint can never buy itself a
   * human's attention by asserting that it needs some.
   */
  considerBlueprintQuestions(graph: SituationGraph, questions: SituationQuestion[]): SituationGraph {
    const own = graph.questionPlan.verdicts.map((verdict) => verdict.question);
    const merged = [...own];
    for (const question of questions) {
      if (merged.some((entry) => entry.id === question.id)) continue;
      merged.push({ ...question, origin: 'blueprint', satisfiesNeedId: question.satisfiesNeedId ?? null });
    }
    return {
      ...graph,
      questionPlan: planQuestions(
        merged,
        graph.questionPlan.budget,
        graph.questionPlan.askedIds,
        graph.questionPlan.asked
      )
    };
  }

  /** Records the human-attention cost in the graph before any replanning. */
  recordQuestionAsked(graph: SituationGraph, question: SituationQuestion): SituationGraph {
    if (graph.questionPlan.askedIds.includes(question.id)) return graph;
    return {
      ...graph,
      questionPlan: {
        ...graph.questionPlan,
        askedIds: [...graph.questionPlan.askedIds, question.id],
        asked: [...graph.questionPlan.asked, question],
        selected: graph.questionPlan.selected.filter((entry) => entry.id !== question.id)
      }
    };
  }

  /**
   * Which providers to reach for, in what order, and which may not run.
   *
   * Pure: it decides nothing about the world and mutates nothing. Material
   * effect first, then permission cost, then provider cost — and a Microsoft
   * Graph need is never executable without a configured, consented connector,
   * no matter how high its priority is.
   */
  planContextAcquisition(
    graph: SituationGraph,
    capabilities: ProviderCapabilities,
    options: { reacquireSatisfied?: boolean } = {}
  ): ContextAcquisitionPlan {
    const steps: AcquisitionStep[] = [];
    const deferred: AcquisitionStep[] = [];

    const ranked = [...graph.informationNeeds]
      .filter(
        (entry) =>
          entry.status !== 'satisfied' ||
          (options.reacquireSatisfied === true &&
            entry.provider === 'web-search' &&
            graph.refreshNeed.cadenceHint !== 'never')
      )
      .sort((a, b) => {
        const provA = providerDescriptor(a.provider);
        const provB = providerDescriptor(b.provider);
        const consentA = provA.requiresConsent ? 1 : 0;
        const consentB = provB.requiresConsent ? 1 : 0;
        return (
          b.priority - a.priority ||
          consentA - consentB ||
          provA.cost - provB.cost ||
          a.id.localeCompare(b.id)
        );
      });

    let order = 0;
    for (const entry of ranked) {
      const provider = providerDescriptor(entry.provider);
      const runnable = providerAvailable(entry.provider, capabilities);
      const step: AcquisitionStep = {
        need: entry,
        provider,
        order: order++,
        executable: runnable && entry.provider !== 'user',
        reason: ''
      };
      if (entry.provider === 'microsoft-graph') {
        // The hard rule, stated in the plan itself so it is visible in a test
        // and in the Source sheet rather than buried in a branch.
        step.executable = false;
        step.reason = capabilities.microsoftGraph
          ? 'a connector is configured, but P0 still does not call Microsoft Graph'
          : 'no Microsoft Graph connector is configured and no consent has been given';
        deferred.push(step);
        continue;
      }
      if (entry.provider === 'user') {
        step.reason = 'asked only if question economics selected it';
        deferred.push(step);
        continue;
      }
      if (!runnable) {
        step.reason = provider.requiresConsent
          ? `${provider.label} needs permission that has not been given`
          : `${provider.label} is not wired up in this build`;
        deferred.push(step);
        continue;
      }
      step.reason =
        entry.status === 'satisfied'
          ? `${provider.label} can refresh this time-sensitive answer now`
          : `${provider.label} can answer this now`;
      steps.push(step);
    }

    return { graphId: graph.id, steps, deferred };
  }

  /**
   * Fold a provider answer back into the graph, purely.
   *
   * Rules, and they are the reason this is not a `Object.assign`:
   *   - a result that is not `satisfied` never writes a fact, it only moves the
   *     need's status and records why;
   *   - a `microsoft-graph` result can only ever be satisfied when the provider
   *     itself says so, which in P0 it never does;
   *   - an incoming statement replaces an existing fact only when it carries at
   *     least as much authority, or when what is already there has gone stale.
   */
  applyContextResult(graph: SituationGraph, result: ContextResult): SituationGraph {
    const needs = graph.informationNeeds.map((entry) => {
      if (entry.id !== result.needId) return entry;
      if (result.status === 'satisfied') return { ...entry, status: 'satisfied' as const };
      if (result.status === 'not-connected' || result.status === 'declined') {
        return { ...entry, status: 'needs-consent' as const };
      }
      return { ...entry, status: 'unavailable' as const };
    });

    if (result.status !== 'satisfied') {
      return { ...graph, informationNeeds: needs };
    }

    const facts = [...graph.facts];
    const events = [...graph.events];
    const resolvedUnknownIds = new Set<string>();
    for (const statement of result.statements) {
      for (const id of statement.resolvesUnknownIds ?? []) resolvedUnknownIds.add(id);
      const eventIndex = events.findIndex((event) => event.id === statement.nodeId);
      if (eventIndex >= 0 && statement.whenMs !== undefined) {
        events[eventIndex] = {
          ...events[eventIndex],
          whenMs: statement.whenMs,
          whenLabel: statement.whenLabel ?? statement.statement,
          truth: statement.truth,
          authority: statement.authority,
          freshness: statement.freshness
        };
        continue;
      }
      const index = facts.findIndex((fact) => fact.id === statement.nodeId);
      const incoming: SituationFact = {
        id: statement.nodeId,
        label: statement.label,
        statement: statement.statement,
        truth: statement.truth,
        authority: statement.authority,
        freshness: statement.freshness,
        anchor: index >= 0 ? facts[index].anchor : { spatial: 'region', temporal: 'now' },
        materialEffect: index >= 0 ? facts[index].materialEffect : 'Stated by a provider this world consulted.',
        editable: index >= 0 ? facts[index].editable : false
      };
      if (index < 0) {
        facts.push(incoming);
        continue;
      }
      const existing = facts[index];
      const strongerAuthority = AUTHORITY_RANK[incoming.authority] > AUTHORITY_RANK[existing.authority];
      const sameAuthorityFresher =
        AUTHORITY_RANK[incoming.authority] === AUTHORITY_RANK[existing.authority] &&
        FRESHNESS_RANK[incoming.freshness] >= FRESHNESS_RANK[existing.freshness];
      if (strongerAuthority || sameAuthorityFresher || existing.freshness === 'stale') {
        facts[index] = incoming;
      }
    }

    const forces = graph.forces.map((force) =>
      force.id === 'flight' && result.provider === 'web-search' && result.statements.length > 0
        ? {
            ...force,
            truth: result.statements[0].truth,
            authority: result.statements[0].authority,
            freshness: result.statements[0].freshness
          }
        : force
    );
    return {
      ...graph,
      facts,
      events,
      forces,
      unknowns: graph.unknowns.filter((unknown) => !resolvedUnknownIds.has(unknown.id)),
      informationNeeds: needs
    };
  }

  /**
   * The concise, safe summary the blueprint gateway is allowed to see.
   *
   * It states the *shape* of the situation and nothing private: no coordinates,
   * no place name that came from a device fix, and never a single field that a
   * Microsoft Graph connector would have read. A model designing a world does
   * not need any of that, so it is not offered any of it.
   */
  summarizeForModel(graph: SituationGraph): string[] {
    const lines: string[] = [
      `situation kind: ${graph.kind}`,
      `job: ${graph.chosenJob ?? 'not chosen yet'}`,
      `local time: ${graph.moment.localTime}`
    ];

    if (graph.kind === 'travel-arrival') {
      const flight = graph.entities.find((entity) => entity.kind === 'flight');
      if (flight) lines.push(`inbound flight: ${flight.label}`);
      const originNeed = graph.informationNeeds.find((entry) => entry.id === 'origin-location');
      lines.push(
        originNeed?.status === 'satisfied'
          ? 'a starting point is known on this device'
          : 'the starting point is not known yet'
      );
      const bag = graph.facts.find((fact) => fact.id === 'checked-bag');
      if (bag) {
        lines.push(
          bag.statement.startsWith('A checked bag')
            ? 'a checked bag is assumed and is correctable in one click'
            : 'no checked bag'
        );
      }
      lines.push('party size is inferred at one and must never be asked');
    }

    if (graph.kind === 'living-news') {
      lines.push(`scope: ${graph.readings.news?.scope ?? 'unstated'}`);
      lines.push(`horizon: ${graph.readings.news?.horizon ?? 'unstated'}`);
    }

    const usable = graph.informationNeeds
      .filter((entry) => entry.status === 'available' || entry.status === 'satisfied')
      .map((entry) => entry.provider);
    lines.push(`providers in play: ${[...new Set(usable)].join(', ') || 'none'}`);
    // Stated as a capability boundary, never as content.
    lines.push('no connected-account context is available; nothing from a mailbox or calendar is known');
    return lines;
  }

  /** The scopes a future connector would request, and why, for the sheet. */
  microsoftGraphScopes(graph: SituationGraph): Array<{ scope: string; justification: string; needs: string[] }> {
    const wanted = new Set(
      graph.informationNeeds.filter((entry) => entry.provider === 'microsoft-graph').map((entry) => entry.id)
    );
    return MICROSOFT_GRAPH_PROVIDER.scopes
      .filter((scope) => scope.needIds.some((id) => wanted.has(id)))
      .map((scope) => ({
        scope: scope.scope,
        justification: scope.justification,
        needs: scope.needIds.filter((id) => wanted.has(id))
      }));
  }

  /** The adapter, exposed so a future connector has one obvious home. */
  get microsoftGraph() {
    return microsoftGraphProvider;
  }
}

export const situationIntelligence = new SituationIntelligenceEngine();
