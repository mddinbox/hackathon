/**
 * The decision cache — the token-saving half.
 *
 * Assembling a decision costs a model call. A person who returns to the same
 * question, or re-roots to a direction they visited before, should not pay for
 * it twice, so an assembled `DecisionResult` is cached by scenario + direction +
 * normalized prompt. The store is injected, like the learning store, so the
 * browser persists and tests stay hermetic.
 */
import type { DecisionResult } from './decision';

export interface DecisionCache {
  get(key: string): DecisionResult | null;
  set(key: string, result: DecisionResult): void;
}

/** Stable key: same question and direction map to the same entry. */
export function decisionCacheKey(scenarioId: string, directionId: string, prompt: string): string {
  const normalized = prompt.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
  return `${scenarioId}::${directionId}::${normalized}`;
}

export function browserDecisionCache(namespace = 'cb.decisions'): DecisionCache {
  const storageKey = (key: string): string => `${namespace}.${key}`;
  return {
    get(key) {
      try {
        const raw = globalThis.localStorage?.getItem(storageKey(key));
        return raw ? (JSON.parse(raw) as DecisionResult) : null;
      } catch {
        return null;
      }
    },
    set(key, result) {
      try {
        globalThis.localStorage?.setItem(storageKey(key), JSON.stringify(result));
      } catch {
        /* storage unavailable or full — the answer simply is not cached. */
      }
    }
  };
}

export function memoryDecisionCache(): DecisionCache {
  const map = new Map<string, DecisionResult>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, result) => void map.set(key, result)
  };
}
