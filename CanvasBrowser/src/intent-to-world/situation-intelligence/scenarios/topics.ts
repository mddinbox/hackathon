/**
 * Tier 2 — topic specializations.
 *
 * Where Tier 1 is comprehensive-but-general, Tier 2 is deep-but-narrow. Each
 * topic supplies the real directions a job splits into, the signal priors that
 * tell them apart, and the concrete forces each one assembles — the knowledge
 * that makes the difference between "here are some options" and "East Austin,
 * ~$1,800, 20-minute commute, hot summers".
 *
 * A topic overrides the general graph for its scenario; every other scenario
 * keeps Tier 1's graph untouched, so coverage stays comprehensive and depth is
 * added only where it has been earned. Adding a topic is the whole job of
 * teaching the engine a new domain — nothing else changes.
 */
import type { IntentionDirection, IntentionGraph } from './intention';

export interface TopicSpecialization {
  scenarioId: string;
  /** The decision this topic's surface leads with. */
  decision: string;
  actionLabel: string;
  directions: IntentionDirection[];
  dampen?: Array<{ re: RegExp; direction: string; factor: number }>;
}

const REAL_ESTATE: TopicSpecialization = {
  scenarioId: 'real-estate',
  decision: 'Where to live and what it will really cost.',
  actionLabel: 'Show live listings that match',
  dampen: [
    // "for rent" is a renter's phrase; it makes an investor read much less likely.
    { re: /\bfor rent\b|\brent(?:ing|al)?\b/i, direction: 'invest', factor: 0.25 }
  ],
  directions: [
    {
      id: 'relocate-family',
      label: 'Relocating with family',
      base: 0.3,
      signals: [
        { re: /\b(family|kids?|children|spouse|wife|husband|partner)\b/i, weight: 0.5, because: 'a household is mentioned' },
        { re: /\b(schools?|school district|daycare)\b/i, weight: 0.4, because: 'schools matter to this move' },
        { re: /\b(pets?|dog|cat)\b/i, weight: 0.2, because: 'a pet is part of the household' },
        { re: /\b(mov(?:e|ing)|relocat\w+)\b/i, weight: 0.25, because: 'this reads as a move, not a visit' }
      ],
      forces: [
        'Budget & typical rent',
        'Neighborhoods that fit',
        'Schools & districts',
        'Commute',
        'Climate reality',
        'Cost of living vs. your city',
        'Groceries & amenities',
        'Moving timeline'
      ]
    },
    {
      id: 'relocate-solo',
      label: 'Relocating (solo)',
      base: 0.3,
      signals: [
        { re: /\b(mov(?:e|ing)|relocat\w+|new city|new job|starting a job)\b/i, weight: 0.4, because: 'this reads as a move' },
        { re: /\b(nightlife|walkable|young|vibe|social)\b/i, weight: 0.25, because: 'lifestyle fit is in the words' }
      ],
      forces: [
        'Budget & typical rent',
        'Neighborhoods that fit your vibe',
        'Commute',
        'Cost of living vs. your city',
        'Nightlife & amenities',
        'Moving timeline'
      ]
    },
    {
      id: 'invest',
      label: 'Investing',
      base: 0.15,
      signals: [
        { re: /\b(invest\w*|roi|cap rate|cash ?flow|rental yield|yield|appreciat\w+|portfolio|landlord)\b/i, weight: 0.8, because: 'investment language is explicit' },
        { re: /\b(for sale|buy|purchase|down payment|mortgage)\b/i, weight: 0.3, because: 'this is a purchase, not a lease' }
      ],
      forces: [
        'Rent yield / cap rate',
        'Price & appreciation trend',
        'Property tax & insurance',
        'Vacancy & tenant demand',
        'Short-term-rental rules & regulations',
        'Financing & rates'
      ]
    },
    {
      id: 'short-term',
      label: 'Short-term stay',
      base: 0.1,
      signals: [
        { re: /\b(furnished|short[- ]term|month[- ]to[- ]month|sublet|temporary|few months|\d+ months?)\b/i, weight: 0.6, because: 'a short, furnished stay is implied' }
      ],
      forces: ['Furnished options & monthly rate', 'Best short-stay neighborhoods', 'Lease flexibility', "What's included"]
    },
    {
      id: 'student',
      label: 'Student housing',
      base: 0.1,
      signals: [
        { re: /\b(ut austin|campus|university|college|student|dorm|intern(?:ship)?)\b/i, weight: 0.6, because: 'this is about being near campus' }
      ],
      forces: ['Rent near campus', 'Roommate vs. studio cost', 'Commute to campus', 'Furnished & lease timing']
    }
  ]
};

export const TOPICS: Record<string, TopicSpecialization> = {
  'real-estate': REAL_ESTATE
};

export function hasTopic(scenarioId: string | null | undefined): boolean {
  return Boolean(scenarioId && scenarioId in TOPICS);
}

/** Deepen a general graph with its topic, when one exists; otherwise pass it through. */
export function specialize(general: IntentionGraph, _prompt: string): IntentionGraph {
  const topic = TOPICS[general.scenarioId];
  if (!topic) return general;
  return {
    ...general,
    decision: topic.decision,
    actionLabel: topic.actionLabel,
    directions: topic.directions,
    dampen: topic.dampen ?? [],
    branches: topic.directions.length > 1,
    specialized: true
  };
}
