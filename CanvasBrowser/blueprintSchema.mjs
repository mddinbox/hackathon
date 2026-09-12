/**
 * The wire-side blueprint gate.
 *
 * This is the *first* of two independent normalizers. It runs in the Node
 * gateway, before a model answer is ever handed to a browser, and it is
 * deliberately a separate implementation from `src/templateBlueprint.ts`
 * rather than a shared one: the browser must not have to trust that the
 * server validated anything, and the server must not have to trust that the
 * browser will. Two gates, two implementations, same rules.
 *
 * Rules:
 *   - one JSON object, extracted from the first fenced block or the answer;
 *   - unknown fields are dropped, never forwarded;
 *   - every string is control-stripped, whitespace-collapsed, length-capped
 *     and rejected outright if it contains markup, a script, a template
 *     expression or a non-https scheme;
 *   - every array is count-capped and de-duplicated by id;
 *   - every enum is checked against a fixed list;
 *   - every 0–1 number is clamped;
 *   - anything that fails structurally yields `null`, which the route answers
 *     with `source: 'fallback'` so the client falls back deterministically.
 *
 * A model therefore cannot emit HTML, CSS, JavaScript, a selector, a style, an
 * event handler, or a non-https link, no matter what it writes.
 */

export const BLUEPRINT_VERSION = 1;

const LIMITS = {
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
};

const FAMILIES = ['journey-world', 'signal-field', 'time-terrain', 'literal'];
const FORCE_TYPES = ['flight', 'weather', 'traffic', 'airport', 'disruption', 'person', 'market', 'local'];
const TRUTHS = ['observed', 'modeled', 'inferred', 'unknown'];

const UNSAFE = /[<>]|&#|javascript:|data:|vbscript:|\bon[a-z]+\s*=|\$\{|\{\{|<\/?script/i;

function text(value, cap) {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || UNSAFE.test(cleaned)) return null;
  return cleaned.slice(0, cap);
}

function textOr(value, cap, fallback) {
  return text(value, cap) ?? fallback;
}

function unit(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

function slug(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || fallback;
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function strings(value, cap, max) {
  const out = [];
  for (const entry of arr(value)) {
    const cleaned = text(entry, cap);
    if (cleaned && !out.includes(cleaned)) out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function oneOf(value, allowed, fallback) {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

export function safeUrl(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > LIMITS.url || UNSAFE.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return url.toString().slice(0, LIMITS.url);
  } catch {
    return null;
  }
}

function job(value, fallbackId) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    id: slug(raw.id, fallbackId),
    label: textOr(raw.label, LIMITS.short, fallbackId),
    evidence: strings(raw.evidence, LIMITS.text, LIMITS.evidence)
  };
}

/** Pulls the first JSON object out of a fenced block, or out of the answer. */
export function extractBlueprintJson(answer) {
  if (typeof answer !== 'string' || answer.length > 200_000) return null;
  const fenced = answer.match(/```(?:json)?\s*([\s\S]*?)```/i);
  for (const candidate of [fenced ? fenced[1] : null, answer]) {
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

export function normalizeBlueprint(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const version = typeof raw.version === 'number' ? Math.round(raw.version) : BLUEPRINT_VERSION;
  if (version !== BLUEPRINT_VERSION) return null;

  const templateRaw = raw.template && typeof raw.template === 'object' ? raw.template : null;
  if (!templateRaw || typeof templateRaw.family !== 'string' || !FAMILIES.includes(templateRaw.family)) return null;

  const situationRaw = raw.situation && typeof raw.situation === 'object' ? raw.situation : {};
  const jobsRaw = raw.jobs && typeof raw.jobs === 'object' ? raw.jobs : {};
  const refreshRaw = raw.refresh && typeof raw.refresh === 'object' ? raw.refresh : {};

  const forces = [];
  for (const entry of arr(raw.forces)) {
    if (forces.length >= LIMITS.forces) break;
    const value = entry && typeof entry === 'object' ? entry : {};
    const mapping = text(value.visualMapping, LIMITS.text);
    if (!mapping) continue;
    const id = slug(value.id, `force-${forces.length + 1}`);
    if (forces.some((existing) => existing.id === id)) continue;
    forces.push({
      id,
      type: oneOf(value.type, FORCE_TYPES, 'local'),
      relevance: unit(value.relevance, 0.5),
      truth: oneOf(value.truth, TRUTHS, 'unknown'),
      freshness: textOr(value.freshness, LIMITS.short, 'unknown freshness'),
      spatialAnchor: textOr(value.spatialAnchor, LIMITS.short, 'region'),
      temporalAnchor: textOr(value.temporalAnchor, LIMITS.short, 'now'),
      visualMapping: mapping
    });
  }

  const unknowns = [];
  for (const entry of arr(raw.unknowns)) {
    if (unknowns.length >= LIMITS.unknowns) break;
    const value = entry && typeof entry === 'object' ? entry : {};
    const reason = text(value.reason, LIMITS.text);
    if (!reason) continue;
    const id = slug(value.id, `unknown-${unknowns.length + 1}`);
    if (unknowns.some((existing) => existing.id === id)) continue;
    unknowns.push({ id, reason, resolvedBy: textOr(value.resolvedBy, LIMITS.text, 'a source that states it') });
  }

  const questions = [];
  for (const entry of arr(raw.questions)) {
    if (questions.length >= LIMITS.questions) break;
    const value = entry && typeof entry === 'object' ? entry : {};
    const prompt = text(value.prompt, LIMITS.text);
    if (!prompt) continue;
    const id = slug(value.id, `question-${questions.length + 1}`);
    if (questions.some((existing) => existing.id === id)) continue;
    const choices = [];
    for (const choiceRaw of arr(value.choices)) {
      if (choices.length >= LIMITS.choices) break;
      const choice = choiceRaw && typeof choiceRaw === 'object' ? choiceRaw : {};
      const label = text(choice.label, LIMITS.short);
      if (!label) continue;
      const choiceId = slug(choice.id, `choice-${choices.length + 1}`);
      if (choices.some((existing) => existing.id === choiceId)) continue;
      const detail = text(choice.detail, LIMITS.text);
      choices.push(detail ? { id: choiceId, label, detail } : { id: choiceId, label });
    }
    questions.push({
      id,
      prompt,
      whyNeeded: textOr(value.whyNeeded, LIMITS.text, ''),
      // Never defaulted: an unstated effect must stay empty so the client's
      // selector rejects the question rather than inventing a reason for it.
      materialEffect: text(value.materialEffect, LIMITS.text) ?? '',
      expectedInformationGain: unit(value.expectedInformationGain, 0),
      userCost: unit(value.userCost, 1),
      choices
    });
  }

  const handoffs = [];
  for (const entry of arr(raw.handoffs)) {
    if (handoffs.length >= LIMITS.handoffs) break;
    const value = entry && typeof entry === 'object' ? entry : {};
    const label = text(value.label, LIMITS.short);
    if (!label) continue;
    const id = slug(value.id, `handoff-${handoffs.length + 1}`);
    if (handoffs.some((existing) => existing.id === id)) continue;
    handoffs.push({
      id,
      label,
      action: textOr(value.action, LIMITS.text, 'Opens only when you click it.'),
      url: safeUrl(value.url)
    });
  }

  const alternates = [];
  for (const entry of arr(jobsRaw.alternates).slice(0, LIMITS.alternates)) {
    alternates.push(job(entry, `alternate-${alternates.length + 1}`));
  }

  return {
    version: BLUEPRINT_VERSION,
    source: 'sol-generated',
    situation: {
      type: slug(situationRaw.type, 'situation'),
      label: textOr(situationRaw.label, LIMITS.text, 'A situation with a shape of its own'),
      entities: strings(situationRaw.entities, LIMITS.short, LIMITS.entities),
      localTime: textOr(situationRaw.localTime, LIMITS.short, 'local time'),
      place: textOr(situationRaw.place, LIMITS.short, 'here')
    },
    jobs: { primary: job(jobsRaw.primary, 'primary'), alternates },
    template: {
      family: templateRaw.family,
      primaryAxis: textOr(templateRaw.primaryAxis, LIMITS.short, 'time'),
      secondaryAxis: textOr(templateRaw.secondaryAxis, LIMITS.short, 'uncertainty'),
      worldMetaphor: textOr(templateRaw.worldMetaphor, LIMITS.text, 'a world you can read at a glance'),
      visualForces: strings(templateRaw.visualForces, LIMITS.short, LIMITS.visualForces)
    },
    forces,
    unknowns,
    questions,
    handoffs,
    refresh: {
      targetEvent: textOr(refreshRaw.targetEvent, LIMITS.text, 'nothing in particular'),
      cadenceHint: textOr(refreshRaw.cadenceHint, LIMITS.short, 'occasionally')
    }
  };
}

/** The schema the model is shown. Prose and enums only — never markup. */
export const BLUEPRINT_CONTRACT = `Return exactly one fenced \`\`\`json block and nothing else.
It must be a single JSON object with this shape and no other keys:
{
  "version": 1,
  "situation": { "type": "kebab-case-key", "label": "", "entities": [""], "localTime": "", "place": "" },
  "jobs": { "primary": { "id": "", "label": "", "evidence": [""] }, "alternates": [{ "id": "", "label": "", "evidence": [""] }] },
  "template": { "family": "journey-world|signal-field|time-terrain|literal", "primaryAxis": "", "secondaryAxis": "", "worldMetaphor": "", "visualForces": [""] },
  "forces": [{ "id": "", "type": "flight|weather|traffic|airport|disruption|person|market|local", "relevance": 0.0, "truth": "observed|modeled|inferred|unknown", "freshness": "", "spatialAnchor": "", "temporalAnchor": "", "visualMapping": "" }],
  "unknowns": [{ "id": "", "reason": "", "resolvedBy": "" }],
  "questions": [{ "id": "", "prompt": "", "whyNeeded": "", "materialEffect": "", "expectedInformationGain": 0.0, "userCost": 0.0, "choices": [{ "id": "", "label": "", "detail": "" }] }],
  "handoffs": [{ "id": "", "label": "", "action": "", "url": "https://..." }],
  "refresh": { "targetEvent": "", "cadenceHint": "" }
}
Hard rules:
- No HTML, CSS, JavaScript, selectors, style values, colours, pixel sizes or element names anywhere. Every string is plain prose or a listed enum value.
- Only https:// URLs. No data:, javascript:, or relative links.
- A question is only worth asking if answering it changes the template, the route, the decision envelope, or the handoff. State that change in "materialEffect". If it changes none of them, leave the question out or state the effect honestly and expect it to be rejected.
- Never ask for something that can be inferred and corrected in one click.
- At most six questions; the product will select at most two.`;
