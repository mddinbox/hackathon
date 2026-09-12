/**
 * CanvasBrowser shell — **Intent-to-World**.
 *
 * The shell owns no intelligence and no presentation opinion. It runs the
 * pipeline and holds its two artifacts:
 *
 *   Prompt + user/context
 *     → Situation Intelligence Engine  (`situationIntelligence.ts`)
 *     → Situation Graph                (`state.situationGraph`)
 *     → context acquisition plan / providers → updated Situation Graph
 *     → Experience Synthesis Engine    (`experienceSynthesis.ts`)
 *     → constrained blueprint + compiler → the immersive world
 *
 * Template routing switches on `graph.kind` and nothing else: the arrival and
 * news detectors are dependencies *inside* the Situation Intelligence Engine
 * and are never called from here. Presentation cannot fetch, and information
 * gathering cannot draw.
 *
 * Travel resolves to the **Journey World** over a linked time strip. News
 * resolves to the **Signal Field**. The model only ever establishes live facts
 * and citations, or argues about the shape of a world; uncertainty, layout, and
 * the decision envelope are computed locally by pure planners, so correcting or
 * reshaping a world never costs another model call.
 *
 * The flow is world-first. A recognised situation opens its own world-shaped
 * surface immediately and asks the one thing it genuinely cannot infer, while
 * research runs in parallel. Prose is a destination the user can choose, never
 * a waiting room they are put in.
 */
import { applyAppearance, loadAppearance, saveAppearance, type Appearance } from '../appearance';
import { askLiveAgent, fetchRoute } from '../agentGateway';
import { requestBlueprint } from '../blueprintGateway';
import {
  defaultCapabilities,
  type ContextResult,
  type ProviderCapabilities
} from '../intent-to-world/situation-intelligence/contextProviders';
import {
  blueprintCompatibility,
  experienceSynthesis
} from '../intent-to-world/experience-synthesis';
import { requestCoarseOrigin } from '../geolocation';
import { createInference, askQuestion, type ClarifyQuestion } from '../inference';
import { loadLocationPreference, saveLocationPreference } from '../locationPreference';
import { requestLocalContext, type LiveLocalContext } from '../localContextGateway';
import { findStopOption } from '../journeyFixtures';
import { planJourney, routeBearing, type JourneyWorld } from '../journeyPlanner';
import { LAYER_LABELS } from '../newsFixtures';
import { BRIEFING_OFFER, parseWorldEdit, type LayerId } from '../newsIntent';
import { layersForScope } from '../newsPlanner';
import {
  answerNewsQuestion,
  applyLiveNewsContext,
  applyWorldEdit,
  beginLiveNewsContext,
  createNewsSession,
  failLiveNewsContext,
  findNewsPlace,
  refreshNewsContext,
  rebuildWorld
} from '../newsSession';
import {
  DEFAULT_ASSUMPTIONS,
  ORIGIN_OPTIONS,
  SAMPLE_SCENARIO,
  TYPED_ORIGIN_DRIVE_MINUTES
} from '../pickupFixtures';
import {
  parseAssumptionEdit,
  parsePartyCount,
  extractCitations,
  type ArrivalSituation
} from '../pickupIntent';
import { planPickup, positionPercent } from '../pickupPlanner';
import { isRefreshDue, motionSentence, motionState } from '../motion';
import {
  computeRefreshPolicy,
  refreshCountdown,
  urgencyLevel,
  type RefreshPolicy
} from '../refreshPolicy';
import {
  blueprintQuestionsAsCandidates,
  situationIntelligence,
  type DiscoveryContext
} from '../intent-to-world/situation-intelligence';
import {
  browserDecisionCache,
  browserLearningStore,
  buildDecisionRequest,
  buildCompareRequest,
  buildTriageRequest,
  decisionCacheKey,
  hasDecisionSurface,
  learn,
  normalizeDecisionResult,
  normalizeCompare,
  normalizeTriage,
  planDecision,
  type DecisionPlan
} from '../intent-to-world/situation-intelligence/scenarios';
import {
  buildPlaceWorld,
  cityById,
  resolveAnchor,
  resolveCity,
  type PlaceDirection,
  type PlaceWorld
} from '../intent-to-world/situation-intelligence/scenarios/places/cities';
import {
  normalizeBlueprint,
  type TemplateBlueprint
} from '../intent-to-world/experience-synthesis/templateBlueprint';
import type { SituationQuestion } from '../intent-to-world/situation-graph';
import { sampleConditions, weatherIntensity, windVector } from '../travelConditionsFixtures';
import type {
  Assumptions,
  ConditionLayers,
  FlightReading,
  JobHypothesisId,
  JourneyStop,
  OriginOption,
  RefreshStatus
} from '../types';
import { UndoStack } from '../undo';
import { syncVisualEngine, type FxMode, type FxParams } from '../visualEngine';
import { renderClarify } from './clarify';
import { clear } from './dom';
import { renderConnection, renderHome, renderLiteral } from './home';
import { renderDecision } from './decisionSurface';
import { renderPlaceWorld, layoutPlaceWorld } from './placeWorld';
import { renderCompare } from './compareSurface';
import { renderTriage } from './triageSurface';
import { onRouteSourceChange } from './journeyWorld';
import { renderDevPanel, renderMoreMenu } from './moreMenu';
import { layoutFieldLabels, renderSignalField } from './signalField';
import { renderSourcesSheet } from './sourcesSheet';
import type { AppActions, AppState, JourneyLens, ViewContext } from './state';
import { renderTerrain } from './timeTerrain';

const LIVE_GATEWAY_ENABLED = import.meta.env.MODE === 'demo' || import.meta.env.MODE === 'test';
const LIVE_LOCAL_CONTEXT_ENABLED =
  import.meta.env.MODE === 'demo' ||
  (import.meta.env.MODE === 'test' &&
    new URLSearchParams(window.location.search).has('live-context'));
/**
 * Blueprint generation is a Demo-only capability on purpose. The test build
 * keeps a gateway so research can be mocked at the network boundary, but it
 * always stands on the deterministic fallback blueprint — a suite that
 * depended on a model's design opinion would not be a suite.
 */
const BLUEPRINT_ENABLED = import.meta.env.MODE === 'demo';
const CHANGE_LIMIT = 3;

/** Flight phase as a 0–1 position for the dominant pulse in the Travel world. */
const PHASE_LEVEL: Record<string, number> = {
  unknown: 0,
  scheduled: 0.15,
  enroute: 0.45,
  landed: 0.8,
  'at-gate': 1
};

const TREND_LEVEL: Record<string, number> = { easing: -1, steady: 0, building: 1 };

/** The travel origin categories and the news places are the same four areas. */
const COARSE_ORIGIN_TO_PLACE: Record<string, string> = {
  'downtown-seattle': 'seattle',
  bellevue: 'bellevue',
  redmond: 'redmond',
  tacoma: 'tacoma',
  everett: 'everett'
};

interface Snapshot {
  assumptions: Assumptions;
  origin: OriginOption | null;
  /** Whether that origin came from an automatic fix rather than a choice. */
  originAuto: boolean;
  reading: FlightReading | null;
  stops: JourneyStop[];
}

export interface CanvasBrowserApp {
  state: AppState;
  actions: AppActions;
  now(): number;
  /**
   * Test-only seams for the refresh controller. Real intervals are minutes
   * long, so the suite drives one tick directly instead of waiting, and reads
   * the armed-timer count to prove there is never more than one scheduler.
   */
  refreshNow(): Promise<void>;
  armedRefreshTimers(): number;
  /** Test-only: bring the next check due, or push it a full interval away. */
  setRefreshDue(due: boolean): void;
  /**
   * Test-only: feed a raw blueprint object through the same normalizer and
   * compiler a model answer would go through. Returns false when the payload
   * is rejected, which is exactly what a hostile or malformed answer does.
   */
  applyRawBlueprint(raw: unknown): boolean;
}

function unknownReading(flightLabel: string, note: string): FlightReading {
  return {
    status: 'unknown',
    phase: 'unknown',
    actualLandingMs: null,
    scheduledArrivalMs: null,
    estimatedArrivalMs: null,
    landingMs: null,
    landingLabel: null,
    truth: 'unknown',
    note,
    citations: [],
    provenance: 'live-research',
    flightLabel,
    retrievedAt: null
  };
}

function idleRefresh(): RefreshStatus {
  return {
    lastCheckedMs: null,
    nextCheckMs: null,
    intervalMs: 0,
    reason: 'this world is not being watched yet',
    urgency: 'stopped',
    active: false,
    paused: false,
    checks: 0
  };
}

export function mountApp(root: HTMLElement): CanvasBrowserApp {
  const appearance = loadAppearance();
  applyAppearance(appearance);
  const locationPreference = loadLocationPreference();

  const state: AppState = {
    view: 'home',
    prompt: '',
    busy: false,
    error: null,
    literal: null,
    decisionPlan: null,
    decision: null,
    decisionPrompt: '',
    decisionPending: false,
    placeWorld: null,
    placeAnchorId: null,
    placeCityId: null,
    placePrompt: '',
    placeRadiusMiles: null,
    placeCenterDLat: 0,
    placeCenterDLon: 0,
    placeNote: null,
    compare: null,
    triage: null,
    situation: null,
    chosenJob: null,
    travelQuestion: null,
    researchPending: false,
    requestGeneration: 0,
    geoGeneration: 0,
    dialogOpener: null,
    pendingFocus: null,
    reading: null,
    assumptions: { ...DEFAULT_ASSUMPTIONS },
    origin: null,
    locationState: 'idle',
    alwaysUseLocation: locationPreference.alwaysUse,
    autoLocationStatus: 'idle',
    placesVisible: false,
    plan: null,
    conditions: null,
    conditionStep: 0,
    conditionLayers: { weather: true, traffic: true },
    refresh: idleRefresh(),
    changes: [],
    sourcesOpen: false,
    moreOpen: false,
    devMode: false,
    appearance,
    inference: createInference(),
    news: createNewsSession(),
    blueprint: null,
    compiled: null,
    situationGraph: null,
    experiencePlan: null,
    questionVerdicts: [],
    blueprintPending: false,
    lens: 'journey',
    stops: [],
    journey: null,
    bingRouteLive: false,
    worldRevision: 0
  };

  const undoStack = new UndoStack<Snapshot>(CHANGE_LIMIT);
  const learningStore = browserLearningStore();
  const decisionCache = browserDecisionCache();
  let renderedRevision = -1;
  let changeSeq = 0;
  let newsContextGeneration = 0;
  let coarseLocationPromise: ReturnType<typeof requestCoarseOrigin> | null = null;

  function requestSharedCoarseLocation(): ReturnType<typeof requestCoarseOrigin> {
    if (coarseLocationPromise) return coarseLocationPromise;
    coarseLocationPromise = requestCoarseOrigin().finally(() => {
      coarseLocationPromise = null;
    });
    return coarseLocationPromise;
  }

  const now = (): number => Date.now();

  function freshNewsSessionPreservingPlace() {
    const next = createNewsSession();
    if (state.news.placeTruth !== 'inferred') {
      next.place = state.news.place;
      next.placeTruth = state.news.placeTruth;
      refreshNewsContext(next, 'initial');
    }
    return next;
  }

  function snapshot(): Snapshot {
    return {
      assumptions: { ...state.assumptions },
      origin: state.origin,
      originAuto: autoOrigin,
      reading: state.reading,
      stops: [...state.stops]
    };
  }

  function recordChange(label: string): void {
    undoStack.push(snapshot());
    state.changes = [...state.changes, { id: `change-${++changeSeq}`, label }].slice(-CHANGE_LIMIT);
  }

  /* ------------------------------------- the two engines, and their seam */

  /**
   * A blueprint a model proposed for this session, kept so a lens change or a
   * local edit re-synthesises against the same proposal instead of silently
   * dropping it. It is a *proposal*: the Experience Synthesis Engine re-runs
   * its compatibility gate on every synthesis, so an incompatible one stays
   * rejected no matter how many times the world is rebuilt.
   */
  let proposedBlueprint: TemplateBlueprint | null = null;

  /** What this build can actually reach. Microsoft Graph is never in here. */
  function capabilities(): ProviderCapabilities {
    const automaticFixFailed =
      state.autoLocationStatus === 'denied' ||
      state.autoLocationStatus === 'unsupported' ||
      state.autoLocationStatus === 'outside-region' ||
      state.autoLocationStatus === 'timeout';
    return defaultCapabilities({
      webResearch: LIVE_GATEWAY_ENABLED,
      locationConsent:
        state.locationState === 'granted' || (state.alwaysUseLocation && !automaticFixFailed),
      localNews: LIVE_LOCAL_CONTEXT_ENABLED,
      marketData: LIVE_LOCAL_CONTEXT_ENABLED
      // `microsoftGraph` stays false: there is no connector and no consent.
    });
  }

  function discoveryContext(): DiscoveryContext {
    return {
      nowMs: now(),
      capabilities: capabilities(),
      chosenJob: state.chosenJob,
      hasOrigin: state.origin !== null,
      originLabel: state.origin?.label ?? null,
      placeLabel: state.news.place.label,
      placeSource:
        state.news.placeTruth === 'coarse-location'
          ? 'device'
          : state.news.placeTruth === 'chosen'
            ? 'chosen'
            : 'inferred',
      checkedBag: state.assumptions.checkedBag,
      internationalArrival: state.assumptions.internationalArrival,
      askedQuestionIds: state.inference.asked,
      askedQuestions: state.situationGraph?.questionPlan.asked ?? [],
      flightReading: state.reading
    };
  }

  async function acquireCoarseLocation(
    needId: 'origin-location' | 'news-place'
  ): ReturnType<typeof requestCoarseOrigin> {
    const graph = state.situationGraph;
    if (!graph) return { status: 'unsupported' };
    // The click or saved preference is the consent event for this acquisition.
    const plan = situationIntelligence.planContextAcquisition(graph, {
      ...capabilities(),
      locationConsent: true
    });
    const authorized = plan.steps.some(
      (step) => step.need.id === needId && step.provider.id === 'geolocation'
    );
    if (!authorized) return { status: 'unsupported' };
    return requestSharedCoarseLocation();
  }

  function foldLocationOutcome(
    needId: 'origin-location' | 'news-place',
    outcome: Awaited<ReturnType<typeof requestCoarseOrigin>>
  ): void {
    const graph = state.situationGraph;
    if (!graph) return;
    state.situationGraph = situationIntelligence.applyGeolocationOutcome(graph, needId, {
      status: outcome.status,
      ...(outcome.status === 'granted' ? { coarseLabel: outcome.origin.label } : {})
    });
    synthesize();
  }

  /** Converts the engine's selected question into the shell's display contract. */
  function displayQuestion(question: SituationQuestion, fallbackOptionId: string): ClarifyQuestion {
    return {
      id: question.id,
      question: question.prompt,
      reason: question.whyNeeded,
      options: question.choices.map((choice) => ({
        id: choice.id,
        label: choice.label,
        ...(choice.detail ? { detail: choice.detail } : {})
      })),
      fallbackOptionId
    };
  }

  function chargeQuestion(
    question: SituationQuestion,
    fallbackOptionId: string
  ): ClarifyQuestion | null {
    const displayed = askQuestion(state.inference, displayQuestion(question, fallbackOptionId));
    if (displayed && state.situationGraph) {
      state.situationGraph = situationIntelligence.recordQuestionAsked(
        state.situationGraph,
        question
      );
      synthesize();
    }
    return displayed;
  }

  function syncTravelOriginQuestion(): void {
    const selected =
      state.situationGraph?.questionPlan.selected.find(
        (question) => question.id === 'travel-origin'
      ) ?? null;
    if (selected) {
      state.travelQuestion = chargeQuestion(selected, 'choose-place');
      return;
    }
    if (
      state.origin !== null ||
      !state.situationGraph?.questionPlan.askedIds.includes('travel-origin')
    ) {
      state.travelQuestion = null;
    }
  }

  /**
   * Core 2, run. The graph decides the world; the blueprint may only argue
   * about its presentation, and only when it is compatible.
   *
   * `state.blueprint` and `state.compiled` are outputs of this function and are
   * never assigned anywhere else, so there is exactly one path from a situation
   * to a template.
   */
  function synthesize(): void {
    const graph = state.situationGraph;
    if (!graph) {
      state.experiencePlan = null;
      state.blueprint = null;
      state.compiled = null;
      state.questionVerdicts = [];
      return;
    }
    const plan = experienceSynthesis.synthesize({
      graph,
      blueprint: proposedBlueprint,
      options: { lens: state.lens, hasSpatialAnchor: state.origin !== null }
    });
    state.experiencePlan = plan;
    state.blueprint = plan.blueprint;
    state.compiled = plan.compiled;
    state.questionVerdicts = graph.questionPlan.verdicts;
  }

  /**
   * Something the graph depends on moved — a job, an origin, an assumption, a
   * news answer. Core 1 re-derives the situation (needs, statuses, questions)
   * and Core 2 re-synthesises the world from it.
   */
  function regraph(): void {
    const graph = state.situationGraph;
    if (!graph) return;
    let next = situationIntelligence.refine(graph, discoveryContext());
    if (proposedBlueprint && blueprintCompatibility(next, proposedBlueprint).compatible) {
      next = situationIntelligence.considerBlueprintQuestions(
        next,
        blueprintQuestionsAsCandidates(proposedBlueprint.questions)
      );
    }
    state.situationGraph = next;
    synthesize();
  }

  /**
   * A proposed presentation blueprint arrives.
   *
   * Its questions go back through question economics as ordinary candidates —
   * presentation cannot buy a person's attention — and the blueprint itself
   * only shapes the world if the synthesis compatibility gate accepts it.
   * Returns whether it was accepted.
   */
  function applyProposedBlueprint(blueprint: TemplateBlueprint): boolean {
    const graph = state.situationGraph;
    if (!graph) return false;
    proposedBlueprint = blueprint;
    if (blueprintCompatibility(graph, blueprint).compatible) {
      state.situationGraph = situationIntelligence.considerBlueprintQuestions(
        graph,
        blueprintQuestionsAsCandidates(blueprint.questions)
      );
    }
    synthesize();
    return state.experiencePlan?.blueprintSource === 'sol-generated';
  }

  function resetPipeline(): void {
    proposedBlueprint = null;
    state.situationGraph = null;
    state.experiencePlan = null;
    state.blueprint = null;
    state.compiled = null;
    state.questionVerdicts = [];
    state.blueprintPending = false;
    state.decisionPlan = null;
    state.decision = null;
    state.decisionPrompt = '';
    state.decisionPending = false;
    state.placeWorld = null;
    state.placePrompt = '';
    state.compare = null;
    state.triage = null;
  }

  /**
   * Assemble a decision for a plan: cache first (a returning question costs no
   * tokens), then the model, instructed to assemble the decision rather than
   * list links. A late answer from a superseded generation is dropped.
   */
  async function assembleDecision(plan: DecisionPlan, prompt: string, generation: number): Promise<void> {
    const key = decisionCacheKey(plan.scenarioId, plan.top.id, prompt);
    const cached = decisionCache.get(key);
    if (cached) {
      if (generation !== state.requestGeneration) return;
      state.decision = cached;
      state.decisionPending = false;
      return;
    }
    try {
      const response = await askLiveAgent(buildDecisionRequest(plan, prompt));
      if (generation !== state.requestGeneration) return;
      const result = normalizeDecisionResult(response.answer, plan);
      decisionCache.set(key, result);
      state.decision = result;
    } catch {
      if (generation !== state.requestGeneration) return;
      state.decision = {
        direction: plan.top.label,
        headline: 'The decision could not be assembled right now — try Refine, or Start over.',
        forces: [],
        action: plan.actionLabel
      };
    }
    state.decisionPending = false;
  }

  /** Open the Decision Surface: lead with the inferred decision, then assemble it. */
  async function openDecision(prompt: string, scenarioId: string, generation: number): Promise<void> {
    const plan = planDecision(prompt, scenarioId, { adjustments: learningStore.get(scenarioId) });
    if (!plan) {
      await runResearch(prompt);
      return;
    }
    state.decisionPrompt = prompt;
    state.decisionPlan = plan;
    state.decision = null;
    state.decisionPending = true;
    state.busy = true;
    state.view = 'decision';
    render();
    await assembleDecision(plan, prompt, generation);
    if (generation !== state.requestGeneration) return;
    state.busy = false;
    render();
  }

  /**
   * Replace the estimated drive times with real routed ones, best-effort. A
   * superseded world (the anchor moved, or Start over) is ignored, and any
   * failure leaves the labelled estimate in place.
   */
  async function applyRealCommutes(world: PlaceWorld): Promise<void> {
    const routed = await fetchRoute(
      { lat: world.anchor.lat, lon: world.anchor.lon },
      world.neighborhoods.map((n) => ({ id: n.id, lat: n.lat, lon: n.lon }))
    );
    if (!routed || state.placeWorld !== world) return;
    const byId = new Map(routed.filter((r) => r.minutes != null).map((r) => [r.id, r.minutes as number]));
    if (byId.size === 0) return;
    const neighborhoods = world.neighborhoods.map((n) =>
      byId.has(n.id) ? { ...n, commuteMin: byId.get(n.id)! } : n
    );
    state.placeWorld = {
      ...world,
      neighborhoods,
      commuteMax: Math.max(...neighborhoods.map((n) => n.commuteMin)),
      routed: true
    };
    render();
  }

  /** Map an inferred direction id to the place world's direction. */
  function toPlaceDirection(id: string): PlaceDirection {
    if (id === 'relocate-family') return 'relocate-family';
    if (id === 'invest') return 'invest';
    return 'relocate-solo';
  }

  /**
   * Open the Place Decision World: a real map with neighborhoods placed by
   * geography and timed from the anchor. Deterministic and instant — no model
   * call — so the space and time a location decision lives in are there at once.
   */
  function openPlace(prompt: string, scenarioId: string): void {
    const plan = planDecision(prompt, scenarioId, { adjustments: learningStore.get(scenarioId) });
    if (!plan) {
      void runResearch(prompt);
      return;
    }
    const city = resolveCity(prompt);
    if (state.placeCityId !== city.id) state.placeAnchorId = null;
    state.placeCityId = city.id;
    // The office can be named in the very first ask ("...near Microsoft").
    const namedAnchor = resolveAnchor(city, prompt);
    if (namedAnchor) state.placeAnchorId = namedAnchor.id;
    state.decisionPlan = plan;
    state.decisionPrompt = prompt;
    state.placePrompt = prompt;
    state.placeRadiusMiles = null;
    state.placeCenterDLat = 0;
    state.placeCenterDLon = 0;
    state.placeNote = null;
    const world = buildPlaceWorld(city, state.placeAnchorId, toPlaceDirection(plan.top.id));
    state.placeWorld = world;
    state.busy = false;
    state.researchPending = false;
    state.view = 'place';
    render();
    void applyRealCommutes(world);
  }

  /** Product research → the Compare surface (option cards, not a paragraph). */
  async function openCompare(prompt: string, generation: number): Promise<void> {
    const plan = planDecision(prompt, 'product-research', { adjustments: learningStore.get('product-research') });
    state.decisionPlan = plan;
    state.decisionPrompt = prompt;
    state.compare = null;
    state.decisionPending = true;
    state.busy = true;
    state.view = 'compare';
    render();
    try {
      const response = await askLiveAgent(buildCompareRequest(prompt, plan?.top.label ?? 'comparing options'));
      if (generation !== state.requestGeneration) return;
      state.compare = normalizeCompare(response.answer);
    } catch {
      if (generation !== state.requestGeneration) return;
      state.compare = { headline: 'The comparison could not be assembled — try Refine, or Start over.', options: [], verdict: '' };
    }
    state.decisionPending = false;
    state.busy = false;
    render();
  }

  /** Urgent symptom → the Triage surface (safety-first, visual). */
  async function openTriage(prompt: string, generation: number): Promise<void> {
    state.decisionPrompt = prompt;
    state.triage = null;
    state.decisionPending = true;
    state.busy = true;
    state.view = 'triage';
    render();
    try {
      const response = await askLiveAgent(buildTriageRequest(prompt));
      if (generation !== state.requestGeneration) return;
      state.triage = normalizeTriage(response.answer);
    } catch {
      if (generation !== state.requestGeneration) return;
      state.triage = {
        severity: 'emergency',
        headline: 'If this may be an emergency, contact your local emergency number now.',
        actNow: [],
        emergency: [],
        causes: []
      };
    }
    state.decisionPending = false;
    state.busy = false;
    render();
  }

  function rebuildPlan(): void {
    // Anything that reaches here changed the situation — an origin, an
    // assumption, a stop, a fresh reading — so Core 1 re-derives the graph and
    // Core 2 re-synthesises the world before the local planners run.
    regraph();
    if (state.chosenJob !== 'pickup') return;
    const reading = state.reading ?? unknownReading('Inbound flight', 'No arrival reading is available yet.');
    state.plan = planPickup({
      nowMs: now(),
      reading,
      assumptions: state.assumptions,
      origin: state.origin,
      conditions: state.conditions,
      stops: state.stops
    });
    rebuildJourney();
    synthesize();
    state.worldRevision += 1;
  }

  /**
   * The spatial half of the world, rebuilt from the same plan.
   *
   * The Journey planner is pure, so this is a cheap local recompute: adding a
   * stop, correcting the bag, or a refresh moving the traffic all reshape the
   * route without a single model call.
   */
  function rebuildJourney(): void {
    if (!state.plan) {
      state.journey = null;
      return;
    }
    const originPoint =
      state.origin && state.origin.lat !== 0 && state.origin.lon !== 0
        ? { lat: state.origin.lat, lon: state.origin.lon }
        : null;
    state.journey = planJourney({
      plan: state.plan,
      originLabel: state.origin?.label ?? null,
      originId: state.origin?.id ?? null,
      originPoint,
      conditions: state.conditions,
      refreshDue: isRefreshDue(state)
    });
  }

  /* ------------------------------------------------ the blueprint gateway */

  /**
   * The one place a blueprint request is made. Never awaited by a render.
   *
   * The gateway is a **presentation** seam: it is handed the graph's own
   * concise summary — the shape of the situation, never a coordinate, never a
   * place a device fix produced, and never a field a connected account would
   * have carried — and what comes back goes to the Experience Synthesis
   * Engine's compatibility gate, never straight to the compiler or the app.
   */
  async function generateBlueprint(prompt: string, generation: number): Promise<void> {
    if (!BLUEPRINT_ENABLED) return;
    const graph = state.situationGraph;
    if (!graph) return;
    state.blueprintPending = true;
    const known = situationIntelligence.summarizeForModel(graph);
    if (state.origin && state.locationState === 'manual') {
      // A place the person deliberately named may be shared; a device fix may not.
      known.push(`starting point is ${state.origin.label}`);
    }
    const blueprint = await requestBlueprint({
      prompt,
      situation: graph.kind === 'travel-arrival' ? 'airport-pickup' : 'local-briefing',
      job: state.chosenJob,
      known
    });
    if (generation !== state.requestGeneration) return;
    state.blueprintPending = false;
    if (blueprint) {
      applyProposedBlueprint(blueprint);
      state.worldRevision += 1;
      render();
    }
  }

  /* ------------------------------------------------- the adaptive refresh */

  /**
   * The runtime half of the refresh policy. The decision lives in the pure
   * `computeRefreshPolicy`; everything here is timers and safety:
   *
   *   - exactly one armed timer, ever (`armedTimers` proves it);
   *   - cancelled on Start over, on leaving the world, and on a new ask;
   *   - parked while the document is hidden, and caught up immediately on
   *     return if the check came due while the tab was away;
   *   - a manual Re-check resets the schedule rather than stacking on it;
   *   - a generation token, so a slow answer from a superseded question can
   *     never overwrite a newer world.
   */
  let refreshTimer = 0;
  let refreshToken = 0;
  let armedTimers = 0;

  /** Travel is watched only inside its own open world, and only with a gateway. */
  function watching(): boolean {
    return LIVE_GATEWAY_ENABLED && state.chosenJob === 'pickup' && state.view === 'terrain';
  }

  function currentPolicy(): RefreshPolicy {
    const reading = state.reading;
    return computeRefreshPolicy({
      nowMs: now(),
      phase: reading?.phase ?? 'unknown',
      scheduledArrivalMs: reading?.scheduledArrivalMs ?? null,
      estimatedArrivalMs: reading?.estimatedArrivalMs ?? null,
      actualLandingMs: reading?.status === 'landed' ? (reading.landingMs ?? null) : null,
      curbReadyEndMs: state.plan?.envelope?.curbWindow.endMs ?? null
    });
  }

  function disarm(): void {
    if (refreshTimer !== 0) {
      clearTimeout(refreshTimer);
      refreshTimer = 0;
      armedTimers = Math.max(0, armedTimers - 1);
    }
  }

  function cancelRefresh(): void {
    disarm();
    refreshToken += 1;
    state.refresh = { ...idleRefresh(), checks: state.refresh.checks };
  }

  /** Recomputes the cadence and arms exactly one timer for it. */
  function scheduleRefresh(): void {
    disarm();
    scheduleRefreshInner();
    // The scan wave on the route plane is the cadence made visible, so the
    // spatial world is rebuilt whenever the cadence changes.
    rebuildJourney();
  }

  function scheduleRefreshInner(): void {
    if (!watching()) {
      state.refresh = { ...state.refresh, active: false, nextCheckMs: null };
      return;
    }
    const policy = currentPolicy();
    const hidden = typeof document !== 'undefined' && document.hidden;
    state.refresh = {
      ...state.refresh,
      lastCheckedMs: state.refresh.lastCheckedMs ?? now(),
      nextCheckMs: policy.nextRefreshMs,
      intervalMs: policy.intervalMs,
      reason: policy.reason,
      urgency: policy.urgency,
      active: policy.urgency !== 'stopped' && !hidden,
      paused: Boolean(hidden) && policy.urgency !== 'stopped'
    };
    if (policy.urgency === 'stopped' || policy.nextRefreshMs === null) return;
    // Parked: the visibility handler catches up when the tab comes back.
    if (hidden) return;
    const delay = Math.max(0, policy.nextRefreshMs - now());
    armedTimers += 1;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = 0;
      armedTimers = Math.max(0, armedTimers - 1);
      void runAutoRefresh();
    }, delay);
  }

  /**
   * One automatic look at the world. It re-asks the *original* question,
   * updates the reading and the conditions, rebuilds the terrain in place, and
   * reschedules. It never returns the user to prose.
   */
  async function runAutoRefresh(): Promise<void> {
    if (!watching()) return;
    const token = ++refreshToken;
    const generation = ++state.requestGeneration;
    state.researchPending = true;
    render();

    await performResearch(state.prompt, state.situation, generation, 'refresh');

    // A newer ask, a Start over, or a manual re-check happened meanwhile.
    if (token !== refreshToken || generation !== state.requestGeneration || !watching()) return;

    state.conditionStep += 1;
    state.conditions = sampleConditions(state.conditionStep, state.origin?.id ?? null, now());
    state.refresh = { ...state.refresh, lastCheckedMs: now(), checks: state.refresh.checks + 1 };
    rebuildPlan();
    scheduleRefresh();
    render();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        disarm();
        state.refresh = { ...state.refresh, active: false, paused: watching() };
        return;
      }
      if (!watching()) return;
      const due = state.refresh.nextCheckMs;
      state.refresh = { ...state.refresh, paused: false };
      // A check that came due while the tab was away happens now, not later.
      if (due !== null && now() >= due) void runAutoRefresh();
      else scheduleRefresh();
      render();
    });
  }

  function rebuildNewsWorld(): void {
    rebuildWorld(state.news, now());
    // The world the person sees and the graph behind it move together: an
    // answered scope or horizon is a change in the situation, not a filter.
    const graph = state.situationGraph;
    if (graph && graph.kind === 'living-news') {
      state.situationGraph = situationIntelligence.applyNewsAnswers(
        graph,
        { scope: state.news.scope, horizon: state.news.horizon },
        discoveryContext()
      );
      synthesize();
    }
    if (state.news.liveContext) foldLiveLocalContextIntoGraph(state.news.liveContext);
    state.worldRevision += 1;
  }

  async function refreshLiveNewsContext(): Promise<void> {
    if (!LIVE_LOCAL_CONTEXT_ENABLED) return;
    const session = state.news;
    const requestId = beginLiveNewsContext(session, ++newsContextGeneration);
    const placeId = session.place.id;
    try {
      const context = await requestLocalContext(placeId);
      if (state.news !== session || !applyLiveNewsContext(session, requestId, context)) return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Live local context failed.';
      if (state.news !== session || !failLiveNewsContext(session, requestId, message)) return;
    }
    rebuildNewsWorld();
    render();
  }

  function foldLiveLocalContextIntoGraph(context: LiveLocalContext): void {
    let graph = state.situationGraph;
    if (!graph || graph.kind !== 'living-news') return;
    const result = (
      needId: string,
      provider: ContextResult['provider'],
      available: boolean,
      label: string,
      statement: string,
      truth: 'observed' | 'modeled'
    ): ContextResult => ({
      needId,
      provider,
      status: available ? 'satisfied' : 'unavailable',
      retrievedAtMs: Date.parse(context.retrievedAt),
      statements: available
        ? [
            {
              nodeId: `live-${needId}`,
              label,
              statement,
              truth,
              authority: 'live-research',
              freshness: 'minutes'
            }
          ]
        : [],
      note: available ? `Retrieved for ${context.place.label}.` : `No ${label.toLowerCase()} was returned.`
    });
    const results: ContextResult[] = [
      result(
        'local-signals',
        'local-news',
        context.news.length > 0,
        'Local headlines',
        `${context.news.length} current public-feed headlines were retrieved.`,
        'observed'
      ),
      result(
        'market-moves',
        'market-data',
        context.markets.length > 0,
        'Market quotes',
        `${context.markets.length} current index quotes were retrieved.`,
        'observed'
      ),
      result(
        'local-weather',
        'weather',
        context.weather !== null || context.air !== null,
        'Weather and air',
        'Current weather and air-quality model outputs were retrieved.',
        'modeled'
      )
    ];
    for (const entry of results) graph = situationIntelligence.applyContextResult(graph, entry);
    state.situationGraph = graph;
    synthesize();
  }

  /**
   * Either asks the one question that is still worth asking, or resolves the
   * Signal Field. The budget lives in `state.inference`, so this can never
   * ask a third question no matter which path the user came in on.
   */
  function advanceNews(): void {
    const graph = state.situationGraph;
    if (graph?.kind === 'living-news') {
      state.situationGraph = situationIntelligence.applyNewsAnswers(
        graph,
        { scope: state.news.scope, horizon: state.news.horizon },
        discoveryContext()
      );
      synthesize();
    }
    const selected =
      state.situationGraph?.questionPlan.selected.find(
        (question) => question.id === 'news-scope' || question.id === 'news-horizon'
      ) ?? null;
    const question = selected
      ? chargeQuestion(selected, selected.id === 'news-scope' ? 'both' : 'today')
      : null;
    state.news.question = question;
    if (question) {
      state.view = 'clarify';
      render();
      return;
    }
    rebuildNewsWorld();
    state.view = 'field';
    render();
    void refreshLiveNewsContext();
    // The world is open and its centre is still only inferred: this is the
    // one moment News genuinely needs a location.
    void autoLocate('news');
  }

  /**
   * The non-Travel research path: an ambiguous news question, where no world
   * job has been chosen yet, so a sentence really is the right first result.
   */
  async function runResearch(prompt: string): Promise<void> {
    state.situation = null;
    state.busy = true;
    state.researchPending = true;
    state.error = null;
    render();

    /** The graph selected the offer; the shell only displays and charges it. */
    const chargeOffer = (): void => {
      if (state.news.situation && !state.news.keptLiteral) {
        const selected =
          state.situationGraph?.questionPlan.selected.find((question) => question.id === BRIEFING_OFFER.id) ??
          null;
        state.news.question = selected
          ? chargeQuestion(selected, BRIEFING_OFFER.fallbackOptionId)
          : null;
      }
    };

    const generation = state.requestGeneration;
    await performResearch(prompt, null, generation);
    if (generation !== state.requestGeneration) return;
    state.view = 'literal';
    chargeOffer();
    render();
  }

  /**
   * Establishes the literal answer and the flight reading for one ask.
   *
   * It never chooses a view: the caller decides whether the result belongs in
   * front of the user (Track) or quietly under an already-open world (Pickup).
   * A response from a superseded generation is dropped on the floor.
   */
  async function performResearch(
    prompt: string,
    situation: ArrivalSituation | null,
    generation: number,
    mode: 'initial' | 'refresh' = 'initial'
  ): Promise<void> {
    const graph = state.situationGraph;
    const providerCapabilities = capabilities();
    const plannedNeed = graph
      ? situationIntelligence
          .planContextAcquisition(graph, providerCapabilities, {
            reacquireSatisfied: mode === 'refresh'
          })
          .steps.find((step) => step.provider.id === 'web-search')
      : null;
    if (!LIVE_GATEWAY_ENABLED) {
      if (generation !== state.requestGeneration) return;
      state.literal = {
        prompt,
        text:
          'Live research is only available in Demo mode. This static build did not contact any source, so there is nothing observed to show.',
        model: null,
        contextTier: null,
        reasoningEffort: null,
        normalization: null,
        retrievedAt: null,
        citations: [],
        status: 'unavailable',
        reading: null
      };
      state.reading = situation
        ? unknownReading(situation.flightLabel, 'Demo mode is off, so no source was consulted.')
        : null;
      if (graph) {
        state.situationGraph = situationIntelligence.markContextUnavailable(
          graph,
          graph.kind === 'travel-arrival' ? 'flight-status' : 'live-research',
          'Demo mode is off, so the provider did not run.'
        );
        synthesize();
      }
      state.busy = false;
      state.researchPending = false;
      return;
    }

    if (!plannedNeed) {
      state.literal = {
        prompt,
        text: 'No permitted context provider is available for this question.',
        model: null,
        contextTier: null,
        reasoningEffort: null,
        normalization: null,
        retrievedAt: null,
        citations: [],
        status: 'unavailable',
        reading: null
      };
      state.reading = situation
        ? unknownReading(situation.flightLabel, 'Situation Intelligence did not authorize a provider.')
        : null;
      state.busy = false;
      state.researchPending = false;
      return;
    }

    try {
      const response = await askLiveAgent(prompt);
      if (generation !== state.requestGeneration) return;
      const currentGraph = state.situationGraph;
      const interpretation = currentGraph
        ? situationIntelligence.ingestLiveResearch(currentGraph, {
            answer: response.answer,
            nowMs: now(),
            flightLabel: situation?.flightLabel,
            retrievedAt: response.retrievedAt
          })
        : null;
      const reading = interpretation?.reading ?? null;
      if (interpretation) {
        state.situationGraph = interpretation.graph;
        synthesize();
      }
      state.literal = {
        prompt,
        text: response.answer,
        model: response.model,
        contextTier: response.contextTier,
        reasoningEffort: response.reasoningEffort,
        normalization: response.normalization ?? null,
        retrievedAt: response.retrievedAt,
        citations: extractCitations(response.answer),
        status: 'answered',
        reading
      };
      state.reading = reading;
    } catch (error) {
      if (generation !== state.requestGeneration) return;
      const message = error instanceof Error ? error.message : 'The live gateway did not answer.';
      state.literal = {
        prompt,
        text: `Live research did not return an answer: ${message}`,
        model: null,
        contextTier: null,
        reasoningEffort: null,
        normalization: null,
        retrievedAt: null,
        citations: [],
        status: 'unavailable',
        reading: null
      };
      state.reading = situation ? unknownReading(situation.flightLabel, message) : null;
      const currentGraph = state.situationGraph;
      if (currentGraph) {
        state.situationGraph = situationIntelligence.markContextUnavailable(
          currentGraph,
          currentGraph.kind === 'travel-arrival' ? 'flight-status' : 'live-research',
          message
        );
        synthesize();
      }
    }
    if (generation !== state.requestGeneration) return;
    state.busy = false;
    state.researchPending = false;
  }

  /**
   * Travel is world-first: the job question is already on screen inside a
   * forming Time Terrain when this starts, and the answer lands *into* whatever
   * the user has chosen by the time it arrives.
   */
  async function startTravelResearch(
    prompt: string,
    situation: ArrivalSituation,
    generation: number
  ): Promise<void> {
    await performResearch(prompt, situation, generation);
    if (generation !== state.requestGeneration) return;

    if (state.chosenJob === 'pickup') {
      // The world is already open with honest unknowns: update it in place.
      if (state.reading) rebuildPlan();
      // The cadence follows the facts that just landed.
      scheduleRefresh();
    } else if (state.chosenJob === 'track') {
      state.view = 'literal';
    }
    render();
  }

  /** Keeps the corridor label attached to the origin the user actually picked. */
  function reprojectConditions(): void {
    if (!state.conditions) return;
    state.conditions = sampleConditions(
      state.conditionStep,
      state.origin?.id ?? null,
      state.conditions.traffic.checkedAtMs
    );
  }

  /* ---------------------------------------------- the automatic coarse fix */

  /**
   * The persistent "always use my location" preference, applied.
   *
   * It is a convenience, not a new capability: it fires the *same*
   * `requestCoarseOrigin()` the explicit buttons fire, so the browser
   * permission is still authoritative, the coordinates are still discarded
   * inside that function, and nothing is stored beyond the boolean consent.
   *
   * Guarantees held here:
   *   - never on Home, on a literal answer, or in any world that does not
   *     genuinely need a location;
   *   - never when the world already has a location the user chose;
   *   - at most one request in flight, tracked by the same geolocation
   *     generation token the explicit path uses, so a manual choice, a new
   *     ask, a Start over, or switching the preference off all make a late
   *     automatic result lose.
   */
  let autoFixToken: number | null = null;
  /**
   * True while the current origin came from an automatic fix rather than a
   * deliberate choice. Nothing outbound is allowed to name such a place.
   */
  let autoOrigin = false;

  function autoFixInFlight(): boolean {
    return autoFixToken !== null && autoFixToken === state.geoGeneration;
  }

  function travelNeedsLocation(): boolean {
    return state.chosenJob === 'pickup' && state.view === 'terrain' && state.origin === null;
  }

  function newsNeedsLocation(): boolean {
    return state.view === 'field' && state.news.placeTruth === 'inferred';
  }

  function homeNeedsLocation(): boolean {
    return state.view === 'home' && state.news.placeTruth === 'inferred';
  }

  async function autoLocate(
    world: 'travel' | 'news' | 'home',
    explicitGesture = false
  ): Promise<void> {
    if (!state.alwaysUseLocation && !explicitGesture) return;
    if (autoFixInFlight()) return;
    if (
      world === 'travel'
        ? !travelNeedsLocation()
        : world === 'news'
          ? !newsNeedsLocation()
          : !homeNeedsLocation()
    ) return;

    const token = ++state.geoGeneration;
    autoFixToken = token;
    state.autoLocationStatus = 'requesting';
    if (world === 'travel') state.locationState = 'requesting';
    render();

    const outcome =
      world === 'home'
        ? await requestSharedCoarseLocation()
        : await acquireCoarseLocation(world === 'travel' ? 'origin-location' : 'news-place');
    if (autoFixToken === token) autoFixToken = null;
    // Superseded: a place was chosen, the view changed, or the preference was
    // switched off while this was pending.
    if (token !== state.geoGeneration) return;

    if (world !== 'home') {
      foldLocationOutcome(world === 'travel' ? 'origin-location' : 'news-place', outcome);
    }
    state.autoLocationStatus = outcome.status;

    if (world === 'home') {
      if (outcome.status === 'granted') {
        const place = findNewsPlace(COARSE_ORIGIN_TO_PLACE[outcome.origin.id] ?? outcome.origin.id);
        if (place) {
          state.news.place = place;
          state.news.placeTruth = 'coarse-location';
          refreshNewsContext(state.news, 'initial');
        }
      }
      render();
      return;
    }

    if (world === 'travel') {
      if (outcome.status === 'granted') {
        recordChange(`Starting point set to ${outcome.origin.label}`);
        state.origin = outcome.origin;
        autoOrigin = true;
        state.locationState = 'granted';
        state.placesVisible = false;
        state.travelQuestion = null;
      } else {
        // The preference stays on. Only this attempt failed, and the manual
        // choices come back so the world can still be completed.
        state.locationState = outcome.status;
        state.placesVisible = true;
      }
      reprojectConditions();
      rebuildPlan();
      syncTravelOriginQuestion();
      render();
      return;
    }

    if (outcome.status === 'granted') {
      const place = findNewsPlace(COARSE_ORIGIN_TO_PLACE[outcome.origin.id] ?? outcome.origin.id);
      if (place) {
        state.news.place = place;
        state.news.placeTruth = 'coarse-location';
        state.news.placesVisible = false;
        refreshNewsContext(state.news);
        applyWorldEdit(state.news, { label: `Centred on ${place.label}` });
        rebuildNewsWorld();
        void refreshLiveNewsContext();
      }
    } else {
      state.news.placesVisible = true;
    }
    render();
  }

  const actions: AppActions = {
    async ask(prompt: string) {
      const trimmed = prompt.trim();
      if (!trimmed || state.busy) {
        if (!trimmed) {
          state.error = 'Say what you are trying to do, in your own words.';
          render();
        }
        return;
      }
      state.prompt = trimmed;
      state.chosenJob = null;
      state.plan = null;
      state.changes = [];
      state.literal = null;
      state.reading = null;
      state.situation = null;
      state.travelQuestion = null;
      state.error = null;
      cancelRefresh();
      state.conditions = null;
      state.conditionStep = 0;
      state.refresh = idleRefresh();
      undoStack.clear();
      state.inference = createInference();
      state.news = freshNewsSessionPreservingPlace();
      resetPipeline();
      state.stops = [];
      state.journey = null;
      state.lens = 'journey';
      state.bingRouteLive = false;
      // Any research or geolocation still in flight belongs to a dead session.
      const generation = ++state.requestGeneration;
      state.geoGeneration += 1;
      /*
       * Core 1, once. The engine owns the detectors, the information needs and
       * question economics; the shell only reads `graph.kind` to decide which
       * world-shaped surface to open.
       */
      const graph = situationIntelligence.discover(trimmed, discoveryContext());
      state.situationGraph = graph;
      state.situation = graph.readings.arrival;
      if (graph.place.source === 'prompt' && graph.place.id) {
        const inferredOrigin = ORIGIN_OPTIONS.find((option) => option.id === graph.place.id) ?? null;
        if (inferredOrigin) {
          state.origin = inferredOrigin;
          state.locationState = 'manual';
          autoOrigin = false;
        }
      }
      synthesize();

      if (graph.kind === 'travel-arrival' && graph.readings.arrival) {
        // World-first: the Travel job question appears immediately, inside a
        // forming Time Terrain, and research runs beside it.
        const situation = graph.readings.arrival;
        // Party size is never asked — but if it was already said, it is heard.
        const party = parsePartyCount(trimmed);
        if (party !== null) state.assumptions = { ...state.assumptions, passengerCount: party };
        // The question the graph selected is the question that gets asked, and
        // the global budget still decides whether it may be shown at all.
        const jobQuestion = graph.questionPlan.selected.find((entry) => entry.id === 'travel-job') ?? null;
        state.travelQuestion = jobQuestion
          ? chargeQuestion(jobQuestion, 'track')
          : null;
        state.researchPending = true;
        state.busy = true;
        state.view = 'clarify';
        render();
        void startTravelResearch(trimmed, situation, generation);
        void generateBlueprint(trimmed, generation);
        return;
      }

      const news = graph.readings.news;
      if (news) {
        state.news.situation = news;
        state.news.scope = news.scope;
        state.news.horizon = news.horizon;
        if (news.scope) state.news.layers = layersForScope(news.scope);
        const hinted = news.placeHint ? findNewsPlace(news.placeHint.toLowerCase()) : null;
        if (hinted) {
          state.news.place = hinted;
          state.news.placeTruth = 'chosen';
          refreshNewsContext(state.news, 'initial');
        }
        if (graph.kind === 'living-news') {
          // Already an assembly request: no literal detour, no live claim.
          advanceNews();
          return;
        }
      }

      // Each curated scenario opens its own purpose-built visual world.
      if (graph.scenarioId === 'real-estate') {
        openPlace(trimmed, graph.scenarioId);
        return;
      }
      if (graph.scenarioId === 'product-research') {
        await openCompare(trimmed, generation);
        return;
      }
      if (graph.scenarioId === 'urgent-symptom-triage') {
        await openTriage(trimmed, generation);
        return;
      }

      await runResearch(trimmed);
    },
    setPrompt(value: string) {
      state.prompt = value;
    },
    async useHomeLocation() {
      await autoLocate('home', true);
    },
    chooseJob(id: JobHypothesisId) {
      state.chosenJob = id;
      state.travelQuestion = null;
      const situation: ArrivalSituation | null = state.situation;

      // The job answer is the one thing that re-derives the whole situation:
      // which information the world still needs, which questions are left, and
      // therefore which world Core 2 synthesises.
      const graph = state.situationGraph;
      if (graph) {
        state.situationGraph = situationIntelligence.chooseJob(graph, id, discoveryContext());
        synthesize();
      }

      if (id === 'pickup') {
        if (!state.reading) {
          state.reading = unknownReading(
            situation?.flightLabel ?? 'Inbound flight',
            state.researchPending
              ? 'Live research is still running, so no arrival reading exists yet.'
              : 'No arrival reading is available for this question yet.'
          );
        }
        if (situation && !situation.international) {
          state.assumptions.internationalArrival = false;
          // The customs segment just disappeared from the situation, so the
          // graph is re-derived before the world is built from it.
          regraph();
        }
        state.view = 'terrain';
        // The world stands in weather and traffic from the moment it opens.
        state.conditions = sampleConditions(state.conditionStep, state.origin?.id ?? null, now());
        state.refresh = { ...idleRefresh(), lastCheckedMs: now() };
        rebuildPlan();
        syncTravelOriginQuestion();
        scheduleRefresh();
        // A pickup with no origin has half a world; the blueprint now asks the
        // one question that unlocks the other half.
        void generateBlueprint(state.prompt, state.requestGeneration);
      } else if (id === 'track') {
        cancelRefresh();
        // The literal answer is the outcome here — shown the moment it exists.
        state.view = state.literal ? 'literal' : 'clarify';
      } else {
        cancelRefresh();
        state.view = 'connection';
      }
      render();
      // Pickup is the Travel world that genuinely needs a starting point. If
      // one is already known, this does nothing at all.
      if (id === 'pickup') void autoLocate('travel');
    },
    backHome() {
      cancelRefresh();
      state.view = 'home';
      state.chosenJob = null;
      state.plan = null;
      state.literal = null;
      state.decisionPlan = null;
      state.decision = null;
      state.decisionPrompt = '';
      state.decisionPending = false;
      state.placeWorld = null;
      state.placePrompt = '';
      state.compare = null;
      state.triage = null;
      state.reading = null;
      state.situation = null;
      state.travelQuestion = null;
      state.researchPending = false;
      state.busy = false;
      state.requestGeneration += 1;
      state.geoGeneration += 1;
      state.origin = null;
      state.locationState = 'idle';
      state.autoLocationStatus = 'idle';
      autoOrigin = false;
      state.placesVisible = false;
      state.assumptions = { ...DEFAULT_ASSUMPTIONS };
      state.changes = [];
      state.conditions = null;
      state.conditionStep = 0;
      state.refresh = idleRefresh();
      state.error = null;
      state.inference = createInference();
      state.news = freshNewsSessionPreservingPlace();
      resetPipeline();
      state.stops = [];
      state.journey = null;
      state.lens = 'journey';
      state.bingRouteLive = false;
      undoStack.clear();
      render();
    },
    async useMyLocation() {
      const token = ++state.geoGeneration;
      state.locationState = 'requesting';
      render();
      const outcome = await acquireCoarseLocation('origin-location');
      // The user may have picked a place, or left, while this was pending.
      if (token !== state.geoGeneration) return;
      foldLocationOutcome('origin-location', outcome);
      if (outcome.status === 'granted') {
        recordChange(`Starting point set to ${outcome.origin.label}`);
        state.origin = outcome.origin;
        autoOrigin = false;
        state.locationState = 'granted';
        state.placesVisible = false;
        state.travelQuestion = null;
      } else {
        state.locationState = outcome.status;
        state.placesVisible = true;
      }
      reprojectConditions();
      rebuildPlan();
      syncTravelOriginQuestion();
      render();
    },
    showPlaces() {
      state.placesVisible = true;
      state.locationState = 'manual';
      render();
    },
    chooseOrigin(id: string) {
      const option = ORIGIN_OPTIONS.find((entry) => entry.id === id);
      if (!option) return;
      state.geoGeneration += 1;
      recordChange(`Starting point set to ${option.label}`);
      state.origin = option;
      autoOrigin = false;
      state.locationState = 'manual';
      state.placesVisible = false;
      state.travelQuestion = null;
      reprojectConditions();
      rebuildPlan();
      render();
    },
    chooseTypedOrigin(label: string) {
      const known = ORIGIN_OPTIONS.find((entry) => entry.label.toLowerCase() === label.toLowerCase());
      const option: OriginOption = known ?? {
        id: 'typed-origin',
        label,
        driveMinutes: TYPED_ORIGIN_DRIVE_MINUTES,
        lat: 0,
        lon: 0
      };
      state.geoGeneration += 1;
      recordChange(`Starting point set to ${option.label}`);
      state.origin = option;
      autoOrigin = false;
      state.locationState = 'manual';
      state.placesVisible = false;
      state.travelQuestion = null;
      reprojectConditions();
      rebuildPlan();
      render();
    },
    editAssumptions(text: string) {
      const edit = parseAssumptionEdit(text);
      if (!edit) {
        state.error = null;
        return false;
      }
      recordChange(edit.label);
      state.assumptions = { ...state.assumptions, ...edit.patch };
      rebuildPlan();
      render();
      return true;
    },
    toggleCheckedBag() {
      recordChange(state.assumptions.checkedBag ? 'No checked bag' : 'Checked bag');
      state.assumptions = { ...state.assumptions, checkedBag: !state.assumptions.checkedBag };
      rebuildPlan();
      render();
    },
    setLens(lens: JourneyLens) {
      if (state.lens === lens) return;
      state.lens = lens;
      // A lens is a presentation choice, so it re-enters through synthesis —
      // the same gate a model blueprint has to pass.
      synthesize();
      render();
    },
    /**
     * A stop is offered, never asked for. Adding one is a pure local
     * recompute: the route deforms, the drive range grows by the stop's stated
     * minutes, and the leave-by in the envelope moves earlier — with no model
     * call and no new question.
     */
    addStop(optionId: string) {
      const option = findStopOption(optionId);
      if (!option) return;
      if (state.stops.some((stop) => stop.id.startsWith(option.id))) return;
      const stop: JourneyStop = {
        id: `${option.id}-${state.stops.length + 1}`,
        label: option.label,
        reason: option.reason,
        minutes: { ...option.minutes },
        lat: option.point.lat,
        lon: option.point.lon,
        truth: 'inferred'
      };
      recordChange(`Stop added: ${option.label}`);
      state.stops = [...state.stops, stop];
      rebuildPlan();
      render();
    },
    removeStop(stopId: string) {
      const target = state.stops.find((stop) => stopId.includes(stop.id));
      if (!target) return;
      recordChange(`Stop removed: ${target.label}`);
      state.stops = state.stops.filter((stop) => stop.id !== target.id);
      rebuildPlan();
      render();
    },
    toggleArrivalKind() {
      const next = !state.assumptions.internationalArrival;
      recordChange(next ? 'International arrival' : 'Domestic arrival');
      state.assumptions = { ...state.assumptions, internationalArrival: next };
      rebuildPlan();
      render();
    },
    undoChange() {
      const previous = undoStack.undo();
      if (!previous) return;
      state.assumptions = previous.assumptions;
      state.origin = previous.origin;
      autoOrigin = previous.originAuto;
      state.reading = previous.reading;
      state.stops = previous.stops;
      state.changes = state.changes.slice(0, -1);
      rebuildPlan();
      render();
    },
    async recheck() {
      // A manual look resets the schedule instead of stacking onto it.
      disarm();
      const token = ++refreshToken;
      const generation = ++state.requestGeneration;
      state.geoGeneration += 1;
      state.researchPending = true;
      state.busy = true;
      render();
      await performResearch(state.prompt, state.situation, generation, 'refresh');
      if (generation !== state.requestGeneration || token !== refreshToken) return;
      if (state.chosenJob === 'pickup') {
        state.view = 'terrain';
        state.conditionStep += 1;
        state.conditions = sampleConditions(state.conditionStep, state.origin?.id ?? null, now());
        state.refresh = { ...state.refresh, lastCheckedMs: now(), checks: state.refresh.checks + 1 };
        rebuildPlan();
        scheduleRefresh();
      }
      render();
    },
    toggleConditionLayer(id: keyof ConditionLayers) {
      // Visibility only. The force keeps shaping the plan either way, so the
      // world can never be made to look calmer than the situation is.
      state.conditionLayers = { ...state.conditionLayers, [id]: !state.conditionLayers[id] };
      render();
    },
    previewSample() {
      recordChange('Loaded the labelled sample scenario');
      const landingMs = now() - SAMPLE_SCENARIO.minutesSinceLanding * 60_000;
      state.reading = {
        status: 'landed',
        phase: 'landed',
        actualLandingMs: landingMs,
        scheduledArrivalMs: null,
        estimatedArrivalMs: null,
        landingMs,
        landingLabel: null,
        truth: 'observed',
        note: SAMPLE_SCENARIO.note,
        citations: SAMPLE_SCENARIO.citations,
        provenance: 'sample',
        flightLabel: `${SAMPLE_SCENARIO.flightLabel} (SAMPLE DATA)`,
        retrievedAt: null
      };
      state.assumptions = { ...DEFAULT_ASSUMPTIONS };
      state.conditions = sampleConditions(state.conditionStep, state.origin?.id ?? null, now());
      rebuildPlan();
      scheduleRefresh();
      render();
    },
    answerClarification(questionId: string, optionId: string) {
      if (questionId === BRIEFING_OFFER.id) {
        state.news.question = null;
        if (optionId === 'briefing') {
          // The situation was always a briefing; only now is it stated, so the
          // graph is rebuilt as that situation before any world is assembled.
          const graph = state.situationGraph;
          if (graph) {
            state.situationGraph = situationIntelligence.promoteToBriefing(graph, discoveryContext());
            synthesize();
          }
          advanceNews();
        } else {
          state.news.keptLiteral = true;
          render();
        }
        return;
      }
      answerNewsQuestion(state.news, questionId, optionId);
      advanceNews();
    },
    toggleLayer(id: LayerId) {
      const next = !state.news.layers[id];
      applyWorldEdit(state.news, {
        label: `${LAYER_LABELS[id]} ${next ? 'shown' : 'hidden'}`,
        layers: { [id]: next }
      });
      rebuildNewsWorld();
      render();
    },
    editWorld(text: string) {
      const edit = parseWorldEdit(text);
      if (!edit) return false;
      applyWorldEdit(state.news, edit);
      rebuildNewsWorld();
      render();
      return true;
    },
    toggleNewsPlaces() {
      state.news.placesVisible = !state.news.placesVisible;
      render();
    },
    chooseNewsPlace(id: string) {
      const place = findNewsPlace(id);
      if (!place) return;
      // A deliberate choice always outranks a geolocation request in flight.
      state.geoGeneration += 1;
      state.news.place = place;
      state.news.placeTruth = 'chosen';
      state.news.placesVisible = false;
      refreshNewsContext(state.news);
      applyWorldEdit(state.news, { label: `Centred on ${place.label}` });
      rebuildNewsWorld();
      void refreshLiveNewsContext();
      render();
    },
    async useNewsLocation() {
      const token = ++state.geoGeneration;
      const outcome = await acquireCoarseLocation('news-place');
      if (token !== state.geoGeneration) return;
      foldLocationOutcome('news-place', outcome);
      if (outcome.status === 'granted') {
        const place = findNewsPlace(COARSE_ORIGIN_TO_PLACE[outcome.origin.id] ?? outcome.origin.id);
        if (place) {
          state.news.place = place;
          state.news.placeTruth = 'coarse-location';
          state.news.placesVisible = false;
          refreshNewsContext(state.news);
          applyWorldEdit(state.news, { label: `Centred on ${place.label}` });
          rebuildNewsWorld();
          void refreshLiveNewsContext();
        }
      } else {
        state.news.placesVisible = true;
      }
      render();
    },
    openSources() {
      state.dialogOpener = activeNodeId();
      state.sourcesOpen = true;
      render();
    },
    closeSources() {
      if (!state.sourcesOpen) return;
      state.sourcesOpen = false;
      state.pendingFocus = state.dialogOpener;
      state.dialogOpener = null;
      render();
    },
    openMore() {
      state.dialogOpener = activeNodeId();
      state.moreOpen = true;
      render();
    },
    closeMore() {
      if (!state.moreOpen) return;
      state.moreOpen = false;
      state.pendingFocus = state.dialogOpener;
      state.dialogOpener = null;
      render();
    },
    setAppearance(patch: Partial<Appearance>) {
      state.appearance = { ...state.appearance, ...patch };
      applyAppearance(state.appearance);
      saveAppearance(state.appearance);
      render();
    },
    setDevMode(enabled: boolean) {
      state.devMode = enabled;
      render();
    },
    rerootDecision(directionId: string) {
      const plan = state.decisionPlan;
      if (!plan) return;
      // Tapping the alternative is a hill-climbing step: this direction climbs,
      // the wrong guess drops, and the engine is smarter next time.
      learn(
        learningStore,
        { scenarioId: plan.scenarioId, reinforceDirection: directionId, penalizeDirection: plan.top.id },
        now()
      );
      const next = planDecision(state.decisionPrompt, plan.scenarioId, {
        forcedDirectionId: directionId,
        adjustments: learningStore.get(plan.scenarioId)
      });
      if (!next) return;
      if (state.view === 'compare') {
        const generation = (state.requestGeneration += 1);
        void openCompare(state.decisionPrompt, generation);
        return;
      }
      if (state.view === 'place') {
        // In the map world, a re-root re-times the whole map around the new
        // direction instead of re-calling a model.
        state.decisionPlan = next;
        state.placeWorld = buildPlaceWorld(
          cityById(state.placeCityId),
          state.placeAnchorId,
          toPlaceDirection(next.top.id)
        );
        render();
        return;
      }
      const generation = (state.requestGeneration += 1);
      state.decisionPlan = next;
      state.decision = null;
      state.decisionPending = true;
      state.busy = true;
      render();
      void assembleDecision(next, state.decisionPrompt, generation).then(() => {
        if (generation !== state.requestGeneration) return;
        state.busy = false;
        render();
      });
    },
    refineDecision(text: string) {
      const plan = state.decisionPlan;
      const value = text.trim();
      if (!value) return;
      if (state.view === 'compare') {
        const generation = (state.requestGeneration += 1);
        void openCompare(`${state.decisionPrompt} — ${value}`, generation);
        return;
      }
      if (state.view === 'triage') {
        const generation = (state.requestGeneration += 1);
        void openTriage(`${state.decisionPrompt} — ${value}`, generation);
        return;
      }
      if (!plan) return;
      if (state.view === 'place') {
        // "my office is near The Domain" re-anchors and re-times the map;
        // anything else re-derives the direction and rebuilds it.
        const city = cityById(state.placeCityId);
        const anchor = resolveAnchor(city, value);
        if (anchor) {
          state.placeAnchorId = anchor.id;
          const world = buildPlaceWorld(city, anchor.id, toPlaceDirection(plan.top.id));
          state.placeWorld = world;
          state.placeNote = `Commute now measured from ${anchor.name}.`;
          render();
          void applyRealCommutes(world);
          return;
        }
        const refined = `${state.placePrompt} — ${value}`;
        learn(learningStore, { scenarioId: plan.scenarioId, boostForces: [value.toLowerCase()] }, now());
        const nextPlan = planDecision(refined, plan.scenarioId, {
          adjustments: learningStore.get(plan.scenarioId)
        });
        if (nextPlan && nextPlan.top.id !== plan.top.id) {
          state.decisionPlan = nextPlan;
          state.placePrompt = refined;
          state.placeWorld = buildPlaceWorld(city, state.placeAnchorId, toPlaceDirection(nextPlan.top.id));
          state.placeNote = `Now optimising for “${nextPlan.top.label}”.`;
          render();
          return;
        }
        // Not an office and not an intent change — say so instead of nothing.
        state.placeNote = /\b(costco|grocery|store|restaurant|coffee|gym|near me|nearby|shop|amenit)\b/i.test(value)
          ? `Nearby-places maps aren’t built yet — this world helps you choose a neighborhood. Try naming your office, e.g. “my office is near ${city.anchors[0].name}”.`
          : `I couldn’t act on “${value}”. Try naming your office (“my office is near ${city.anchors[1]?.name ?? city.anchors[0].name}”) or your intent (“renting”, “buying”, “investing”).`;
        render();
        return;
      }
      const refinedPrompt = `${state.decisionPrompt} — ${value}`;
      learn(learningStore, { scenarioId: plan.scenarioId, boostForces: [value.toLowerCase()] }, now());
      const next = planDecision(refinedPrompt, plan.scenarioId, {
        adjustments: learningStore.get(plan.scenarioId)
      });
      if (!next) return;
      const generation = (state.requestGeneration += 1);
      state.decisionPrompt = refinedPrompt;
      state.decisionPlan = next;
      state.decision = null;
      state.decisionPending = true;
      state.busy = true;
      render();
      void assembleDecision(next, refinedPrompt, generation).then(() => {
        if (generation !== state.requestGeneration) return;
        state.busy = false;
        render();
      });
    },
    actOnDecision() {
      const plan = state.decisionPlan;
      if (!plan) return;
      const query = encodeURIComponent(`${state.decisionPrompt} ${plan.top.label}`);
      window.open(`https://www.bing.com/search?q=${query}`, '_blank', 'noopener');
    },
    reanchorPlace(anchorId: string) {
      state.placeAnchorId = anchorId;
      const direction = toPlaceDirection(state.decisionPlan?.top.id ?? 'relocate-family');
      const world = buildPlaceWorld(cityById(state.placeCityId), anchorId, direction);
      state.placeWorld = world;
      render();
      void applyRealCommutes(world);
    },
    zoomPlace(factor: number) {
      const world = state.placeWorld;
      if (!world) return;
      const current = state.placeRadiusMiles ?? world.radiusMiles;
      state.placeRadiusMiles = Math.max(3, Math.min(80, Math.round(current * factor * 10) / 10));
      render();
    },
    panPlace(dLatFactor: number, dLonFactor: number) {
      const world = state.placeWorld;
      if (!world) return;
      const radius = state.placeRadiusMiles ?? world.radiusMiles;
      const degLat = radius / 69;
      const degLon = radius / (69 * Math.max(0.2, Math.cos((world.center.lat * Math.PI) / 180)));
      state.placeCenterDLat += degLat * dLatFactor;
      state.placeCenterDLon += degLon * dLonFactor;
      render();
    },
    recenterPlace() {
      state.placeRadiusMiles = null;
      state.placeCenterDLat = 0;
      state.placeCenterDLon = 0;
      render();
    },
    async setAlwaysUseLocation(enabled: boolean) {
      state.alwaysUseLocation = enabled;
      // Consent only. The record is a version tag and this boolean.
      saveLocationPreference(enabled);
      state.autoLocationStatus = 'idle';
      if (!enabled) {
        // A fix already in flight belongs to a preference that no longer
        // exists. The world keeps whatever location it already has.
        state.geoGeneration += 1;
        autoFixToken = null;
        render();
        return;
      }
      render();
      // The toggle click *is* the user gesture, so a world that is open and
      // still missing its location can be completed right now.
      if (homeNeedsLocation()) await autoLocate('home');
      else if (travelNeedsLocation()) await autoLocate('travel');
      else if (newsNeedsLocation()) await autoLocate('news');
    }
  };

  const ctx: ViewContext = { state, actions };

  function activeNodeId(): string | null {
    return document.activeElement instanceof HTMLElement ? document.activeElement.dataset.node ?? null : null;
  }

  /**
   * Points the GPU layer at the surface that is actually on screen, in that
   * surface's own coordinates: the Signal Field centre follows the DOM centre
   * when Markets shifts it, and the terrain's NOW column lands on the DOM NOW
   * rule. Measured once per render — never per frame.
   */
  function syncVisuals(): void {
    const journeyActive = state.view === 'terrain' && state.lens === 'journey' && state.journey !== null;
    const mode: FxMode | null =
      state.view === 'home'
        ? 'home'
        : state.view === 'field'
          ? 'news'
          : state.view === 'terrain'
            ? journeyActive
              ? 'journey'
              : 'travel'
            : null;
    if (!mode) {
      syncVisualEngine(null);
      return;
    }

    const params: Partial<FxParams> = {
      revision: state.worldRevision,
      intensity: state.appearance.contrast === 'high' ? 0.5 : 1
    };

    if ((mode === 'travel' || mode === 'journey') && state.plan) {
      const plan = state.plan;
      const world = root.querySelector<HTMLElement>('[data-node="world"]');
      const overlay = root.querySelector<HTMLElement>('.world-overlay');
      const percent = positionPercent(plan.horizon, plan.nowMs) / 100;
      if (world && overlay) {
        const worldRect = world.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        params.nowX =
          worldRect.width > 0
            ? (overlayRect.left - worldRect.left + percent * overlayRect.width) / worldRect.width
            : percent;
      } else {
        params.nowX = percent;
      }
      params.resolved = plan.resolved ? 1 : 0;

      // Everything below is read from the situation, never chosen for looks.
      // Delete the datum and the motion it drives disappears with it.
      params.flightPhase = PHASE_LEVEL[plan.phase] ?? 0;
      params.flightProgress = positionPercent(plan.horizon, plan.anchor.ms) / 100;

      // One decision, made once, in `motion.ts`: what is actually happening.
      // The GPU layer and the words under the map read the same answer.
      const motion = motionState(state);
      params.trafficActive = motion.trafficLoad > 0 ? 1 : 0;
      params.weatherActive = motion.weatherIntensity > 0 ? 1 : 0;
      params.flightActive = motion.flightMoving ? 1 : 0;
      params.disruptionActive = motion.disruption ? 1 : 0;
      params.refreshDue = motion.refreshDue ? 1 : 0;

      const conditions = plan.conditions;
      if (conditions) {
        const wind = windVector(conditions.weather);
        params.weatherIntensity = weatherIntensity(conditions.weather);
        params.windX = wind.x;
        params.windY = wind.y;
        params.trafficLoad = conditions.traffic.congestion;
        params.trafficTrend = TREND_LEVEL[conditions.traffic.trend];
      } else {
        params.weatherIntensity = 0;
        params.windX = 0;
        params.windY = 0;
        params.trafficLoad = 0;
        params.trafficTrend = 0;
      }

      params.refreshUrgency = urgencyLevel(state.refresh.urgency);
      params.minutesToRefresh = refreshCountdown(
        plan.nowMs,
        state.refresh.lastCheckedMs,
        state.refresh.nextCheckMs
      );

      // The Journey plane is aligned to the route the DOM actually drew, in
      // the map's own coordinates, so the GPU ground and the SVG agree.
      if (mode === 'journey' && state.journey) {
        const journey: JourneyWorld = state.journey;
        const bearing = routeBearing(journey.mainPath);
        params.airportX = journey.seaAt.x / 100;
        params.airportY = journey.seaAt.y / 100;
        params.routeX = bearing.x;
        params.routeY = -bearing.y;
        params.routeProgress = journey.nowOnRoute;
        params.routeKnown = journey.origin ? 1 : 0;
      }
    }

    if (mode === 'news' && state.news.world) {
      const newsWorld = state.news.world;
      // No live market feed exists in this build, so the axis is a reading and
      // the field stands still. Wire a live source and the currents start.
      params.marketLive = 0;
      const stage = root.querySelector<HTMLElement>('[data-node="world"]');
      const plot = root.querySelector<HTMLElement>('[data-node="field-plot"]');
      const region = newsWorld.rings.find((ring) => ring.id === 'region') ?? { rx: 47, ry: 46 };
      params.centerX = newsWorld.centerX / 100;
      params.ellipseX = 0.3;
      params.ellipseY = 0.46;
      if (stage && plot) {
        const stageRect = stage.getBoundingClientRect();
        const plotRect = plot.getBoundingClientRect();
        if (stageRect.width > 0 && stageRect.height > 0 && plotRect.width > 0) {
          params.centerX =
            (plotRect.left - stageRect.left + (newsWorld.centerX / 100) * plotRect.width) / stageRect.width;
          params.ellipseX = ((region.rx / 100) * plotRect.width) / stageRect.width;
          params.ellipseY = ((region.ry / 100) * plotRect.height) / stageRect.height;
        }
      }
    }

    syncVisualEngine(mode, params);
  }

  function render(): void {
    const activeNode = activeNodeId();
    clear(root);

    const view =
      state.view === 'home'
        ? renderHome(ctx)
        : state.view === 'literal'
          ? renderLiteral(ctx)
          : state.view === 'clarify'
            ? renderClarify(ctx)
            : state.view === 'connection'
              ? renderConnection(ctx)
              : state.view === 'decision'
                ? renderDecision(ctx)
                  : state.view === 'place'
                    ? renderPlaceWorld(ctx)
                    : state.view === 'compare'
                      ? renderCompare(ctx)
                      : state.view === 'triage'
                        ? renderTriage(ctx)
                        : state.view === 'field'
                          ? renderSignalField(ctx)
                          : renderTerrain(ctx);
    root.append(view);
    if (state.devMode) root.append(renderDevPanel(ctx));

    if (state.sourcesOpen) {
      const sheet = renderSourcesSheet(ctx);
      root.append(sheet);
      sheet.showModal();
    }
    if (state.moreOpen) {
      const menu = renderMoreMenu(ctx);
      root.append(menu);
      menu.showModal();
    }

    const world = root.querySelector<HTMLElement>('[data-node="world"]');
    if (world && state.worldRevision !== renderedRevision) {
      world.classList.add('world--changed');
      renderedRevision = state.worldRevision;
    }

    // Direct field type is only safe once it has been measured against the
    // centre anchor and the ring names, so the pass runs after layout.
    if (state.view === 'field') layoutFieldLabels(root);
    if (state.view === 'place') layoutPlaceWorld(root);

    // A dialog hands focus back to the control that opened it; everything else
    // keeps the node the user was already on.
    const target = state.pendingFocus ?? activeNode;
    state.pendingFocus = null;
    if (target) {
      const restored = root.querySelector<HTMLElement>(`[data-node="${target}"]`);
      restored?.focus({ preventScroll: true });
    }
    document.body.dataset.view = state.view;
    // Which world's atmosphere the page is standing in, so the ground under a
    // forming Travel terrain is never the Signal Field's deep space.
    const newsSurface =
      state.view === 'field' || (state.view === 'clarify' && !state.travelQuestion && state.chosenJob !== 'track');
    document.body.dataset.world = newsSurface ? 'news' : state.situation ? 'travel' : 'none';

    // The GPU layer is mounted last, against the DOM that now exists. Any
    // engine for a surface that just went away is disposed inside this call.
    syncVisuals();
  }

  /**
   * The map is the authority on who owns the route.
   *
   * When Bing's frame is live and carrying the route, Bing also draws the
   * traffic on it, so CanvasBrowser's own corridor motion would be a second
   * claim about the same road. The flag is read by `motion.ts`, which is the
   * one place that decides what may animate — so the legend, the GPU layer and
   * the SVG all stop together, or all run together.
   *
   * A full re-render here would be wrong, not merely wasteful: the base is a
   * singleton iframe, and re-appending it into a freshly built tree makes the
   * browser reload it — which would make the frame go live again, flip the
   * source back, and loop. So exactly the two things that depend on the answer
   * are updated in place. Everything else is CSS, driven by `data-route-source`
   * on the map itself.
   */
  onRouteSourceChange((source) => {
    const live = source === 'bing';
    if (state.bingRouteLive === live) return;
    state.bingRouteLive = live;
    const legend = root.querySelector<HTMLElement>('[data-node="motion-legend"]');
    if (legend) {
      const motion = motionState(state);
      legend.dataset.motion = motion.active.join(',');
      legend.textContent = motionSentence(motion.active);
    }
    syncVisuals();
  });

  render();
  if (state.alwaysUseLocation) void autoLocate('home');
  return {
    state,
    actions,
    now,
    refreshNow: () => runAutoRefresh(),
    armedRefreshTimers: () => armedTimers,
    /**
     * Test-only: move the *next check* to now, or back out to a full interval.
     * Real cadences are minutes long, so the suite cannot wait for a check to
     * come due, and "due" is precisely the condition that is allowed to make
     * the world scan. Nothing else about the schedule is touched.
     */
    setRefreshDue(due: boolean) {
      const interval = state.refresh.intervalMs || 5 * 60_000;
      const nowMs = now();
      // The whole interval is preserved either way, so the countdown share the
      // rule reads is the real one rather than an artefact of the seam.
      state.refresh = {
        ...state.refresh,
        lastCheckedMs: due ? nowMs - interval : nowMs,
        nextCheckMs: due ? nowMs : nowMs + interval
      };
      rebuildJourney();
      render();
    },
    applyRawBlueprint: (raw: unknown) => {
      const blueprint = normalizeBlueprint(raw, 'sol-generated');
      if (!blueprint) return false;
      // Schema-safe is not the same as compatible: the Experience Synthesis
      // Engine still decides whether this blueprint may shape the world.
      const accepted = applyProposedBlueprint(blueprint);
      state.worldRevision += 1;
      render();
      return accepted;
    }
  };
}
