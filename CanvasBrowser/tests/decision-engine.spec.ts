import { test, expect } from '@playwright/test';
import {
  decisionCacheKey,
  hasDecisionSurface,
  learn,
  memoryDecisionCache,
  memoryLearningStore,
  normalizeDecisionResult,
  normalizeCompare,
  normalizeTriage,
  planDecision
} from '../src/intent-to-world/situation-intelligence/scenarios';

test('compare normalization builds option cards from JSON and marks a best pick', () => {
  const r = normalizeCompare(
    '{"headline":"Go with the M3 Air","options":[{"name":"MacBook Air M3","price":"$1099","rating":4.6,"best":true,"pros":["light","battery"],"cons":["256GB base"]},{"name":"Dell XPS 13","price":"$999","rating":4.2,"pros":["price"],"cons":["fans"]}],"verdict":"Best all-round"}'
  );
  expect(r.options).toHaveLength(2);
  expect(r.options[0].best).toBe(true);
  expect(r.options[0].rating).toBeCloseTo(4.6);
  expect(r.options[0].pros).toContain('light');
  expect(r.headline).toContain('M3');
});

test('triage normalization is safety-first and defaults to emergency on unreadable output', () => {
  const ok = normalizeTriage(
    '{"severity":"emergency","headline":"Call now","actNow":["Sit down"],"emergency":["worsening pain"],"causes":["strain"]}'
  );
  expect(ok.severity).toBe('emergency');
  expect(ok.actNow).toContain('Sit down');
  expect(ok.emergency).toContain('worsening pain');

  const bad = normalizeTriage('sorry, no structured answer here');
  expect(bad.severity).toBe('emergency');
});

/** The two-tier decision engine — pure, no page, no network. */

test('real-estate infers the leading direction and keeps the runner-up one tap away', () => {
  const relo = planDecision('apartments for rent in Austin', 'real-estate')!;
  expect(relo.top.id).toBe('relocate-family');
  expect(relo.alternative!.id).toBe('relocate-solo');

  const invest = planDecision('invest in Austin real estate for cap rate', 'real-estate')!;
  expect(invest.top.id).toBe('invest');

  const family = planDecision('moving to Austin with my family and schools', 'real-estate')!;
  expect(family.top.id).toBe('relocate-family');
  expect(family.top.evidence.length).toBeGreaterThan(0);
});

test('Tier 1 shapes the general graph by resolution mode, and every scenario earns a surface', () => {
  // Triage does not fork; it leads with what to do now and an escalation action.
  const triage = planDecision('chest pain and shortness of breath', 'urgent-symptom-triage')!;
  expect(triage.resolutionMode).toBe('triage');
  expect(triage.branches, 'triage does not fork').toBe(false);
  expect(triage.actionLabel).toBe('Get emergency help');
  expect(triage.top.forces[0]).toContain('Do this now');

  // A purchase forks into competing directions, and "best" reads as comparing.
  const shop = planDecision('best laptop 2024', 'product-research')!;
  expect(shop.branches, 'a purchase forks').toBe(true);
  expect(shop.top.id).toBe('compare');
  expect(shop.alternative).not.toBeNull();

  // Real-estate is deepened by a Tier-2 topic.
  const re = planDecision('apartments for rent in Austin', 'real-estate')!;
  expect(re.specialized, 'real-estate has a topic').toBe(true);
  expect(re.top.id).toBe('relocate-family');

  // Every registry scenario earns a surface; heroes and unknowns do not.
  expect(hasDecisionSurface('real-estate')).toBe(true);
  expect(hasDecisionSurface('product-research')).toBe(true);
  expect(hasDecisionSurface('urgent-symptom-triage')).toBe(true);
  expect(hasDecisionSurface('airport-pickup')).toBe(false);
  expect(hasDecisionSurface('not-a-scenario')).toBe(false);
});

test('the learning overlay hill-climbs the direction the person keeps choosing', () => {
  const store = memoryLearningStore();
  const prompt = 'places in Austin';
  expect(planDecision(prompt, 'real-estate', { adjustments: store.get('real-estate') })!.top.id).toBe(
    'relocate-family'
  );

  learn(store, { scenarioId: 'real-estate', reinforceDirection: 'invest', penalizeDirection: 'relocate-family' }, 1);
  learn(store, { scenarioId: 'real-estate', reinforceDirection: 'invest', penalizeDirection: 'relocate-family' }, 2);

  expect(
    planDecision(prompt, 'real-estate', { adjustments: store.get('real-estate') })!.top.id,
    'the engine climbed toward what this person keeps choosing'
  ).toBe('invest');
});

test('normalization strips links and "go look it up" from an assembled decision', () => {
  const plan = planDecision('apartments for rent in Austin', 'real-estate')!;
  const result = normalizeDecisionResult(
    '{"direction":"Investing","headline":"Buy in East Austin — visit zillow.com for more.","forces":[{"label":"Yield","value":"~6% gross; see https://example.com/x for details"}],"action":"Show listings"}',
    plan
  );
  expect(result.forces).toHaveLength(1);
  expect(result.forces[0].value).toContain('6%');
  expect(result.forces[0].value).not.toContain('http');
  expect(result.headline).not.toContain('zillow.com');
});

test('a decision falls back to a clean statement when the JSON cannot be read', () => {
  const plan = planDecision('apartments for rent in Austin', 'real-estate')!;
  const result = normalizeDecisionResult('Sorry, there is no structured answer here.', plan);
  expect(result.direction).toBe(plan.top.label);
  expect(result.forces).toHaveLength(0);
  expect(result.headline.length).toBeGreaterThan(0);
});

test('normalization survives a model preamble and real newlines inside the JSON', () => {
  const plan = planDecision('apartments for rent in Austin', 'real-estate')!;
  // Exactly the shape the live model returned: prose, then JSON pretty-printed
  // with real newlines inside the string values (invalid JSON until repaired).
  const answer =
    'I am checking current Austin benchmarks.\n' +
    '{"direction":"Relocating with family","headline":"Target a\n3-bedroom in Mueller at\n$2,500-$3,200 monthly.","forces":[{"label":"Budget & typical rent","value":"1BR about\n$1,500; 2BR about\n$2,000.","note":"Excludes\nparking and utilities."}],"action":"Show live listings that match"}';
  const result = normalizeDecisionResult(answer, plan);
  expect(result.headline).toContain('Mueller');
  expect(result.headline).not.toContain('{');
  expect(result.forces).toHaveLength(1);
  expect(result.forces[0].value).toContain('1BR');
  expect(result.forces[0].note).toContain('parking');
});

test('the fallback never surfaces raw JSON when parsing truly fails', () => {
  const plan = planDecision('apartments for rent in Austin', 'real-estate')!;
  // A truncated / unparseable JSON blob must not leak to the headline.
  const answer = '{"direction":"Relocating (solo)","headline":"Start with a 1BR in North Loop.","forces":[{"lab';
  const result = normalizeDecisionResult(answer, plan);
  expect(result.headline).not.toContain('{');
  expect(result.headline).toContain('North Loop');
  expect(result.forces).toHaveLength(0);
});

test('the decision cache returns a stored result for the same question and direction', () => {
  const cache = memoryDecisionCache();
  const key = decisionCacheKey('real-estate', 'relocate-family', 'Apartments for rent in Austin');
  expect(cache.get(key)).toBeNull();
  cache.set(key, { direction: 'Relocating with family', headline: 'stored', forces: [], action: null });
  // The same question, differently spaced, is the same key — so no second model call.
  const again = decisionCacheKey('real-estate', 'relocate-family', '  Apartments   for rent in Austin ');
  expect(cache.get(again)!.headline).toBe('stored');
});
