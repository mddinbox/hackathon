/**
 * The learning overlay — the engine getting smarter without re-deriving from scratch.
 *
 * Tier 1 and Tier 2 are deterministic and fixed. This is a thin, persisted layer
 * on top: per-scenario deltas that nudge direction priors and force weights from
 * what the person actually does. Each correction is one hill-climbing step —
 * tapping the alternative direction lifts it and lowers the wrong guess; asking
 * for a force in the feedback prompt boosts it. The base never moves, so tests
 * stay deterministic; only the overlay learns.
 *
 * The store is injected so the browser uses `localStorage` and tests use memory,
 * and so nothing here reaches for a global.
 */
import type { IntentionGraph } from './intention';

export interface LearnedAdjustments {
  /** Added to a direction's base prior. */
  directionDeltas: Record<string, number>;
  /** Added to the weight of a force label when it appears. */
  forceBoosts: Record<string, number>;
  updatedAt: number;
}

export interface LearningSignal {
  scenarioId: string;
  /** A direction the person confirmed or corrected toward. */
  reinforceDirection?: string;
  /** A direction the person turned away from. */
  penalizeDirection?: string;
  /** Forces the person asked for (e.g. from the refine prompt). */
  boostForces?: string[];
}

export interface LearningStore {
  get(scenarioId: string): LearnedAdjustments | null;
  set(scenarioId: string, adjustments: LearnedAdjustments): void;
}

/** One hill-climbing step, and the ceiling a delta may reach. */
export const LEARNING_RATE = 0.15;
export const LEARNING_CEILING = 0.9;

function clamp(value: number): number {
  return Math.min(LEARNING_CEILING, Math.max(-LEARNING_CEILING, Math.round(value * 1000) / 1000));
}

function empty(): LearnedAdjustments {
  return { directionDeltas: {}, forceBoosts: {}, updatedAt: 0 };
}

/**
 * Apply one signal and persist. Reinforcement climbs, penalty descends, both
 * clamped, so a run of corrections converges instead of exploding.
 */
export function learn(store: LearningStore, signal: LearningSignal, nowMs: number): LearnedAdjustments {
  const adjustments = store.get(signal.scenarioId) ?? empty();
  const deltas = { ...adjustments.directionDeltas };
  const boosts = { ...adjustments.forceBoosts };

  if (signal.reinforceDirection) {
    deltas[signal.reinforceDirection] = clamp((deltas[signal.reinforceDirection] ?? 0) + LEARNING_RATE);
  }
  if (signal.penalizeDirection && signal.penalizeDirection !== signal.reinforceDirection) {
    deltas[signal.penalizeDirection] = clamp((deltas[signal.penalizeDirection] ?? 0) - LEARNING_RATE);
  }
  for (const force of signal.boostForces ?? []) {
    boosts[force] = clamp((boosts[force] ?? 0) + LEARNING_RATE);
  }

  const next: LearnedAdjustments = { directionDeltas: deltas, forceBoosts: boosts, updatedAt: nowMs };
  store.set(signal.scenarioId, next);
  return next;
}

/** Fold the learned deltas into a graph's direction priors. Base is never mutated. */
export function applyLearning(graph: IntentionGraph, adjustments: LearnedAdjustments | null): IntentionGraph {
  if (!adjustments) return graph;
  return {
    ...graph,
    directions: graph.directions.map((direction) => ({
      ...direction,
      base: direction.base + (adjustments.directionDeltas[direction.id] ?? 0)
    }))
  };
}

/** A `localStorage`-backed store, guarded so it degrades to no-op off the browser. */
export function browserLearningStore(namespace = 'cb.learn'): LearningStore {
  const key = (scenarioId: string): string => `${namespace}.${scenarioId}`;
  return {
    get(scenarioId) {
      try {
        const raw = globalThis.localStorage?.getItem(key(scenarioId));
        return raw ? (JSON.parse(raw) as LearnedAdjustments) : null;
      } catch {
        return null;
      }
    },
    set(scenarioId, adjustments) {
      try {
        globalThis.localStorage?.setItem(key(scenarioId), JSON.stringify(adjustments));
      } catch {
        /* storage unavailable or full — learning simply does not persist. */
      }
    }
  };
}

/** An in-memory store for tests and for environments without storage. */
export function memoryLearningStore(): LearningStore {
  const map = new Map<string, LearnedAdjustments>();
  return {
    get: (scenarioId) => map.get(scenarioId) ?? null,
    set: (scenarioId, adjustments) => void map.set(scenarioId, adjustments)
  };
}
