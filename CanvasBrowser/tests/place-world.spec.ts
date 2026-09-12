import { test, expect } from '@playwright/test';
import {
  buildPlaceWorld,
  cityById,
  estimateDriveMinutes,
  resolveAnchor,
  resolveCity
} from '../src/intent-to-world/situation-intelligence/scenarios/places/cities';

/** The place model — real geography, computed travel time, multi-city, pure. */

const austin = cityById('austin');
const seattle = cityById('seattle');

test('the place world times every neighborhood from the anchor and recommends by direction', () => {
  const family = buildPlaceWorld(austin, 'downtown', 'relocate-family');
  expect(family.neighborhoods.length).toBeGreaterThan(4);
  for (const n of family.neighborhoods) {
    expect(n.commuteMin, `${n.name} has a drive time`).toBeGreaterThan(0);
    expect(n.distanceMiles).toBeGreaterThanOrEqual(0);
  }
  // Family weighting favors strong schools: Circle C (schools 5) ranks high.
  expect(family.neighborhoods.slice(0, 3).map((n) => n.id)).toContain('circlec');

  // Investor weighting favors low rent: the pick is a value area.
  const invest = buildPlaceWorld(austin, 'downtown', 'invest');
  expect(['pflugerville', 'roundrock']).toContain(invest.recommendedId);
});

test('re-anchoring the office changes the drive times (space → time)', () => {
  const fromDowntown = buildPlaceWorld(austin, 'downtown', 'relocate-family');
  const fromAirport = buildPlaceWorld(austin, 'airport', 'relocate-family');
  const a = fromDowntown.neighborhoods.find((n) => n.id === 'mueller')!;
  const b = fromAirport.neighborhoods.find((n) => n.id === 'mueller')!;
  expect(b.commuteMin).not.toBe(a.commuteMin);
});

test('the same machinery works for a second city, chosen from the prompt', () => {
  expect(resolveCity('apartments for rent in Seattle').id).toBe('seattle');
  expect(resolveCity('houses in Bellevue').id).toBe('seattle');
  expect(resolveCity('apartments for rent in Austin').id).toBe('austin');
  expect(resolveCity('apartments for rent somewhere').id).toBe('austin'); // default

  const family = buildPlaceWorld(seattle, 'redmond', 'relocate-family');
  expect(family.cityLabel).toBe('Seattle');
  expect(family.neighborhoods.length).toBeGreaterThan(4);
  // Eastside (Bellevue/Redmond/Kirkland, schools 5) leads for a family near Redmond.
  expect(['bellevueN', 'redmondN', 'kirkland']).toContain(family.recommendedId);
});

test('a refine phrase resolves the office anchor per city, and vague text does not', () => {
  expect(resolveAnchor(austin, 'my office is near the domain')!.id).toBe('domain');
  expect(resolveAnchor(austin, 'I work at UT campus')!.id).toBe('ut');
  expect(resolveAnchor(seattle, 'my office is at Microsoft')!.id).toBe('redmond');
  expect(resolveAnchor(seattle, 'near amazon')!.id).toBe('slu');
  expect(resolveAnchor(austin, 'let me talk about it')).toBeNull();
  expect(estimateDriveMinutes(0)).toBeGreaterThanOrEqual(3);
});
