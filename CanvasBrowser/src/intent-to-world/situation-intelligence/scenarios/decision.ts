/**
 * The decision-assembly orchestrator.
 *
 * It runs the two tiers — Tier 1 builds the general intention graph, Tier 2
 * deepens it for a known topic — then ranks the directions from the prompt,
 * commits to the most likely one (keeping the runner-up one tap away), and turns
 * that into a request that instructs a model to *assemble the decision* rather
 * than list links. It normalizes the result at the boundary, stripping any URL
 * or "go check X", because a link is homework and homework is what a plain
 * browser already does.
 *
 * The engine (`planDecision`) works for every recognized scenario through Tier 1.
 * Whether a scenario is rendered as a full Decision Surface is a separate, more
 * conservative gate (`hasDecisionSurface`) so a one-word definition is never
 * dressed up as a life decision.
 */
import { buildGeneralIntention, type IntentionGraph } from './intention';
import { applyLearning, type LearnedAdjustments } from './learning';
import { scenarioById } from './registry';
import { specialize } from './topics';
import type { ResolutionMode } from '../../situation-graph';

export interface RankedDirection {
  id: string;
  label: string;
  score: number;
  evidence: string[];
  forces: string[];
}

export interface DecisionPlan {
  scenarioId: string;
  decision: string;
  /** The direction the surface leads with. */
  top: RankedDirection;
  /** The runner-up, kept one tap away — null when the job does not fork. */
  alternative: RankedDirection | null;
  ranked: RankedDirection[];
  /** The carry-it-out action, or null when the job needs none. */
  actionLabel: string | null;
  resolutionMode: ResolutionMode;
  /** How the request frames the assembly for this mode. */
  lead: string;
  /** True when the job forks into competing directions worth choosing between. */
  branches: boolean;
  /** True when a Tier-2 topic deepened the graph. */
  specialized: boolean;
}

/** One resolved force: the actual answer, never a link. */
export interface DecisionForce {
  label: string;
  value: string;
  note?: string;
}

export interface DecisionResult {
  direction: string;
  headline: string;
  forces: DecisionForce[];
  action: string | null;
}

/** The full two-tier intention graph for a scenario, or null if unrecognized. */
export function buildIntentionGraph(prompt: string, scenarioId: string): IntentionGraph | null {
  const scenario = scenarioById(scenarioId);
  if (!scenario) return null;
  return specialize(buildGeneralIntention(scenario), prompt);
}

/** Rank a graph's directions from the prompt, most likely first, with evidence. */
export function inferDirections(prompt: string, graph: IntentionGraph): RankedDirection[] {
  const ranked = graph.directions.map((direction) => {
    let score = direction.base;
    const evidence: string[] = [];
    for (const signal of direction.signals) {
      if (signal.re.test(prompt)) {
        score += signal.weight;
        evidence.push(signal.because);
      }
    }
    for (const damp of graph.dampen) {
      if (damp.direction === direction.id && damp.re.test(prompt)) score *= damp.factor;
    }
    return {
      id: direction.id,
      label: direction.label,
      score: Math.round(score * 1000) / 1000,
      evidence,
      forces: direction.forces
    };
  });
  ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return ranked;
}

/**
 * The decision plan for a prompt. `forcedDirectionId` re-roots the graph when the
 * person taps the alternative direction; `adjustments` folds in what this person
 * has taught the engine so far, so the lead direction climbs toward what they
 * actually mean.
 */
export function planDecision(
  prompt: string,
  scenarioId: string,
  options: { forcedDirectionId?: string | null; adjustments?: LearnedAdjustments | null } = {}
): DecisionPlan | null {
  const base = buildIntentionGraph(prompt, scenarioId);
  if (!base) return null;
  const graph = applyLearning(base, options.adjustments ?? null);
  const ranked = inferDirections(prompt, graph);
  const top =
    (options.forcedDirectionId ? ranked.find((entry) => entry.id === options.forcedDirectionId) : null) ??
    ranked[0];
  const alternative = graph.branches ? ranked.find((entry) => entry.id !== top.id) ?? null : null;
  return {
    scenarioId,
    decision: graph.decision,
    top,
    alternative,
    ranked,
    actionLabel: graph.actionLabel,
    resolutionMode: graph.resolutionMode,
    lead: graph.lead,
    branches: graph.branches,
    specialized: graph.specialized
  };
}

/**
 * Whether to render the full Decision Surface. Every recognized scenario earns
 * an assembled result now — Tier 1 shapes it by mode, Tier 2 deepens it where a
 * topic exists. Heroes and bare literals are not in the registry, so they keep
 * their own surfaces.
 */
export function hasDecisionSurface(scenarioId: string | null | undefined): boolean {
  return scenarioById(scenarioId) !== null;
}

/* ------------------------------------------------------------- the request */

/**
 * The instruction that makes the model assemble the result rather than list
 * links. It frames the assembly for the resolution mode (a direct answer, a
 * status, a triage, a recommendation), names the forces to resolve, and forbids
 * URLs and "go check" answers — that is the whole difference from a search box.
 */
export function buildDecisionRequest(plan: DecisionPlan, prompt: string): string {
  const actionField = plan.actionLabel ? `,"action":"${plan.actionLabel}"` : '';
  const shape =
    '{"direction":"' +
    plan.top.label +
    '","headline":"<one sentence: the assembled answer>","forces":[{"label":"<force>","value":"<the actual answer — numbers, places, concrete facts>","note":"<one short caveat, optional>"}]' +
    actionField +
    '}';
  return [
    `User asked: ${prompt}`,
    plan.branches ? `Their most likely goal is: ${plan.top.label}.` : '',
    plan.lead,
    `Cover these, in order, resolving each to the real answer: ${plan.top.forces.join('; ')}.`,
    'Return ONLY a JSON object, no prose and no markdown fences, of exactly this shape:',
    shape,
    'Hard rules:',
    '- Start the reply with { and end with }. No preamble, no explanation, no markdown fences.',
    '- Every "value" is the actual answer: a number, a place, a concrete fact. Never a URL, never "check X", never "visit Y", never "search for".',
    '- Do not include links, or instructions to look anything up. The person should not have to do further work.',
    '- Be specific and current. Prefer concrete figures and named facts over generalities.'
  ]
    .filter(Boolean)
    .join('\n');
}

/* ----------------------------------------------------------- normalization */

const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const DOMAIN_RE =
  /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|org|net|io|gov|edu|co|us|app|ai|co\.uk)\b(?:\/\S*)?/gi;
const LOOKUP_RE = /\b(?:check|visit|see|search(?: for)?|look (?:it )?up|go to)\b[^.]*?\.(?:\s|$)/gi;

function clean(value: unknown, cap: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(URL_RE, '')
    .replace(DOMAIN_RE, '')
    .replace(LOOKUP_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;])/g, '$1')
    .trim()
    .slice(0, cap);
}

/** Extract the first balanced JSON object from a model answer. */
export function extractDecisionJson(answer: string): unknown | null {
  if (typeof answer !== 'string') return null;
  const start = answer.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < answer.length; i++) {
    const ch = answer[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = answer.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          try {
            // Models routinely pretty-print the JSON with real newlines, which
            // are invalid *inside* JSON strings; collapse control characters and
            // retry before giving up.
            return JSON.parse(candidate.replace(/[\u0000-\u001f]+/g, ' '));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Turn a model answer into a safe `DecisionResult`. Any URL or "go look it up"
 * is stripped here, so the no-links rule holds no matter what the model returns.
 * When the JSON cannot be read, the raw text is delivered as a single assembled
 * statement rather than dropped — degraded, but still not a pile of links.
 */
export function normalizeDecisionResult(answer: string, plan: DecisionPlan): DecisionResult {
  const raw = extractDecisionJson(answer) as
    | { direction?: unknown; headline?: unknown; forces?: unknown; action?: unknown }
    | null;

  if (!raw || typeof raw !== 'object') {
    // Never surface raw JSON. Prefer the model's own headline if we can find it,
    // otherwise the prose before any JSON began.
    const headlineMatch = answer.match(/"headline"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const proseOnly = answer.split(/\{\s*"direction"/i)[0];
    const headline = headlineMatch
      ? clean(headlineMatch[1].replace(/\\"/g, '"'), 300)
      : clean(proseOnly, 300);
    return {
      direction: plan.top.label,
      headline: headline || 'The decision could not be assembled — try Refine, or Start over.',
      forces: [],
      action: plan.actionLabel
    };
  }

  const forcesRaw = Array.isArray(raw.forces) ? raw.forces : [];
  const forces: DecisionForce[] = [];
  for (const entry of forcesRaw.slice(0, 8)) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { label?: unknown; value?: unknown; note?: unknown };
    const label = clean(record.label, 60);
    const value = clean(record.value, 320);
    if (!label || !value) continue;
    const note = clean(record.note, 160);
    forces.push(note ? { label, value, note } : { label, value });
  }

  return {
    direction: clean(raw.direction, 80) || plan.top.label,
    headline: clean(raw.headline, 300) || plan.decision,
    forces,
    action: clean(raw.action, 60) || plan.actionLabel || null
  };
}

/* --------------------------------------------------- product comparison */

export interface CompareOption {
  name: string;
  price: string;
  /** 0–5. */
  rating: number;
  best: boolean;
  pros: string[];
  cons: string[];
}

export interface CompareResult {
  headline: string;
  options: CompareOption[];
  verdict: string;
}

/** Ask the model to assemble a real comparison as structured JSON, not prose. */
export function buildCompareRequest(prompt: string, directionLabel: string): string {
  return [
    `User asked: ${prompt}`,
    `They are ${directionLabel.toLowerCase()}. Assemble a comparison that lets them choose confidently.`,
    'Return ONLY a JSON object, starting with { and ending with }, no prose, no markdown:',
    '{"headline":"<one-line recommendation>","options":[{"name":"<product>","price":"<approx price, e.g. $999>","rating":<number 0-5>,"best":<true for the single recommended one>,"pros":["<short>"],"cons":["<short>"]}],"verdict":"<one line: why the pick>"}',
    'Rules: 3–4 real, current options; exactly one has "best":true; "rating" is a number 0–5; 2–3 short pros and cons each; concrete prices. Never a URL, never "search for". Be specific.'
  ].join('\n');
}

function cleanList(value: unknown, max: number, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value.slice(0, max)) {
    const s = clean(item, cap);
    if (s) out.push(s);
  }
  return out;
}

export function normalizeCompare(answer: string): CompareResult {
  const raw = extractDecisionJson(answer) as
    | { headline?: unknown; options?: unknown; verdict?: unknown }
    | null;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.options)) {
    const match = answer.match(/"headline"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return {
      headline: match ? clean(match[1].replace(/\\"/g, '"'), 200) : clean(answer.split(/\{\s*"headline"/i)[0], 200),
      options: [],
      verdict: ''
    };
  }
  const options: CompareOption[] = [];
  for (const entry of raw.options.slice(0, 5)) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { name?: unknown; price?: unknown; rating?: unknown; best?: unknown; pros?: unknown; cons?: unknown };
    const name = clean(record.name, 60);
    if (!name) continue;
    const rating = Math.max(0, Math.min(5, Number(record.rating) || 0));
    options.push({
      name,
      price: clean(record.price, 40),
      rating: Math.round(rating * 10) / 10,
      best: record.best === true,
      pros: cleanList(record.pros, 4, 90),
      cons: cleanList(record.cons, 4, 90)
    });
  }
  if (options.length > 0 && !options.some((o) => o.best)) options[0].best = true;
  return {
    headline: clean(raw.headline, 200) || 'Here is how the options compare.',
    options,
    verdict: clean(raw.verdict, 200)
  };
}

/* ------------------------------------------------------------- triage */

export type Severity = 'emergency' | 'urgent' | 'routine';

export interface TriageResult {
  severity: Severity;
  headline: string;
  actNow: string[];
  emergency: string[];
  causes: string[];
}

/** Ask the model for a safety-first triage as structured JSON. */
export function buildTriageRequest(prompt: string): string {
  return [
    `Someone described: ${prompt}`,
    'You are a careful triage assistant. Lead with safety, do not diagnose definitively.',
    'Return ONLY a JSON object, starting with { and ending with }, no prose, no markdown:',
    '{"severity":"emergency|urgent|routine","headline":"<one calm line>","actNow":["<what to do right now>"],"emergency":["<red-flag signs that mean call emergency services / go to the ER now>"],"causes":["<possible, non-alarming explanations>"]}',
    'Rules: if there is any chance this is life-threatening, severity="emergency". 2–4 concise items per list. No URLs. Never tell them to ignore serious symptoms.'
  ].join('\n');
}

export function normalizeTriage(answer: string): TriageResult {
  const raw = extractDecisionJson(answer) as
    | { severity?: unknown; headline?: unknown; actNow?: unknown; emergency?: unknown; causes?: unknown }
    | null;
  const severityRaw = typeof raw?.severity === 'string' ? raw.severity.toLowerCase() : '';
  const severity: Severity = severityRaw === 'emergency' ? 'emergency' : severityRaw === 'routine' ? 'routine' : 'urgent';
  if (!raw || typeof raw !== 'object') {
    return {
      severity: 'emergency',
      headline: 'If this may be an emergency, contact your local emergency number now.',
      actNow: ['If symptoms are severe or worsening, call emergency services immediately.'],
      emergency: [],
      causes: []
    };
  }
  return {
    severity,
    headline: clean(raw.headline, 200) || 'When in doubt about a serious symptom, seek care.',
    actNow: cleanList(raw.actNow, 5, 160),
    emergency: cleanList(raw.emergency, 5, 160),
    causes: cleanList(raw.causes, 5, 160)
  };
}
