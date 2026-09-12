/**
 * Living News session.
 *
 * Owns the mutable local state of the second template: answered scope/horizon,
 * the centre of the world, and which forces are switched on. The Situation
 * Intelligence Engine is the sole owner of what is still worth asking.
 *
 * The shell delegates here so `app.ts` stays a state machine rather than a
 * pile of template-specific logic.
 */
import type { ClarifyQuestion } from './inference';
import {
  DEFAULT_LAYERS,
  DEFAULT_NEWS_PLACE,
  DEFAULT_RADIUS_MILES,
  NEWS_PLACES,
  sampleSignalsForPlace,
  type SampleSignal,
  type NewsPlace
} from './newsFixtures';
import {
  HORIZON_QUESTION,
  SCOPE_QUESTION,
  parseHorizon,
  parseScope,
  type LayerId,
  type NewsHorizon,
  type NewsScope,
  type NewsSituation,
  type WorldEdit
} from './newsIntent';
import { layersForScope, planSignalField, type SignalWorld } from './newsPlanner';
import type { LiveLocalContext } from './localContextGateway';
import { liveSignalsFromContext } from './liveNewsContext';

export type PlaceTruth = 'inferred' | 'chosen' | 'coarse-location';

export interface NewsSession {
  situation: NewsSituation | null;
  scope: NewsScope | null;
  horizon: NewsHorizon | null;
  place: NewsPlace;
  /** How the centre of the world came to be that place. */
  placeTruth: PlaceTruth;
  placesVisible: boolean;
  layers: Record<LayerId, boolean>;
  radiusMiles: number;
  focus: 'all' | 'commute';
  world: SignalWorld | null;
  /** The question currently on screen, if any. */
  question: ClarifyQuestion | null;
  /** True when the user chose to keep the literal answer instead of a world. */
  keptLiteral: boolean;
  /** Local reshaping history, newest last. Never a chat transcript. */
  notes: string[];
  /** Location-scoped provider result. Rebuilt only when the centre changes. */
  signals: SampleSignal[];
  contextRevision: number;
  contextStatus: 'sample' | 'loading' | 'live' | 'partial' | 'unavailable';
  contextErrors: string[];
  contextRequestId: number;
  liveContext: LiveLocalContext | null;
}

export function createNewsSession(): NewsSession {
  return {
    situation: null,
    scope: null,
    horizon: null,
    place: DEFAULT_NEWS_PLACE,
    placeTruth: 'inferred',
    placesVisible: false,
    layers: { ...DEFAULT_LAYERS },
    radiusMiles: DEFAULT_RADIUS_MILES,
    focus: 'all',
    world: null,
    question: null,
    keptLiteral: false,
    notes: [],
    signals: sampleSignalsForPlace(DEFAULT_NEWS_PLACE),
    contextRevision: 0,
    contextStatus: 'sample',
    contextErrors: [],
    contextRequestId: 0,
    liveContext: null
  };
}

/** Applies whatever the budget could not buy, so the world always resolves. */
export function applyFallbacks(session: NewsSession): void {
  if (session.scope === null) session.scope = parseScope(SCOPE_QUESTION.fallbackOptionId) ?? 'both';
  if (session.horizon === null) session.horizon = parseHorizon(HORIZON_QUESTION.fallbackOptionId) ?? 'today';
}

export function answerNewsQuestion(session: NewsSession, questionId: string, optionId: string): void {
  if (questionId === SCOPE_QUESTION.id) {
    const scope = parseScope(optionId);
    if (scope) {
      session.scope = scope;
      session.layers = layersForScope(scope);
    }
    return;
  }
  if (questionId === HORIZON_QUESTION.id) {
    const horizon = parseHorizon(optionId);
    if (horizon) session.horizon = horizon;
  }
}

export function rebuildWorld(session: NewsSession, nowMs: number): void {
  applyFallbacks(session);
  session.world = planSignalField({
    nowMs,
    place: session.place,
    scope: session.scope!,
    horizon: session.horizon!,
    layers: session.layers,
    radiusMiles: session.radiusMiles,
    focus: session.focus,
    signals: session.signals,
    contextRevision: session.contextRevision
  });
}

export function refreshNewsContext(
  session: NewsSession,
  reason: 'initial' | 'center-change' = 'center-change'
): void {
  session.signals = sampleSignalsForPlace(session.place);
  session.contextStatus = 'sample';
  session.contextErrors = [];
  session.liveContext = null;
  if (reason === 'center-change') {
    session.contextRevision += 1;
    session.notes = [...session.notes, `Local context refreshed for ${session.place.label}`].slice(-3);
  }
}

export function beginLiveNewsContext(session: NewsSession, requestId: number): number {
    session.contextRequestId = requestId;
    session.contextStatus = 'loading';
    return session.contextRequestId;
  }

export function applyLiveNewsContext(
    session: NewsSession,
    requestId: number,
    context: LiveLocalContext
  ): boolean {
    if (requestId !== session.contextRequestId || context.place.id !== session.place.id) return false;
    const signals = liveSignalsFromContext(context, session.place);
    if (signals.length === 0) {
      session.contextStatus = 'unavailable';
      session.contextErrors = context.errors.length > 0 ? context.errors : ['No live context was returned.'];
      return false;
    }
    session.signals = signals;
    session.liveContext = context;
    session.contextErrors = context.errors;
    session.contextStatus = context.errors.length > 0 ? 'partial' : 'live';
    return true;
  }

export function failLiveNewsContext(session: NewsSession, requestId: number, message: string): boolean {
    if (requestId !== session.contextRequestId) return false;
    session.contextStatus = 'unavailable';
    session.contextErrors = [message];
    session.liveContext = null;
    return true;
}

export function applyWorldEdit(session: NewsSession, edit: WorldEdit): void {
  if (edit.layers) session.layers = { ...session.layers, ...edit.layers };
  if (edit.radiusMiles !== undefined) session.radiusMiles = edit.radiusMiles;
  if (edit.focus !== undefined) session.focus = edit.focus;
  session.notes = [...session.notes, edit.label].slice(-3);
}

export function findNewsPlace(id: string): NewsPlace | null {
  return NEWS_PLACES.find((place) => place.id === id) ?? null;
}
