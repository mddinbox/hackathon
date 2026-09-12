/**
 * window.__canvasBrowser — a narrow, test-only read surface.
 *
 * It is installed only in the test build (see main.ts), never in production
 * or demo artifacts. It can read the world; it cannot commit anything on the
 * user's behalf, request location, or open a link.
 */
import type { CanvasBrowserApp } from './ui/app';
import { BING_TRAFFIC_PARAM, projectToEmbed, viewportFor } from './bingMap';
import { setJourneyBaseState } from './ui/journeyWorld';
import { motionState } from './motion';
import { defaultCapabilities } from './intent-to-world/situation-intelligence/contextProviders';
import { situationIntelligence } from './intent-to-world/situation-intelligence';
import type { SignalWorld } from './newsPlanner';
import type { SituationGraph } from './intent-to-world/situation-graph';
import type { Assumptions, LandingStatus, PickupPlan, RefreshStatus } from './types';

export interface PublicState {
  view: string;
  chosenJob: string | null;
  landingStatus: LandingStatus | null;
  flightPhase: string | null;
  assumptions: Assumptions;
  originId: string | null;
  locationState: string;
  /**
   * The persistent consent, and what the last automatic attempt did. Both are
   * about permission, never about where the person is: no coordinate, and no
   * raw fix, is readable from here or anywhere else.
   */
  alwaysUseLocation: boolean;
  autoLocationStatus: string;
  resolved: boolean;
  provenance: string | null;
  changes: string[];
  /** The shared two-question budget. Never above 2. */
  questionsAsked: number;
  questionId: string | null;
  /** True while a live answer for the current ask is still in flight. */
  researchPending: boolean;
  /** Whether a literal answer currently exists for this session. */
  hasLiteral: boolean;
  newsScope: string | null;
  newsHorizon: string | null;
  newsPlace: string | null;
  newsPlaceTruth: string;
  newsRadiusMiles: number;
  newsContextRevision: number;
  visibleSignals: string[];
  consequences: string[];
  layers: Record<string, boolean>;
  /** Travel: what the adaptive refresh controller is currently doing. */
  refresh: RefreshStatus & { armedTimers: number };
  /** Travel: the SAMPLE conditions the world is standing in. */
  conditions: {
    step: number;
    label: string;
    weatherKind: string;
    weatherCondition: string;
    weatherWidenMinutes: number;
    trafficLevel: string;
    trafficTrend: string;
    trafficDelay: { min: number; max: number };
  } | null;
  conditionLayers: Record<string, boolean>;
  /** Which world blueprint the template resolved from, and how. */
  blueprint: {
    source: string;
    family: string;
    situationType: string;
    questionIds: string[];
    selectedQuestionIds: string[];
    rejectedQuestionIds: string[];
  } | null;
  /**
   * Core 1's artifact, flattened. The full graph is available from `graph()`;
   * this is the part a test usually asserts on.
   */
  situation: {
    kind: string;
    graphId: string;
    chosenJob: string | null;
    hypotheses: string[];
    needs: Array<{ id: string; provider: string; status: string; permission: string | null; optional: boolean }>;
    questionIds: string[];
    selectedQuestionIds: string[];
    rejectedQuestionIds: string[];
    unknownIds: string[];
  } | null;
  /** Core 2's artifact, flattened. */
  experience: {
    graphId: string;
    family: string;
    templateLabel: string;
    blueprintSource: string;
    decisions: Array<{ id: string; outcome: string }>;
    forceIds: string[];
    askedQuestionIds: string[];
    refusedQuestionIds: string[];
  } | null;
  /** What the compiler made of it. */
  template: { view: string; primary: string; secondary: string | null; fxMode: string | null } | null;
  /** Journey: which plane has the height, and what the route looks like. */
  lens: string;
  stops: string[];
  journey: {
    hasRoute: boolean;
    waypoints: string[];
    segments: number;
    markers: string[];
    hasWeatherCell: boolean;
    mainPathLength: number;
    /** The real base map this world is drawn over, and whether it is a route. */
    baseKind: string;
    /**
     * The base is described, never quoted.
     *
     * The embed URL carries the route endpoints, and after a granted fix one
     * of those is the person's own position. So this surface states the facts
     * a test needs — the host, that a route exists, that Bing's traffic layer
     * is on — and no coordinate. The URL itself is readable only where it has
     * to be: on the iframe in the DOM.
     */
    baseHost: string;
    baseHasRoute: boolean;
    baseTrafficLayer: boolean;
    /** `bing` once Bing owns the routed line and its traffic; else `overlay`. */
    routeSource: string;
    /** True only when the next check is due — the one scan condition. */
    refreshDue: boolean;
    segmentWindows: Array<{ label: string; startMs: number | null; endMs: number | null }>;
  } | null;
  /** What is actually moving right now, and nothing else. */
  activeMotion: string[];
}

export interface CanvasBrowserTestApi {
  waitForIdle(): Promise<void>;
  state(): PublicState;
  plan(): PickupPlan | null;
  world(): SignalWorld | null;
  /** Core 1's full artifact, for architecture-level assertions. */
  graph(): SituationGraph | null;
  /**
   * The context acquisition plan for the current graph, computed with this
   * build's real capabilities. Used to prove that providers are ordered by
   * material effect and that Microsoft Graph is never executable.
   */
  acquisitionPlan(): {
    steps: Array<{ needId: string; provider: string; order: number; executable: boolean; reason: string }>;
    deferred: Array<{ needId: string; provider: string; executable: boolean; reason: string }>;
  } | null;
  /**
   * Runs exactly one automatic refresh tick now. The real cadence is minutes
   * long, so the suite drives the controller directly rather than waiting; the
   * gateway it calls is always mocked at the network boundary in tests.
   */
  tickRefresh(): Promise<void>;
  /** Test-only: bring the next automatic check due, or push it away again. */
  setRefreshDue(due: boolean): void;
  /**
   * Test-only: drive the Bing base into the state a real load or failure would
   * put it in. The suite never lets a request reach bing.com, so this is how a
   * live base — and therefore the Bing-aligned overlay — can be exercised at
   * all. It goes through exactly the same path the iframe's own events do.
   */
  setBaseState(state: 'pending' | 'live' | 'unavailable'): void;
  /** Test-only: the Web Mercator projection the live overlay is aligned by. */
  projectToBase(lat: number, lon: number): { x: number; y: number } | null;
  /** Feeds a raw blueprint payload through the normalizer + compiler. */
  applyBlueprint(raw: unknown): boolean;
}

export function installTestApi(app: CanvasBrowserApp): void {
  const api: CanvasBrowserTestApi = {
    async waitForIdle() {
      await Promise.resolve();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },
    state() {
      const news = app.state.news;
      const conditions = app.state.conditions;
      return {
        view: app.state.view,
        chosenJob: app.state.chosenJob,
        landingStatus: app.state.reading?.status ?? null,
        flightPhase: app.state.reading?.phase ?? null,
        assumptions: { ...app.state.assumptions },
        originId: app.state.origin?.id ?? null,
        locationState: app.state.locationState,
        alwaysUseLocation: app.state.alwaysUseLocation,
        autoLocationStatus: app.state.autoLocationStatus,
        resolved: app.state.plan?.resolved ?? false,
        provenance: app.state.plan?.provenance ?? null,
        changes: app.state.changes.map((entry) => entry.label),
        questionsAsked: app.state.inference.questionsAsked,
        questionId: app.state.travelQuestion?.id ?? news.question?.id ?? null,
        researchPending: app.state.researchPending,
        hasLiteral: app.state.literal !== null,
        newsScope: news.scope,
        newsHorizon: news.horizon,
        newsPlace: news.place.label,
        newsPlaceTruth: news.placeTruth,
        newsRadiusMiles: news.radiusMiles,
        newsContextRevision: news.contextRevision,
        visibleSignals: [
          ...(news.world?.signals.map((signal) => signal.id) ?? []),
          ...(news.world?.axis?.map((entry) => entry.id) ?? [])
        ],
        consequences: news.world?.consequences.map((item) => item.text) ?? [],
        layers: { ...news.layers },
        refresh: { ...app.state.refresh, armedTimers: app.armedRefreshTimers() },
        conditions: conditions
          ? {
              step: conditions.step,
              label: conditions.label,
              weatherKind: conditions.weather.kind,
              weatherCondition: conditions.weather.condition,
              weatherWidenMinutes: conditions.weather.widenMinutes,
              trafficLevel: conditions.traffic.level,
              trafficTrend: conditions.traffic.trend,
              trafficDelay: { ...conditions.traffic.delayMinutes }
            }
          : null,
        conditionLayers: { ...app.state.conditionLayers },
        blueprint: app.state.blueprint
          ? {
              source: app.state.blueprint.source,
              family: app.state.blueprint.template.family,
              situationType: app.state.blueprint.situation.type,
              questionIds: app.state.blueprint.questions.map((question) => question.id),
              selectedQuestionIds: app.state.questionVerdicts
                .filter((verdict) => verdict.selected)
                .map((verdict) => verdict.question.id),
              rejectedQuestionIds: app.state.questionVerdicts
                .filter((verdict) => !verdict.selected)
                .map((verdict) => verdict.question.id)
            }
          : null,
        situation: app.state.situationGraph
          ? {
              kind: app.state.situationGraph.kind,
              graphId: app.state.situationGraph.id,
              chosenJob: app.state.situationGraph.chosenJob,
              hypotheses: app.state.situationGraph.hypotheses.map((entry) => entry.id),
              needs: app.state.situationGraph.informationNeeds.map((entry) => ({
                id: entry.id,
                provider: entry.provider,
                status: entry.status,
                permission: entry.permission,
                optional: entry.optional
              })),
              questionIds: app.state.situationGraph.questionPlan.verdicts.map((verdict) => verdict.question.id),
              selectedQuestionIds: app.state.situationGraph.questionPlan.selected.map((question) => question.id),
              askedQuestionIds: app.state.situationGraph.questionPlan.askedIds,
              rejectedQuestionIds: app.state.situationGraph.questionPlan.verdicts
                .filter((verdict) => !verdict.selected)
                .map((verdict) => verdict.question.id),
              unknownIds: app.state.situationGraph.unknowns.map((entry) => entry.id)
            }
          : null,
        experience: app.state.experiencePlan
          ? {
              graphId: app.state.experiencePlan.graphId,
              family: app.state.experiencePlan.family,
              templateLabel: app.state.experiencePlan.templateLabel,
              blueprintSource: app.state.experiencePlan.blueprintSource,
              decisions: app.state.experiencePlan.decisions.map((decision) => ({
                id: decision.id,
                outcome: decision.outcome
              })),
              forceIds: app.state.experiencePlan.visualForces.map((force) => force.id),
              askedQuestionIds: app.state.experiencePlan.questionContract.asked.map((entry) => entry.id),
              refusedQuestionIds: app.state.experiencePlan.questionContract.refused.map((entry) => entry.id)
            }
          : null,
        template: app.state.compiled
          ? {
              view: app.state.compiled.view,
              primary: app.state.compiled.primary,
              secondary: app.state.compiled.secondary,
              fxMode: app.state.compiled.fxMode
            }
          : null,
        lens: app.state.lens,
        stops: app.state.stops.map((stop) => stop.label),
        journey: app.state.journey
          ? {
              hasRoute: app.state.journey.origin !== null,
              waypoints: app.state.journey.waypoints.map((waypoint) => waypoint.label),
              segments: app.state.journey.segments.length,
              markers: app.state.journey.markers.map((marker) => marker.id),
              hasWeatherCell: app.state.journey.weather !== null,
              mainPathLength: app.state.journey.mainPath.length,
              baseKind: app.state.journey.base.kind,
              baseHost: new URL(app.state.journey.base.embedUrl).hostname,
              baseHasRoute: app.state.journey.base.route !== null,
              baseTrafficLayer: app.state.journey.base.embedUrl.includes(BING_TRAFFIC_PARAM),
              routeSource: app.state.bingRouteLive ? 'bing' : 'overlay',
              refreshDue: app.state.journey.refreshDue,
              segmentWindows: app.state.journey.segments.map((segment) => ({
                label: segment.label,
                startMs: segment.window?.startMs ?? null,
                endMs: segment.window?.endMs ?? null
              }))
            }
          : null,
        activeMotion: motionState(app.state).active
      };
    },
    plan() {
      return app.state.plan;
    },
    world() {
      return app.state.news.world;
    },
    graph() {
      return app.state.situationGraph;
    },
    acquisitionPlan() {
      const graph = app.state.situationGraph;
      if (!graph) return null;
      // The same capabilities the app runs with: no connector, so no Graph.
      const plan = situationIntelligence.planContextAcquisition(
        graph,
        defaultCapabilities({
          webResearch: true,
          locationConsent: app.state.alwaysUseLocation || app.state.locationState === 'granted'
        })
      );
      return {
        steps: plan.steps.map((step) => ({
          needId: step.need.id,
          provider: step.provider.id,
          order: step.order,
          executable: step.executable,
          reason: step.reason
        })),
        deferred: plan.deferred.map((step) => ({
          needId: step.need.id,
          provider: step.provider.id,
          executable: step.executable,
          reason: step.reason
        }))
      };
    },
    tickRefresh() {
      return app.refreshNow();
    },
    setRefreshDue(due: boolean) {
      app.setRefreshDue(due);
    },
    setBaseState(state: 'pending' | 'live' | 'unavailable') {
      setJourneyBaseState(state);
    },
    projectToBase(lat: number, lon: number) {
      const journey = app.state.journey;
      const box = document.querySelector<HTMLElement>('.map-frame');
      if (!journey || !box || box.clientWidth < 1 || box.clientHeight < 1) return null;
      return projectToEmbed({ lat, lon }, viewportFor(journey.base, box.clientWidth, box.clientHeight));
    },
    applyBlueprint(raw: unknown) {
      return app.applyRawBlueprint(raw);
    }
  };
  (window as unknown as { __canvasBrowser: CanvasBrowserTestApi }).__canvasBrowser = api;
}
