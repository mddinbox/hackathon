/**
 * Demo-quality example prompts — one per recognized scenario.
 *
 * These power the header picker and the dev-panel launcher. Each prompt is
 * chosen to classify unambiguously to its scenario, so a demo can fire any of
 * the curated experiences and watch the engine open the right world.
 */
export interface DemoExample {
  scenarioId: string;
  label: string;
  prompt: string;
  group: string;
}

export const DEMO_EXAMPLES: readonly DemoExample[] = [
  {
    scenarioId: 'urgent-symptom-triage',
    label: 'Urgent triage (safety)',
    prompt: 'Chest pain and shortness of breath',
    group: 'Triage'
  },
  { scenarioId: 'product-research', label: 'Product research', prompt: 'Best laptop 2024', group: 'Compare' },
  { scenarioId: 'real-estate', label: 'Real estate', prompt: 'Apartments for rent in Austin', group: 'Place' }
];

/**
 * The two hero worlds. They are not registry scenarios, so they live apart from
 * DEMO_EXAMPLES (which the registry tests assert is exactly the scenario set),
 * but the header picker offers them alongside the registry scenarios.
 */
export const HERO_EXAMPLES: readonly DemoExample[] = [
  { scenarioId: 'airport-pickup', label: 'Airport pickup', prompt: 'EVA AIR TPE to SEA landed tonight?', group: 'Worlds' },
  {
    scenarioId: 'local-news-briefing',
    label: 'Local briefing',
    prompt: 'What local news and market moves matter to me this morning?',
    group: 'Worlds'
  }
];

/** Everything the header scenario picker offers: the two heroes, then the scenarios. */
export const MENU_EXAMPLES: readonly DemoExample[] = [...HERO_EXAMPLES, ...DEMO_EXAMPLES];

