import { test, expect } from '@playwright/test';
import { situationIntelligence } from '../src/intent-to-world/situation-intelligence';
import {
  SCENARIOS,
  classifyScenario,
  buildScenarioGraph
} from '../src/intent-to-world/situation-intelligence/scenarios';
import { defaultCapabilities } from '../src/intent-to-world/situation-intelligence/contextProviders';
import { DEMO_EXAMPLES } from '../src/ui/demoExamples';

/**
 * The curated scenario registry — triage, product-research, real-estate. Pure
 * unit tests: no page, no network, no clock beyond the one injected.
 */

const ctx = () => ({ nowMs: 1_700_000_000_000, capabilities: defaultCapabilities() });
const discover = (prompt: string) => situationIntelligence.discover(prompt, ctx());

test('the registry is exactly the three curated scenarios, with pure detectors', () => {
  const ids = SCENARIOS.map((s) => s.id).sort();
  expect(ids).toEqual(['product-research', 'real-estate', 'urgent-symptom-triage']);
  for (const scenario of SCENARIOS) {
    const c = scenario.detect('an unrelated sentence about nothing in particular');
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
    expect(scenario.decisionGoal.statement.length).toBeGreaterThan(5);
  }
});

test('representative prompts classify to the expected scenario', () => {
  const cases: Array<[string, string]> = [
    ['chest pain and shortness of breath', 'urgent-symptom-triage'],
    ['best laptop 2024', 'product-research'],
    ['sony vs bose headphones', 'product-research'],
    ['apartments for rent in Austin', 'real-estate'],
    ['houses in Denver', 'real-estate']
  ];
  for (const [prompt, expected] of cases) {
    const match = classifyScenario(prompt, SCENARIOS);
    expect(match, `"${prompt}" should classify`).not.toBeNull();
    expect(match!.scenario.id, `"${prompt}"`).toBe(expected);
  }
});

test('a possible emergency wins every tie', () => {
  expect(classifyScenario('chest pain and shortness of breath', SCENARIOS)!.scenario.id).toBe('urgent-symptom-triage');
  expect(classifyScenario('stroke symptoms right now', SCENARIOS)!.scenario.id).toBe('urgent-symptom-triage');
});

test('discover() routes a recognized scenario to a renderable graph, with identity intact', () => {
  const graph = discover('best laptop 2024');
  expect(graph.kind).toBe('literal');
  expect(graph.scenarioId).toBe('product-research');
  expect(graph.resolutionMode).toBe('transact');
  expect(graph.chosenJob).toBe('answer');
  expect(graph.informationNeeds.some((need) => need.id === 'live-research')).toBe(true);
});

test('a scenario that deserves a world it cannot build says so honestly', () => {
  const spatial = discover('apartments for rent in Austin');
  expect(spatial.scenarioId).toBe('real-estate');
  expect(spatial.constraints.some((c) => c.id === 'deserved-world'), 'names the place world it deserves').toBe(true);

  // A literal-deserving scenario adds no such constraint.
  const literal = discover('best laptop 2024');
  expect(literal.constraints.some((c) => c.id === 'deserved-world')).toBe(false);
});

test('scenario questions run through the same economics, with declared levers', () => {
  const ambiguous = discover('houses in Denver');
  expect(ambiguous.scenarioId).toBe('real-estate');
  expect(ambiguous.questionPlan.selected.map((q) => q.id)).toEqual(['buy-or-rent']);
  expect(ambiguous.questionPlan.selected[0].movesLevers).toEqual(['outcome-template']);
  // A stated intent asks nothing.
  expect(discover('houses for sale in Denver').questionPlan.selected).toHaveLength(0);
});

test('the two hero detectors are never shadowed by the registry', () => {
  const arrival = discover('EVA AIR TPE to SEA landed tonight?');
  expect(arrival.kind).toBe('travel-arrival');
  expect(arrival.scenarioId).toBe('airport-pickup');

  const briefing = discover('What local news and market moves matter to me this morning?');
  expect(briefing.kind).toBe('living-news');

  const ambiguousNews = discover('Did the Fed change rates in the news today?');
  expect(ambiguousNews.kind).toBe('literal');
  expect(ambiguousNews.scenarioId).toBeUndefined();
  expect(ambiguousNews.readings.news).not.toBeNull();
});

test('a prompt with no recognized scenario still falls through to the bare literal answer', () => {
  const graph = discover('ruminate on the nature of Tuesdays');
  expect(graph.kind).toBe('literal');
  expect(graph.scenarioId).toBeUndefined();
});

test('buildScenarioGraph is deterministic for the same prompt and scenario', () => {
  const scenario = SCENARIOS.find((s) => s.id === 'product-research')!;
  const a = buildScenarioGraph('best laptop 2024', scenario, ctx());
  const b = buildScenarioGraph('best laptop 2024', scenario, ctx());
  expect(a.scenarioId).toBe('product-research');
  expect({ ...a, id: '' }).toEqual({ ...b, id: '' });
});

test('the demo launcher has exactly one example per scenario, each classifying back to it', () => {
  const ids = SCENARIOS.map((s) => s.id);
  const covered = new Set(DEMO_EXAMPLES.map((e) => e.scenarioId));
  for (const id of ids) expect(covered.has(id), `missing a demo example for "${id}"`).toBe(true);
  expect(DEMO_EXAMPLES.length, 'one per scenario, no extras').toBe(ids.length);
  for (const example of DEMO_EXAMPLES) {
    const match = classifyScenario(example.prompt, SCENARIOS);
    expect(match?.scenario.id, `"${example.prompt}" should classify to ${example.scenarioId}`).toBe(example.scenarioId);
  }
});
