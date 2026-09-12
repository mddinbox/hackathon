/**
 * The LLM template thinking engine — the *blueprint*, not the UI.
 *
 * CanvasBrowser lets a model think about what kind of world a question
 * deserves. It does **not** let a model draw one. The contract in this file is
 * the whole safety story:
 *
 *   - the model may only emit one JSON object matching `TemplateBlueprint`;
 *   - every field is enum-checked, length-capped, count-capped and
 *     markup-scrubbed here before anything downstream reads it;
 *   - unknown fields are dropped rather than passed through;
 *   - a parse or validation failure is not an error state — it produces the
 *     deterministic fallback blueprint, labelled `fallback`, so the UI never
 *     waits on and never breaks because of a model;
 *   - nothing in a blueprint is HTML, CSS, JS, a selector, or a style. The
 *     compiler (`templateCompiler.ts`) turns a blueprint into visual
 *     primitives that already exist in this codebase.
 *
 * The second job of this file is **question economics**. A human's attention
 * is the scarcest input the product has, so a question must earn its place:
 * it must state what it materially changes, and what it changes must be one of
 * the four things a person actually feels — the template, the route, the
 * decision envelope, or the handoff. Anything else is inferred, shown as a
 * correctable assumption, and never asked.
 */
import type { TruthKind } from '../../types';

export const BLUEPRINT_VERSION = 1;

/* ------------------------------------------------------------------ schema */

export type TemplateFamily = 'journey-world' | 'signal-field' | 'time-terrain' | 'literal';

export type ForceType =
  | 'flight'
  | 'weather'
  | 'traffic'
  | 'airport'
  | 'disruption'
  | 'person'
  | 'market'
  | 'local';

export type BlueprintSource = 'sol-generated' | 'fallback';

export interface BlueprintSituation {
  /** A stable machine-ish key: `airport-pickup`, `local-briefing`. */
  type: string;
  label: string;
  entities: string[];
  /** The local moment and place this world is anchored to, in words. */
  localTime: string;
  place: string;
}

export interface BlueprintJob {
  id: string;
  label: string;
  /** Why this job is believed — the signals in the prompt, not a rationale. */
  evidence: string[];
}

export interface BlueprintJobs {
  primary: BlueprintJob;
  alternates: BlueprintJob[];
}

export interface BlueprintTemplate {
  family: TemplateFamily;
  primaryAxis: string;
  secondaryAxis: string;
  worldMetaphor: string;
  visualForces: string[];
}

export interface BlueprintForce {
  id: string;
  type: ForceType;
  /** 0–1. How much this force can actually move the outcome. */
  relevance: number;
  truth: TruthKind;
  freshness: string;
  /** Where it acts: `route`, `airport`, `curb`, `region`. */
  spatialAnchor: string;
  /** When it acts: `now`, `arrival window`, `next 45 min`. */
  temporalAnchor: string;
  /** What it should look like — in the compiler's vocabulary, not CSS. */
  visualMapping: string;
}

export interface BlueprintUnknown {
  id: string;
  reason: string;
  /** What would resolve it: a source, a user answer, or the passage of time. */
  resolvedBy: string;
}

export interface BlueprintChoice {
  id: string;
  label: string;
  detail?: string;
}

export interface BlueprintQuestion {
  id: string;
  prompt: string;
  /** One concise line the user is shown under the question. */
  whyNeeded: string;
  /**
   * What visibly changes when this is answered. A question whose effect does
   * not name the template, the route, the envelope or the handoff is rejected
   * by `selectQuestions` — that is the self-critical rule, encoded.
   */
  materialEffect: string;
  expectedInformationGain: number;
  userCost: number;
  choices: BlueprintChoice[];
}

export interface BlueprintHandoff {
  id: string;
  label: string;
  /** What the click does, in the user's words. Never an instruction to us. */
  action: string;
  url: string | null;
}

export interface BlueprintRefresh {
  targetEvent: string;
  cadenceHint: string;
}

export interface TemplateBlueprint {
  version: number;
  source: BlueprintSource;
  situation: BlueprintSituation;
  jobs: BlueprintJobs;
  template: BlueprintTemplate;
  forces: BlueprintForce[];
  unknowns: BlueprintUnknown[];
  questions: BlueprintQuestion[];
  handoffs: BlueprintHandoff[];
  refresh: BlueprintRefresh;
}

/* -------------------------------------------------------------------- caps */

export const BLUEPRINT_LIMITS = {
  short: 80,
  text: 240,
  url: 300,
  entities: 8,
  evidence: 4,
  alternates: 4,
  visualForces: 8,
  forces: 12,
  unknowns: 8,
  questions: 6,
  choices: 5,
  handoffs: 6
} as const;

const TEMPLATE_FAMILIES: TemplateFamily[] = ['journey-world', 'signal-field', 'time-terrain', 'literal'];
const FORCE_TYPES: ForceType[] = [
  'flight',
  'weather',
  'traffic',
  'airport',
  'disruption',
  'person',
  'market',
  'local'
];
const TRUTH_KINDS: TruthKind[] = ['observed', 'modeled', 'inferred', 'unknown'];

/**
 * Anything that even smells like markup, a script, a template expression or a
 * dangerous scheme takes the whole string out. The blueprint is prose and
 * enums; there is no legitimate reason for any of this to appear in one.
 */
const UNSAFE_TEXT_RE = /[<>]|&#|javascript:|data:|vbscript:|\bon[a-z]+\s*=|\$\{|\{\{|<\/?script/i;

/** Collapses whitespace, strips control characters, and enforces a hard cap. */
function text(value: unknown, cap: number): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (UNSAFE_TEXT_RE.test(cleaned)) return null;
  return cleaned.slice(0, cap);
}

function textOr(value: unknown, cap: number, fallback: string): string {
  return text(value, cap) ?? fallback;
}

function unit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown, cap: number, max: number): string[] {
  const out: string[] = [];
  for (const entry of list(value)) {
    const cleaned = text(entry, cap);
    if (cleaned && !out.includes(cleaned)) out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Only absolute `https:` URLs survive, and only when they parse. A model that
 * wants to hand the user somewhere has to name a real, ordinary web address.
 */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > BLUEPRINT_LIMITS.url) return null;
  if (UNSAFE_TEXT_RE.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return url.toString().slice(0, BLUEPRINT_LIMITS.url);
  } catch {
    return null;
  }
}

/**
 * A slug id. Ids reach the DOM as `data-node` values and question keys, so
 * they are restricted to a character set that cannot mean anything else.
 */
function id(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

/* --------------------------------------------------------------- normalize */

function normalizeSituation(raw: unknown): BlueprintSituation {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    type: id(value.type, 'situation'),
    label: textOr(value.label, BLUEPRINT_LIMITS.text, 'A situation with a shape of its own'),
    entities: strings(value.entities, BLUEPRINT_LIMITS.short, BLUEPRINT_LIMITS.entities),
    localTime: textOr(value.localTime, BLUEPRINT_LIMITS.short, 'local time'),
    place: textOr(value.place, BLUEPRINT_LIMITS.short, 'here')
  };
}

function normalizeJob(raw: unknown, fallbackId: string): BlueprintJob {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    id: id(value.id, fallbackId),
    label: textOr(value.label, BLUEPRINT_LIMITS.short, fallbackId),
    evidence: strings(value.evidence, BLUEPRINT_LIMITS.text, BLUEPRINT_LIMITS.evidence)
  };
}

function normalizeTemplate(raw: unknown): BlueprintTemplate {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    family: oneOf(value.family, TEMPLATE_FAMILIES, 'literal'),
    primaryAxis: textOr(value.primaryAxis, BLUEPRINT_LIMITS.short, 'time'),
    secondaryAxis: textOr(value.secondaryAxis, BLUEPRINT_LIMITS.short, 'uncertainty'),
    worldMetaphor: textOr(value.worldMetaphor, BLUEPRINT_LIMITS.text, 'a world you can read at a glance'),
    visualForces: strings(value.visualForces, BLUEPRINT_LIMITS.short, BLUEPRINT_LIMITS.visualForces)
  };
}

function normalizeForce(raw: unknown, index: number): BlueprintForce | null {
  const value = (raw ?? {}) as Record<string, unknown>;
  const label = text(value.visualMapping, BLUEPRINT_LIMITS.text);
  if (!label) return null;
  return {
    id: id(value.id, `force-${index + 1}`),
    type: oneOf(value.type, FORCE_TYPES, 'local'),
    relevance: unit(value.relevance, 0.5),
    truth: oneOf(value.truth, TRUTH_KINDS, 'unknown'),
    freshness: textOr(value.freshness, BLUEPRINT_LIMITS.short, 'unknown freshness'),
    spatialAnchor: textOr(value.spatialAnchor, BLUEPRINT_LIMITS.short, 'region'),
    temporalAnchor: textOr(value.temporalAnchor, BLUEPRINT_LIMITS.short, 'now'),
    visualMapping: label
  };
}

function normalizeUnknown(raw: unknown, index: number): BlueprintUnknown | null {
  const value = (raw ?? {}) as Record<string, unknown>;
  const reason = text(value.reason, BLUEPRINT_LIMITS.text);
  if (!reason) return null;
  return {
    id: id(value.id, `unknown-${index + 1}`),
    reason,
    resolvedBy: textOr(value.resolvedBy, BLUEPRINT_LIMITS.text, 'a source that states it')
  };
}

function normalizeChoice(raw: unknown, index: number): BlueprintChoice | null {
  const value = (raw ?? {}) as Record<string, unknown>;
  const label = text(value.label, BLUEPRINT_LIMITS.short);
  if (!label) return null;
  const detail = text(value.detail, BLUEPRINT_LIMITS.text);
  return { id: id(value.id, `choice-${index + 1}`), label, ...(detail ? { detail } : {}) };
}

function normalizeQuestion(raw: unknown, index: number): BlueprintQuestion | null {
  const value = (raw ?? {}) as Record<string, unknown>;
  const prompt = text(value.prompt, BLUEPRINT_LIMITS.text);
  if (!prompt) return null;
  const choices: BlueprintChoice[] = [];
  for (const entry of list(value.choices).slice(0, BLUEPRINT_LIMITS.choices)) {
    const choice = normalizeChoice(entry, choices.length);
    if (choice && !choices.some((existing) => existing.id === choice.id)) choices.push(choice);
  }
  return {
    id: id(value.id, `question-${index + 1}`),
    prompt,
    whyNeeded: textOr(value.whyNeeded, BLUEPRINT_LIMITS.text, ''),
    // Deliberately *not* defaulted: an unstated effect must stay empty so the
    // selector can reject the question instead of inventing a reason for it.
    materialEffect: text(value.materialEffect, BLUEPRINT_LIMITS.text) ?? '',
    expectedInformationGain: unit(value.expectedInformationGain, 0),
    userCost: unit(value.userCost, 1),
    choices
  };
}

function normalizeHandoff(raw: unknown, index: number): BlueprintHandoff | null {
  const value = (raw ?? {}) as Record<string, unknown>;
  const label = text(value.label, BLUEPRINT_LIMITS.short);
  if (!label) return null;
  return {
    id: id(value.id, `handoff-${index + 1}`),
    label,
    action: textOr(value.action, BLUEPRINT_LIMITS.text, 'Opens only when you click it.'),
    url: safeUrl(value.url)
  };
}

/**
 * Turns anything at all into a blueprint, or into `null`.
 *
 * `null` is a completely normal outcome: the caller answers it with the
 * deterministic fallback. The one structural requirement is that the object
 * declares a template family this build knows how to compile — a blueprint
 * that cannot name its own world is not a blueprint.
 */
export function normalizeBlueprint(raw: unknown, source: BlueprintSource = 'sol-generated'): TemplateBlueprint | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;

  const version = typeof value.version === 'number' ? Math.round(value.version) : BLUEPRINT_VERSION;
  if (version !== BLUEPRINT_VERSION) return null;

  const rawTemplate = (value.template ?? null) as Record<string, unknown> | null;
  const rawFamily = rawTemplate && typeof rawTemplate.family === 'string' ? rawTemplate.family : null;
  // The family is checked against the *stated* value, never against the
  // normalized fallback — otherwise an unknown family would quietly become a
  // literal answer instead of being rejected.
  if (!rawFamily || !TEMPLATE_FAMILIES.includes(rawFamily as TemplateFamily)) return null;
  const template = normalizeTemplate(value.template);

  const jobsRaw = (value.jobs ?? {}) as Record<string, unknown>;
  const alternates: BlueprintJob[] = [];
  for (const entry of list(jobsRaw.alternates).slice(0, BLUEPRINT_LIMITS.alternates)) {
    alternates.push(normalizeJob(entry, `alternate-${alternates.length + 1}`));
  }

  const forces: BlueprintForce[] = [];
  for (const entry of list(value.forces)) {
    const force = normalizeForce(entry, forces.length);
    if (force && !forces.some((existing) => existing.id === force.id)) forces.push(force);
    if (forces.length >= BLUEPRINT_LIMITS.forces) break;
  }

  const unknowns: BlueprintUnknown[] = [];
  for (const entry of list(value.unknowns)) {
    const item = normalizeUnknown(entry, unknowns.length);
    if (item && !unknowns.some((existing) => existing.id === item.id)) unknowns.push(item);
    if (unknowns.length >= BLUEPRINT_LIMITS.unknowns) break;
  }

  const questions: BlueprintQuestion[] = [];
  for (const entry of list(value.questions)) {
    const question = normalizeQuestion(entry, questions.length);
    if (question && !questions.some((existing) => existing.id === question.id)) questions.push(question);
    if (questions.length >= BLUEPRINT_LIMITS.questions) break;
  }

  const handoffs: BlueprintHandoff[] = [];
  for (const entry of list(value.handoffs)) {
    const handoff = normalizeHandoff(entry, handoffs.length);
    if (handoff && !handoffs.some((existing) => existing.id === handoff.id)) handoffs.push(handoff);
    if (handoffs.length >= BLUEPRINT_LIMITS.handoffs) break;
  }

  const refreshRaw = (value.refresh ?? {}) as Record<string, unknown>;

  return {
    version: BLUEPRINT_VERSION,
    source,
    situation: normalizeSituation(value.situation),
    jobs: { primary: normalizeJob(jobsRaw.primary, 'primary'), alternates },
    template,
    forces,
    unknowns,
    questions,
    handoffs,
    refresh: {
      targetEvent: textOr(refreshRaw.targetEvent, BLUEPRINT_LIMITS.text, 'nothing in particular'),
      cadenceHint: textOr(refreshRaw.cadenceHint, BLUEPRINT_LIMITS.short, 'occasionally')
    }
  };
}

/**
 * Pulls the first fenced JSON object out of a model answer.
 *
 * The model is told to emit exactly one ```json block. This accepts that,
 * accepts a bare object, and accepts nothing else — a prose answer simply
 * yields `null` and the fallback is used.
 */
export function extractBlueprintJson(answer: string): unknown | null {
  if (typeof answer !== 'string' || answer.length > 200_000) return null;
  const fenced = answer.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], answer];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/* ---------------------------------------------------------------- fallback */

export interface PickupBlueprintInput {
  flightLabel: string;
  /** Which job the user has already chosen, when they have. */
  chosenJob: 'track' | 'connect' | 'pickup' | null;
  hasOrigin: boolean;
  international: boolean;
  place?: string;
  localTime?: string;
}

/**
 * The airport-pickup blueprint the product can always produce on its own.
 *
 * This is the reference the model is imitating, and the floor the UI stands
 * on. Note what it asks and what it refuses to ask:
 *
 *   - **job** is asked, because the answer changes which template resolves;
 *   - **origin** is asked, and only once Pickup is chosen, because it unlocks
 *     the route, the traffic exposure and the leave-by envelope;
 *   - **passenger count** is carried as a question object and then rejected by
 *     `selectQuestions`, because its honest effect is a few minutes of
 *     assembly time — it moves no lever, so it is inferred instead;
 *   - **checked bag** is not a question at all. It is an editable assumption
 *     with its impact stated on the control, because a person can correct it
 *     in one click and does not need to be interrogated first.
 */
export function pickupBlueprint(input: PickupBlueprintInput): TemplateBlueprint {
  const pickup = input.chosenJob === 'pickup';
  const questions: BlueprintQuestion[] = [];

  if (!input.chosenJob) {
    questions.push({
      id: 'travel-job',
      prompt: 'Are you tracking the arrival, making a connection, or picking someone up?',
      whyNeeded: 'Each answer builds a different world, and only you know which one you are in.',
      materialEffect:
        'Chooses the template: a pickup builds a route world, tracking stays a reading, a connection is a different geometry entirely.',
      expectedInformationGain: 0.92,
      userCost: 0.12,
      choices: [
        { id: 'track', label: 'Tracking the arrival' },
        { id: 'connect', label: 'Making a connection' },
        { id: 'pickup', label: 'Picking someone up' }
      ]
    });
  }

  if (pickup && !input.hasOrigin) {
    questions.push({
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
      ]
    });
  }

  // Considered and deliberately not asked. It is kept in the blueprint so the
  // Source sheet can show the argument rather than a silent omission.
  questions.push({
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
    ]
  });

  const forces: BlueprintForce[] = [
    {
      id: 'flight',
      type: 'flight',
      relevance: 1,
      truth: 'unknown',
      freshness: 're-read on every check',
      spatialAnchor: 'airport',
      temporalAnchor: 'arrival',
      visualMapping: 'the dominant pulse travelling the arrival-processing strip'
    },
    {
      id: 'traffic',
      type: 'traffic',
      relevance: 0.85,
      truth: 'modeled',
      freshness: 'SAMPLE projection',
      spatialAnchor: 'route',
      temporalAnchor: 'leave-by window',
      visualMapping: 'density and current along the route path'
    },
    {
      id: 'weather',
      type: 'weather',
      relevance: 0.6,
      truth: 'modeled',
      freshness: 'SAMPLE projection',
      spatialAnchor: 'airport',
      temporalAnchor: 'arrival window',
      visualMapping: 'a projected cell over the airport with wind streaks'
    },
    {
      id: 'airport',
      type: 'airport',
      relevance: 0.55,
      truth: 'observed',
      freshness: 'official airport guidance',
      spatialAnchor: 'curb',
      temporalAnchor: 'now',
      visualMapping: 'markers at the cell-phone lot and the arrivals curb'
    },
    {
      id: 'disruption',
      type: 'disruption',
      relevance: 0.4,
      truth: 'modeled',
      freshness: 'SAMPLE projection',
      spatialAnchor: 'route',
      temporalAnchor: 'now',
      visualMapping: 'incident markers on the affected route segment'
    }
  ];

  return {
    version: BLUEPRINT_VERSION,
    source: 'fallback',
    situation: {
      type: 'airport-pickup',
      label: `Meeting ${input.flightLabel} at SEA`,
      entities: [input.flightLabel, 'SEA Cell Phone Lot', 'SEA Arrivals curb'],
      localTime: input.localTime ?? 'local time',
      place: input.place ?? 'Seattle–Tacoma International Airport'
    },
    jobs: {
      primary: {
        id: input.chosenJob ?? 'pickup',
        label: pickup ? 'Picking someone up' : 'An arrival that has a job behind it',
        evidence: ['an inbound flight was named', 'the destination is SEA']
      },
      alternates: [
        { id: 'track', label: 'Tracking the arrival', evidence: ['a status question with no meeting in it'] },
        { id: 'connect', label: 'Making a connection', evidence: ['an onward flight would be named'] }
      ]
    },
    template: {
      family: 'journey-world',
      primaryAxis: 'space — the route from you to the curb',
      secondaryAxis: 'time — the arrival processing that decides when the curb is live',
      worldMetaphor: 'one map where the drive and the airport share a clock',
      visualForces: ['route', 'traffic', 'weather', 'airport', 'disruption', 'refresh']
    },
    forces,
    unknowns: [
      {
        id: 'actual-landing',
        reason: 'No source has stated an actual landing time yet.',
        resolvedBy: 'a flight-status page that publishes wheels-down'
      },
      {
        id: 'checked-bag',
        reason: 'Nobody said whether there is a checked bag, and it moves curb-ready by 12–28 minutes.',
        resolvedBy: 'the assumption control on the situation line — one click, no question'
      },
      {
        id: 'passenger-count',
        reason: 'Party size is unknown; it changes the curb assembly tail by a few minutes.',
        resolvedBy: 'inference, held at one, correctable in a follow-up phrase — not worth a question'
      }
    ],
    questions,
    handoffs: [
      {
        id: 'cell-lot-directions',
        label: 'Directions to the SEA Cell Phone Lot',
        action: 'Opens a maps route in a new tab, only when you click it.',
        url: 'https://www.google.com/maps/dir/?api=1&destination=SEA+Cell+Phone+Lot+SeaTac+WA'
      },
      {
        id: 'sea-pickup-rules',
        label: 'Dropping off / picking up at SEA',
        action: 'The official airport page for curb rules.',
        url: 'https://www.portseattle.org/sea/dropping-off-picking-up'
      }
    ],
    refresh: {
      targetEvent: 'the curb-ready text',
      cadenceHint: 'hourly far out, every 15 minutes near arrival, every 5 minutes on the ground'
    }
  };
}

/** The other half of the demonstration: the same grammar, a different world. */
export function newsBlueprint(input: { label: string; place: string; localTime?: string }): TemplateBlueprint {
  return {
    version: BLUEPRINT_VERSION,
    source: 'fallback',
    situation: {
      type: 'local-briefing',
      label: input.label,
      entities: [input.place],
      localTime: input.localTime ?? 'this morning',
      place: input.place
    },
    jobs: {
      primary: {
        id: 'briefing',
        label: 'Knowing what could reach my day',
        evidence: ['the question asks what matters, not what happened']
      },
      alternates: [{ id: 'lookup', label: 'One specific fact', evidence: ['a named event would be asked for'] }]
    },
    template: {
      family: 'signal-field',
      primaryAxis: 'reach — how close a signal gets to you',
      secondaryAxis: 'impact — how hard it lands if it does',
      worldMetaphor: 'a field of signals around where you stand',
      visualForces: ['local', 'markets', 'weather', 'mobility']
    },
    forces: [
      {
        id: 'local',
        type: 'local',
        relevance: 0.9,
        truth: 'modeled',
        freshness: 'SAMPLE projection',
        spatialAnchor: 'region',
        temporalAnchor: 'today',
        visualMapping: 'signals placed by distance from the centre'
      },
      {
        id: 'markets',
        type: 'market',
        relevance: 0.6,
        truth: 'modeled',
        freshness: 'SAMPLE projection',
        spatialAnchor: 'axis',
        temporalAnchor: 'today',
        visualMapping: 'a vertical axis of moves beside the field'
      }
    ],
    unknowns: [
      {
        id: 'scope',
        reason: 'It is not stated which kinds of signal count as reaching you.',
        resolvedBy: 'one question, when it is genuinely ambiguous'
      }
    ],
    questions: [],
    handoffs: [],
    refresh: { targetEvent: 'the next material local change', cadenceHint: 'hourly' }
  };
}
