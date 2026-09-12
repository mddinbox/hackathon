/** Shell state and the action surface the views are allowed to call. */
import type { Appearance } from '../appearance';
import type { ClarifyQuestion, InferenceState } from '../inference';
import type { LayerId } from '../newsIntent';
import type { NewsSession } from '../newsSession';
import type { ArrivalSituation } from '../pickupIntent';
import type { JourneyWorld } from '../journeyPlanner';
import type {
  SituationGraph,
  SituationQuestionVerdict
} from '../intent-to-world/situation-graph';
import type { ExperiencePlan } from '../intent-to-world/experience-synthesis';
import type {
  DecisionPlan,
  DecisionResult,
  CompareResult,
  TriageResult
} from '../intent-to-world/situation-intelligence/scenarios';
import type { PlaceWorld } from '../intent-to-world/situation-intelligence/scenarios/places/cities';
import type { TemplateBlueprint } from '../intent-to-world/experience-synthesis/templateBlueprint';
import type { CompiledTemplate } from '../intent-to-world/experience-synthesis/templateCompiler';
import type {
  Assumptions,
  ChangeEntry,
  ConditionLayers,
  FlightReading,
  JobHypothesisId,
  JourneyStop,
  LiteralAnswer,
  OriginOption,
  PickupPlan,
  RefreshStatus,
  TravelConditions
} from '../types';

export type View =
  | 'home'
  | 'literal'
  | 'clarify'
  | 'terrain'
  | 'field'
  | 'connection'
  | 'decision'
  | 'place'
  | 'compare'
  | 'triage';
export type LocationState = 'idle' | 'requesting' | 'granted' | 'denied' | 'unsupported' | 'outside-region' | 'timeout' | 'manual';

/**
 * The outcome of the most recent *automatic* fix, for the one line More is
 * allowed to show. It is a permission story, never a place.
 */
export type AutoLocationStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'unsupported' | 'outside-region' | 'timeout';

/**
 * Which plane of the Journey World is dominant. Both lenses show the same
 * world — the map and the arrival strip are always linked — the lens only
 * decides which of the two the screen gives its height to.
 */
export type JourneyLens = 'journey' | 'timeline';

export interface AppState {
  view: View;
  prompt: string;
  busy: boolean;
  error: string | null;
  literal: LiteralAnswer | null;
  /** The inferred decision plan for a scenario the engine assembles a decision for. */
  decisionPlan: DecisionPlan | null;
  /** The assembled decision, once the model has returned it. */
  decision: DecisionResult | null;
  /** The prompt the current decision was assembled from (grows as it is refined). */
  decisionPrompt: string;
  /** True while the decision is still being assembled. */
  decisionPending: boolean;
  /** The spatial world for a place decision (real-estate), or null. */
  placeWorld: PlaceWorld | null;
  /** The anchor (office) the place world times commutes from. */
  placeAnchorId: string | null;
  /** The city the place world is about. */
  placeCityId: string | null;
  /** The prompt the place world was built from. */
  placePrompt: string;
  /** Zoom override for the place map (miles radius); null uses the city default. */
  placeRadiusMiles: number | null;
  /** Pan offset applied to the place map centre. */
  placeCenterDLat: number;
  placeCenterDLon: number;
  /** One-line feedback from the last place refine, or null. */
  placeNote: string | null;
  /** The assembled product comparison, or null. */
  compare: CompareResult | null;
  /** The assembled triage, or null. */
  triage: TriageResult | null;
  situation: ArrivalSituation | null;
  chosenJob: JobHypothesisId | null;
  /** The currently selected Travel question: job first, then origin if needed. */
  travelQuestion: ClarifyQuestion | null;
  /** True while live research for the current ask is still in flight. */
  researchPending: boolean;
  /**
   * Bumped on every new ask, re-check, or Start over. A late gateway answer
   * from an older generation is discarded instead of overwriting the world.
   */
  requestGeneration: number;
  /**
   * Bumped whenever the user picks or types a place, or leaves the view. A
   * slow geolocation callback from an older generation is discarded.
   */
  geoGeneration: number;
  /** The control that opened the current dialog, so focus can be restored. */
  dialogOpener: string | null;
  /** A node to focus after the next render (dialog close, mostly). */
  pendingFocus: string | null;
  reading: FlightReading | null;
  assumptions: Assumptions;
  origin: OriginOption | null;
  locationState: LocationState;
  /**
   * The persistent consent: may a relevant world request one fresh fix per
   * session without a second click? Stored as a boolean and nothing else.
   */
  alwaysUseLocation: boolean;
  /** What the last automatic attempt did, for the one status line in More. */
  autoLocationStatus: AutoLocationStatus;
  placesVisible: boolean;
  plan: PickupPlan | null;
  /**
   * The SAMPLE weather + traffic the Travel world is standing in. They are
   * always computed into the plan; the layer switches below only decide
   * whether they are *drawn*.
   */
  conditions: TravelConditions | null;
  /** Which fixture step the session is on. Each auto re-check advances it. */
  conditionStep: number;
  conditionLayers: ConditionLayers;
  /** What the adaptive refresh controller is currently doing. */
  refresh: RefreshStatus;
  changes: ChangeEntry[];
  sourcesOpen: boolean;
  moreOpen: boolean;
  devMode: boolean;
  appearance: Appearance;
  /** Shared across templates: at most two clarifying questions, ever. */
  inference: InferenceState;
  /** Everything the Living News template knows and shows. */
  news: NewsSession;
  /**
   * The world blueprint the situation resolved to, and the compiled template
   * that blueprint produced. Both are always present for a recognised
   * situation — a fallback is generated instantly and a model answer, when one
   * arrives, replaces it. Rendering never waits on either.
   *
   * Neither is set directly any more: both are read off `experiencePlan`, so
   * the only way a template can change is through the Experience Synthesis
   * Engine, and the only way that engine can change is through the graph.
   */
  blueprint: TemplateBlueprint | null;
  compiled: CompiledTemplate | null;
  /**
   * Core 1's output — what is going on, what information the world needs, and
   * which questions survived question economics. The single routing key the
   * shell switches on (`graph.kind`) lives here.
   */
  situationGraph: SituationGraph | null;
  /** Core 2's output — what world that graph deserves, and why. */
  experiencePlan: ExperiencePlan | null;
  /** Why each question was asked or refused, for the Source sheet. */
  questionVerdicts: SituationQuestionVerdict[];
  /** True while a blueprint request is in flight. Never blocks a render. */
  blueprintPending: boolean;
  /** Which plane of the Journey World has the height. */
  lens: JourneyLens;
  /** Stops the user added to the drive, in order. */
  stops: JourneyStop[];
  /** The route world the Journey template draws. Rebuilt with the plan. */
  journey: JourneyWorld | null;
  /**
   * True while the Bing base is live *and* carrying the route.
   *
   * In that state the geography is real and the route belongs to the Bing map
   * the handoff opens, so CanvasBrowser draws neither a corridor nor its
   * illustrative congestion over it — and therefore animates no traffic. It is
   * set by the map itself when a frame loads or fails, never guessed here.
   */
  bingRouteLive: boolean;
  /** Bumped whenever knowledge changes, so motion only plays on real change. */
  worldRevision: number;
}

export interface AppActions {
  ask(prompt: string): Promise<void>;
  setPrompt(value: string): void;
  useHomeLocation(): Promise<void>;
  chooseJob(id: JobHypothesisId): void;
  backHome(): void;
  useMyLocation(): Promise<void>;
  showPlaces(): void;
  chooseOrigin(id: string): void;
  chooseTypedOrigin(label: string): void;
  editAssumptions(text: string): boolean;
  toggleCheckedBag(): void;
  toggleArrivalKind(): void;
  /** Journey: give the height to the map or to the arrival strip. */
  setLens(lens: JourneyLens): void;
  /** Journey: add a stop by fixture id. Local recompute, no model call. */
  addStop(optionId: string): void;
  /** Journey: remove a stop by its instance id. Local recompute. */
  removeStop(stopId: string): void;
  undoChange(): void;
  recheck(): Promise<void>;
  previewSample(): void;
  /**
   * Travel: show or hide a conditions layer. Visibility only — the force keeps
   * shaping the plan either way, so reality cannot be hidden from computation.
   */
  toggleConditionLayer(id: keyof ConditionLayers): void;
  /** Living News: answer the one question on screen. */
  answerClarification(questionId: string, optionId: string): void;
  /** Living News: switch a force on or off. Local, no model call. */
  toggleLayer(id: LayerId): void;
  /** Living News: reshape the world from a follow-up phrase. */
  editWorld(text: string): boolean;
  toggleNewsPlaces(): void;
  chooseNewsPlace(id: string): void;
  useNewsLocation(): Promise<void>;
  openSources(): void;
  closeSources(): void;
  openMore(): void;
  closeMore(): void;
  setAppearance(patch: Partial<Appearance>): void;
  /**
   * Persist the location consent. Turning it on inside a relevant world that
   * still lacks a location requests one fix immediately — the toggle click is
   * the user gesture. Turning it off invalidates any pending automatic fix and
   * leaves the current world exactly where it is.
   */
  setAlwaysUseLocation(enabled: boolean): Promise<void>;
  setDevMode(enabled: boolean): void;
  /** Decision Surface: re-root to the runner-up direction; teaches the engine. */
  rerootDecision(directionId: string): void;
  /** Decision Surface: refine or correct from the feedback prompt; teaches the engine. */
  refineDecision(text: string): void;
  /** Decision Surface: carry out the single action (opens the handoff). */
  actOnDecision(): void;
  /** Place World: move the commute anchor (office) and re-time the map. */
  reanchorPlace(anchorId: string): void;
  /** Place World: zoom the map (factor < 1 zooms in), keeping pins accurate. */
  zoomPlace(factor: number): void;
  /** Place World: pan the map by a fraction of the current radius. */
  panPlace(dLatFactor: number, dLonFactor: number): void;
  /** Place World: reset zoom and pan to the default framing. */
  recenterPlace(): void;
}

export interface ViewContext {
  state: AppState;
  actions: AppActions;
}
