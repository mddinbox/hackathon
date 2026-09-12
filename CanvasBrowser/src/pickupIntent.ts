/**
 * Situation reading.
 *
 * This module detects that a question is about an airport arrival and reads
 * the literal flight answer. It never asserts that the user is doing a pickup —
 * job hypotheses are offered to the user, who chooses.
 */
import type { Assumptions, Citation, FlightPhase, FlightReading, LandingStatus } from './types';
import type { ClarifyQuestion } from './inference';

export interface ArrivalSituation {
  flightLabel: string;
  airline: string | null;
  flightNumber: string | null;
  origin: string | null;
  destination: string | null;
  /** True when the destination is (or is assumed to be) SEA, the P0 terrain. */
  seaArrival: boolean;
  international: boolean;
}

export interface JobHypothesis {
  id: 'track' | 'connect' | 'pickup';
  label: string;
  supported: boolean;
}

const AIRPORT_CODE_RE = /\b(TPE|SEA|SFO|LAX|JFK|SEA-TAC|NRT|HND|ICN|PDX|YVR|ORD|DFW|BOS|EWR|IAD|SJC|LAS)\b/g;
const FLIGHT_NUMBER_RE = /\b([A-Z]{2})\s?-?(\d{1,4})\b/;
const ARRIVAL_SIGNAL_RE = /\b(land(?:ed|ing|s)?|arriv\w*|touch(?:ed)?\s?down|inbound|flight|airport|pick(?:ing)?\s?up|gate)\b/i;
const AIRLINES: Array<{ match: RegExp; name: string; code: string }> = [
  { match: /\beva\s?air\b|\beva\b/i, name: 'EVA Air', code: 'BR' },
  { match: /\bdelta\b/i, name: 'Delta', code: 'DL' },
  { match: /\balaska\b/i, name: 'Alaska', code: 'AS' },
  { match: /\bunited\b/i, name: 'United', code: 'UA' },
  { match: /\bamerican\b/i, name: 'American', code: 'AA' },
  { match: /\bana\b/i, name: 'ANA', code: 'NH' }
];
const INTERNATIONAL_ORIGINS = new Set(['TPE', 'NRT', 'HND', 'ICN', 'YVR']);

/** Detects an airport-arrival situation. Returns null when the question is not one. */
export function detectArrivalSituation(prompt: string): ArrivalSituation | null {
  if (!ARRIVAL_SIGNAL_RE.test(prompt)) return null;

  const codes: string[] = [];
  for (const match of prompt.toUpperCase().matchAll(AIRPORT_CODE_RE)) {
    const code = match[1] === 'SEA-TAC' ? 'SEA' : match[1];
    if (!codes.includes(code)) codes.push(code);
  }
  const airline = AIRLINES.find((entry) => entry.match.test(prompt)) ?? null;
  const flightMatch = prompt.toUpperCase().match(FLIGHT_NUMBER_RE);
  const flightNumber = flightMatch ? `${flightMatch[1]}${flightMatch[2]}` : null;

  if (codes.length === 0 && !airline && !flightNumber) return null;

  const destination = codes.length > 1 ? codes[codes.length - 1] : codes[0] ?? null;
  const origin = codes.length > 1 ? codes[0] : null;
  const labelParts = [airline?.name ?? null, flightNumber, origin && destination ? `${origin} → ${destination}` : destination];
  return {
    flightLabel: labelParts.filter(Boolean).join(' · ') || 'Inbound flight',
    airline: airline?.name ?? null,
    flightNumber,
    origin,
    destination,
    seaArrival: destination === 'SEA' || codes.includes('SEA'),
    international: origin ? INTERNATIONAL_ORIGINS.has(origin) : true
  };
}

/**
 * The offer shown after the literal answer. Order is stable, nothing is
 * pre-selected, and the unsupported hypothesis is still listed honestly.
 */
export function jobHypotheses(): JobHypothesis[] {
  return [
    { id: 'track', label: 'Tracking the arrival', supported: true },
    { id: 'connect', label: 'Making a connection', supported: false },
    { id: 'pickup', label: 'Picking someone up', supported: true }
  ];
}

/**
 * The same offer, expressed as a budgeted question. Showing it costs one of
 * the two clarifying questions the product is allowed to ask.
 *
 * The reason line is not decoration: every question the product asks has to be
 * able to say what answering it changes, because that is the test it had to
 * pass to be asked at all.
 */
export const JOB_QUESTION: ClarifyQuestion = {
  id: 'travel-job',
  question: 'Are you tracking the arrival, making a connection, or picking someone up?',
  reason: 'Each answer builds a different world, and only you know which one you are in.',
  options: jobHypotheses().map((hypothesis) => ({ id: hypothesis.id, label: hypothesis.label })),
  fallbackOptionId: 'track'
};

/**
 * The job question as the blueprint sees it.
 *
 * When a blueprint carries a `travel-job` question of its own — Sol-generated
 * or fallback — its prompt and its reason are used, so the world the model
 * designed is the world the person is asked about. The choices are always the
 * product's own, because a job id has to map to a template this build can
 * actually compile.
 */
export function jobQuestionFor(
  blueprintQuestion: { prompt: string; whyNeeded: string } | null | undefined
): ClarifyQuestion {
  if (!blueprintQuestion) return JOB_QUESTION;
  return {
    ...JOB_QUESTION,
    question: blueprintQuestion.prompt || JOB_QUESTION.question,
    reason: blueprintQuestion.whyNeeded || JOB_QUESTION.reason
  };
}

const ENROUTE_RE = /\b(en\s?route|enroute|airborne|in the air|still in flight|in flight|has not landed|hasn'?t landed|not yet landed|not landed)\b/i;
const LANDED_RE = /\b(landed|arrived|touched down|touchdown|wheels[-\s]?down|on the ground|at the gate)\b/i;
const AT_GATE_RE = /\b(at the gate|arrived at (?:the )?gate|on stand|blocks? in)\b/i;
const SCHEDULED_RE = /\bscheduled\b[^.]{0,40}?\b(?:arrival|arrive|land(?:ing)?|in)\b|\b(?:arrival|landing) (?:is )?scheduled\b|\bscheduled to (?:arrive|land)\b|\bscheduled arrival\b/i;
const ESTIMATED_RE = /\b(estimated|expected|eta|now expected|projected|due)\b/i;
const NEGATION_RE = /\b(not|no|hasn'?t|haven'?t|isn'?t|un(?:confirmed|available)|yet to|due to|scheduled to|expected to|estimated to|will|should)\b/i;
const TIME_RE = /\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/i;
const URL_RE = /https?:\/\/[^\s)<>"']+/g;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Extracts plain HTTPS citations from a free-text answer. */
export function extractCitations(text: string): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const raw of text.match(URL_RE) ?? []) {
    const url = raw.replace(/[.,;)]+$/, '');
    if (seen.has(url)) continue;
    seen.add(url);
    let label = url;
    try {
      label = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      /* keep the raw string as the label */
    }
    citations.push({ label, url });
  }
  return citations;
}

/**
 * Resolves a wall-clock time stated in an answer to an epoch timestamp near
 * `nowMs`. A time that would land far in the future is read as yesterday.
 */
export function resolveClockTime(nowMs: number, hours: number, minutes: number, meridiem: string | null): number {
  let hour = hours % 24;
  if (meridiem) {
    const pm = /p/i.test(meridiem);
    hour = hours % 12;
    if (pm) hour += 12;
  }
  const base = new Date(nowMs);
  const candidate = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minutes, 0, 0);
  const deltaMs = candidate.getTime() - nowMs;
  if (deltaMs > 6 * 60 * 60 * 1000) return candidate.getTime() - 24 * 60 * 60 * 1000;
  if (deltaMs < -18 * 60 * 60 * 1000) return candidate.getTime() + 24 * 60 * 60 * 1000;
  return candidate.getTime();
}

export interface ParseFlightAnswerInput {
  answer: string;
  nowMs: number;
  flightLabel: string;
  retrievedAt?: string | null;
}

/**
 * Reads a free-text answer into a flight reading.
 *
 * Rules that are never bent:
 * - a missing status is `unknown`, never `landed`;
 * - `landed` requires an un-negated landing claim;
 * - `landingMs` is only set when the same claim carries a time;
 * - a scheduled or estimated arrival is read into its own field and can never
 *   become `landingMs`, so it can move the horizon and the refresh cadence but
 *   never produce a commitment.
 */
export function parseFlightAnswer(input: ParseFlightAnswerInput): FlightReading {
  const { answer, nowMs, flightLabel } = input;
  const citations = extractCitations(answer);
  const retrievedAt = input.retrievedAt ?? null;

  let status: LandingStatus = 'unknown';
  let landingMs: number | null = null;
  let landingLabel: string | null = null;
  let note = 'No source stated an actual landing time, so arrival is still unknown.';

  const lines = sentences(answer);
  const landedSentence = lines.find((sentence) => {
    if (!LANDED_RE.test(sentence)) return false;
    const head = sentence.slice(0, sentence.search(LANDED_RE));
    return !NEGATION_RE.test(head) && !ENROUTE_RE.test(sentence);
  });

  if (landedSentence) {
    status = 'landed';
    note = 'A source stated the flight is on the ground.';
    const timeMatch = landedSentence.match(TIME_RE);
    if (timeMatch) {
      const hours = Number(timeMatch[1]);
      const minutes = Number(timeMatch[2]);
      const meridiem = timeMatch[3] ?? null;
      if (hours <= 23 && minutes <= 59) {
        landingMs = resolveClockTime(nowMs, hours, minutes, meridiem);
        landingLabel = timeMatch[0].trim();
        note = `A source stated an actual landing at ${landingLabel}.`;
      }
    }
    if (landingMs === null) {
      note = 'A source says it is on the ground but did not state the landing time.';
    }
  } else if (ENROUTE_RE.test(answer)) {
    status = 'enroute';
    note = 'The flight is reported still en route, so there is no actual landing time yet.';
  }

  // Model prose is not evidence. Without a claim-level URL, a landing sentence
  // stays an unverified hint and can never unlock a committed pickup window.
  if (status === 'landed' && citations.length === 0) {
    status = 'unknown';
    landingMs = null;
    landingLabel = null;
    note = 'A landing was mentioned without a claim-level citation, so arrival remains unknown.';
  }

  const scheduledArrivalMs = readPlannedTime(lines, SCHEDULED_RE, nowMs, landedSentence);
  const estimatedArrivalMs = readPlannedTime(lines, ESTIMATED_RE, nowMs, landedSentence);

  let phase: FlightPhase = 'unknown';
  if (status === 'landed') {
    phase = landedSentence && AT_GATE_RE.test(landedSentence) ? 'at-gate' : 'landed';
  } else if (status === 'enroute') {
    phase = 'enroute';
  } else if (scheduledArrivalMs !== null || estimatedArrivalMs !== null) {
    phase = 'scheduled';
  }

  const truth =
    status === 'landed' && landingMs !== null && citations.length > 0 ? 'observed' : 'unknown';
  return {
    status,
    phase,
    actualLandingMs: landingMs,
    scheduledArrivalMs,
    estimatedArrivalMs,
    landingMs,
    landingLabel,
    truth,
    note,
    citations,
    provenance: 'live-research',
    flightLabel,
    retrievedAt
  };
}

/**
 * Reads a planning time (scheduled / estimated) out of the sentence that
 * actually claims it. Deliberately conservative: the sentence must carry the
 * qualifier *and* a clock, it must not be the landing sentence, and nothing
 * here is ever promoted to an actual landing.
 */
function readPlannedTime(
  lines: string[],
  qualifier: RegExp,
  nowMs: number,
  landedSentence: string | undefined
): number | null {
  for (const sentence of lines) {
    if (sentence === landedSentence) continue;
    if (!qualifier.test(sentence)) continue;
    const timeMatch = sentence.match(TIME_RE);
    if (!timeMatch) continue;
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    if (hours > 23 || minutes > 59) continue;
    return resolveClockTime(nowMs, hours, minutes, timeMatch[3] ?? null);
  }
  return null;
}

export interface AssumptionEdit {
  patch: Partial<Assumptions>;
  label: string;
}

/**
 * Local, model-free reading of a follow-up like "no checked bag".
 * Returns null when nothing recognisable was said.
 */
export function parseAssumptionEdit(text: string): AssumptionEdit | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;

  if (/\b(no|without|zero)\b[^.]{0,20}\b(checked\s?bags?|luggage|bags?)\b/.test(value) || /\bcarry[-\s]?on only\b/.test(value)) {
    return { patch: { checkedBag: false }, label: 'No checked bag' };
  }
  if (/\b(has|with|got|there is|there's|yes)\b[^.]{0,20}\b(checked\s?bags?|luggage)\b/.test(value) || /^checked bag$/.test(value)) {
    return { patch: { checkedBag: true }, label: 'Checked bag' };
  }
  if (/\bdomestic\b|\bno customs\b|\bskip customs\b/.test(value)) {
    return { patch: { internationalArrival: false }, label: 'Domestic arrival' };
  }
  if (/\binternational\b|\bcustoms\b|\bcbp\b/.test(value)) {
    return { patch: { internationalArrival: true }, label: 'International arrival' };
  }
  const partyMatch = value.match(/\b(\d{1,2})\s*(passengers?|people|adults?|travell?ers?)\b/);
  if (partyMatch) {
    const count = Math.min(9, Math.max(1, Number(partyMatch[1])));
    return { patch: { passengerCount: count }, label: `${count} passenger${count === 1 ? '' : 's'}` };
  }
  if (/\b(just me|solo|alone|one passenger|1 passenger)\b/.test(value)) {
    return { patch: { passengerCount: 1 }, label: '1 passenger' };
  }
  return null;
}

/**
 * Party size, read out of the original prompt.
 *
 * Party size is never asked for — it moves no template, route, envelope or
 * handoff, so it fails the question-economics test. But when someone has
 * already said it ("picking up my parents", "three of them"), refusing to hear
 * it would be its own kind of rudeness. So it is captured silently, held at
 * one otherwise, and corrected only in the person's own words.
 */
export function parsePartyCount(prompt: string): number | null {
  const value = prompt.toLowerCase();
  const numeric = value.match(/\b(\d{1,2})\s*(passengers?|people|adults?|travell?ers?|of them|friends?|guests?)\b/);
  if (numeric) return Math.min(9, Math.max(1, Number(numeric[1])));
  const words: Array<[RegExp, number]> = [
    [/\b(two|both|a couple|my parents|the couple)\b/, 2],
    [/\bthree\b/, 3],
    [/\bfour\b/, 4]
  ];
  for (const [pattern, count] of words) {
    if (pattern.test(value)) return count;
  }
  if (/\b(my family|the family|the kids|the team)\b/.test(value)) return 3;
  return null;
}
