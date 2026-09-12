/**
 * Situation reading for the Living News template.
 *
 * A feed answers "what was published". The job here is "what changed in my
 * world, what reaches me, and what deserves attention or action". This module
 * decides whether a question is that job, infers everything it honestly can
 * from the words themselves, and states what is left to ask.
 *
 * It never asks for categories in a form: at most a scope and a horizon, and
 * only when they cannot be read from the prompt.
 */
import type { ClarifyQuestion } from './inference';

/** Which part of the user's world is in play. */
export type NewsScope = 'near-me' | 'work-markets' | 'both';

/** How far ahead the consequences have to reach. */
export type NewsHorizon = 'now' | 'today' | 'week';

export type LayerId = 'local' | 'markets' | 'weather' | 'mobility';

export interface NewsSituation {
  /**
   * `briefing` — the user already asked for an assembled world.
   * `ambiguous` — a news-shaped question that deserves the literal answer first.
   */
  kind: 'briefing' | 'ambiguous';
  /** Inferred from the prompt; null when it must be asked. */
  scope: NewsScope | null;
  horizon: NewsHorizon | null;
  /** A place named in the prompt, if any. Coarse, never geocoded. */
  placeHint: string | null;
  /** Short restatement of the job, shown above a clarifying question. */
  label: string;
}

const NEWS_SIGNAL_RE =
  /\b(news|headlines?|happening|going on|briefing|brief me|what changed|what'?s changed|market|markets|stock|stocks|earnings|index|traffic|commute|air quality|smoke|weather|outage|closure|alert|around me)\b/i;

/**
 * A briefing is an *assembly* request. A temporal word on its own — "this
 * morning", "today", "my day" — is never enough: "Did the Fed change rates in
 * the news this morning?" is a specific factual question and must be answered
 * literally first. The intent has to be stated separately: brief me, what
 * matters, what should I know, what is happening around me.
 */
const BRIEFING_RE =
  /\b(briefings?|brief me|build (?:me|my)|living briefing|what should i know|what matters|matters? to me|matter to me|around me|catch me up|overview of (?:my|the)|affect(?:s|ing)? my|change my day|start my day|run my day|my world)\b/i;

const LOCAL_RE =
  /\b(local|nearby|near me|neighbou?rhood|my (?:city|area|street|block|commute|route)|traffic|transit|commute|weather|air quality|smoke|closure|outage)\b/i;
const MARKET_RE = /\b(market|markets|stock|stocks|ticker|watchlist|earnings|index|indices|s&p|nasdaq|dow|fed|cpi|rates?|portfolio|work)\b/i;

const NOW_RE = /\b(right now|at this moment|currently|next hour|this hour)\b/i;
const TODAY_RE = /\b(today|tonight|this morning|this afternoon|this evening|next 6 hours|rest of the day)\b/i;
const WEEK_RE = /\b(this week|next few days|coming days|week ahead|weekend)\b/i;

const PLACE_RE = /\b(seattle|bellevue|redmond|tacoma|everett)\b/i;

/**
 * Detects a "what changed in my world" situation.
 * Returns null when the question is not that job.
 */
export function detectNewsSituation(prompt: string): NewsSituation | null {
  if (!NEWS_SIGNAL_RE.test(prompt)) return null;
  // An airport arrival question is the other template's job, not this one.
  if (/\b(flight|landed|landing|arrival|gate|terminal|pick(?:ing)?\s?up)\b/i.test(prompt)) return null;

  const local = LOCAL_RE.test(prompt);
  const markets = MARKET_RE.test(prompt);
  const scope: NewsScope | null = local && markets ? 'both' : local ? 'near-me' : markets ? 'work-markets' : null;

  const horizon: NewsHorizon | null = WEEK_RE.test(prompt)
    ? 'week'
    : TODAY_RE.test(prompt)
      ? 'today'
      : NOW_RE.test(prompt)
        ? 'now'
        : null;

  const placeMatch = prompt.match(PLACE_RE);
  const kind: NewsSituation['kind'] = BRIEFING_RE.test(prompt) ? 'briefing' : 'ambiguous';

  return {
    kind,
    scope,
    horizon,
    placeHint: placeMatch ? placeMatch[1][0].toUpperCase() + placeMatch[1].slice(1).toLowerCase() : null,
    label:
      kind === 'briefing'
        ? 'What is changing around you that could reach your day.'
        : 'This reads like a news question. The literal answer comes first.'
  };
}

export const SCOPE_QUESTION: ClarifyQuestion = {
  id: 'news-scope',
  question: 'What part of your world should this cover?',
  options: [
    { id: 'near-me', label: 'Near me', detail: 'Streets, weather, air, mobility' },
    { id: 'work-markets', label: 'My work & markets', detail: 'Indices, watchlist, releases' },
    { id: 'both', label: 'Both', detail: 'One field, both forces' }
  ],
  fallbackOptionId: 'both'
};

export const HORIZON_QUESTION: ClarifyQuestion = {
  id: 'news-horizon',
  question: 'How far ahead does it have to reach?',
  options: [
    { id: 'now', label: 'Right now', detail: 'The next hour' },
    { id: 'today', label: 'Today', detail: 'Through this evening' },
    { id: 'week', label: 'This week', detail: 'Consequences that keep running' }
  ],
  fallbackOptionId: 'today'
};

/** The offer shown after a literal news answer. Choosing is one question. */
export const BRIEFING_OFFER: ClarifyQuestion = {
  id: 'news-offer',
  question: 'Do you want that as an answer, or as your world?',
  options: [
    { id: 'literal', label: 'Keep it literal', detail: 'The answer stays as written' },
    { id: 'briefing', label: 'Build my living briefing', detail: 'Assemble the signal field' }
  ],
  fallbackOptionId: 'literal'
};

export function parseScope(id: string): NewsScope | null {
  return id === 'near-me' || id === 'work-markets' || id === 'both' ? id : null;
}

export function parseHorizon(id: string): NewsHorizon | null {
  return id === 'now' || id === 'today' || id === 'week' ? id : null;
}

export interface WorldEdit {
  label: string;
  layers?: Partial<Record<LayerId, boolean>>;
  radiusMiles?: number;
  focus?: 'all' | 'commute';
}

const LAYER_WORDS: Array<{ match: RegExp; id: LayerId; name: string }> = [
  { match: /\b(markets?|stocks?|tickers?|watchlist|earnings)\b/i, id: 'markets', name: 'Markets' },
  { match: /\b(weather|air|air quality|smoke|forecast)\b/i, id: 'weather', name: 'Weather/air' },
  { match: /\b(mobility|traffic|transit|roads?|commute|ferry|ferries)\b/i, id: 'mobility', name: 'Roads & transit' },
  { match: /\b(local|neighbou?rhood|city|civic)\b/i, id: 'local', name: 'Local' }
];

/**
 * Local, model-free reading of a follow-up like "hide markets" or
 * "only things within 25 miles". Returns null when nothing was recognised —
 * the world is never rebuilt on a guess, and nothing is ever appended as chat.
 */
export function parseWorldEdit(text: string): WorldEdit | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;

  if (/\b(commut(?:e|ing)|drive|route|get to work)\b/.test(value) && /\b(what|affect|matters?|only|show)\b/.test(value)) {
    return { label: 'Focused on your commute', focus: 'commute', layers: { mobility: true } };
  }
  if (/\b(everything|all of it|unfocus|show all)\b/.test(value)) {
    return { label: 'Focus cleared', focus: 'all' };
  }

  const radius = value.match(/\b(\d{1,3})\s*(?:mi|mile|miles)\b/);
  if (radius) {
    const miles = Math.min(200, Math.max(2, Number(radius[1])));
    return { label: `Radius set to ${miles} miles`, radiusMiles: miles };
  }

  const hiding = /\b(hide|drop|remove|without|no|mute|less)\b/.test(value);
  const showing = /\b(show|add|bring back|include|unhide|more)\b/.test(value);
  for (const word of LAYER_WORDS) {
    if (!word.match.test(value)) continue;
    if (hiding) return { label: `${word.name} hidden`, layers: { [word.id]: false } };
    if (showing) return { label: `${word.name} shown`, layers: { [word.id]: true } };
  }
  return null;
}
