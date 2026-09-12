/**
 * The scenario registry — a small, curated set of recognized browser jobs.
 *
 * Deliberately narrow and high-quality. Alongside the two hero worlds (airport
 * arrival → Journey World, living news → Signal Field), the engine recognizes
 * exactly three registry scenarios, each with a purpose-built *visual*
 * experience rather than a wall of text:
 *   - urgent-symptom triage  → the Triage surface (safety-first),
 *   - product research        → the Compare surface (option cards),
 *   - real-estate             → the Place world (aerial map + drive times).
 *
 * Classification only runs when both hero detectors return null.
 */
import type { ScenarioDefinition } from './types';

const test = (prompt: string, re: RegExp): boolean => re.test(prompt);

/** Emergency-ish health language, checked first so triage outranks a lookup. */
const URGENT_RE =
  /\b(chest pain|can'?t breathe|cannot breathe|difficulty breathing|heart attack|stroke|overdose|suicidal|suicide|self[- ]harm|severe bleeding|anaphyla|unconscious|seizure)\b/i;

export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: 'urgent-symptom-triage',
    label: 'Urgent symptom triage',
    intent: 'informational',
    resolutionMode: 'triage',
    deservedFamily: 'literal',
    supportedToday: 'literal',
    demandTier: 'B',
    deservedWorld: 'A triage answer that routes a possible emergency to real help first.',
    // Highest confidence in the set: a possible emergency must win every tie.
    detect: (p) => (URGENT_RE.test(p) ? 0.99 : 0),
    handoffs: () => [
      {
        id: 'emergency',
        label: 'Get emergency help',
        action: 'If this may be an emergency, contact your local emergency number now.',
        url: null,
        materialEffect: 'Routes a possible emergency to real help instead of a web answer.'
      }
    ],
    decisionGoal: {
      statement: 'Decide whether this needs urgent care, safely.',
      successCriterion: 'A clear escalate-now message plus cited, authoritative guidance.'
    }
  },
  {
    id: 'product-research',
    label: 'Product research / comparison',
    intent: 'commercial',
    resolutionMode: 'transact',
    deservedFamily: 'literal',
    supportedToday: 'literal',
    demandTier: 'A',
    deservedWorld: 'A comparison world with specs, prices and reviews.',
    detect: (p) =>
      test(p, /\bbest\b.+\b(20\d\d|laptop|phone|headphones?|tv|camera|car|vacuum|mattress|for)\b/i) ||
      test(p, /\b(vs|versus)\b/i) ||
      test(p, /\b(compare|which .+ should i buy|reviews? (?:of|for))\b/i)
        ? 0.75
        : 0,
    decisionGoal: {
      statement: 'Choose which product to buy.',
      successCriterion: 'A comparison of the real options, each traceable to a source.'
    }
  },
  {
    id: 'real-estate',
    label: 'Real estate search',
    intent: 'commercial',
    resolutionMode: 'transact',
    deservedFamily: 'place-field',
    supportedToday: 'literal',
    demandTier: 'B',
    deservedWorld: 'A map of homes by price and commute.',
    detect: (p) =>
      test(p, /\b(homes?|houses?|apartments?|condos?) for (?:sale|rent)\b/i) ||
      test(p, /\b(zillow|redfin|realtor)\b/i) ||
      test(p, /\b(apartments?|houses?) (?:in|near)\b/i)
        ? 0.8
        : 0,
    questions: (prompt) => {
      if (/\b(for sale|to buy|buying|for rent|renting|to rent)\b/i.test(prompt)) return [];
      return [
        {
          id: 'buy-or-rent',
          prompt: 'Are you looking to buy or to rent?',
          whyNeeded: 'Buying and renting are different searches with different sources.',
          materialEffect: 'Chooses which world of listings is assembled.',
          expectedInformationGain: 0.82,
          userCost: 0.15,
          choices: [
            { id: 'buy', label: 'Buy' },
            { id: 'rent', label: 'Rent' }
          ],
          movesLevers: ['outcome-template']
        }
      ];
    },
    decisionGoal: {
      statement: 'Find a place that fits price and location.',
      successCriterion: 'Listings with price, size and location, from a real source.'
    }
  }
];

/** The scenario for an id, or null (heroes and bare literals are not in the registry). */
export function scenarioById(id: string | null | undefined): ScenarioDefinition | null {
  if (!id) return null;
  return SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}
