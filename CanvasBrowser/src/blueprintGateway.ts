/**
 * The blueprint client.
 *
 * It asks the local gateway to *think about the shape of a world* and returns
 * a normalized blueprint or `null`. Every failure mode — offline, 404, 502,
 * timeout, prose instead of JSON, a hostile payload — resolves to `null`, and
 * `null` means "use the deterministic fallback". Nothing here can throw into a
 * render.
 */
import {
  normalizeBlueprint,
  type TemplateBlueprint
} from './intent-to-world/experience-synthesis/templateBlueprint';

export interface BlueprintRequest {
  prompt: string;
  /** `airport-pickup` or `local-briefing`. Steers the model, never the schema. */
  situation: string;
  /** The job the user has already chosen, when they have chosen one. */
  job: string | null;
  /** Facts the model must not have to guess at. Short, plain strings only. */
  known: string[];
}

const TIMEOUT_MS = 20_000;

export async function requestBlueprint(request: BlueprintRequest): Promise<TemplateBlueprint | null> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), TIMEOUT_MS) : 0;
  try {
    const response = await fetch('/api/blueprint', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-canvas-browser-demo': '1' },
      body: JSON.stringify(request),
      signal: controller?.signal
    });
    if (!response.ok) return null;
    if (!response.headers.get('content-type')?.includes('application/json')) return null;
    const body = (await response.json()) as { blueprint?: unknown; source?: unknown };
    if (body.source === 'fallback') return null;
    // Normalized once on the wire and once again here: the client never
    // trusts its own server any more than it trusts the model.
    return normalizeBlueprint(body.blueprint, 'sol-generated');
  } catch {
    return null;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}
