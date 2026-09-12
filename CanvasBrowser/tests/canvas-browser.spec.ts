import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';

import { checkLoopbackRequest, documentHeaders, securityHeaders } from '../serverSecurity.mjs';
import {
  extractBlueprintJson as wireExtract,
  normalizeBlueprint as wireNormalize
} from '../blueprintSchema.mjs';
import {
  bingBase,
  bingFieldBase,
  embedUrlForBox,
  globalPixel,
  isAllowedBingEmbed,
  mapSize,
  projectToEmbed,
  viewportFor,
  BING_TRAFFIC_PARAM,
  MERCATOR_LAT_LIMIT
} from '../src/bingMap';
import { refreshIsDue } from '../src/motion';
import { computeRefreshPolicy, describeCadence } from '../src/refreshPolicy';
import {
  FX_STATIC_COORDINATE_FUNCTIONS,
  fxFunctionSource,
  fxShaderSource,
  type FxMode
} from '../src/visualEngine';
import {
  extractBlueprintJson as clientExtract,
  newsBlueprint,
  normalizeBlueprint as clientNormalize,
  pickupBlueprint,
  type BlueprintQuestion
} from '../src/intent-to-world/experience-synthesis/templateBlueprint';
import { selectQuestions } from '../src/intent-to-world/situation-intelligence/questionEconomics';
import {
  compileTemplate,
  describeTemplate
} from '../src/intent-to-world/experience-synthesis/templateCompiler';
import { defaultCapabilities } from '../src/intent-to-world/situation-intelligence/contextProviders';
import {
  situationIntelligence,
  type DiscoveryContext
} from '../src/intent-to-world/situation-intelligence';
import {
  blueprintCompatibility,
  expectedFamily,
  experienceSynthesis
} from '../src/intent-to-world/experience-synthesis';
import { findNeed, type SituationGraph } from '../src/intent-to-world/situation-graph';
import { parseFlightAnswer } from '../src/pickupIntent';
import { liveSignalsFromContext } from '../src/liveNewsContext';
import type { LiveLocalContext } from '../src/localContextGateway';
import { findNewsPlace } from '../src/newsSession';
import { planSignalField } from '../src/newsPlanner';
import { nearestOrigin } from '../src/geolocation';

/**
 * CanvasBrowser — product acceptance tests.
 *
 * The product is world-first: a recognised situation opens its own
 * world-shaped surface immediately and asks the one thing it cannot infer,
 * while research runs in parallel. Nothing here touches a live model; the Demo
 * gateway is always mocked at the network boundary.
 */

/**
 * The mocked answer states a landing a few minutes ago, so the suite behaves
 * identically no matter what time of day it runs.
 */
function clockLabel(offsetMinutes: number): string {
  const when = new Date(Date.now() + offsetMinutes * 60_000);
  return when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\u202f/g, ' ');
}

function landedAnswer(): string {
  return (
    `EVA Air BR26 (TPE → SEA) landed at ${clockLabel(-6)} at Seattle-Tacoma International Airport. ` +
    'Source: https://www.flightaware.com/live/flight/EVA26'
  );
}

const ENROUTE_ANSWER =
  'EVA Air BR26 was still en route at 6:04 PM PDT; an actual arrival time is not yet available. ' +
  'https://www.flightaware.com/live/flight/EVA26';

const EVA_PROMPT = 'EVA AIR TPE to SEA landed tonight?';

/** Strong enough to infer both scope and horizon — zero questions. */
const NEWS_STRONG_PROMPT = 'What local news and market moves matter to me this morning?';
/** Neither scope nor horizon is inferable — exactly two questions. */
const NEWS_OPEN_PROMPT = 'What is happening around me that could change my day?';
/** A news-shaped question that deserves the literal answer first. */
const NEWS_LITERAL_PROMPT = 'Did the Fed change rates in the news today?';
/** The same shape, with a temporal word that must not imply a briefing. */
const NEWS_MORNING_PROMPT = 'Did the Fed change rates in the news this morning?';

const consoleErrors: string[] = [];

/**
 * The Journey World frames a real Bing Maps base. The suite must never depend
 * on that request succeeding — or on it happening at all — so every test aborts
 * anything leaving for bing.com and asserts the *attributes* of the frame
 * instead. What the product must get right is which URL it builds, how it is
 * sandboxed, and that the world still reads when the base cannot load.
 */
async function blockExternal(page: Page): Promise<void> {
  await page.route('https://*.bing.com/**', (route) => route.abort());
}

test.beforeEach(async ({ page }) => {
  consoleErrors.length = 0;
  await blockExternal(page);
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
});

test.afterEach(() => {
  expect(consoleErrors, `no console errors, saw: ${consoleErrors.join(' | ')}`).toEqual([]);
});

interface AgentCounter {
  get(): number;
}

/** `delayMs` proves what is on screen *before* research answers. */
async function mockAgent(page: Page, answer: string, delayMs = 0): Promise<AgentCounter> {
  let calls = 0;
  await page.route('**/api/agent', async (route) => {
    calls += 1;
    expect(route.request().headers()['x-canvas-browser-demo']).toBe('1');
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answer,
        model: 'gpt-5.6-sol',
        contextTier: 'long_context',
        reasoningEffort: 'medium',
        normalization: 'Query normalization candidate: TPE→SEA may be BR26/EVA26; verify against live sources.',
        retrievedAt: new Date().toISOString()
      })
    });
  });
  return { get: () => calls };
}

async function mockLocalContext(page: Page): Promise<AgentCounter> {
  let calls = 0;
  await page.route('**/api/local-context', async (route) => {
    calls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        place: { id: 'seattle', label: 'Seattle', lat: 47.6062, lon: -122.3321 },
        retrievedAt: '2026-08-17T22:00:00.000Z',
        weather: {
          temperatureF: 75,
          weatherCode: 2,
          condition: 'Cloudy',
          windMph: 8,
          windDegrees: 240,
          sourceUrl: 'https://open-meteo.com/en/docs'
        },
        air: {
          usAqi: 42,
          pm25: 7.1,
          sourceUrl: 'https://open-meteo.com/en/docs/air-quality-api'
        },
        news: Array.from({ length: 4 }, (_, index) => ({
          id: `news-${index + 1}`,
          title: `Seattle live headline ${index + 1}`,
          source: `Publisher ${index + 1}`,
          url: `https://example.com/news-${index + 1}`,
          publishedAt: `2026-08-17T2${1 - Math.min(index, 1)}:30:00.000Z`,
          feed: 'Seattle local RSS'
        })),
        markets: [
          {
            id: 'sp500',
            label: 'S&P 500',
            price: 6500,
            changePercent: 0.62,
            asOf: '2026-08-17T21:55:00.000Z',
            url: 'https://finance.yahoo.com/quote/%5EGSPC'
          },
          {
            id: 'nasdaq',
            label: 'Nasdaq Composite',
            price: 24000,
            changePercent: -0.31,
            asOf: '2026-08-17T21:55:00.000Z',
            url: 'https://finance.yahoo.com/quote/%5EIXIC'
          }
        ],
        errors: []
      })
    });
  });
  return { get: () => calls };
}

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('body[data-canvas-browser-ready="true"]');
}

/** Types a prompt without waiting for any particular surface. */
async function askRaw(page: Page, prompt: string): Promise<void> {
  await page.locator('[data-node="home-prompt"]').fill(prompt);
  await page.locator('[data-node="home-prompt-ask"]').click();
}

/** Travel: the job question appears immediately, inside a forming terrain. */
async function askTravel(page: Page, prompt = EVA_PROMPT): Promise<void> {
  await askRaw(page, prompt);
  await expect(page.locator('[data-node="clarify-question"]')).toBeVisible();
}

async function waitForResearch(page: Page): Promise<void> {
  await expect
    .poll(async () => page.evaluate(() => window.__canvasBrowser.state().researchPending))
    .toBe(false);
}

async function askTravelResolved(page: Page, prompt = EVA_PROMPT): Promise<void> {
  await askTravel(page, prompt);
  await waitForResearch(page);
}

async function openPickup(page: Page): Promise<void> {
  await page.locator('[data-node="hypothesis-pickup"]').click();
  await expect(page.locator('[data-node="time-terrain"]')).toBeVisible();
}

async function openSignalField(page: Page): Promise<void> {
  await askRaw(page, NEWS_STRONG_PROMPT);
  await expect(page.locator('[data-node="signal-field"]')).toBeVisible();
}

interface Box {
  x: number;
  y: number;
}

async function signalBoxes(page: Page): Promise<Record<string, Box>> {
  return page.evaluate(() => {
    const boxes: Record<string, { x: number; y: number }> = {};
    for (const node of document.querySelectorAll<HTMLElement>('button.signal[data-node^="signal-"]')) {
      const rect = node.getBoundingClientRect();
      boxes[node.dataset.node!] = { x: Math.round(rect.x), y: Math.round(rect.y) };
    }

    return boxes;
  });
}

/* ------------------------------------------------------------------------ */
/* Home                                                                      */
/* ------------------------------------------------------------------------ */

test('home is one question and one prompt — no tabs, slots, rails, or panels', async ({ page }) => {
  await open(page);

  await expect(page.locator('[data-node="display-question"]')).toHaveText('What are you actually trying to do?');
  await expect(page.locator('input')).toHaveCount(1);
  await expect(page.getByRole('textbox')).toHaveCount(1);

  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.locator('[data-node^="panel-"]')).toHaveCount(0);
  await expect(page.locator('[data-node^="slot-"]')).toHaveCount(0);
  await expect(page.locator('[data-node="first-run-overlay"]')).toHaveCount(0);
  await expect(page.locator('[data-node="dev-panel"]')).toHaveCount(0);

  // No rejected surfaces anywhere in the default experience.
  const body = (await page.locator('body').innerText()).toLowerCase();
  for (const rejected of ['bill pay', 'compare', 'catalog', 'inspector', 'trust lab', 'diagnostics', 'density']) {
    expect(body, `home must not mention "${rejected}"`).not.toContain(rejected);
  }

  // Exactly one secondary control next to the brand.
  await expect(page.locator('[data-node="more-button"]')).toHaveCount(1);
  await expect(page.locator('[data-node="brand"]')).toHaveCount(1);
});

test('home is an authored composition: two ambient world seeds, the local moment, no cards', async ({ page }) => {
  await open(page);

  // Both worlds are promised visually, on opposite sides of the prompt.
  const ambient = page.locator('[data-node="home-ambient"]');
  await expect(ambient).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('[data-node="home-seed-terrain"]')).toBeVisible();
  await expect(page.locator('[data-node="home-seed-field"]')).toBeVisible();
  await expect(page.locator('[data-node="home-seed-terrain"] .seed-band')).not.toHaveCount(0);
  await expect(page.locator('[data-node="home-seed-field"] .seed-grid-line')).toHaveCount(9);
  await expect(page.locator('[data-node="home-seed-field"] .seed-ring')).toHaveCount(0);
  const homeShader = fxShaderSource('home');
  expect(homeShader).not.toContain('Standing rings');
  expect(homeShader).not.toContain('for (int i = 0; i < PARTICLES; i++)');

  // Scenery, never a gallery: nothing in it can be clicked or focused.
  await expect(ambient.locator('button, a, input')).toHaveCount(0);
  expect(await ambient.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');

  // Time is stated; place is requested honestly rather than guessed from timezone.
  await expect(page.locator('[data-node="home-clock"]')).toHaveText(/\d{1,2}:\d{2}/);
  await expect(page.locator('[data-node="home-use-location"]')).toHaveText('Use current location');
  await expect(page.locator('[data-node="home-place"]')).toHaveCount(0);

  // Still not a dashboard.
  await expect(page.locator('[data-node^="template-card"]')).toHaveCount(0);
  await expect(page.locator('[data-node="dashboard"]')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.locator('[data-node^="panel-"]')).toHaveCount(0);

  // The seeds sit behind the prompt, not in front of it.
  const zIndex = await page.evaluate(() => ({
    ambient: getComputedStyle(document.querySelector('[data-node="home-ambient"]')!).zIndex,
    focus: getComputedStyle(document.querySelector('.home-focus')!).zIndex
  }));
  expect(Number(zIndex.focus)).toBeGreaterThan(Number(zIndex.ambient));
});

test('home shows no inline example hints — the header picker covers every wired experience', async ({
  page
}) => {
  await open(page);

  await expect(page.locator('[data-node^="home-hint"]')).toHaveCount(0);
  await expect(page.locator('.hint')).toHaveCount(0);

  // The picker covers the two hero worlds and the registry scenarios.
  await page.locator('[data-node="scenario-menu"]').click();
  await expect(page.locator('[data-node="scenario-menu-item-airport-pickup"]')).toBeVisible();
  await expect(page.locator('[data-node="scenario-menu-item-local-news-briefing"]')).toBeVisible();
  await expect(page.locator('[data-node="scenario-menu-item-product-research"]')).toBeVisible();

  // It is a picker, not a set of template cards on the page.
  await expect(page.locator('[data-node^="template-card"]')).toHaveCount(0);
});

/* ------------------------------------------------------------------------ */
/* Travel — world-first                                                      */
/* ------------------------------------------------------------------------ */

test('an arrival question opens a forming Travel world and asks the job question immediately', async ({ page }) => {
  const agent = await mockAgent(page, landedAnswer(), 2500);
  await open(page);
  await askRaw(page, EVA_PROMPT);

  // The one question is on screen inside a Travel-shaped world…
  await expect(page.locator('[data-node="clarify-question"]')).toContainText(
    'Are you tracking the arrival, making a connection, or picking someone up?'
  );
  await expect(page.locator('[data-node="forming-world"]')).toBeVisible();
  await expect(page.locator('[data-node="clarify-read"]')).toContainText('EVA Air');

  // …while the answer is still in flight. No page of prose, ever.
  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.view).toBe('clarify');
  expect(state.researchPending).toBe(true);
  expect(state.hasLiteral).toBe(false);
  expect(state.questionsAsked).toBe(1);
  await expect(page.locator('[data-node="literal-answer"]')).toHaveCount(0);
  await expect(page.locator('[data-node="time-terrain"]')).toHaveCount(0);
  await expect(page.locator('[data-node="travel-research-status"]')).toContainText('running beside this question');

  // Research is genuinely running in parallel, not started by the choice.
  expect(agent.get()).toBe(1);
});

test('choosing Pickup before research lands opens the world with honest unknowns, then updates in place', async ({
  page
}) => {
  await mockAgent(page, landedAnswer(), 1800);
  await open(page);
  await askTravel(page);

  await page.locator('[data-node="hypothesis-pickup"]').click();

  // The world exists immediately, and it says what it does not know.
  await expect(page.locator('[data-node="time-terrain"]')).toBeVisible();
  const unknown = page.locator('[data-node="unknown-envelope"]');
  await expect(unknown).toContainText('Not enough to commit yet');
  await expect(unknown).toContainText('Live research is still running');
  await expect(page.locator('[data-node="segment-cbp"]')).toHaveAttribute('data-hatch', 'true');
  expect(await page.evaluate(() => window.__canvasBrowser.state().view)).toBe('terrain');

  // When the facts arrive the same world resolves — no trip back to prose.
  await expect(page.locator('[data-node="decision-envelope"]')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('[data-node="envelope-primary"]')).toContainText('Be in the SEA Cell Phone Lot between');
  await expect(page.locator('[data-node="unknown-envelope"]')).toHaveCount(0);
  await expect(page.locator('[data-node="literal-answer"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__canvasBrowser.state().view)).toBe('terrain');
});

test('choosing Track waits inside the world, then shows the literal answer when it is ready', async ({ page }) => {
  await mockAgent(page, landedAnswer(), 1200);
  await open(page);
  await askTravel(page);

  await page.locator('[data-node="hypothesis-track"]').click();
  await expect(page.locator('[data-node="tracking-wait"]')).toContainText('Tracking the arrival');
  await expect(page.locator('[data-node="literal-answer"]')).toHaveCount(0);

  await expect(page.locator('[data-node="literal-answer"]')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('[data-node="literal-answer"]')).toContainText('landed at');
  await expect(page.locator('[data-node="literal-freshness"]')).toContainText(
    'gpt-5.6-sol · long_context · medium reasoning'
  );
  await expect(page.locator('[data-node="track-arrival"]')).toBeVisible();
  await expect(page.locator('[data-node="time-terrain"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__canvasBrowser.state().view)).toBe('literal');
});

test('Track after the answer already landed goes straight to the literal reading', async ({ page }) => {
  await mockAgent(page, ENROUTE_ANSWER);
  await open(page);
  await askTravelResolved(page);

  await expect(page.locator('[data-node="travel-research-status"]')).toContainText('without an actual arrival time');
  await page.locator('[data-node="hypothesis-track"]').click();

  await expect(page.locator('[data-node="literal-answer"]')).toContainText('still en route');
  await expect(page.locator('[data-node="track-arrival"]')).toBeVisible();
});

test('"making a connection" is an immersive, honest future-template world — not a prose apology', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page);

  await page.locator('[data-node="hypothesis-connect"]').click();

  const notice = page.locator('[data-node="connection-notice"]');
  await expect(notice).toContainText('Coordination Constellation');
  await expect(notice).toContainText('not in this P0');
  await expect(page.locator('.constellation')).toBeVisible();
  await expect(page.locator('[data-node="literal-answer"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__canvasBrowser.state().view)).toBe('connection');

  // It is a fork in a world, not a dead end.
  await page.locator('[data-node="connection-open-pickup"]').click();
  await expect(page.locator('[data-node="time-terrain"]')).toBeVisible();
});

test('choosing "picking someone up" opens the Time Terrain world', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);

  await expect(page.locator('[data-node="pipeline"]')).toBeVisible();
  await expect(page.locator('[data-node="now-rule"]')).toBeVisible();
  await expect(page.locator('[data-node="segment-cbp"]')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Decision envelope' })).toBeVisible();
});

test('an unresolved landing withholds the commit window and offers an unblocker', async ({ page }) => {
  await mockAgent(page, ENROUTE_ANSWER);
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);

  const unknown = page.locator('[data-node="unknown-envelope"]');
  await expect(unknown).toContainText('Not enough to commit yet');
  await expect(unknown).toContainText('still en route');

  // No fabricated, time-shaped leave window anywhere in the envelope.
  await expect(page.locator('[data-node="decision-envelope"]')).toHaveCount(0);
  expect(await unknown.innerText()).not.toMatch(/\d{1,2}:\d{2}/);

  await expect(page.locator('[data-node="recheck"]')).toBeVisible();
  await expect(page.locator('[data-node="preview-sample"]')).toContainText('SAMPLE DATA');
  await expect(page.locator('[data-node="segment-cbp"]')).toHaveAttribute('data-hatch', 'true');
});

test('a resolved landing produces a cell-lot envelope, a curb range, truth labels, and click-only links', async ({
  page
}) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);

  const envelope = page.getByRole('region', { name: 'Decision envelope' });
  await expect(page.locator('[data-node="envelope-primary"]')).toContainText(/Be in the SEA Cell Phone Lot between \d{1,2}:\d{2}/);
  await expect(page.locator('[data-node="envelope-secondary"]')).toContainText(
    /Expect their curb-ready text \d{1,2}:\d{2}.*\d{1,2}:\d{2}/
  );
  await expect(page.locator('[data-node="curb-rule"]')).toContainText('active-load only');
  await expect(envelope.locator('[data-node="envelope-method"]')).toContainText('Modeled');

  await expect(page.locator('[data-node="landing-marker"]')).toHaveAttribute('data-truth', 'observed');
  await expect(page.locator('[data-node="segment-bags"]')).toHaveAttribute('data-truth', 'inferred');
  await expect(page.locator('[data-node="truth-legend"]')).toContainText('Observed');
  await expect(page.locator('[data-node="lot-marker"]')).toContainText('SEA Cell Phone Lot');

  const links = page.locator('[data-node="pickup-links"] a');
  await expect(links).toHaveCount(4);
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  const hrefs = await links.evaluateAll((nodes) => nodes.map((node) => (node as HTMLAnchorElement).href));
  expect(hrefs.filter((href) => href.includes('portseattle.org'))).toHaveLength(2);
  expect(hrefs.some((href) => href.includes('google.com/maps'))).toBe(true);
  expect(hrefs.some((href) => href.includes('bing.com/maps'))).toBe(true);

  // Sources are one control away, never chrome in the world.
  await page.locator('[data-node="sources-button"]').click();
  await expect(page.getByRole('dialog', { name: 'Sources' })).toBeVisible();
  await expect(page.locator('[data-node="sources-sheet"]')).toContainText('no live traffic source');
  await expect(page.locator('[data-node="sources-sheet"]')).toContainText('flightaware.com');
  await page.locator('[data-node="sources-close"]').click();
  await expect(page.locator('[data-node="sources-sheet"]')).toHaveCount(0);
});

test('Time Terrain is terrain, not a project plan: no outer frame, no repeated truth chips', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);

  // One legend carries truth; the bars carry it in their material.
  await expect(page.locator('.segment-chip')).toHaveCount(0);
  await expect(page.locator('[data-node="pipeline"] .truth-chip')).toHaveCount(0);
  await expect(page.locator('[data-node="truth-legend"]')).toHaveCount(1);

  const frame = await page.locator('[data-node="world"]').evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      top: style.borderTopWidth,
      right: style.borderRightWidth,
      bottom: style.borderBottomWidth,
      left: style.borderLeftWidth
    };
  });
  expect(frame).toEqual({ top: '0px', right: '0px', bottom: '0px', left: '0px' });

  // Range text is above its band, so a narrow bar cannot swallow its numbers.
  const geometry = await page.locator('[data-node="segment-taxi"]').evaluate((el) => {
    const range = el.querySelector('.segment-range')!.getBoundingClientRect();
    const band = el.querySelector('.segment-band')!.getBoundingClientRect();
    return { rangeBottom: range.bottom, bandTop: band.top, rangeWidth: range.width };
  });
  expect(geometry.rangeBottom).toBeLessThanOrEqual(geometry.bandTop + 1);
  expect(geometry.rangeWidth).toBeGreaterThan(40);
});

test('the Travel handoff reads on warm paper while the terrain stays a dark world', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);

  await expect(page.locator('[data-node="world"]')).toHaveAttribute('data-surface', 'dark');
  await expect(page.locator('[data-node="decision-envelope"]')).toHaveAttribute('data-surface', 'light');

  const luminance = await page.evaluate(() => {
    const read = (selector: string, prop: 'backgroundColor' | 'color') => {
      const style = getComputedStyle(document.querySelector(selector)!);
      const match = style[prop].match(/\d+(\.\d+)?/g) ?? ['0', '0', '0'];
      const [r, g, b] = match.map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    return {
      envelope: read('[data-node="decision-envelope"]', 'backgroundColor'),
      envelopeInk: read('[data-node="envelope-primary"]', 'color'),
      world: read('[data-node="world"]', 'backgroundColor')
    };
  });
  expect(luminance.envelope).toBeGreaterThan(200);
  expect(luminance.envelopeInk).toBeLessThan(70);
  expect(luminance.world).toBeLessThan(60);

  // The links and the method line live on the paper too, and stay readable.
  const linkColour = await page
    .locator('[data-node="pickup-links"] a')
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  expect(linkColour).not.toBe('rgb(255, 255, 255)');

  // Functional, not a theme: More still offers no light/dark switch.
  await page.locator('[data-node="more-button"]').click();
  await expect(page.locator('[data-node^="appearance-theme"]')).toHaveCount(0);
});

test('the sample preview is available from the unknown world and is tagged SAMPLE DATA', async ({ page }) => {
  await mockAgent(page, ENROUTE_ANSWER);
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);

  await page.locator('[data-node="preview-sample"]').click();

  await expect(page.locator('[data-node="sample-badge"]')).toContainText('SAMPLE DATA');
  await expect(page.locator('[data-node="envelope-primary"]')).toContainText('Be in the SEA Cell Phone Lot between');
  expect(await page.evaluate(() => window.__canvasBrowser.state().provenance)).toBe('sample');
});

/* ------------------------------------------------------------------------ */
/* Location: gesture-gated, coarse, and never stale                          */
/* ------------------------------------------------------------------------ */

test('geolocation is never requested before an explicit click, and is coarse when it is', async ({ page, context }) => {
  await mockAgent(page, landedAnswer());
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 47.61, longitude: -122.2 });
  await page.addInitScript(() => {
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    (window as unknown as { __geo: unknown[] }).__geo = [];
    navigator.geolocation.getCurrentPosition = (success, error, options) => {
      (window as unknown as { __geo: unknown[] }).__geo.push(options);
      return original(success, error, options);
    };
  });

  await open(page);
  await askTravelResolved(page);
  await openPickup(page);

  expect(await page.evaluate(() => (window as unknown as { __geo: unknown[] }).__geo.length)).toBe(0);

  await page.locator('[data-node="use-my-location"]').click();
  await expect(page.locator('[data-node="travel-block"]')).toBeVisible();

  const options = await page.evaluate(() => (window as unknown as { __geo: PositionOptions[] }).__geo);
  expect(options).toHaveLength(1);
  expect(options[0]).toEqual({ enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });

  // Coarse category only — the nearest fixture origin, never raw coordinates.
  expect(await page.evaluate(() => window.__canvasBrowser.state().originId)).toBe('bellevue');
});

test('denied location falls back to places, and Bellevue yields an estimated drive and decision', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_success, error) => {
      error?.({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: 'denied' });
    };
  });

  await open(page);
  await askTravelResolved(page);
  await openPickup(page);
  await page.locator('[data-node="use-my-location"]').click();

  await expect(page.locator('[data-node="location-fallback"]')).toContainText('pick a starting point');
  for (const place of ['Downtown Seattle', 'Bellevue', 'Tacoma', 'Everett']) {
    await expect(page.locator('[data-node="place-options"]')).toContainText(place);
  }
  await expect(page.locator('[data-node="origin-text"]')).toBeVisible();

  await page.locator('[data-node="origin-bellevue"]').click();

  const travel = page.locator('[data-node="travel-block"]');
  await expect(page.locator('[data-node="travel-label"]')).toContainText('Your drive from Bellevue');
  await expect(travel).toContainText('estimated, not live traffic');
  await expect(page.locator('[data-node="envelope-travel"]')).toContainText(/Leave Bellevue (by \d{1,2}:\d{2}|now)/);
});

test('a slow location fix can never overwrite a starting point the user chose meanwhile', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  // Everett coordinates, delivered long after the user has already decided.
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (success) => {
      setTimeout(() => {
        success({
          coords: {
            latitude: 47.9789,
            longitude: -122.2021,
            accuracy: 3000,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null
          },
          timestamp: Date.now()
        } as GeolocationPosition);
      }, 1500);
    };
  });

  await open(page);
  await askTravelResolved(page);
  await openPickup(page);

  await page.locator('[data-node="use-my-location"]').click();
  await page.locator('[data-node="choose-place"]').click();
  await page.locator('[data-node="origin-tacoma"]').click();
  await expect(page.locator('[data-node="travel-label"]')).toContainText('Your drive from Tacoma');

  // The stale fix lands here, and is discarded.
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => window.__canvasBrowser.state().originId)).toBe('tacoma');
  await expect(page.locator('[data-node="travel-label"]')).toContainText('Your drive from Tacoma');
  const changes = await page.evaluate(() => window.__canvasBrowser.state().changes);
  expect(changes.some((entry) => entry.includes('Everett'))).toBe(false);
});

test('a slow location fix can never overwrite a Signal Field centre the user chose meanwhile', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (success) => {
      setTimeout(() => {
        success({
          coords: {
            latitude: 47.61,
            longitude: -122.2,
            accuracy: 3000,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null
          },
          timestamp: Date.now()
        } as GeolocationPosition);
      }, 1500);
    };
  });

  await open(page);
  await openSignalField(page);

  await page.locator('[data-node="field-place-button"]').click();
  await page.locator('[data-node="field-use-location"]').click();
  await page.locator('[data-node="news-place-tacoma"]').click();
  await expect(page.locator('[data-node="field-place"]')).toHaveText('Tacoma');

  await page.waitForTimeout(2000);
  await expect(page.locator('[data-node="field-place"]')).toHaveText('Tacoma');
  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.newsPlace).toBe('Tacoma');
  expect(state.newsPlaceTruth).toBe('chosen');
});

test('leaving the view invalidates a pending location request', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (success) => {
      setTimeout(() => {
        success({
          coords: {
            latitude: 47.9789,
            longitude: -122.2021,
            accuracy: 3000,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null
          },
          timestamp: Date.now()
        } as GeolocationPosition);
      }, 1200);
    };
  });

  await open(page);
  await askTravelResolved(page);
  await openPickup(page);
  await page.locator('[data-node="use-my-location"]').click();
  await page.locator('[data-node="back-home"]').click();
  await expect(page.locator('[data-node="home"]')).toBeVisible();

  await page.waitForTimeout(1800);
  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.view).toBe('home');
  expect(state.originId).toBeNull();
});

/* ------------------------------------------------------------------------ */
/* The persistent "always use my location" preference                        */
/* ------------------------------------------------------------------------ */

const LOCATION_KEY = 'canvasbrowser.location.v1';

/**
 * Replaces `getCurrentPosition` with a counted, deterministic stub. Every test
 * below asserts on *how many times* the product asked, and when — that is the
 * whole contract of an automatic fix.
 */
async function instrumentGeolocation(
  page: Page,
  config: { lat: number; lon: number; delayMs?: number } = { lat: 47.61, lon: -122.2 }
): Promise<void> {
  await page.addInitScript((cfg: { lat: number; lon: number; delayMs?: number }) => {
    (window as unknown as { __geo: unknown[] }).__geo = [];
    navigator.geolocation.getCurrentPosition = (success, _error, options) => {
      (window as unknown as { __geo: unknown[] }).__geo.push(options ?? {});
      const deliver = (): void =>
        success({
          coords: {
            latitude: cfg.lat,
            longitude: cfg.lon,
            accuracy: 3000,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null
          },
          timestamp: Date.now()
        } as GeolocationPosition);
      if (cfg.delayMs && cfg.delayMs > 0) setTimeout(deliver, cfg.delayMs);
      else deliver();
    };
  }, config);
}

/** Denies every fix, and still counts the asking. */
async function denyGeolocation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __geo: unknown[] }).__geo = [];
    navigator.geolocation.getCurrentPosition = (_success, error, options) => {
      (window as unknown as { __geo: unknown[] }).__geo.push(options ?? {});
      error?.({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: 'denied' });
    };
  });
}

function geoCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __geo: unknown[] }).__geo.length);
}

async function setAlwaysLocation(page: Page, enabled: boolean): Promise<void> {
  await page.locator('[data-node="more-button"]').click();
  const toggle = page.locator('[data-node="always-location-toggle"]');
  if (enabled) await toggle.check();
  else await toggle.uncheck();
  await page.locator('[data-node="more-close"]').click();
  await expect(page.locator('[data-node="more-menu"]')).toHaveCount(0);
}

test('the location preference is off by default, and Home never asks for a fix', async ({ page }) => {
  await instrumentGeolocation(page);
  await open(page);

  expect(await geoCalls(page)).toBe(0);
  expect(await page.evaluate(() => window.__canvasBrowser.state().alwaysUseLocation)).toBe(false);
  // Off is the absence of a record, not a stored "false".
  expect(await page.evaluate((key) => localStorage.getItem(key), LOCATION_KEY)).toBeNull();
  await expect(page.locator('[data-node="home-use-location"]')).toBeVisible();

  await page.locator('[data-node="more-button"]').click();
  await expect(page.locator('[data-node="always-location-toggle"]')).not.toBeChecked();
  await expect(page.locator('[data-node="always-location-status"]')).toHaveCount(0);
  await expect(page.locator('[data-node="always-location-group"]')).toContainText(
    'Always use my location for relevant worlds'
  );
  await expect(page.locator('[data-node="always-location-group"]')).toContainText(
    'never stored, and never sent to the model'
  );

  // A genuine behaviour preference, sitting above Developer mode.
  const order = await page
    .locator('[data-node="always-location-toggle"], [data-node="dev-mode-toggle"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-node')));
  expect(order).toEqual(['always-location-toggle', 'dev-mode-toggle']);

  await page.locator('[data-node="more-close"]').click();

  expect(await geoCalls(page)).toBe(0);
});

test('Home uses a fresh coarse location after the explicit location click', async ({ page }) => {
  await instrumentGeolocation(page, { lat: 47.674, lon: -122.1215 });
  await open(page);

  await page.locator('[data-node="home-use-location"]').click();

  await expect(page.locator('[data-node="home-place"]')).toHaveText('Redmond');
  await expect(page.locator('[data-node="home-use-location"]')).toHaveCount(0);
  await expect.poll(() => geoCalls(page)).toBe(1);
  expect(await page.evaluate((key) => localStorage.getItem(key), LOCATION_KEY)).toBeNull();
  expect(await page.evaluate(() => window.__canvasBrowser.state().alwaysUseLocation)).toBe(false);
});

test('a device fix outside the supported region is never relabelled as a Puget Sound city', () => {
  expect(nearestOrigin(40.7128, -74.006)).toBeNull();
  expect(nearestOrigin(47.674, -122.1215)?.id).toBe('redmond');
});

test('enabling the preference stores consent only — a version and a boolean', async ({ page }) => {
  await instrumentGeolocation(page);
  await open(page);
  await setAlwaysLocation(page, true);

  const stored = await page.evaluate((key) => localStorage.getItem(key), LOCATION_KEY);
  expect(JSON.parse(stored!)).toEqual({ version: 1, alwaysUse: true });

  // Nothing about where the person is may appear anywhere in storage.
  const dump = (
    await page.evaluate(() =>
      Object.keys(localStorage)
        .map((key) => `${key}=${localStorage.getItem(key)}`)
        .join('|')
    )
  ).toLowerCase();
  for (const forbidden of ['lat', 'lon', 'coord', 'seattle', 'bellevue', 'tacoma', 'everett', 'origin', 'place']) {
    expect(dump, `storage must not mention "${forbidden}"`).not.toContain(forbidden);
  }

  await expect.poll(() => geoCalls(page)).toBe(1);
  await expect(page.locator('[data-node="home-place"]')).toHaveText('Bellevue');
});

test('the preference survives a reload, so it really is across sessions', async ({ page }) => {
  await instrumentGeolocation(page);
  await open(page);
  await setAlwaysLocation(page, true);

  await page.reload();
  await page.waitForSelector('body[data-canvas-browser-ready="true"]');

  expect(await page.evaluate(() => window.__canvasBrowser.state().alwaysUseLocation)).toBe(true);
  await page.locator('[data-node="more-button"]').click();
  await expect(page.locator('[data-node="always-location-toggle"]')).toBeChecked();
  // A new session stores no place, but consent permits one fresh Home fix.
  expect(await page.evaluate(() => window.__canvasBrowser.state().originId)).toBeNull();
  await expect.poll(() => geoCalls(page)).toBe(1);
  await expect(page.locator('[data-node="home-place"]')).toHaveText('Bellevue');
});

test('enabled, the Travel pickup world requests exactly one fresh fix and gains its route', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await instrumentGeolocation(page);
  await open(page);
  await setAlwaysLocation(page, true);

  await askTravelResolved(page);
  // Home already acquired one coarse fix; Travel requests its own fresh route fix.
  expect(await geoCalls(page)).toBe(1);

  await openPickup(page);
  await expect.poll(() => page.evaluate(() => window.__canvasBrowser.state().originId)).toBe('bellevue');
  expect(await geoCalls(page)).toBe(2);

  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.locationState).toBe('granted');
  expect(state.autoLocationStatus).toBe('granted');
  expect(state.journey?.hasRoute).toBe(true);
  await expect(page.locator('[data-node="travel-label"]')).toContainText('Your drive from Bellevue');

  // One fix per world, not one per render.
  await page.waitForTimeout(400);
  expect(await geoCalls(page)).toBe(2);
});

test('the Home location flows into Signal Field without a second device request', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await instrumentGeolocation(page);
  await open(page);
  await setAlwaysLocation(page, true);
  expect(await geoCalls(page)).toBe(1);

  await openSignalField(page);
  await expect(page.locator('[data-node="field-place"]')).toHaveText('Bellevue');
  expect(await geoCalls(page)).toBe(1);

  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.newsPlaceTruth).toBe('coarse-location');
  expect(state.autoLocationStatus).toBe('granted');
  expect(state.newsContextRevision).toBe(0);
  expect(state.visibleSignals).toContain('bellevue-mobility');

  await page.waitForTimeout(400);
  expect(await geoCalls(page)).toBe(1);
});

test('switching Local News to current Redmond location refreshes nearby anchors at 5 miles', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await instrumentGeolocation(page, { lat: 47.674, lon: -122.1215 });
  await open(page);
  await openSignalField(page);
  await page.locator('[data-node="field-radius-5"]').click();

  await page.locator('[data-node="field-place-button"]').click();
  await page.locator('[data-node="field-use-location"]').click();

  await expect(page.locator('[data-node="field-place"]')).toHaveText('Redmond');
  for (const id of ['redmond-mobility', 'redmond-transit', 'redmond-civic', 'redmond-weather']) {
    await expect(page.locator(`[data-node="signal-${id}"]`)).toBeVisible();
  }
  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.newsRadiusMiles).toBe(5);
  expect(state.newsContextRevision).toBe(1);
  expect(state.visibleSignals.filter((id) => id.startsWith('redmond-'))).toHaveLength(4);
  await expect(page.locator('[data-node="field-freshness"]')).toContainText('REFRESH: CENTER CHANGE');

  const extent = await page.locator('[data-node="field-reach-boundary"]').evaluate((node) => ({
    rx: Number(node.getAttribute('rx')),
    ry: Number(node.getAttribute('ry'))
  }));
  expect(Math.max(extent.rx, extent.ry), 'five-mile boundary uses the frame with margin').toBeGreaterThan(35);
  expect(Math.max(extent.rx, extent.ry)).toBeLessThanOrEqual(46);

  const collisions = await page.evaluate(() => {
    const labels = [...document.querySelectorAll<HTMLElement>('button.signal .signal-label')];
    const pairs: string[] = [];
    for (let i = 0; i < labels.length; i++) {
      const a = labels[i].getBoundingClientRect();
      for (let j = i + 1; j < labels.length; j++) {
        const b = labels[j].getBoundingClientRect();
        if (Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)) {
          pairs.push(`${i}-${j}`);
        }
      }
    }
    return pairs;
  });
  expect(collisions).toEqual([]);
});

test('weather is visualized as a projected area with a wind vector, not only a link', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await instrumentGeolocation(page, { lat: 47.674, lon: -122.1215 });
  await open(page);
  await openSignalField(page);
  await page.locator('[data-node="field-radius-5"]').click();
  await page.locator('[data-node="field-place-button"]').click();
  await page.locator('[data-node="field-use-location"]').click();

  const area = page.locator('[data-node="weather-area-redmond-weather"]');
  await expect(area).toBeVisible();
  await expect(area.locator('.field-weather-footprint')).toHaveCount(1);
  await expect(area.locator('ellipse')).toHaveCount(1);
  await expect(area.locator('.field-weather-wind')).toHaveCount(1);
  await expect(area.locator('.field-weather-arrow')).toHaveCount(1);
  await expect(area.locator('.field-weather-vector-label')).toHaveText('WIND');

  const geometry = await area.evaluate((node) => {
    const boundary = node.querySelector<SVGEllipseElement>('.field-weather-footprint')!;
    const wind = node.querySelector<SVGLineElement>('.field-weather-wind')!;
    const arrow = node.querySelector<SVGPolygonElement>('.field-weather-arrow')!;
    return {
      rx: Number(boundary.getAttribute('rx')),
      ry: Number(boundary.getAttribute('ry')),
      windLength: Math.hypot(
        Number(wind.getAttribute('x2')) - Number(wind.getAttribute('x1')),
        Number(wind.getAttribute('y2')) - Number(wind.getAttribute('y1'))
      ),
      arrowPoints: arrow.getAttribute('points') ?? ''
    };
  });

  expect(geometry.rx).toBeGreaterThan(5);
  expect(geometry.ry).toBeGreaterThan(12);
  expect(geometry.windLength).toBeGreaterThan(10);
  expect(geometry.arrowPoints.split(' ')).toHaveLength(3);
  const weatherSignal = page.locator('[data-node="signal-redmond-weather"]');
  await expect(weatherSignal).toContainText('Local air');
  await expect(weatherSignal).toHaveAttribute('aria-label', /wind toward 238 degrees/);

  await page.locator('[data-node="layer-weather"]').click();
  await expect(area).toHaveCount(0);
  await expect(page.locator('[data-node="signal-redmond-weather"]')).toHaveCount(0);
});

test('live weather, news, and markets become provenance-preserving Local News signals', () => {
  const context: LiveLocalContext = {
    place: { id: 'redmond', label: 'Redmond', lat: 47.674, lon: -122.1215 },
    retrievedAt: '2026-08-17T22:00:00.000Z',
    weather: {
      temperatureF: 73,
      weatherCode: 2,
      condition: 'Cloudy',
      windMph: 8,
      windDegrees: 240,
      sourceUrl: 'https://open-meteo.com/en/docs'
    },
    air: {
      usAqi: 42,
      pm25: 7.1,
      sourceUrl: 'https://open-meteo.com/en/docs/air-quality-api'
    },
    news: [
      {
        id: 'news-1',
        title: 'Redmond council approves trail connection',
        source: 'Local publisher',
        url: 'https://example.com/redmond-trail',
        publishedAt: '2026-08-17T21:30:00.000Z',
        feed: 'Local publisher RSS'
      }
    ],
    markets: [
      {
        id: 'sp500',
        label: 'S&P 500',
        price: 6500,
        changePercent: 0.62,
        asOf: '2026-08-17T21:55:00.000Z',
        url: 'https://finance.yahoo.com/quote/%5EGSPC'
      }
    ],
    errors: []
  };
  const signals = liveSignalsFromContext(context, findNewsPlace('redmond')!);

  const weather = signals.find((signal) => signal.id === 'redmond-live-weather')!;
  expect(weather.provenance).toBe('live');
  expect(weather.weatherArea).toMatchObject({ windDegrees: 60 });
  expect(weather.detail).toContain('73°F');
  expect(weather.detail).toContain('from 240°');
  expect(weather.source?.url).toBe('https://open-meteo.com/en/docs');
  const air = signals.find((signal) => signal.id === 'redmond-live-air')!;
  expect(air.detail).toContain('US AQI 42');
  expect(air.source?.url).toBe('https://open-meteo.com/en/docs/air-quality-api');

  const news = signals.find((signal) => signal.id === 'redmond-live-news-1')!;
  expect(news.provenance).toBe('live');
  expect(news.source?.url).toBe('https://example.com/redmond-trail');
  expect(news.minutesAgo).toBe(30);
  expect(news.anchorPrecision).toBe('coarse');

  const market = signals.find((signal) => signal.id === 'live-market-sp500')!;
  expect(market.provenance).toBe('live');
  expect(market.axis?.move).toBe('+0.62%');

  expect(signals.some((signal) => signal.layer === 'mobility' && signal.provenance !== 'live')).toBe(true);
  expect(signals.filter((signal) => signal.layer === 'mobility' && signal.provenance !== 'live')).toHaveLength(2);
  expect(signals.filter((signal) => signal.weatherArea)).toHaveLength(1);
  const world = planSignalField({
    nowMs: Date.parse(context.retrievedAt),
    place: findNewsPlace('redmond')!,
    scope: 'both',
    horizon: 'today',
    layers: { local: true, markets: true, weather: true, mobility: true },
    radiusMiles: 25,
    focus: 'all',
    signals
  });
  expect(world.signals.find((signal) => signal.id === news.id)?.distanceLabel).toBe('coarse local context');
  expect(world.consequences.find((entry) => entry.id === news.id)?.provenance).toBe('live');
  expect(world.consequences.find((entry) => entry.layer === 'mobility')?.provenance).toBe('sample');
});

test('an explicit center overrides a prompt-named place and keeps the graph synchronized', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askRaw(page, 'What local news and market moves matter to me in Redmond this morning?');
  await expect(page.locator('[data-node="signal-field"]')).toBeVisible();

  let state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.newsPlace).toBe('Redmond');
  expect(state.newsContextRevision).toBe(0);
  expect(state.visibleSignals).toContain('redmond-mobility');
  await expect(page.locator('[data-node="field-freshness"]')).toContainText('REFRESH: INITIAL PACK');

  await page.locator('[data-node="field-place-button"]').click();
  await page.locator('[data-node="news-place-tacoma"]').click();

  state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.newsPlace).toBe('Tacoma');
  expect(state.newsContextRevision).toBe(1);
  expect(state.visibleSignals).toContain('tacoma-mobility');
  const place = await page.evaluate(() => window.__canvasBrowser.graph()!.place);
  expect(place.label).toBe('Tacoma');
  expect(place.source).toBe('chosen');
});

test('with the preference off, no world ever asks for a fix on its own', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await instrumentGeolocation(page);
  await open(page);

  await askTravelResolved(page);
  await openPickup(page);
  await page.waitForTimeout(400);
  expect(await geoCalls(page)).toBe(0);
  expect(await page.evaluate(() => window.__canvasBrowser.state().originId)).toBeNull();

  await page.locator('[data-node="back-home"]').click();
  await openSignalField(page);
  await page.waitForTimeout(400);
  expect(await geoCalls(page)).toBe(0);
  expect(await page.evaluate(() => window.__canvasBrowser.state().newsPlaceTruth)).toBe('inferred');
});

test('a denied automatic fix keeps the preference on and hands back the manual choices', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await denyGeolocation(page);
  await open(page);
  await setAlwaysLocation(page, true);

  await askTravelResolved(page);
  await openPickup(page);

  await expect(page.locator('[data-node="location-fallback"]')).toContainText('pick a starting point');
  await expect(page.locator('[data-node="place-options"]')).toContainText('Bellevue');
  await expect(page.locator('[data-node="use-my-location"]')).toBeVisible();

  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.alwaysUseLocation).toBe(true);
  expect(state.autoLocationStatus).toBe('denied');

  // The preference is not silently switched off, and More says why.
  await page.locator('[data-node="more-button"]').click();
  await expect(page.locator('[data-node="always-location-toggle"]')).toBeChecked();
  await expect(page.locator('[data-node="always-location-status"]')).toContainText('browser permission denied');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), LOCATION_KEY)).toEqual({
    version: 1,
    alwaysUse: true
  });
});

test('turning the preference on inside a world that lacks a location completes it at once', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await instrumentGeolocation(page);
  await open(page);

  await askTravelResolved(page);
  await openPickup(page);
  expect(await geoCalls(page)).toBe(0);

  await setAlwaysLocation(page, true);
  await expect.poll(() => page.evaluate(() => window.__canvasBrowser.state().originId)).toBe('bellevue');
  expect(await geoCalls(page)).toBe(1);
});

test('a late automatic fix cannot override a starting point the user chose meanwhile', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  // Everett, delivered long after the user has already decided.
  await instrumentGeolocation(page, { lat: 47.9789, lon: -122.2021, delayMs: 1500 });
  await open(page);
  await setAlwaysLocation(page, true);

  await askTravelResolved(page);
  await openPickup(page);
  expect(await geoCalls(page)).toBe(1);

  await page.locator('[data-node="choose-place"]').click();
  await page.locator('[data-node="origin-tacoma"]').click();
  await expect(page.locator('[data-node="travel-label"]')).toContainText('Your drive from Tacoma');

  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => window.__canvasBrowser.state().originId)).toBe('tacoma');
  await expect(page.locator('[data-node="travel-label"]')).toContainText('Your drive from Tacoma');
  const changes = await page.evaluate(() => window.__canvasBrowser.state().changes);
  expect(changes.some((entry) => entry.includes('Everett'))).toBe(false);
});

test('a late automatic fix cannot override a Signal Field centre the user chose meanwhile', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await instrumentGeolocation(page, { lat: 47.61, lon: -122.2, delayMs: 1500 });
  await open(page);
  await setAlwaysLocation(page, true);

  await openSignalField(page);
  expect(await geoCalls(page)).toBe(1);

  await page.locator('[data-node="field-place-button"]').click();
  await page.locator('[data-node="news-place-tacoma"]').click();
  await expect(page.locator('[data-node="field-place"]')).toHaveText('Tacoma');

  await page.waitForTimeout(2000);
  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.newsPlace).toBe('Tacoma');
  expect(state.newsPlaceTruth).toBe('chosen');
});

test('switching the preference off invalidates a fix that is still pending', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await instrumentGeolocation(page, { lat: 47.9789, lon: -122.2021, delayMs: 1500 });
  await open(page);
  await setAlwaysLocation(page, true);

  await askTravelResolved(page);
  await openPickup(page);
  expect(await geoCalls(page)).toBe(1);

  await setAlwaysLocation(page, false);

  await page.waitForTimeout(2000);
  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.originId).toBeNull();
  expect(state.alwaysUseLocation).toBe(false);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), LOCATION_KEY)).toEqual({
    version: 1,
    alwaysUse: false
  });
});

test('a new ask invalidates a pending automatic fix, exactly as an explicit one', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await instrumentGeolocation(page, { lat: 47.9789, lon: -122.2021, delayMs: 1500 });
  await open(page);
  await setAlwaysLocation(page, true);

  await askTravelResolved(page);
  await openPickup(page);
  expect(await geoCalls(page)).toBe(1);

  await page.locator('[data-node="back-home"]').click();
  await expect(page.locator('[data-node="home"]')).toBeVisible();

  await page.waitForTimeout(1800);
  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.view).toBe('home');
  expect(state.originId).toBeNull();
});

/* ------------------------------------------------------------------------ */
/* Local reshaping, keyboard, mobile, More                                   */
/* ------------------------------------------------------------------------ */

test('removing the checked bag dissolves the bags segment and contracts the range with no extra model call', async ({
  page
}) => {
  const agent = await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);

  await expect(page.locator('[data-node="segment-bags"]')).toBeVisible();
  const before = await page.evaluate(() => window.__canvasBrowser.plan());
  const callsBefore = agent.get();

  await page.locator('[data-node="terrain-followup"]').fill('no checked bag');
  await page.locator('[data-node="terrain-followup-apply"]').click();

  await expect(page.locator('[data-node="segment-bags"]')).toHaveCount(0);
  await expect(page.locator('[data-node="assumption-bags"]')).toHaveText('no checked bag');

  const after = await page.evaluate(() => window.__canvasBrowser.plan());
  const beforeSpan = before!.envelope!.curbWindow.endMs - before!.envelope!.curbWindow.startMs;
  const afterSpan = after!.envelope!.curbWindow.endMs - after!.envelope!.curbWindow.startMs;
  expect(afterSpan).toBeLessThan(beforeSpan);
  expect(after!.envelope!.curbWindow.endMs).toBeLessThan(before!.envelope!.curbWindow.endMs);

  expect(agent.get()).toBe(callsBefore);

  // The change is reversible, and the control stays visually secondary.
  await expect(page.locator('[data-node="what-changed"]')).toContainText('What changed (1)');
  await page.locator('[data-node="what-changed"] summary').click();
  await expect(page.locator('[data-node="what-changed"]')).toContainText('No checked bag');
  await page.locator('[data-node="undo-change"]').click();
  await expect(page.locator('[data-node="segment-bags"]')).toBeVisible();
  expect(agent.get()).toBe(callsBefore);
});

async function focusNode(page: Page, node: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const focused = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.node ?? null
    );
    if (focused === node) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`could not reach [data-node="${node}"] by keyboard`);
}

test('the whole path is reachable from the keyboard alone', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);

  await page.keyboard.press('Tab');
  await expect(page.locator('[data-node="brand"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-node="scenario-menu"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-node="more-button"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-node="home-use-location"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-node="home-prompt"]')).toBeFocused();

  await page.keyboard.type(EVA_PROMPT);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-node="clarify-question"]')).toBeVisible();
  await waitForResearch(page);

  await focusNode(page, 'hypothesis-pickup');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-node="time-terrain"]')).toBeVisible();

  await focusNode(page, 'assumption-bags');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-node="segment-bags"]')).toHaveCount(0);

  await focusNode(page, 'sources-button');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Sources' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-node="sources-sheet"]')).toHaveCount(0);
});

test('closing Sources or More hands focus back to the control that opened it', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);

  await page.locator('[data-node="sources-button"]').click();
  await expect(page.getByRole('dialog', { name: 'Sources' })).toBeVisible();
  await page.locator('[data-node="sources-close"]').click();
  await expect(page.locator('[data-node="sources-sheet"]')).toHaveCount(0);
  await expect(page.locator('[data-node="sources-button"]')).toBeFocused();

  // Escape is the same promise as the Close button.
  await page.locator('[data-node="sources-button"]').click();
  await expect(page.getByRole('dialog', { name: 'Sources' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-node="sources-sheet"]')).toHaveCount(0);
  await expect(page.locator('[data-node="sources-button"]')).toBeFocused();

  await page.locator('[data-node="more-button"]').click();
  await expect(page.getByRole('dialog', { name: 'More' })).toBeVisible();
  await page.locator('[data-node="more-close"]').click();
  await expect(page.locator('[data-node="more-menu"]')).toHaveCount(0);
  await expect(page.locator('[data-node="more-button"]')).toBeFocused();
});

test('mobile renders a vertical world with a sticky envelope and no horizontal overflow', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth
  }));
  expect(overflow.doc).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);

  const segments = page.locator('[data-node="pipeline"] li');
  const first = await segments.first().boundingBox();
  const last = await segments.last().boundingBox();
  expect(first!.y).toBeLessThan(last!.y); // vertical timeline
  expect(Math.abs(first!.x - last!.x)).toBeLessThan(2); // full-width rows

  for (const node of ['sources-button', 'use-my-location']) {
    const box = await page.locator(`[data-node="${node}"]`).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  // The sticky warm envelope stays readable over the dark world.
  const envelope = page.getByRole('region', { name: 'Decision envelope' });
  await expect(envelope).toBeVisible();
  const sticky = await page.locator('[data-node="unknown-envelope"], [data-node="decision-envelope"]').first().evaluate(
    (el) => {
      const style = getComputedStyle(el);
      const match = style.backgroundColor.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0'];
      const [r, g, b] = match.map(Number);
      return { position: style.position, luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b };
    }
  );
  expect(sticky.position).toBe('sticky');
  expect(sticky.luminance).toBeGreaterThan(200);
});

test('More holds appearance, accessibility, and an off-by-default developer mode', async ({ page }) => {
  await open(page);
  await page.locator('[data-node="more-button"]').click();

  const menu = page.getByRole('dialog', { name: 'More' });
  await expect(menu).toBeVisible();
  await expect(page.locator('[data-node="dev-mode-toggle"]')).not.toBeChecked();

  await page.locator('[data-node="appearance-contrast-high"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');

  await page.locator('[data-node="dev-mode-toggle"]').check();
  await expect(page.locator('[data-node="dev-panel"]')).toBeVisible();

  await page.locator('[data-node="more-close"]').click();
  await expect(page.locator('[data-node="more-menu"]')).toHaveCount(0);
});

test('More keeps contrast, text size, and motion — and offers no dark/light theme switch', async ({ page }) => {
  await open(page);
  await page.locator('[data-node="more-button"]').click();

  for (const control of [
    'appearance-contrast-standard',
    'appearance-contrast-high',
    'appearance-textSize-standard',
    'appearance-textSize-large',
    'appearance-motion-full',
    'appearance-motion-reduced'
  ]) {
    await expect(page.locator(`[data-node="${control}"]`)).toHaveCount(1);
  }

  // Light and dark are functional here, not a user preference.
  await expect(page.locator('[data-node^="appearance-theme"]')).toHaveCount(0);
  await expect(page.locator('[data-node^="appearance-appearance"]')).toHaveCount(0);
  const menuText = (await page.locator('[data-node="more-menu"]').innerText()).toLowerCase();
  for (const rejected of ['dark mode', 'light mode', 'theme']) {
    expect(menuText, `More must not offer "${rejected}"`).not.toContain(rejected);
  }
});

/* ------------------------------------------------------------------------ */
/* Living News — the second hero template                                    */
/* ------------------------------------------------------------------------ */

test('an open news question resolves the Signal Field in at most two questions', async ({ page }) => {
  const agent = await mockAgent(page, landedAnswer());
  await open(page);
  await askRaw(page, NEWS_OPEN_PROMPT);

  // 1 — scope. Three choices, no form, no progress wizard.
  const question = page.locator('[data-node="clarify-question"]');
  await expect(question).toContainText('What part of your world');
  await expect(page.locator('[data-node="clarify-choices"] button')).toHaveCount(3);
  await expect(page.locator('[data-node^="progress"]')).toHaveCount(0);
  await expect(page.locator('[data-node="clarify"] input')).toHaveCount(0);
  await page.locator('[data-node="clarify-both"]').click();

  // 2 — horizon.
  await expect(question).toContainText('How far ahead');
  await page.locator('[data-node="clarify-today"]').click();

  // …and then the world, with no third question.
  await expect(page.locator('[data-node="signal-field"]')).toBeVisible();
  await expect(page.locator('[data-node="clarify"]')).toHaveCount(0);

  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.questionsAsked).toBe(2);
  expect(state.newsScope).toBe('both');
  expect(state.newsHorizon).toBe('today');
  expect(state.view).toBe('field');

  // The Signal Field is deterministic and local: the gateway is never asked.
  expect(agent.get()).toBe(0);
});

test('a strong news prompt needs no question at all', async ({ page }) => {
  const agent = await mockAgent(page, landedAnswer());
  await open(page);
  await openSignalField(page);

  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.questionsAsked).toBe(0);
  expect(state.newsScope).toBe('both');
  expect(state.newsHorizon).toBe('today');
  expect(agent.get()).toBe(0);
});

test('an ambiguous news question answers literally first, then offers the world', async ({ page }) => {
  const agent = await mockAgent(page, 'The Federal Reserve left rates unchanged. https://www.federalreserve.gov/');
  await open(page);
  await askRaw(page, NEWS_LITERAL_PROMPT);

  await expect(page.locator('[data-node="literal-answer"]')).toContainText('left rates unchanged');
  const offer = page.locator('[data-node="news-offer"]');
  await expect(offer).toContainText('as an answer, or as your world');
  await expect(page.locator('[data-node="signal-field"]')).toHaveCount(0);
  expect(agent.get()).toBe(1);

  await page.locator('[data-node="offer-briefing"]').click();
  await expect(page.locator('[data-node="signal-field"]')).toBeVisible();

  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.questionsAsked).toBeLessThanOrEqual(2);
  expect(agent.get()).toBe(1);
});

test('"this morning" alone is not a briefing: a specific factual question is still researched', async ({ page }) => {
  const agent = await mockAgent(page, 'The Federal Reserve left rates unchanged. https://www.federalreserve.gov/');
  await open(page);
  await askRaw(page, NEWS_MORNING_PROMPT);

  // The literal answer, from the gateway — not a jump into a sample field.
  await expect(page.locator('[data-node="literal-answer"]')).toContainText('left rates unchanged');
  expect(agent.get()).toBe(1);
  await expect(page.locator('[data-node="signal-field"]')).toHaveCount(0);
  await expect(page.locator('[data-node="news-offer"]')).toContainText('as an answer, or as your world');

  // …and the world is still one click away, once the user asks for it.
  await page.locator('[data-node="offer-briefing"]').click();
  await expect(page.locator('[data-node="signal-field"]')).toBeVisible();
  expect(agent.get()).toBe(1);
});

test('a stated briefing intent still goes straight to the world', async ({ page }) => {
  const agent = await mockAgent(page, landedAnswer());
  await open(page);
  await askRaw(page, 'Brief me on local news and market moves today');
  await expect(page.locator('[data-node="signal-field"]')).toBeVisible();
  await expect(page.locator('[data-node="literal-answer"]')).toHaveCount(0);
  expect(agent.get()).toBe(0);

  // A briefing intent without an inferable scope still costs a question, not
  // a literal detour.
  await page.locator('[data-node="back-home"]').click();
  await askRaw(page, 'Brief me on what matters around me this morning');
  await expect(page.locator('[data-node="clarify-question"]')).toContainText('What part of your world');
  await expect(page.locator('[data-node="literal-answer"]')).toHaveCount(0);
  expect(agent.get()).toBe(0);
});

test('the Signal Field is a reach world: centre, rings, layers, envelope, sources', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openSignalField(page);

  // The person and their moment are the centre of the world.
  const centre = page.locator('[data-node="field-center-label"]');
  await expect(centre).toContainText('YOU');
  await expect(page.locator('[data-node="field-place"]')).toHaveText('Seattle');
  await expect(page.locator('[data-node="field-clock"]')).toHaveText(/\d{1,2}:\d{2}\s?(AM|PM)/);

  // Reach is one selected geographic extent over the map, not orbital bands.
  const rings = page.locator('[data-node="reach-rings"]');
  await expect(rings).toContainText('Reach');
  await expect(rings).toContainText('≤ 25 mi');
  await expect(page.locator('[data-node="field-geometry"] .field-ring')).toHaveCount(0);
  await expect(page.locator('[data-node="field-geometry"] .field-bearing-axis')).toHaveCount(0);
  await expect(page.locator('[data-node="field-geometry"] .field-tether')).toHaveCount(1);
  await expect(page.locator('.center-pulse')).toHaveCount(1);

  // Local + Markets are the P0 forces, and both are on.
  for (const layer of ['local', 'markets']) {
    await expect(page.locator(`[data-node="layer-${layer}"]`)).toHaveAttribute('aria-pressed', 'true');
  }
  const roads = page.locator('[data-node="layer-mobility"]');
  await expect(roads).toContainText('Roads & transit');
  await expect(roads).toHaveAttribute('title', /traffic, transit, ferries, and airport access/i);

  // FutureGlass instrument language, without a false live claim or a map claim.
  const status = page.locator('[data-node="field-freshness"]');
  await expect(status).toHaveCount(1);
  await expect(status).toContainText('MODE: SAMPLE STATIC');
  await expect(status).toContainText('MAP: BING AERIAL');
  await expect(status).toContainText('RETRIEVAL: LOCAL');
  await expect(status).toContainText('REFRESH: INITIAL PACK');
  await expect(status).toContainText('0 LIVE');
  await expect(status).not.toContainText('MODE: LIVE CONTEXT');
  expect((await status.innerText()).toLowerCase()).not.toMatch(/updated|freshest/);

  await expect(page.locator('[data-node="field-schematic"]')).toHaveCount(0);

  // One dominant, prioritised outcome — not a list of headlines.
  await expect(page.locator('[data-node="briefing-title"]')).toHaveText('Your next 6 hours');
  const consequences = page.locator('[data-node="briefing-consequences"] > li');
  expect(await consequences.count()).toBeGreaterThan(0);
  expect(await consequences.count()).toBeLessThanOrEqual(3);
  await expect(page.locator('[data-node="consequence-1"]')).toContainText(/Leave 20 minutes earlier/);

  // Absence is stated, not hidden.
  await expect(page.locator('[data-node="field-absence"]')).toContainText('No public feed');

  // The market axis is three compact signals anchored to time, not a grid.
  await expect(page.locator('[data-node="market-axis"]')).toBeVisible();
  await expect(page.locator('[data-node^="market-signal-"]')).toHaveCount(3);

  await expect(page.locator('[data-node="sources-button"]')).toBeVisible();
});

test('Local News uses a static Bing aerial base and map-anchored geographic signals', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openSignalField(page);

  const frame = page.locator('[data-node="field-map-base"]');
  await expect(frame).toHaveAttribute('title', 'Static Bing aerial map for Local News');
  await expect(frame).toHaveAttribute('sandbox', /allow-scripts/);
  await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(await frame.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none');
  const src = await frame.getAttribute('src');
  expect(src).toMatch(/^https:\/\/www\.bing\.com\/maps\/embed\?/);
  expect(src).toContain('typ=a');
  expect(src).not.toMatch(/key=|token=|apikey/i);

  const expected = bingFieldBase({ lat: 47.6062, lon: -122.3321 }, 25);
  expect(isAllowedBingEmbed(expected.embedUrl)).toBe(true);
  const handoff = page.locator('[data-node="field-map-open"]');
  await expect(handoff).toHaveAttribute('href', expected.viewUrl);
  await expect(handoff).toHaveAttribute('target', '_blank');

  const signal = page.locator('[data-node="signal-i5-incident"]');
  await expect(signal).toHaveAttribute('data-lat', '47.565');
  await expect(signal).toHaveAttribute('data-lon', '-122.31');
  await expect(page.locator('[data-node="tether-i5-incident"]')).toHaveCount(1);
});

test('FutureGlass reach presets reshape Local News locally with no model call', async ({ page }) => {
  const agent = await mockAgent(page, landedAnswer());
  await open(page);
  await openSignalField(page);

  await expect(page.locator('[data-node="field-instrument-rail"]')).toBeVisible();
  await expect(page.locator('[data-node="field-radius-25"]')).toHaveAttribute('aria-pressed', 'true');
  const initial = (await page.evaluate(() => window.__canvasBrowser.state())).visibleSignals.length;

  await page.locator('[data-node="field-radius-5"]').click();
  let state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.newsRadiusMiles).toBe(5);
  expect(state.visibleSignals.length).toBeLessThan(initial);
  await expect(page.locator('[data-node="field-radius-5"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-node="field-radius-120"]').click();
  state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.newsRadiusMiles).toBe(120);
  expect(state.visibleSignals.length).toBeGreaterThanOrEqual(initial);
  await expect(page.locator('[data-node="field-radius-120"]')).toHaveAttribute('aria-pressed', 'true');
  expect(agent.get()).toBe(0);
});

test('live Local News uses one headline rail, one weather footprint, and minimal leaders', async ({ page }) => {
  const context = await mockLocalContext(page);
  await page.goto('/?live-context=1');
  await page.waitForSelector('body[data-canvas-browser-ready="true"]');
  await openSignalField(page);

  await expect(page.locator('[data-node="field-freshness"]')).toContainText('MODE: MIXED LIVE + SAMPLE');
  await expect(page.locator('[data-node="local-news-rail"]')).toBeVisible();
  await expect(page.locator('[data-node^="local-news-item-"]')).toHaveCount(4);
  await expect(page.locator('[data-node^="weather-area-"]')).toHaveCount(1);
  await expect(page.locator('[data-node="field-geometry"] .field-tether')).toHaveCount(1);

  const liveMapLabels = page.locator('button.signal[data-display="rail"] .signal-label');
  await expect(liveMapLabels).toHaveCount(4);
  for (let index = 0; index < 4; index++) {
    expect(await liveMapLabels.nth(index).evaluate((node) => getComputedStyle(node).display)).toBe('none');
  }
  expect(context.get()).toBe(1);
});

test('signal names are direct field type: no chips, no clipping, and no landing on the anchor', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openSignalField(page);

  // Type on the field, not a plate on the field.
  const labels = await page.$$eval('.signal .signal-label', (nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      const short = node.querySelector('.signal-short') as HTMLElement;
      const shortStyle = getComputedStyle(short);
      return {
        background: style.backgroundColor,
        borderTop: style.borderTopWidth,
        borderLeft: style.borderLeftWidth,
        boxShadow: style.boxShadow,
        textShadow: shortStyle.textShadow,
        overflowX: short.scrollWidth - short.clientWidth,
        overflowY: short.scrollHeight - short.clientHeight
      };
    })
  );
  expect(labels.length).toBeGreaterThanOrEqual(8);
  for (const label of labels) {
    expect(label.background).toBe('rgba(0, 0, 0, 0)');
    expect(label.borderTop).toBe('0px');
    expect(label.borderLeft).toBe('0px');
    expect(label.boxShadow).toBe('none');
    expect(label.textShadow).not.toBe('none');
    expect(label.overflowX, 'a signal name must never be clipped').toBeLessThanOrEqual(1);
    expect(label.overflowY, 'a signal name must never be clipped').toBeLessThanOrEqual(1);
  }

  // No-fly zones: the anchor, the ring names, the compass, the market axis.
  const collisions = await page.evaluate(() => {
    const box = (el: Element) => el.getBoundingClientRect();
    const hits = (a: DOMRect, b: DOMRect) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const noFly = [
      ...document.querySelectorAll(
        '[data-node="field-center-label"], .center-place, .ring-label, .compass-mark, [data-node="market-axis"]'
      )
    ].map(box);
    const report: string[] = [];
    const placed: DOMRect[] = [];
    for (const signal of document.querySelectorAll<HTMLElement>('button.signal[data-node^="signal-"]')) {
      const rect = box(signal.querySelector('.signal-label')!);
      if (noFly.some((zone) => hits(rect, zone))) report.push(`${signal.dataset.node} over a no-fly zone`);
      if (placed.some((other) => hits(rect, other))) report.push(`${signal.dataset.node} over another name`);
      placed.push(rect);
    }
    return report;
  });
  expect(collisions).toEqual([]);

  // Every signal is still a named button with a visible focus ring.
  const first = page.locator('button.signal[data-node^="signal-"]').first();
  await expect(first).toHaveAttribute('aria-label', /Observed|Modeled|Inferred|Unavailable/);
  await first.focus();
  const outline = await first.evaluate((el) => getComputedStyle(el).outlineWidth);
  expect(outline).not.toBe('0px');
});

test('the Signal Field is not a card grid, a tab set, or a panel layout', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openSignalField(page);

  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.locator('[data-node^="panel-"]')).toHaveCount(0);
  await expect(page.locator('[data-node^="card-"]')).toHaveCount(0);
  await expect(page.locator('[data-node^="sidebar"]')).toHaveCount(0);

  // Signals are placed by reach and bearing: no shared rows, no shared columns.
  const boxes = Object.values(await signalBoxes(page));
  expect(boxes.length).toBeGreaterThanOrEqual(8);
  expect(new Set(boxes.map((box) => box.x)).size).toBeGreaterThanOrEqual(boxes.length - 1);
  expect(new Set(boxes.map((box) => box.y)).size).toBeGreaterThanOrEqual(boxes.length - 1);

  // Exactly one prompt in the world, and no transcript.
  await expect(page.locator('input')).toHaveCount(1);
  await expect(page.locator('[data-node^="transcript"]')).toHaveCount(0);
  await expect(page.locator('[data-node^="message-"]')).toHaveCount(0);
});

test('toggling a layer hides its signals, keeps map anchors stable, and rewrites the briefing locally', async ({
  page
}) => {
  const agent = await mockAgent(page, landedAnswer());
  await open(page);
  await openSignalField(page);

  await expect(page.locator('[data-node="signal-port-freight"]')).toBeVisible();
  await expect(page.locator('[data-node="market-axis"]')).toBeVisible();
  await expect(page.locator('[data-node="briefing-consequences"]')).toContainText('watched tech names');
  const callsBefore = agent.get();
  const mapBefore = await page.evaluate(() => ({
    src: document.querySelector<HTMLIFrameElement>('[data-node="field-map-base"]')!.src,
    height: Math.round(document.querySelector<HTMLElement>('[data-node="world"]')!.getBoundingClientRect().height)
  }));

  await page.locator('[data-node="layer-markets"]').click();

  // The market force leaves the world entirely — dots, axis, and consequence.
  await expect(page.locator('[data-node="layer-markets"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-node="signal-port-freight"]')).toHaveCount(0);
  await expect(page.locator('[data-node="market-axis"]')).toHaveCount(0);
  await expect(page.locator('[data-node="briefing-consequences"]')).not.toContainText('watched tech names');
  await expect(page.locator('[data-node="field-absence"]')).toContainText('Markets layer is off');
  const mapAfter = await page.evaluate(() => ({
    src: document.querySelector<HTMLIFrameElement>('[data-node="field-map-base"]')!.src,
    height: Math.round(document.querySelector<HTMLElement>('[data-node="world"]')!.getBoundingClientRect().height)
  }));
  expect(mapAfter).toEqual(mapBefore);

  // The viewport is stable, and every rendered high-impact tether keeps its
  // signal's projected coordinate.
  const anchored = await page.evaluate(() => {
    const tethers = [...document.querySelectorAll<SVGLineElement>('.field-tether[data-node]')];
    return tethers.length > 0 && tethers.every((tether) => {
      const id = tether.dataset.node!.replace(/^tether-/, '');
      const signal = document.querySelector<HTMLElement>(`[data-signal-id="${id}"]`);
      if (!signal) return false;
      const x = Number.parseFloat(signal.style.getPropertyValue('--x'));
      const y = Number.parseFloat(signal.style.getPropertyValue('--y'));
      return (
        Math.abs(Number(tether.getAttribute('x1')) - x) < 0.01 &&
        Math.abs(Number(tether.getAttribute('y1')) - y) < 0.01
      );
    });
  });
  expect(anchored).toBe(true);

  // …and none of it cost a model call.
  expect(agent.get()).toBe(callsBefore);

  await page.locator('[data-node="layer-markets"]').click();
  await expect(page.locator('[data-node="market-axis"]')).toBeVisible();
  expect(agent.get()).toBe(callsBefore);
});

test('"hide markets" reshapes the world instead of appending a transcript', async ({ page }) => {
  const agent = await mockAgent(page, landedAnswer());
  await open(page);
  await openSignalField(page);
  const callsBefore = agent.get();

  await page.locator('[data-node="field-followup"]').fill('hide markets');
  await page.locator('[data-node="field-followup-apply"]').click();

  await expect(page.locator('[data-node="market-axis"]')).toHaveCount(0);
  await expect(page.locator('[data-node="layer-markets"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-node="field-notes"]')).toContainText('Markets hidden');
  await expect(page.locator('input')).toHaveCount(1);
  expect(agent.get()).toBe(callsBefore);

  // A radius edit is equally local.
  await page.locator('[data-node="field-followup"]').fill('only things within 8 miles');
  await page.locator('[data-node="field-followup-apply"]').click();
  await expect(page.locator('[data-node="signal-wind-advisory"]')).toHaveCount(0);
  await expect(page.locator('[data-node="field-notes"]')).toContainText('Radius set to 8 miles');
  expect(agent.get()).toBe(callsBefore);
});

test('evidence reads on a warm light sheet while the field stays a dark space', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openSignalField(page);

  await expect(page.locator('[data-node="world"]')).toHaveAttribute('data-surface', 'dark');
  await expect(page.locator('[data-node="briefing-ribbon"]')).toHaveAttribute('data-surface', 'light');

  await page.locator('[data-node="sources-button"]').click();
  const sheet = page.getByRole('dialog', { name: 'Sources' });
  await expect(sheet).toBeVisible();
  await expect(page.locator('[data-node="sources-sheet"]')).toHaveAttribute('data-surface', 'light');
  await expect(page.locator('[data-node="sources-sheet"]')).toContainText('SAMPLE');
  await expect(page.locator('[data-node="sources-sheet"]')).toContainText('wsdot.com');

  // Functional, not decorative: the reading surface really is lighter.
  const luminance = await page.evaluate(() => {
    const read = (selector: string) => {
      const style = getComputedStyle(document.querySelector(selector)!);
      const match = style.backgroundColor.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0'];
      const [r, g, b] = match.map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    return { sheet: read('[data-node="sources-sheet"]'), field: read('[data-node="world"]') };
  });
  expect(luminance.sheet).toBeGreaterThan(200);
  expect(luminance.field).toBeLessThan(60);
});

test('the centre stays gesture-gated: a sample place until the user says otherwise', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await page.addInitScript(() => {
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    (window as unknown as { __geo: unknown[] }).__geo = [];
    navigator.geolocation.getCurrentPosition = (success, error, options) => {
      (window as unknown as { __geo: unknown[] }).__geo.push(options);
      return original(success, error, options);
    };
  });
  await open(page);
  await openSignalField(page);

  expect(await page.evaluate(() => (window as unknown as { __geo: unknown[] }).__geo.length)).toBe(0);
  await expect(page.locator('[data-node="field-place-button"]')).toHaveAttribute('data-place-truth', 'inferred');
  await expect(page.locator('[data-node="field-place-button"]')).toContainText('sample place');

  await page.locator('[data-node="field-place-button"]').click();
  for (const place of ['Seattle', 'Bellevue', 'Tacoma', 'Everett']) {
    await expect(page.locator('[data-node="field-place-options"]')).toContainText(place);
  }
  await expect(page.locator('[data-node="field-use-location"]')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __geo: unknown[] }).__geo.length)).toBe(0);

  await page.locator('[data-node="news-place-tacoma"]').click();
  await expect(page.locator('[data-node="field-place"]')).toHaveText('Tacoma');
  await expect(page.locator('[data-node="field-place-button"]')).toHaveAttribute('data-place-truth', 'chosen');
});

test('the two-question budget holds on every route into a template', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);

  const budget = async () => (await page.evaluate(() => window.__canvasBrowser.state())).questionsAsked;

  // Route 1 — open news question: scope, horizon, then the world.
  await askRaw(page, NEWS_OPEN_PROMPT);
  await page.locator('[data-node="clarify-near-me"]').click();
  await page.locator('[data-node="clarify-now"]').click();
  await expect(page.locator('[data-node="signal-field"]')).toBeVisible();
  expect(await budget()).toBeLessThanOrEqual(2);

  // Route 2 — literal news answer, then the offer, then the world.
  await page.locator('[data-node="back-home"]').click();
  await askRaw(page, NEWS_LITERAL_PROMPT);
  await expect(page.locator('[data-node="news-offer"]')).toBeVisible();
  await page.locator('[data-node="offer-briefing"]').click();
  await expect(page.locator('[data-node="signal-field"]')).toBeVisible();
  expect(await budget()).toBeLessThanOrEqual(2);
  await expect(page.locator('[data-node="clarify"]')).toHaveCount(0);

  // Route 3 — travel: job, then origin inside the world. Both are graph-owned.
  await page.locator('[data-node="back-home"]').click();
  await askTravelResolved(page);
  expect(await budget()).toBe(1);
  await openPickup(page);
  expect(await budget()).toBe(2);
});

test('the Signal Field goes radial-to-vertical on a phone with no horizontal scroll', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await openSignalField(page);

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth
  }));
  expect(overflow.doc).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);

  // Signals stack by reach: full-width rows, running down the page.
  const boxes = Object.values(await signalBoxes(page));
  const xs = boxes.map((box) => box.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(1);
  expect(Math.max(...boxes.map((box) => box.y))).toBeGreaterThan(Math.min(...boxes.map((box) => box.y)));

  for (const node of ['layer-markets', 'sources-button', 'field-place-button']) {
    const box = await page.locator(`[data-node="${node}"]`).boundingBox();
    expect(box!.height, `${node} must stay reachable`).toBeGreaterThanOrEqual(44);
  }

  const ribbon = await page.locator('[data-node="briefing-ribbon"]').evaluate((el) => getComputedStyle(el).position);
  expect(ribbon).toBe('sticky');
  await expect(page.locator('[data-node="briefing-title"]')).toBeVisible();
});

test('Local News projects map anchors when a mobile view expands to desktop', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await openSignalField(page);
  await expect(page.locator('[data-node="field-map-frame"]')).toBeHidden();

  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(page.locator('[data-node="field-map-frame"]')).toBeVisible();
  await expect
    .poll(async () =>
      page.locator('[data-node="signal-i5-incident"]').evaluate((node) =>
        (node as HTMLElement).style.getPropertyValue('--x')
      )
    )
    .toMatch(/%$/);
  const aligned = await page.evaluate(() => {
    const signal = document.querySelector<HTMLElement>('[data-node="signal-i5-incident"]')!;
    const tether = document.querySelector<SVGLineElement>('[data-node="tether-i5-incident"]')!;
    return (
      Math.abs(Number.parseFloat(signal.style.getPropertyValue('--x')) - Number(tether.getAttribute('x1'))) <
        0.01 &&
      Math.abs(Number.parseFloat(signal.style.getPropertyValue('--y')) - Number(tether.getAttribute('y1'))) <
        0.01
    );
  });
  expect(aligned).toBe(true);
});

test('the forming Travel world does not overflow a phone', async ({ page }) => {
  await mockAgent(page, landedAnswer(), 1500);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await askTravel(page);

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth
  }));
  expect(overflow.doc).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);

  for (const node of ['hypothesis-track', 'hypothesis-pickup']) {
    const box = await page.locator(`[data-node="${node}"]`).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  }
});

/* ------------------------------------------------------------------------ */
/* The visual engine — decorative ground under a semantic world              */
/* ------------------------------------------------------------------------ */

interface FxReading {
  count: number;
  mode: string | null;
  ariaHidden: string | null;
  pointerEvents: string;
  zIndex: string;
  state: string | null;
  quality: string | null;
  frame: string | null;
}

async function readFx(page: Page): Promise<FxReading> {
  return page.evaluate(() => {
    const all = document.querySelectorAll<HTMLCanvasElement>('canvas.fx-canvas');
    const canvas = all[0] ?? null;
    const style = canvas ? getComputedStyle(canvas) : null;
    return {
      count: all.length,
      mode: canvas?.dataset.fxMode ?? null,
      ariaHidden: canvas?.getAttribute('aria-hidden') ?? null,
      pointerEvents: style?.pointerEvents ?? '',
      zIndex: style?.zIndex ?? '',
      state: canvas?.dataset.fxState ?? null,
      quality: canvas?.dataset.fxQuality ?? null,
      frame: canvas?.dataset.fxFrame ?? null
    };
  });
}

test('each world stands on exactly one decorative GPU canvas, behind everything', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);

  const home = await readFx(page);
  expect(home.count, 'home mounts one GPU canvas').toBe(1);
  expect(home.mode).toBe('home');
  expect(home.ariaHidden).toBe('true');
  expect(home.pointerEvents).toBe('none');
  expect(Number(home.zIndex)).toBe(0);
  const homeContentZ = await page
    .locator('.home-focus')
    .evaluate((node) => Number(getComputedStyle(node).zIndex));
  expect(homeContentZ).toBeGreaterThan(Number(home.zIndex));

  await askTravelResolved(page);
  await openPickup(page);
  const travel = await readFx(page);
  expect(travel.count, 'the pickup world mounts one GPU canvas').toBe(1);
  // The pickup world resolves to Journey by default, so the plane that is
  // mounted is the route plane. The Timeline lens mounts the terrain plane.
  expect(travel.mode).toBe('journey');
  expect(travel.ariaHidden).toBe('true');
  expect(travel.pointerEvents).toBe('none');

  await page.locator('[data-node="lens-timeline"]').click();
  const timeline = await readFx(page);
  expect(timeline.count, 'switching the lens never accumulates a canvas').toBe(1);
  expect(timeline.mode).toBe('travel');
  await page.locator('[data-node="lens-journey"]').click();

  // The warm decision envelope is never under the GPU layer.
  const envelopeClear = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.fx-canvas')!;
    const envelope = document.querySelector('[data-node="decision-envelope"], [data-node="unknown-envelope"]')!;
    return !canvas.contains(envelope) && !envelope.contains(canvas);
  });
  expect(envelopeClear).toBe(true);

  await page.locator('[data-node="back-home"]').click();
  await openSignalField(page);
  const news = await readFx(page);
  expect(news.count, 'the field mounts one GPU canvas').toBe(1);
  expect(news.mode).toBe('news');
  expect(news.ariaHidden).toBe('true');

  // Nothing decorative is announced or focusable, in any world.
  await expect(page.locator('canvas[aria-hidden="false"]')).toHaveCount(0);
  await expect(page.locator('canvas[tabindex]')).toHaveCount(0);
});

test('the GPU layer never accumulates: one canvas survives a full round trip', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);

  for (let pass = 0; pass < 2; pass++) {
    await askTravelResolved(page);
    await openPickup(page);
    expect((await readFx(page)).mode).toBe('journey');
    await page.locator('[data-node="back-home"]').click();
    await expect(page.locator('[data-node="home-prompt"]')).toBeVisible();
    expect((await readFx(page)).mode).toBe('home');
    await openSignalField(page);
    expect((await readFx(page)).mode).toBe('news');
    await page.locator('[data-node="back-home"]').click();
    await expect(page.locator('[data-node="home-prompt"]')).toBeVisible();
  }

  const final = await readFx(page);
  expect(final.count, 'exactly one canvas is ever mounted').toBe(1);
  expect(final.mode).toBe('home');
});

test('reduced motion renders one still frame and starts no animation loop', async ({ page }) => {
  await page.goto('/?motion=off');
  await page.waitForSelector('body[data-canvas-browser-ready="true"]');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');

  const still = await readFx(page);
  expect(still.count).toBe(1);
  expect(still.state, 'a still surface says so').toBe('static');

  // A still surface stays still: no frame is drawn while nothing changes.
  const before = still.frame;
  await page.waitForTimeout(1200);
  const after = (await readFx(page)).frame;
  expect(after).toBe(before);

  // Full motion is the default — but Home has no scenario, so there is nothing
  // for it to be *about*. It settles into a still latent field and stops the
  // loop, and the machine-readable list of active motion is empty.
  await open(page);
  const live = await readFx(page);
  if (live.quality !== 'none') {
    await expect
      .poll(async () => (await readFx(page)).state, { timeout: 4000 })
      .toBe('static');
    expect(await page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas.fx-canvas')!.dataset.fxActiveMotion)).toBe('');
    const settled = (await readFx(page)).frame;
    await page.waitForTimeout(900);
    expect((await readFx(page)).frame, 'an idle Home draws no frames at all').toBe(settled);

    // The pointer is a thing that is actually happening, so it still redraws.
    await page.mouse.move(300, 300);
    await page.mouse.move(700, 420);
    await expect
      .poll(async () => Number((await readFx(page)).frame), { timeout: 2000 })
      .toBeGreaterThan(Number(settled));
  }
});

test('a phone keeps the GPU layer inside the world, with no horizontal overflow', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await openSignalField(page);

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth
  }));
  expect(overflow.doc).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);

  const bounded = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.fx-canvas')!;
    const rect = canvas.getBoundingClientRect();
    return { right: rect.right, width: rect.width };
  });
  expect(bounded.right).toBeLessThanOrEqual(391);
  expect(bounded.width).toBeGreaterThan(0);
});

/* ------------------------------------------------------------------------ */
/* Gateway hardening                                                         */
/* ------------------------------------------------------------------------ */

test('the loopback gateway rejects rebound hosts and foreign origins', () => {
  const port = 4173;
  const demo = { 'x-canvas-browser-demo': '1' };

  // The same-origin demo, which must keep working.
  expect(checkLoopbackRequest({ host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, ...demo }, port).ok).toBe(
    true
  );
  expect(checkLoopbackRequest({ host: `localhost:${port}`, origin: `http://localhost:${port}`, ...demo }, port).ok).toBe(
    true
  );
  // A same-origin GET with no Origin header is normal.
  expect(checkLoopbackRequest({ host: `127.0.0.1:${port}`, ...demo }, port).ok).toBe(true);

  // DNS rebinding: the browser still resolves to 127.0.0.1, but says so.
  for (const host of [`attacker.example.com:${port}`, `evil.localhost:${port}`, '127.0.0.1', `127.0.0.1:${port + 1}`, '']) {
    const result = checkLoopbackRequest({ host, origin: `http://127.0.0.1:${port}`, ...demo }, port);
    expect(result.ok, `host "${host}" must be rejected`).toBe(false);
    expect(result.status).toBe(403);
  }

  // Cross-site drive-by from a real page.
  for (const origin of ['http://evil.example.com', `https://127.0.0.1:${port}`, 'null', `http://127.0.0.1:${port + 1}`]) {
    const result = checkLoopbackRequest({ host: `127.0.0.1:${port}`, origin, ...demo }, port);
    expect(result.ok, `origin "${origin}" must be rejected`).toBe(false);
    expect(result.status).toBe(403);
  }

  // The demo header is still required.
  expect(checkLoopbackRequest({ host: `127.0.0.1:${port}` }, port).ok).toBe(false);

  // And every response carries the hardening headers.
  const headers = securityHeaders();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['cross-origin-resource-policy']).toBe('same-origin');
});

test('the running gateway enforces the host check on the wire', async () => {
  const port = 4179;
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), CANVAS_DIST_DIR: 'dist-test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15_000);
    server.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('http://')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on('error', reject);
  });

  const call = (headers: Record<string, string>, path = '/api/health'): Promise<number> =>
    new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });

  try {
    await ready;
    expect(await call({ host: `127.0.0.1:${port}`, 'x-canvas-browser-demo': '1' })).toBe(200);
    expect(await call({ host: `rebound.example.com:${port}`, 'x-canvas-browser-demo': '1' })).toBe(403);
    expect(
      await call({ host: `127.0.0.1:${port}`, origin: 'http://evil.example.com', 'x-canvas-browser-demo': '1' })
    ).toBe(403);
    expect(await call({ host: `127.0.0.1:${port}` })).toBe(403);
    // Static serving is untouched by the API guard.
    expect(await call({ host: `rebound.example.com:${port}` }, '/')).toBe(200);
  } finally {
    server.kill();
  }
});

test('artifacts stay separated: the test API exists only in the test build', async () => {
  const root = process.cwd();
  const distTest = join(root, 'dist-test', 'assets');
  expect(existsSync(distTest), 'dist-test must exist — the Playwright webServer builds it').toBe(true);
  const testBundle = readdirSync(distTest)
    .filter((file) => file.endsWith('.js'))
    .map((file) => readFileSync(join(distTest, file), 'utf8'))
    .join('\n');
  expect(testBundle).toContain('__canvasBrowser');

  if (!existsSync(join(root, 'dist', 'index.html'))) {
    execSync('npx vite build', { cwd: root, stdio: 'ignore' });
  }
  const distProd = join(root, 'dist', 'assets');
  const prodBundle = readdirSync(distProd)
    .filter((file) => file.endsWith('.js'))
    .map((file) => readFileSync(join(distProd, file), 'utf8'))
    .join('\n');
  expect(prodBundle).not.toContain('__canvasBrowser');
  expect(prodBundle).not.toContain('installTestApi');
});

/* ------------------------------------------------------------------------ */
/* The adaptive refresh policy — pure, and exact at every boundary            */
/* ------------------------------------------------------------------------ */

const HOUR = 60 * 60_000;
const NOW = Date.UTC(2026, 3, 12, 18, 0, 0);

test('uncited landing prose can never commit an actual landing', () => {
  const reading = parseFlightAnswer({
    answer: `EVA Air BR26 landed at ${clockLabel(-4)} at SEA.`,
    nowMs: Date.now(),
    flightLabel: 'EVA Air BR26',
    retrievedAt: new Date().toISOString()
  });

  expect(reading.status).toBe('unknown');
  expect(reading.actualLandingMs).toBeNull();
  expect(reading.truth).toBe('unknown');
  expect(reading.note).toContain('without a claim-level citation');
});

test('the refresh policy is exact at every boundary it claims', () => {
  // More than two hours out: an hourly glance is enough.
  expect(
    computeRefreshPolicy({
      nowMs: NOW,
      phase: 'scheduled',
      scheduledArrivalMs: NOW + 3 * HOUR,
      estimatedArrivalMs: null,
      actualLandingMs: null,
      curbReadyEndMs: null
    })
  ).toMatchObject({ urgency: 'hourly', intervalMs: 60 * 60_000, nextRefreshMs: NOW + 60 * 60_000 });

  // Exactly two hours is *inside* two hours: 15 minutes.
  const atTwo = computeRefreshPolicy({
    nowMs: NOW,
    phase: 'enroute',
    scheduledArrivalMs: NOW + 2 * HOUR,
    estimatedArrivalMs: null,
    actualLandingMs: null,
    curbReadyEndMs: null
  });

  expect(atTwo.urgency).toBe('quarter-hourly');
  expect(atTwo.intervalMs).toBe(15 * 60_000);

  // A second past two hours falls back to hourly — the boundary is real.
  expect(
    computeRefreshPolicy({
      nowMs: NOW,
      phase: 'enroute',
      scheduledArrivalMs: NOW + 2 * HOUR + 1000,
      estimatedArrivalMs: null,
      actualLandingMs: null,
      curbReadyEndMs: null
    }).urgency
  ).toBe('hourly');

  // Between one and two hours: still 15 minutes.
  expect(
    computeRefreshPolicy({
      nowMs: NOW,
      phase: 'enroute',
      scheduledArrivalMs: NOW + 2 * HOUR,
      estimatedArrivalMs: NOW + 90 * 60_000,
      actualLandingMs: null,
      curbReadyEndMs: null
    })
  ).toMatchObject({ urgency: 'quarter-hourly' });

  // Exactly one hour is *inside* an hour: 5 minutes.
  const atOne = computeRefreshPolicy({
    nowMs: NOW,
    phase: 'enroute',
    scheduledArrivalMs: null,
    estimatedArrivalMs: NOW + HOUR,
    actualLandingMs: null,
    curbReadyEndMs: null
  });
  expect(atOne.urgency).toBe('five-minute');
  expect(atOne.intervalMs).toBe(5 * 60_000);
  expect(atOne.reason).toContain('estimated arrival');

  // On the ground with the curb window still ahead: 5 minutes.
  expect(
    computeRefreshPolicy({
      nowMs: NOW,
      phase: 'landed',
      scheduledArrivalMs: NOW - 30 * 60_000,
      estimatedArrivalMs: null,
      actualLandingMs: NOW - 6 * 60_000,
      curbReadyEndMs: NOW + 40 * 60_000
    })
  ).toMatchObject({ urgency: 'five-minute', reason: 'they are on the ground and moving through the airport' });

  // The trip is done: the world stops watching entirely.
  const done = computeRefreshPolicy({
    nowMs: NOW,
    phase: 'at-gate',
    scheduledArrivalMs: null,
    estimatedArrivalMs: null,
    actualLandingMs: NOW - 2 * HOUR,
    curbReadyEndMs: NOW - 60_000
  });
  expect(done.urgency).toBe('stopped');
  expect(done.intervalMs).toBe(0);
  expect(done.nextRefreshMs).toBeNull();
  expect(describeCadence(done)).toContain('not checking again');

  // Nothing known at all is itself a reason to look often.
  expect(
    computeRefreshPolicy({
      nowMs: NOW,
      phase: 'unknown',
      scheduledArrivalMs: null,
      estimatedArrivalMs: null,
      actualLandingMs: null,
      curbReadyEndMs: null
    })
  ).toMatchObject({ urgency: 'quarter-hourly', reason: 'no arrival time is established yet' });
});

test('the cadence sentence names the interval and the reason', () => {
  const policy = computeRefreshPolicy({
    nowMs: NOW,
    phase: 'enroute',
    scheduledArrivalMs: null,
    estimatedArrivalMs: NOW + 90 * 60_000,
    actualLandingMs: null,
    curbReadyEndMs: null
  });
  expect(describeCadence(policy)).toBe('every 15 min because the estimated arrival is inside two hours');
});

/* ------------------------------------------------------------------------ */
/* The refresh controller — one timer, cancelled and resumed honestly        */
/* ------------------------------------------------------------------------ */

async function readRefresh(page: Page) {
  return page.evaluate(() => window.__canvasBrowser.state().refresh);
}

test('the pickup world watches itself: one timer, a stated cadence, and a reason', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);

  const refresh = await readRefresh(page);
  expect(refresh.active, 'an open pickup world is being watched').toBe(true);
  expect(refresh.urgency).toBe('five-minute');
  expect(refresh.intervalMs).toBe(5 * 60_000);
  expect(refresh.armedTimers, 'exactly one scheduler is ever armed').toBe(1);

  // The world says what it did, when it will look again, and why.
  const status = page.locator('[data-node="refresh-status"]');
  await expect(status).toContainText(/Checked \d{1,2}:\d{2}/);
  await expect(status).toContainText(/next in \d+ min/);
  await expect(status).toContainText('every 5 min because they are on the ground');
  await expect(page.locator('[data-node="refresh-dial"]')).toHaveCount(1);

  // It stays secondary: the envelope is still the dominant type on the page.
  const sizes = await page.evaluate(() => ({
    status: parseFloat(getComputedStyle(document.querySelector('[data-node="situation-now"]')!).fontSize),
    envelope: parseFloat(getComputedStyle(document.querySelector('[data-node="envelope-primary"]')!).fontSize)
  }));
  expect(sizes.envelope).toBeGreaterThan(sizes.status * 1.5);
});

test('leaving the world cancels the schedule, and only one scheduler ever exists', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);
  expect((await readRefresh(page)).armedTimers).toBe(1);

  // Re-entering the world repeatedly must not stack timers.
  for (let pass = 0; pass < 3; pass++) {
    await page.locator('[data-node="back-home"]').click();
    await expect(page.locator('[data-node="home-prompt"]')).toBeVisible();
    const stopped = await readRefresh(page);
    expect(stopped.active, 'leaving the view cancels the watch').toBe(false);
    expect(stopped.armedTimers, 'no timer survives Start over').toBe(0);

    await askTravelResolved(page);
    await openPickup(page);
    expect((await readRefresh(page)).armedTimers, 'still exactly one').toBe(1);
  }
});

test('a hidden tab parks the schedule and catches up the moment it returns', async ({ page }) => {
  // A controllable clock, so a five-minute cadence can be observed in a test
  // without waiting five minutes. No live model is involved either way.
  await page.clock.install();
  const agent = await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);
  const callsBefore = agent.get();
  expect((await readRefresh(page)).urgency).toBe('five-minute');

  // Hidden: the timer is disarmed rather than left polling in the background.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const parked = await readRefresh(page);
  expect(parked.armedTimers, 'nothing is armed while the tab is away').toBe(0);
  expect(parked.paused).toBe(true);

  // Six minutes pass off-screen, so the five-minute check comes due.
  await page.clock.fastForward('06:00');
  expect(agent.get(), 'a hidden tab does not poll').toBe(callsBefore);

  // Coming back does the overdue check immediately, then re-arms once.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => agent.get(), { timeout: 5000 }).toBe(callsBefore + 1);
  await expect.poll(async () => (await readRefresh(page)).armedTimers).toBe(1);
  expect((await readRefresh(page)).paused).toBe(false);
});

test('a manual re-check resets the schedule instead of stacking on it', async ({ page }) => {
  await mockAgent(page, ENROUTE_ANSWER);
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);

  const before = await readRefresh(page);
  expect(before.urgency).toBe('quarter-hourly');

  await page.locator('[data-node="recheck"]').click();
  await waitForResearch(page);

  const after = await readRefresh(page);
  expect(after.armedTimers, 'a manual look replaces the timer, never adds one').toBe(1);
  expect(after.checks).toBe(before.checks + 1);
  expect(after.lastCheckedMs!).toBeGreaterThanOrEqual(before.lastCheckedMs!);
});

test('a refresh answer from a dead session can never overwrite the world', async ({ page }) => {
  await mockAgent(page, landedAnswer(), 1500);
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);

  // Start a refresh, then leave the world before it can land.
  const pending = page.evaluate(() => window.__canvasBrowser.tickRefresh());
  await page.locator('[data-node="back-home"]').click();
  await expect(page.locator('[data-node="home-prompt"]')).toBeVisible();
  await pending;
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.view, 'the stale answer does not drag the user back into a world').toBe('home');
  expect(state.chosenJob).toBeNull();
  expect(state.refresh.armedTimers).toBe(0);
});

/* ------------------------------------------------------------------------ */
/* Weather and traffic — forces over the world, not cards beside it          */
/* ------------------------------------------------------------------------ */

test('the world stands in weather and traffic, tagged SAMPLE and drawn as layers', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);
  await page.locator('[data-node="choose-place"]').click();
  await page.locator('[data-node="origin-bellevue"]').click();

  // One compact situation line, not a panel.
  const situation = page.locator('[data-node="situation-now"]');
  await expect(situation).toContainText('On the ground');
  await expect(page.locator('[data-node="situation-weather"]')).toContainText('SAMPLE');
  await expect(page.locator('[data-node="situation-traffic"]')).toContainText(/Traffic (light|moderate|heavy|severe)/);

  // The forces are layers over the world, each with exactly one label.
  await expect(page.locator('[data-node="weather-layer"]')).toHaveCount(1);
  await expect(page.locator('[data-node="traffic-layer"]')).toHaveCount(1);
  await expect(page.locator('[data-node="weather-label"]')).toContainText('SAMPLE');
  await expect(page.locator('[data-node="traffic-label"]')).toContainText('I-405');
  await expect(page.locator('[data-node="traffic-label"]')).toContainText('SAMPLE');

  // Layers live inside the world, under the semantic bands — never cards.
  const inside = await page.evaluate(() => {
    const world = document.querySelector('[data-node="world"]')!;
    return {
      weather: world.contains(document.querySelector('[data-node="weather-layer"]')),
      traffic: world.contains(document.querySelector('[data-node="traffic-layer"]')),
      weatherZ: Number(getComputedStyle(document.querySelector('[data-node="weather-layer"]')!).zIndex),
      bandZ: Number(getComputedStyle(document.querySelector('[data-node="pipeline"]')!).zIndex)
    };
  });
  expect(inside.weather).toBe(true);
  expect(inside.traffic).toBe(true);
  expect(inside.weatherZ).toBeLessThanOrEqual(inside.bandZ);

  // The evidence sheet names the authority behind each force.
  await page.locator('[data-node="sources-button"]').click();
  const sheet = page.locator('[data-node="sources-sheet"]');
  await expect(sheet).toContainText('weather.gov');
  await expect(sheet).toContainText('wsdot.com');
  await expect(sheet).toContainText('open-meteo.com');
  await expect(sheet).toContainText('SAMPLE DATA');
  await expect(sheet).toContainText(/checked \d{1,2}:\d{2}/);
});

test('hiding a layer hides the drawing, never its effect on the plan', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);
  await page.locator('[data-node="choose-place"]').click();
  await page.locator('[data-node="origin-bellevue"]').click();

  const before = await page.evaluate(() => window.__canvasBrowser.plan());
  await page.locator('[data-node="layer-traffic"]').click();

  await expect(page.locator('[data-node="traffic-layer"]')).toHaveCount(0);
  await expect(page.locator('[data-node="traffic-label"]')).toHaveCount(0);
  await expect(page.locator('[data-node="layer-note"]')).toContainText('hides the drawing, not its effect');

  const after = await page.evaluate(() => window.__canvasBrowser.plan());
  expect(after!.travel!.driveMinutes, 'reality cannot be hidden from the computation').toEqual(
    before!.travel!.driveMinutes
  );
  expect(after!.envelope!.lotWindow).toEqual(before!.envelope!.lotWindow);
});

test('traffic moves the drive and the leave envelope; weather widens a named segment', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);
  await page.locator('[data-node="choose-place"]').click();
  await page.locator('[data-node="origin-bellevue"]').click();

  const before = await page.evaluate(() => window.__canvasBrowser.plan());
  const beforeConditions = await page.evaluate(() => window.__canvasBrowser.state().conditions);

  // The fixture drive range is visible under the traffic that moved it.
  expect(before!.travel!.baseDriveMinutes).toEqual({ min: 26, max: 46 });
  expect(before!.travel!.driveMinutes.max).toBe(46 + beforeConditions!.trafficDelay.max);
  await expect(page.locator('[data-node="envelope-conditions"]')).toContainText(/\+\d+–\d+ min traffic/);

  // Advance to the next SAMPLE step: heavier traffic and rain.
  await page.evaluate(() => window.__canvasBrowser.tickRefresh());
  await expect
    .poll(async () => page.evaluate(() => window.__canvasBrowser.state().conditions!.trafficLevel))
    .toBe('heavy');

  const after = await page.evaluate(() => window.__canvasBrowser.plan());
  const afterConditions = await page.evaluate(() => window.__canvasBrowser.state().conditions);
  expect(afterConditions!.weatherKind).toBe('rain');
  expect(afterConditions!.weatherWidenMinutes).toBe(5);

  // Traffic widened the drive. If the ideal departure is still ahead it moves
  // earlier; once the plan is already late, "leave now" stays pinned to now
  // and the achievable Cell Phone Lot arrival widens instead.
  expect(after!.travel!.driveMinutes.max).toBeGreaterThan(before!.travel!.driveMinutes.max);
  if (before!.travel!.lateForIdealWindow) {
    expect(after!.travel!.lateForIdealWindow).toBe(true);
    expect(after!.travel!.arrivalWindow.endMs).toBeGreaterThan(before!.travel!.arrivalWindow.endMs);
  } else {
    expect(after!.travel!.departByMs).toBeLessThan(before!.travel!.departByMs);
  }

  // Weather widened exactly one named segment, by exactly the stated amount.
  const curbBefore = before!.segments.find((s) => s.id === 'curb')!;
  const curbAfter = after!.segments.find((s) => s.id === 'curb')!;
  expect(curbAfter.duration.max - curbBefore.duration.max).toBe(5);
  expect(curbAfter.duration.min).toBe(curbBefore.duration.min);
  expect(curbAfter.method).toContain('widened 5 min');
  expect(after!.envelope!.curbWindow.endMs).toBeGreaterThan(before!.envelope!.curbWindow.endMs);

  // And the envelope says so, in the world, with no chat transcript anywhere.
  const notes = page.locator('[data-node="envelope-conditions"]');
  await expect(notes).toContainText('steady rain widens');
  await expect(notes).toContainText('by 5 min');
  await expect(page.locator('[data-node="literal-answer"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__canvasBrowser.state().view)).toBe('terrain');
});

test('an en-route world resolves in place on refresh, and the cadence tightens 15m → 5m', async ({ page }) => {
  // The first look says en route; the next one says it is down.
  let calls = 0;
  await page.route('**/api/agent', async (route) => {
    calls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answer: calls === 1 ? ENROUTE_ANSWER : landedAnswer(),
        model: 'gpt-5.6-sol',
        contextTier: 'long_context',
        reasoningEffort: 'medium',
        retrievedAt: new Date().toISOString()
      })
    });
  });

  await open(page);
  await askTravelResolved(page);
  await openPickup(page);

  await expect(page.locator('[data-node="unknown-envelope"]')).toContainText('Not enough to commit yet');
  const enroute = await readRefresh(page);
  expect(enroute.urgency, 'nothing known yet is watched every 15 minutes').toBe('quarter-hourly');
  expect(await page.evaluate(() => window.__canvasBrowser.state().flightPhase)).toBe('enroute');

  await page.evaluate(() => window.__canvasBrowser.tickRefresh());

  // The same world resolves in place — no trip back to prose.
  await expect(page.locator('[data-node="decision-envelope"]')).toBeVisible();
  await expect(page.locator('[data-node="unknown-envelope"]')).toHaveCount(0);
  await expect(page.locator('[data-node="literal-answer"]')).toHaveCount(0);
  await expect(page.locator('[data-node="situation-phase"]')).toHaveText('On the ground');

  const landed = await readRefresh(page);
  expect(landed.urgency, 'processing at the airport is watched every 5 minutes').toBe('five-minute');
  expect(landed.intervalMs).toBe(5 * 60_000);
  expect(landed.armedTimers).toBe(1);
  expect(await page.evaluate(() => window.__canvasBrowser.state().view)).toBe('terrain');
});

/* ------------------------------------------------------------------------ */
/* Scenario-driven motion                                                    */
/* ------------------------------------------------------------------------ */

async function readTravelFx(page: Page) {
  return page.evaluate(() => {
    // Travel and Journey are the same situation seen two ways, and both
    // publish the readings that drive them.
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas.fx-canvas[data-fx-mode="journey"], canvas.fx-canvas[data-fx-mode="travel"]'
    );
    if (!canvas) return null;
    const d = canvas.dataset;
    return {
      mode: canvas.dataset.fxMode ?? null,
      phase: Number(d.fxFlightPhase),
      progress: Number(d.fxFlightProgress),
      weather: Number(d.fxWeather),
      wind: d.fxWind ?? '',
      traffic: Number(d.fxTraffic),
      trend: Number(d.fxTrafficTrend),
      urgency: Number(d.fxRefreshUrgency),
      routeKnown: d.fxRouteKnown ?? null,
      routeProgress: d.fxRouteProgress ?? null,
      state: d.fxState ?? null
    };
  });
}

test('the Travel canvas is driven by the situation, not by taste', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page);
  await openPickup(page);

  const first = (await readTravelFx(page))!;
  expect(first.phase, 'on the ground pushes the dominant pulse down the horizon').toBeGreaterThan(0.5);
  expect(first.urgency, 'a five-minute cadence is the fastest scan').toBe(1);
  expect(first.traffic).toBeGreaterThan(0);
  expect(first.wind).toMatch(/^-?\d+\.\d{2},-?\d+\.\d{2}$/);

  // Advance the world: heavier traffic and rain must move the uniforms.
  await page.evaluate(() => window.__canvasBrowser.tickRefresh());
  await expect
    .poll(async () => page.evaluate(() => window.__canvasBrowser.state().conditions!.trafficLevel))
    .toBe('heavy');

  const second = (await readTravelFx(page))!;
  expect(second.traffic, 'flow density follows congestion').toBeGreaterThan(first.traffic);
  expect(second.weather, 'atmospheric density follows the weather projection').toBeGreaterThan(first.weather);
  expect(second.trend, 'building traffic reads as building').toBe(1);
  expect(second.wind).not.toBe(first.wind);

  // The News world carries none of these: they are Travel's own data.
  await page.locator('[data-node="back-home"]').click();
  await openSignalField(page);
  const newsData = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.fx-canvas')!;
    return { mode: canvas.dataset.fxMode, traffic: canvas.dataset.fxTraffic ?? null };
  });
  expect(newsData.mode).toBe('news');
  expect(newsData.traffic).toBeNull();

  // The animation is explained in words, so nobody has to guess — and the
  // words list what is moving *now*, not what the template could ever do.
  await page.locator('[data-node="back-home"]').click();
  await askTravelResolved(page);
  await openPickup(page);
  const legend = page.locator('[data-node="motion-legend"]');
  await expect(legend).toContainText('the corridor dashes drift because traffic is flowing');
  await expect(legend).toContainText('Coordinates, routes and markers hold still');
  // The flight is on the ground and the check was just made, so neither is
  // claimed as motion.
  await expect(legend).not.toContainText('still in the air');
  await expect(legend).not.toContainText('the next check is due now');
});

test('reduced motion keeps the situation data and still draws no loop', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await page.goto('/?motion=off');
  await page.waitForSelector('body[data-canvas-browser-ready="true"]');
  await askTravelResolved(page);
  await openPickup(page);

  const fx = (await readTravelFx(page))!;
  expect(fx.state, 'a still world says so').toBe('static');
  expect(fx.traffic, 'the data is still published, it simply does not animate').toBeGreaterThan(0);

  const before = await page.evaluate(
    () => document.querySelector<HTMLCanvasElement>('canvas.fx-canvas')!.dataset.fxFrame
  );
  await page.waitForTimeout(900);
  const after = await page.evaluate(
    () => document.querySelector<HTMLCanvasElement>('canvas.fx-canvas')!.dataset.fxFrame
  );
  expect(after).toBe(before);
});

/* ------------------------------------------------------------------------ */
/* The real map base                                                         */
/* ------------------------------------------------------------------------ */

/**
 * The Journey World is drawn over Bing Maps, so a person sees the actual
 * streets they are about to drive. Everything below is about the *contract*
 * around that frame — the URL is built locally from coordinates, the host is
 * fixed, the frame is sandboxed and referrer-free, and the world still reads
 * when the base cannot load. The suite never lets the request leave.
 */
async function readBaseFrame(page: Page) {
  return page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-node="map-base"]');
    if (!frame) return null;
    const region = document.querySelector<HTMLElement>('[data-node="journey-map"]')!;
    const plane = document.querySelector<HTMLElement>('[data-node="journey-plane"]')!;
    const overlay = document.querySelector<HTMLElement>('.map-overlay')!;
    return {
      src: frame.getAttribute('src') ?? '',
      title: frame.getAttribute('title') ?? '',
      sandbox: frame.getAttribute('sandbox') ?? '',
      referrer: frame.getAttribute('referrerpolicy') ?? '',
      loading: frame.getAttribute('loading') ?? '',
      pointerEvents: getComputedStyle(frame).pointerEvents,
      insideFrame: Boolean(document.querySelector('.map-frame')?.contains(frame)),
      baseState: region.dataset.baseState ?? '',
      z: {
        base: Number(getComputedStyle(frame).zIndex),
        plane: Number(getComputedStyle(plane).zIndex),
        overlay: Number(getComputedStyle(overlay).zIndex)
      }
    };
  });
}

test('the Journey world is drawn over a real, sandboxed Bing Maps base', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);
  await setOrigin(page);

  const frame = (await readBaseFrame(page))!;
  expect(frame, 'the map has a real base').not.toBeNull();

  // Exactly one host, exactly one path, over https, with no credentials.
  const url = new URL(frame.src);
  expect(url.protocol).toBe('https:');
  expect(url.hostname).toBe('www.bing.com');
  expect(url.pathname).toBe('/maps/embed');
  expect(url.username).toBe('');
  expect(url.searchParams.get('cp')).toMatch(/^47\.\d+~-122\.\d+$/);
  expect(Number(url.searchParams.get('lvl'))).toBeGreaterThanOrEqual(8);
  // A route exists, so the base carries the route itself.
  expect(url.searchParams.get('rtp')).toMatch(/^pos\.47\.\d+_-122\.\d+~pos\.47\.\d+_-122\.\d+$/);
  // No key, no token, nothing that could be a credential.
  expect(frame.src).not.toMatch(/key=|token=|apikey/i);

  expect(frame.title).toBe('Bing Maps route base');
  expect(frame.sandbox).toContain('allow-scripts');
  expect(frame.sandbox).not.toContain('allow-top-navigation');
  expect(frame.sandbox).not.toContain('allow-forms');
  expect(frame.referrer).toBe('no-referrer');
  expect(frame.pointerEvents, 'the projected overlay requires a fixed viewport').toBe('none');
  expect(frame.insideFrame, 'the base lives inside the map frame').toBe(true);

  // Bottom to top: base, then CanvasBrowser's annotation, then its labels.
  expect(frame.z.base).toBeLessThan(frame.z.plane);
  expect(frame.z.plane).toBeLessThan(frame.z.overlay);

  // The base names itself, and hands off to the real map in a new tab.
  const note = page.locator('[data-node="map-base-note"]');
  await expect(note).toContainText('Static Bing Maps base');
  const open_ = page.locator('[data-node="map-base-open"]');
  await expect(open_).toHaveText('Open full map to pan / zoom');
  await expect(open_).toHaveAttribute('target', '_blank');
  await expect(open_).toHaveAttribute('rel', /noopener/);
  await expect(open_).toHaveAttribute('rel', /noreferrer/);
  expect(await open_.getAttribute('href')).toMatch(/^https:\/\/www\.bing\.com\/maps\?/);

  // And the world above it is still CanvasBrowser's own annotation.
  await expect(page.locator('[data-node="map-stamp"]')).toContainText('SAMPLE MAP');
  await expect(page.locator('[data-node="map-stamp"]')).toContainText('Bing Maps geography');
  await expect(page.locator('[data-node="route-main"]')).toHaveCount(1);
});

test('with no origin the base still lands on SEA and its cell phone lot', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);

  await expect(page.locator('[data-node="journey-map"]')).toHaveAttribute('data-route', 'unknown');
  await expect(page.locator('[data-node="journey-map"]')).toHaveAttribute('data-base', 'airport');

  const frame = (await readBaseFrame(page))!;
  const url = new URL(frame.src);
  expect(url.hostname).toBe('www.bing.com');
  // No origin, so no route is drawn on the base — but the geography is real,
  // centred between the airport and the lot rather than invented.
  expect(url.searchParams.get('rtp')).toBeNull();
  const [lat, lon] = url.searchParams.get('cp')!.split('~').map(Number);
  expect(Math.abs(lat - 47.443), 'centred on SEA').toBeLessThan(0.02);
  expect(Math.abs(lon + 122.302)).toBeLessThan(0.02);
  await expect(page.locator('[data-node="map-base-note"]')).toContainText('Bing Maps base');
});

test('a base that cannot load leaves the illustrative overlay, and says so', async ({ page, context }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);
  await setOrigin(page);

  await context.setOffline(true);
  // Any re-render while offline states the fallback rather than blanking.
  await page.locator('[data-node="add-stop-coffee"]').click();
  await expect(page.locator('[data-node="journey-map"]')).toHaveAttribute('data-base-state', 'unavailable');
  await expect(page.locator('[data-node="map-base-fallback"]')).toBeVisible();
  await expect(page.locator('[data-node="map-base-fallback"]')).toContainText(
    'Bing Maps unavailable · illustrative overlay'
  );

  // The world is not blank: the route, the anchors and the legend all stand.
  await expect(page.locator('[data-node="route-main"]')).toHaveCount(1);
  await expect(page.locator('[data-node="waypoint-lot"]')).toBeVisible();
  const landOpacity = await page
    .locator('.map-land')
    .evaluate((node) => Number(getComputedStyle(node).opacity));
  expect(landOpacity, 'the illustrative relief comes back up when it is the only map').toBeGreaterThan(0.9);
  await context.setOffline(false);
});

test('the demo document may frame Bing and nothing else', () => {
  const csp = documentHeaders()['content-security-policy'];
  const directives = Object.fromEntries(
    csp.split('; ').map((part) => {
      const [name, ...values] = part.split(' ');
      return [name, values];
    })
  );

  expect(directives['frame-src']).toEqual(["'self'", 'https://www.bing.com', 'https://*.bing.com']);
  // The relaxation is exactly one directive wide. Nothing else opened up.
  expect(directives['script-src']).toEqual(["'self'"]);
  expect(directives['connect-src']).toEqual(["'self'"]);
  expect(directives['object-src']).toEqual(["'none'"]);
  expect(directives['form-action']).toEqual(["'none'"]);
  expect(directives['base-uri']).toEqual(["'none'"]);
  expect(directives['frame-ancestors']).toEqual(["'none'"]);
  expect(csp).not.toContain('unsafe-eval');
});

test('the base URL is built locally, and nothing else can become a frame src', () => {
  // A route: both ends, and a zoom that holds them.
  const withRoute = bingBase({ lat: 47.6101, lon: -122.2015 });
  expect(isAllowedBingEmbed(withRoute.embedUrl)).toBe(true);
  expect(withRoute.kind).toBe('route');
  expect(withRoute.embedUrl).toContain('rtp=pos.47.6101_-122.2015~pos.47.4356_-122.2960');
  expect(withRoute.viewUrl.startsWith('https://www.bing.com/maps?')).toBe(true);

  // No origin: the half of the world that is known, and no invented start.
  const airport = bingBase(null);
  expect(isAllowedBingEmbed(airport.embedUrl)).toBe(true);
  expect(airport.kind).toBe('airport');
  expect(airport.embedUrl).not.toContain('rtp=');

  // Coordinates are clamped before any arithmetic and rounded to ~10 m, so no
  // nonsense fix — and no spurious precision — can reach a URL.
  const wild = bingBase({ lat: 999, lon: -999 });
  expect(wild.embedUrl).toContain('cp=68.7178~-151.1480');
  expect(wild.embedUrl).toContain('rtp=pos.90.0000_-180.0000~');
  expect(isAllowedBingEmbed(wild.embedUrl)).toBe(true);

  // The gate refuses everything that is not the one embed endpoint.
  for (const hostile of [
    'http://www.bing.com/maps/embed?cp=1~1',
    'https://evil.com/maps/embed?cp=1~1',
    'https://www.bing.com.evil.com/maps/embed',
    'https://www.bing.com/search?q=x',
    'https://user:pass@www.bing.com/maps/embed',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    ''
  ]) {
    expect(isAllowedBingEmbed(hostile), hostile).toBe(false);
  }
});

/* ------------------------------------------------------------------------ */
/* The Bing-aligned overlay: the map is a map, not a diagram of one           */
/* ------------------------------------------------------------------------ */

/**
 * The overlay used to be a schematic *fitted* to the frame: it filled the box
 * beautifully and put the SEA Cell Phone Lot out past Vashon Island. These
 * tests hold the fix — every drawn thing is projected through Bing's own Web
 * Mercator viewport, from the same centre, zoom and 1200 × height render the
 * embed URL asks for, so a dot is where the place is.
 */

/** Bellevue → the cell lot: the base every alignment test stands on. */
const BELLEVUE = { lat: 47.6101, lon: -122.2015 };

async function alignedOverlay(page: Page) {
  return page.evaluate(() => {
    const region = document.querySelector<HTMLElement>('[data-node="journey-map"]')!;
    const read = (node: string): { x: number; y: number } | null => {
      const marker = document.querySelector<HTMLElement>(`[data-node="${node}"]`);
      if (!marker) return null;
      return {
        x: Number.parseFloat(marker.style.getPropertyValue('--x')),
        y: Number.parseFloat(marker.style.getPropertyValue('--y'))
      };
    };
    const dot = (node: string): { x: number; y: number } | null => {
      const circle = document.querySelector<SVGCircleElement>(`[data-anchor="${node}"]`);
      if (!circle) return null;
      return { x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy')) };
    };
    return {
      projection: region.dataset.overlayProjection ?? '',
      routeSource: region.dataset.routeSource ?? '',
      baseState: region.dataset.baseState ?? '',
      stamp: document.querySelector('[data-node="map-stamp-note"]')?.textContent ?? '',
      markers: {
        origin: read('waypoint-origin'),
        lot: read('waypoint-lot'),
        curb: read('waypoint-curb')
      },
      dots: {
        origin: dot('waypoint-origin'),
        lot: dot('waypoint-lot'),
        curb: dot('waypoint-curb'),
        curbWorks: dot('map-note-curb-works')
      },
      weather: (() => {
        const cell = document.querySelector<SVGEllipseElement>('.weather-cell');
        return cell
          ? {
              x: Number(cell.getAttribute('cx')),
              y: Number(cell.getAttribute('cy')),
              rx: Number(cell.getAttribute('rx')),
              ry: Number(cell.getAttribute('ry'))
            }
          : null;
      })(),
      routeVisible: (() => {
        const paths = document.querySelector<SVGGElement>('.route-paths');
        return paths ? getComputedStyle(paths).display !== 'none' : false;
      })(),
      routeMainD: document.querySelector('[data-node="route-main"]')?.getAttribute('d') ?? '',
      bandD: document.querySelector('[data-node="route-load-band-1"]')?.getAttribute('d') ?? ''
    };
  });
}

/** Puts the base into the state a successful load would, and re-lays the overlay. */
async function goLive(page: Page): Promise<void> {
  await page.evaluate(() => window.__canvasBrowser.setBaseState('live'));
  await expect(page.locator('[data-node="journey-map"]')).toHaveAttribute('data-overlay-projection', 'bing');
}

/** And the state a blocked or offline base leaves behind. */
async function goDark(page: Page): Promise<void> {
  await page.evaluate(() => window.__canvasBrowser.setBaseState('unavailable'));
  await expect(page.locator('[data-node="journey-map"]')).toHaveAttribute(
    'data-overlay-projection',
    'illustrative'
  );
}

/**
 * A world that never gets a base at all, for the whole run.
 *
 * `setBaseState` is a momentary seam: the world re-renders on every correction
 * and refresh, each render re-attaches the base iframe, and re-attaching an
 * iframe reloads it — so a base driven dark by hand comes back at the next
 * render. Reporting the browser as offline is the durable version of the same
 * situation, and it is the state any test about *CanvasBrowser's own* corridor
 * has to stand in: that corridor only exists when Bing has not drawn one.
 *
 * Must be called before `open()`, and it does not touch the mocked gateway.
 */
async function withoutBase(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
  });
}

async function projected(page: Page, point: { lat: number; lon: number }) {
  return page.evaluate(
    (geo) => window.__canvasBrowser.projectToBase(geo.lat, geo.lon),
    point
  );
}

test('the projection is Web Mercator at Bing’s own numbers', () => {
  // The map is a square of 256 · 2^level pixels, exactly as Bing documents it.
  expect(mapSize(0)).toBe(256);
  expect(mapSize(11)).toBe(524_288);

  // Null Island is the middle of that square; the poles clamp to its edges.
  const level = 11;
  const size = mapSize(level);
  const centre = globalPixel({ lat: 0, lon: 0 }, level);
  expect(centre.x).toBeCloseTo(size / 2, 6);
  expect(centre.y).toBeCloseTo(size / 2, 6);
  expect(globalPixel({ lat: 0, lon: -180 }, level).x).toBeCloseTo(0, 6);
  expect(globalPixel({ lat: 0, lon: 180 }, level).x).toBeCloseTo(size, 6);
  // ±85.05112878° is the Web Mercator limit, and beyond it nothing moves.
  expect(globalPixel({ lat: MERCATOR_LAT_LIMIT, lon: 0 }, level).y).toBeCloseTo(0, 3);
  expect(globalPixel({ lat: 89, lon: 0 }, level).y).toBeCloseTo(0, 3);
  expect(globalPixel({ lat: -89, lon: 0 }, level).y).toBeCloseTo(size, 3);

  // Longitude is linear, latitude is not — the Mercator stretch is real.
  const a = globalPixel({ lat: 47.6, lon: -122.3 }, level);
  const b = globalPixel({ lat: 47.6, lon: -122.2 }, level);
  expect(b.x - a.x).toBeCloseTo((0.1 / 360) * size, 6);
  const north = globalPixel({ lat: 47.7, lon: -122.3 }, level);
  expect(a.y - north.y).toBeGreaterThan(b.x - a.x); // a degree of lat is taller

  // And the frame: the centre of the render is the centre of the base.
  const base = bingBase(BELLEVUE);
  const view = viewportFor(base, 1200, 420);
  expect(view.width).toBe(1200);
  const middle = projectToEmbed(view.center, view);
  expect(middle.x).toBeCloseTo(50, 6);
  expect(middle.y).toBeCloseTo(50, 6);

  // Both ends of the drive are genuinely inside the frame the URL asks for.
  for (const point of [BELLEVUE, { lat: 47.4356, lon: -122.296 }, { lat: 47.4502, lon: -122.3088 }]) {
    for (const box of [
      { w: 1600, h: 520 },
      { w: 900, h: 420 },
      { w: 640, h: 700 }
    ]) {
      const frame = viewportFor(base, box.w, box.h);
      const at = projectToEmbed(point, frame);
      expect(at.x, `${point.lat} in ${box.w}×${box.h}`).toBeGreaterThan(0);
      expect(at.x).toBeLessThan(100);
      expect(at.y).toBeGreaterThan(0);
      expect(at.y).toBeLessThan(100);
    }
  }

  // The viewport is not a second opinion: it is the URL, read back.
  const url = new URL(embedUrlForBox(base, 900, 420));
  const same = viewportFor(base, 900, 420);
  expect(Number(url.searchParams.get('lvl'))).toBe(same.level);
  expect(Number(url.searchParams.get('h'))).toBe(same.height);
  expect(Number(url.searchParams.get('w'))).toBe(same.width);
  expect(url.searchParams.get('cp')).toBe(`${same.center.lat.toFixed(4)}~${same.center.lon.toFixed(4)}`);
});

test('a live base puts every marker where Bing put the place', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);
  await setOrigin(page);

  // Without a base there is no Bing geometry, and the world says as much.
  await goDark(page);
  const before = await alignedOverlay(page);
  expect(before.projection).toBe('illustrative');
  expect(before.stamp).toContain('illustrative');

  await goLive(page);
  const after = await alignedOverlay(page);
  expect(after.projection).toBe('bing');
  expect(after.stamp).toContain('Web Mercator');

  // Every anchor lands on its own coordinate, to within a rounding step.
  const expectAt = async (
    dot: { x: number; y: number } | null,
    point: { lat: number; lon: number },
    what: string
  ): Promise<{ x: number; y: number }> => {
    const truth = (await projected(page, point))!;
    expect(truth, what).not.toBeNull();
    expect(dot, what).not.toBeNull();
    expect(Math.abs(dot!.x - truth.x), `${what} x`).toBeLessThan(0.05);
    expect(Math.abs(dot!.y - truth.y), `${what} y`).toBeLessThan(0.05);
    return truth;
  };

  const lot = await expectAt(after.dots.lot, { lat: 47.4356, lon: -122.296 }, 'the cell phone lot');
  const curb = await expectAt(after.dots.curb, { lat: 47.4436, lon: -122.3016 }, 'the arrivals curb');
  await expectAt(after.dots.origin, BELLEVUE, 'the Bellevue origin');
  await expectAt(after.dots.curbWorks, { lat: 47.4462, lon: -122.3049 }, 'the curb lane work');

  // The lot and the curb are a mile apart, so they are close together on a
  // base that holds the whole drive — and the lot is south-east of the curb,
  // which is where it actually is. The old fitted plane had it near Vashon.
  expect(Math.hypot(lot.x - curb.x, lot.y - curb.y)).toBeLessThan(12);
  expect(lot.x).toBeGreaterThan(curb.x);
  expect(lot.y).toBeGreaterThan(curb.y);

  // Labels may fan to stay readable; the dots they belong to may not move.
  expect(after.markers.lot!.x).toBeCloseTo(lot.x, 1);
  expect(Math.abs(after.markers.lot!.y - lot.y)).toBeLessThan(40);

  // The weather cell is projected over the airport itself, at a real radius —
  // and it is round on screen, which on a plane with two scales means two
  // radii whose ratio is the box's own aspect.
  const airport = (await projected(page, { lat: 47.4502, lon: -122.3088 }))!;
  expect(Math.abs(after.weather!.x - airport.x)).toBeLessThan(0.05);
  expect(Math.abs(after.weather!.y - airport.y)).toBeLessThan(0.05);
  expect(after.weather!.rx).toBeGreaterThan(0.2);
  expect(after.weather!.rx, 'a weather cell is kilometres, not half a map').toBeLessThan(30);
  const box = await page.evaluate(() => {
    const rect = document.querySelector('.map-frame')!.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  });
  const renderedX = (after.weather!.rx / 100) * box.w;
  const renderedY = (after.weather!.ry / 100) * box.h;
  expect(Math.abs(renderedX - renderedY), 'the cell is a circle on screen').toBeLessThan(2);
});

test('with a live Bing base the projected sample corridor stays visible', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);
  await setOrigin(page);

  // No base yet: the illustrative corridor is the only route there is.
  await goDark(page);
  const before = await alignedOverlay(page);
  expect(before.routeSource).toBe('overlay');
  expect(before.routeVisible, 'the fallback still has to show a route').toBe(true);

  await goLive(page);
  const after = await alignedOverlay(page);
  // The embed renders geography but not its `rtp` route. Keep the sample
  // corridor attached to that geography instead of leaving the map route-less.
  expect(after.routeSource).toBe('bing');
  expect(after.routeVisible, 'the projected Redmond/Seattle-area corridor remains visible').toBe(true);

  // What is kept is congestion, and it is projected from real corridor
  // coordinates — not from the fitted plane.
  expect(after.bandD.length).toBeGreaterThan(0);
  expect(after.bandD).not.toBe(before.bandD);
  const first = after.bandD.match(/M\s+(-?[\d.]+)\s+(-?[\d.]+)/)!;
  const start = (await projected(page, BELLEVUE))!;
  // The first band starts on the corridor out of Bellevue, near the origin.
  expect(Math.hypot(Number(first[1]) - start.x, Number(first[2]) - start.y)).toBeLessThan(30);

  // And when the base goes away again, the honest schematic comes back.
  await page.evaluate(() => window.__canvasBrowser.setBaseState('unavailable'));
  const down = await alignedOverlay(page);
  expect(down.projection).toBe('illustrative');
  expect(down.routeSource).toBe('overlay');
  expect(down.routeVisible).toBe(true);
  expect(down.stamp).toContain('illustrative');
});

test('a resize re-projects the overlay instead of stretching it', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);
  await setOrigin(page);
  await goLive(page);

  const wide = await alignedOverlay(page);
  const wideTruth = (await projected(page, { lat: 47.4356, lon: -122.296 }))!;
  expect(Math.abs(wide.dots.lot!.x - wideTruth.x)).toBeLessThan(0.05);
  expect(Math.abs(wide.dots.lot!.y - wideTruth.y)).toBeLessThan(0.05);

  // A different-shaped box is a different Bing render: a different height, and
  // often a different zoom. The overlay has to be recomputed, not scaled.
  await page.setViewportSize({ width: 1100, height: 1000 });
  await expect
    .poll(async () => (await alignedOverlay(page)).dots.lot?.y, { timeout: 5000 })
    .not.toBe(wide.dots.lot!.y);

  const tall = await alignedOverlay(page);
  expect(tall.projection).toBe('bing');
  const tallTruth = (await projected(page, { lat: 47.4356, lon: -122.296 }))!;
  // The numbers changed because the viewport changed — and they still agree
  // with the projection the new URL asks for.
  expect(Math.abs(tall.dots.lot!.x - tallTruth.x)).toBeLessThan(0.05);
  expect(Math.abs(tall.dots.lot!.y - tallTruth.y)).toBeLessThan(0.05);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('adding a stop re-projects the world, and the stop lands on its coordinate', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);
  await setOrigin(page);
  await goLive(page);

  const before = await alignedOverlay(page);
  await page.locator('[data-node="add-stop-coffee"]').click();
  await expect(page.locator('[data-node="waypoint-stop-coffee-1"]')).toBeVisible();
  await goLive(page);

  const after = await alignedOverlay(page);
  expect(after.projection).toBe('bing');
  // The anchors that did not move on the ground did not move on the screen.
  expect(after.dots.lot!.x).toBeCloseTo(before.dots.lot!.x, 1);
  expect(after.dots.lot!.y).toBeCloseTo(before.dots.lot!.y, 1);
  // And the new stop is at its own coordinate, not at a convenient gap.
  const coffee = (await projected(page, { lat: 47.4901, lon: -122.3201 }))!;
  const dot = await page.evaluate(() => {
    const circle = document.querySelector<SVGCircleElement>('[data-anchor="waypoint-stop-coffee-1"]')!;
    return { x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy')) };
  });
  expect(Math.abs(dot.x - coffee.x)).toBeLessThan(0.05);
  expect(Math.abs(dot.y - coffee.y)).toBeLessThan(0.05);
});

/* ------------------------------------------------------------------------ */
/* Route parity: one route on the map, and it is Bing's                      */
/* ------------------------------------------------------------------------ */

/**
 * The correction these tests hold.
 *
 * Opening Bing Maps for this trip returns `WA-520 W → I-5 S · 34 min · 27.6 mi`
 * as the fastest route, with `I-405 S` and `I-90 W → WA-509 S` as alternates.
 * CanvasBrowser's fixture corridor says `I-405 south → I-518 · 19 mi`. Once the
 * geometry was aligned to Bing's own Web Mercator, drawing that corridor
 * anyway put a line across real streets the drive does not take, and printed
 * road names and distances that were simply not what Bing had chosen.
 *
 * The framed endpoint was then measured: `/maps/embed` returns byte-identical
 * geography for `rtp=`, `trfc=1`, labelled positions, `adr.` addresses,
 * `rtop=`, and for no route parameter at all. It draws no route and no
 * traffic. The same `rtp=` on `bing.com/maps` — the handoff — draws all of it.
 *
 * So over a live base CanvasBrowser draws no route, no congestion and no flow,
 * animates no traffic, claims no road name or distance, and says where the
 * real line is. When the base is down, all of it comes back, named as the
 * SAMPLE corridor it is.
 */

/** A fresh fix that is deliberately *not* the Bellevue fixture centroid. */
const FRESH_FIX = { lat: 47.64213, lon: -122.20581 };
const CELL_LOT = { lat: 47.4356, lon: -122.296 };

async function baseFrameSrc(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector<HTMLIFrameElement>('[data-node="map-base"]')?.getAttribute('src') ?? ''
  );
}

/** Everything this browser has persisted, as one string, for a leak check. */
async function storageDump(page: Page): Promise<string> {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .map((key) => `${key}=${localStorage.getItem(key)}`)
      .join('|')
  );
}

test('the Bing base carries the traffic layer and both route endpoints', () => {
  const base = bingBase(FRESH_FIX, CELL_LOT);

  // Bing's traffic parameter is requested on both. It works on the handoff;
  // the framed endpoint currently ignores it, which is why nothing in the UI
  // says the frame is showing traffic.
  expect(base.embedUrl).toContain(BING_TRAFFIC_PARAM);
  expect(base.viewUrl).toContain(BING_TRAFFIC_PARAM);
  expect(isAllowedBingEmbed(base.embedUrl)).toBe(true);

  // And the route Bing is asked to solve is this trip, end to end.
  expect(base.route).toBe('pos.47.6421_-122.2058~pos.47.4356_-122.2960');
  expect(new URL(base.embedUrl).searchParams.get('rtp')).toBe(base.route);
  expect(new URL(base.viewUrl).searchParams.get('rtp')).toBe(base.route);

  // A re-shaped render keeps both: a different box is not a different trip.
  const boxed = new URL(embedUrlForBox(base, 900, 420));
  expect(boxed.searchParams.get('trfc')).toBe('1');
  expect(boxed.searchParams.get('rtp')).toBe(base.route);

  // With no origin there is no route to ask for, and traffic still shows.
  const airport = bingBase(null);
  expect(airport.route).toBeNull();
  expect(airport.embedUrl).toContain(BING_TRAFFIC_PARAM);
});

test('a granted fix routes from a coarse local category and discloses no exact coordinate', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await instrumentGeolocation(page, FRESH_FIX);
  await open(page);
  await openJourney(page);

  await page.locator('[data-node="use-my-location"]').click();
  await expect(page.locator('[data-node="waypoint-origin"]')).toBeVisible();

  // The product still reasons in coarse categories — that has not changed.
  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.originId).toBe('bellevue');
  expect(state.locationState).toBe('granted');

  // Bing receives the coarse Bellevue category, never the meter-level fix.
  const src = await baseFrameSrc(page);
  const rtp = new URL(src).searchParams.get('rtp') ?? '';
  expect(rtp).toContain('pos.47.6101_-122.2015');
  expect(rtp, 'the destination is still the cell phone lot').toContain('pos.47.4356_-122.2960');
  expect(rtp, 'the exact device fix never reaches Bing').not.toContain('47.6421');
  expect(src, 'and Bing draws its own traffic over it').toContain(BING_TRAFFIC_PARAM);

  // Nothing in the product ever exposes that number.
  expect(await storageDump(page), 'no coordinate is persisted').not.toMatch(/47\.6|-?122\./);
  const publicState = await page.evaluate(() => JSON.stringify(window.__canvasBrowser.state()));
  expect(publicState, 'no coordinate is readable from the test API').not.toMatch(/47\.6|-122\./);
  expect(await page.evaluate(() => JSON.stringify(window.__canvasBrowser.state().journey))).not.toMatch(
    /47\.|-122\./
  );

  // Start over drops the coarse category. A place then chosen by hand routes
  // from that place's own published coordinate.
  await page.locator('[data-node="back-home"]').click();
  await expect(page.locator('[data-node="home"]')).toBeVisible();
  await openJourney(page);
  await setOrigin(page, 'origin-tacoma');
  await expect
    .poll(async () => new URL(await baseFrameSrc(page)).searchParams.get('rtp'))
    .toContain('pos.47.2529_-122.4443');
  expect(await baseFrameSrc(page), 'and the stale fix is gone').not.toContain('47.6421');
});

/** The legend, the strokes and the words, in whichever state the base is in. */
async function routeClaims(page: Page) {
  return page.evaluate(() => {
    const region = document.querySelector<HTMLElement>('[data-node="journey-map"]')!;
    const shown = (selector: string): boolean => {
      const node = document.querySelector(selector);
      return node ? getComputedStyle(node).display !== 'none' : false;
    };
    return {
      routeSource: region.dataset.routeSource ?? '',
      mainRoute: shown('.route-paths'),
      trafficBands: shown('.route-loads'),
      flowParticles: shown('.route-flow-layer'),
      liveLegend: shown('[data-node="route-legend-live"]'),
      fallbackLegend: shown('[data-node="route-legend-fallback"]'),
      markers: shown('.map-anchors'),
      weather: shown('[data-node="map-weather"]'),
      now: Boolean(document.querySelector('[data-node="map-now"]')),
      text: region.innerText
    };
  });
}

test('a live Bing base keeps the projected sample route and hands exact routing to Bing', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);
  await setOrigin(page);

  // Base down: CanvasBrowser's corridor is the only route there is, and it
  // names itself a sample rather than pretending to be the road network.
  await goDark(page);
  const down = await routeClaims(page);
  expect(down.routeSource).toBe('overlay');
  expect(down.mainRoute).toBe(true);
  expect(down.trafficBands).toBe(true);
  expect(down.flowParticles).toBe(true);
  expect(down.fallbackLegend).toBe(true);
  expect(down.liveLegend).toBe(false);
  expect(down.text).toContain('I-405');
  expect(down.text).toContain('SAMPLE corridor');
  // `mi` and not `min`: the distance claim, not the drive range beside it.
  expect(down.text).toMatch(/\d+ mi(?![a-z])/);

  // Base live: the aligned SAMPLE corridor remains because the embed itself
  // renders geography only. Invented congestion and flow still disappear.
  await goLive(page);
  const live = await routeClaims(page);
  expect(live.routeSource).toBe('bing');
  expect(live.mainRoute, 'one projected SAMPLE route line').toBe(true);
  expect(live.trafficBands, 'no second congestion band').toBe(false);
  expect(live.flowParticles, 'no second flow').toBe(false);

  expect(live.liveLegend).toBe(true);
  expect(live.fallbackLegend).toBe(true);
  expect(live.text).toContain('Exact route and live traffic: Bing Maps · this base renders geography only');
  expect(live.text).toContain(
    'Open full map for the routed line, live traffic, current road list, ETA, tolls and alternatives'
  );
  expect(live.text).toContain(
    'The visible corridor is a Web-Mercator-aligned SAMPLE estimate. Open Bing Maps for the exact route, live traffic, ETA, tolls and alternatives.'
  );

  // Fixture route claims remain only with an explicit SAMPLE corridor label.
  expect(live.text).toContain('I-405');
  expect(live.text).toContain('SAMPLE corridor');
  expect(live.text).toMatch(/\d+ mi(?![a-z])/);

  // What CanvasBrowser genuinely adds is still there, on real coordinates.
  expect(live.markers).toBe(true);
  expect(live.weather).toBe(true);
  expect(live.now).toBe(true);
  await expect(page.locator('[data-node="waypoint-lot"]')).toContainText('SEA Cell Phone Lot');
  await expect(page.locator('[data-node="map-note-curb-works"]')).toContainText('Arrivals curb lane work');

  // Leg timing may stay — it is a local estimate — but it must say so, and it
  // must never be read as the ETA Bing is showing directly above it.
  const leg = page.locator('[data-node="route-legend"] .leg').first();
  await expect(leg).toContainText(/\d{1,2}:\d{2}/);
  await expect(leg).toContainText('SAMPLE');

  // The handoff is a real link the person clicks, to the same route.
  const open_ = page.locator('[data-node="route-bing-open"]');
  const href = await open_.getAttribute('href');
  expect(href).toMatch(/^https:\/\/www\.bing\.com\/maps\?/);
  expect(href).toContain(BING_TRAFFIC_PARAM);
  expect(href).toContain('rtp=');
  expect(await open_.getAttribute('target')).toBe('_blank');
  expect(await open_.getAttribute('rel')).toContain('noopener');

  // And when the base goes away, the illustrative world comes back whole.
  await goDark(page);
  const again = await routeClaims(page);
  expect(again.routeSource).toBe('overlay');
  expect(again.mainRoute).toBe(true);
  expect(again.trafficBands).toBe(true);
  expect(again.flowParticles).toBe(true);
  expect(again.fallbackLegend).toBe(true);
  expect(again.text).toContain('I-405');
});

test('a live Bing route removes CanvasBrowser’s traffic motion, and a dead base restores it', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);
  await setOrigin(page);

  await goLive(page);
  expect(await page.evaluate(() => window.__canvasBrowser.state().journey!.routeSource)).toBe('bing');
  // The traffic datum is unchanged and still moves the plan — only the claim
  // that CanvasBrowser is *showing* it is withdrawn.
  expect(await page.evaluate(() => window.__canvasBrowser.state().conditions!.trafficLevel)).toBeTruthy();
  expect(
    await activeMotion(page),
    'there is no CanvasBrowser corridor on a live base, so there is nothing to flow along'
  ).not.toContain('traffic');
  await expect(page.locator('[data-node="motion-legend"]')).not.toContainText('corridor dashes drift');

  await goDark(page);
  expect(await page.evaluate(() => window.__canvasBrowser.state().journey!.routeSource)).toBe('overlay');
  expect(await activeMotion(page), 'its own corridor is back, so its own flow is back').toContain('traffic');
  await expect(page.locator('[data-node="motion-legend"]')).toContainText('corridor dashes drift');
});

/* ------------------------------------------------------------------------ */
/* Semantic motion: nothing moves unless something is happening              */
/* ------------------------------------------------------------------------ */

async function activeMotion(page: Page): Promise<string[]> {
  const raw = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.fx-canvas');
    return canvas?.dataset.fxActiveMotion ?? '';
  });
  return raw ? raw.split(',') : [];
}

/** Advances the SAMPLE conditions to the clear, light-traffic step. */
async function advanceToClear(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) await page.evaluate(() => window.__canvasBrowser.tickRefresh());
  await expect
    .poll(async () => page.evaluate(() => window.__canvasBrowser.state().conditions!.weatherKind))
    .toBe('clear');
}

/**
 * The claim the shaders make is that a coordinate system is a place to read
 * values against, and therefore does not move. That is only worth anything if
 * it can be checked, so every such structure is a named GLSL function — and
 * this reads their bodies out of the exact source that compiles.
 */
test('every coordinate function in every world is mathematically time-free', () => {
  const modes: FxMode[] = ['home', 'travel', 'journey', 'news'];
  for (const mode of modes) {
    const source = fxShaderSource(mode);
    const names = FX_STATIC_COORDINATE_FUNCTIONS[mode];
    expect(names.length, `${mode} declares its coordinate systems`).toBeGreaterThan(0);
    for (const name of names) {
      const body = fxFunctionSource(source, name);
      expect(body, `${mode}: ${name} exists in the compiled source`).not.toBeNull();
      expect(body, `${mode}: ${name} reads no clock`).not.toContain('u_time');
      // No bare `t` either: that is the local alias main() gives the clock.
      expect(/(^|[^\w.])t([^\w]|$)/.test(body!), `${mode}: ${name} has no time term`).toBe(false);
      expect(body, `${mode}: ${name} takes no time argument`).not.toMatch(/\(\s*float\s+t\s*[,)]/);
    }
  }

  // Journey: the corridor current and the disruption beat are the only things
  // the clock touches on the route, and both are gated by a live reading.
  const journey = fxShaderSource('journey');
  for (const line of journey.split('\n').filter((l) => /\bt\s*\*/.test(l) || /\*\s*t\b/.test(l))) {
    expect(
      /u_trafficActive|u_weatherActive|u_flightActive|u_refreshDue|u_disruptionActive|weatherTime|speed|scan|inbound/.test(
        line
      ),
      `journey: an ungated clock term — ${line.trim()}`
    ).toBe(true);
  }

  // Travel: the depth rows the whole floor is ruled with take no clock at all;
  // the moving rows are a separate term, multiplied by u_trafficActive.
  const travel = fxShaderSource('travel');
  expect(travel).toContain('float flowRows = log(z) * flowPitch + t * flowSpeed * u_trafficActive;');
  expect(travel, 'the flight marker does not breathe').not.toContain('sin(t * 0.35)');
  expect(fxFunctionSource(travel, 'travelDepthRows')).toContain('log(z) * 2.2');
});

test('coordinate systems hold still: graticules, relief, NOW and rule markers', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);
  await setOrigin(page);

  const animated = await page.evaluate(() => {
    const names = (node: Element): string => getComputedStyle(node).animationName;
    const selectors = [
      '.map-graticule',
      '.map-relief',
      '.map-ground',
      '.map-leader',
      '.map-anchor',
      '.route-path--main',
      '.route-path--alternate',
      '.map-now-dot',
      '.map-note[data-kind="airport"] .map-note-body',
      '.map-note[data-kind="rule"] .map-note-body'
    ];
    const moving: string[] = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (names(node) !== 'none') moving.push(`${selector} → ${names(node)}`);
      }
    }
    return moving;
  });
  expect(animated, 'a coordinate system is a place to read, not an event').toEqual([]);
});

test('a landed flight, clear sky and no check due animates nothing at all', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);
  await setOrigin(page);
  await advanceToClear(page);

  // Landed, clear, and the check was just made.
  expect(await page.evaluate(() => window.__canvasBrowser.state().flightPhase)).toBe('landed');
  expect(await page.evaluate(() => window.__canvasBrowser.state().journey!.refreshDue)).toBe(false);

  let motion = await activeMotion(page);
  expect(motion, 'the aircraft is down').not.toContain('flight');
  expect(motion, 'the sky is clear').not.toContain('weather');
  expect(motion, 'no check is due').not.toContain('refresh-due');
  expect(motion.filter((id) => id !== 'world-update' && id !== 'traffic'), 'nothing else moves').toEqual([]);

  // Hide the one remaining live thing, and the world goes completely still.
  await page.locator('[data-node="layer-traffic"]').click();
  motion = await activeMotion(page);
  expect(motion.filter((id) => id !== 'world-update')).toEqual([]);
  await expect(page.locator('[data-node="route-flow"]'), 'no traffic, no particles').toHaveCount(0);
  await expect(page.locator('[data-node="motion-legend"]')).toContainText('Nothing is moving');

  // And the engine actually stops: a still world burns no frames.
  const quality = await page.evaluate(
    () => document.querySelector<HTMLCanvasElement>('canvas.fx-canvas')!.dataset.fxQuality
  );
  if (quality !== 'none') {
    await expect.poll(async () => (await readFx(page)).state, { timeout: 5000 }).toBe('static');
    const settled = (await readFx(page)).frame;
    await page.waitForTimeout(800);
    expect((await readFx(page)).frame).toBe(settled);
  }
});

/**
 * The other half of the same claim: when something *is* happening the loop
 * runs, and it stops again the moment that thing stops. A still world is only
 * honest if a busy one is visibly different.
 */
test('the frame counter follows the situation: it runs on traffic, and stops when it is hidden', async ({
  page
}) => {
  await mockAgent(page, landedAnswer());
  await withoutBase(page);
  await open(page);
  await openJourney(page);
  await setOrigin(page);
  // The corridor motion belongs to *CanvasBrowser's* route, and that route is
  // only drawn when Bing has not drawn one. So this is the base-down world.
  await expect(page.locator('[data-node="journey-map"]')).toHaveAttribute('data-base-state', 'unavailable');
  await advanceToClear(page);

  const quality = await page.evaluate(
    () => document.querySelector<HTMLCanvasElement>('canvas.fx-canvas')!.dataset.fxQuality
  );
  test.skip(quality === 'none', 'no drawing context in this environment');

  // Traffic is flowing, so the corridor is running: frames keep arriving.
  expect(await activeMotion(page)).toContain('traffic');
  await expect.poll(async () => (await readFx(page)).state, { timeout: 5000 }).toBe('running');
  const running = Number((await readFx(page)).frame);
  await page.waitForTimeout(500);
  expect(Number((await readFx(page)).frame), 'a moving corridor draws').toBeGreaterThan(running);

  // Hide it, and the loop stops rather than idling on a still picture.
  await page.locator('[data-node="layer-traffic"]').click();
  await expect.poll(async () => (await readFx(page)).state, { timeout: 5000 }).toBe('static');
  const stopped = (await readFx(page)).frame;
  await page.waitForTimeout(700);
  expect((await readFx(page)).frame).toBe(stopped);
});

test('home has no situation, so it never starts a loop', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);

  const quality = await page.evaluate(
    () => document.querySelector<HTMLCanvasElement>('canvas.fx-canvas')!.dataset.fxQuality
  );
  test.skip(quality === 'none', 'no drawing context in this environment');

  await expect.poll(async () => (await readFx(page)).state, { timeout: 5000 }).toBe('static');
  expect(await activeMotion(page), 'nothing is happening on home').toEqual([]);
  const settled = (await readFx(page)).frame;
  await page.waitForTimeout(800);
  expect((await readFx(page)).frame, 'an idle home draws nothing new').toBe(settled);

  // The pointer is a person moving, not the world: it redraws exactly once.
  await page.mouse.move(400, 400);
  await page.mouse.move(900, 500);
  await expect.poll(async () => Number((await readFx(page)).frame)).toBeGreaterThan(Number(settled));
  await expect.poll(async () => (await readFx(page)).state).toBe('static');
  const parallaxed = (await readFx(page)).frame;
  await page.waitForTimeout(600);
  expect((await readFx(page)).frame).toBe(parallaxed);
});

test('motion appears exactly when the situation calls for it', async ({ page }) => {
  // First look: still en route. Later looks: on the ground.
  let calls = 0;
  await page.route('**/api/agent', async (route) => {
    calls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answer: calls === 1 ? ENROUTE_ANSWER : landedAnswer(),
        model: 'gpt-5.6-sol',
        contextTier: 'long_context',
        reasoningEffort: 'medium',
        retrievedAt: new Date().toISOString()
      })
    });
  });

  await withoutBase(page);
  await open(page);
  await openJourney(page);
  await setOrigin(page);
  // Corridor motion is CanvasBrowser's own claim about its own route, so it is
  // exercised where that route exists: with no Bing line above it.
  await expect(page.locator('[data-node="journey-map"]')).toHaveAttribute('data-base-state', 'unavailable');

  // In the air: the arrival marker travels.
  expect(await page.evaluate(() => window.__canvasBrowser.state().flightPhase)).toBe('enroute');
  expect(await activeMotion(page), 'an aircraft in the air is ongoing').toContain('flight');
  await expect(page.locator('[data-node="motion-legend"]')).toContainText('still in the air');

  // Rain and heavy traffic: weather streaks and a live disruption join in.
  await page.evaluate(() => window.__canvasBrowser.tickRefresh());
  await expect
    .poll(async () => page.evaluate(() => window.__canvasBrowser.state().conditions!.weatherKind))
    .toBe('rain');
  const wet = await activeMotion(page);
  expect(wet, 'rain is falling').toContain('weather');
  expect(wet, 'vehicles are moving on the corridor').toContain('traffic');
  expect(wet, 'a lane-blocking slowdown wants a decision').toContain('disruption');
  expect(await page.evaluate(() => window.__canvasBrowser.state().flightPhase), 'and it has landed').toBe('landed');
  expect(await activeMotion(page)).not.toContain('flight');

  // The disruption marker is the only note that pulses; rules stay still.
  const pulsing = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.map-note')]
      .filter((node) => getComputedStyle(node.querySelector('.map-note-body')!).animationName !== 'none')
      .map((node) => node.dataset.kind)
  );
  expect(new Set(pulsing)).toEqual(new Set(pulsing.length ? ['disruption'] : []));

  // Hiding traffic removes the corridor motion, and nothing else.
  await page.locator('[data-node="layer-traffic"]').click();
  expect(await activeMotion(page)).not.toContain('traffic');
  expect(await activeMotion(page), 'the weather is still falling').toContain('weather');
  await page.locator('[data-node="layer-traffic"]').click();

  // Hiding weather removes the weather motion.
  await page.locator('[data-node="layer-weather"]').click();
  expect(await activeMotion(page)).not.toContain('weather');
});

test('the scan appears when a check is due, not because a cadence is fast', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);
  await setOrigin(page);

  // The fastest cadence there is — and no scan, because it was just checked.
  const refresh = await readRefresh(page);
  expect(refresh.urgency).toBe('five-minute');
  await expect(page.locator('[data-node="map-scan"]')).toHaveCount(0);
  expect(await activeMotion(page)).not.toContain('refresh-due');
  await expect(page.locator('[data-node="refresh-status"]')).toHaveAttribute('data-due', 'false');
  const dial = await page
    .locator('[data-node="refresh-dial"]')
    .evaluate((node) => getComputedStyle(node).animationName);
  expect(dial, 'the cadence is words and a draining dial, not a beat').toBe('none');

  // Bring the check due: now the world asks to be looked at.
  await page.evaluate(() => window.__canvasBrowser.setRefreshDue(true));
  await expect(page.locator('[data-node="map-scan"]')).toHaveCount(1);
  expect(await activeMotion(page)).toContain('refresh-due');
  await expect(page.locator('[data-node="refresh-status"]')).toHaveAttribute('data-due', 'true');
  await expect(page.locator('[data-node="motion-legend"]')).toContainText('the next check is due now');

  // And it goes away again the moment the check is no longer due.
  await page.evaluate(() => window.__canvasBrowser.setRefreshDue(false));
  await expect(page.locator('[data-node="map-scan"]')).toHaveCount(0);
  expect(await activeMotion(page)).not.toContain('refresh-due');
});

test('the refresh-due rule is exact at the boundary it claims', () => {
  const base = {
    intervalMs: 300_000,
    reason: 'watching',
    urgency: 'five-minute' as const,
    active: true,
    paused: false,
    checks: 1
  };
  const start = 1_000_000;
  const status = { ...base, lastCheckedMs: start, nextCheckMs: start + 300_000 };

  expect(refreshIsDue(status, start), 'just checked is not due').toBe(false);
  // 0.12 of the interval left is the threshold, and it is inclusive.
  expect(refreshIsDue(status, start + 300_000 - 36_000)).toBe(true);
  expect(refreshIsDue(status, start + 300_000 - 36_001)).toBe(false);
  expect(refreshIsDue(status, start + 400_000), 'overdue is due').toBe(true);
  expect(refreshIsDue({ ...status, paused: true }, start + 400_000), 'a parked world is not').toBe(false);
  expect(refreshIsDue({ ...status, active: false }, start + 400_000)).toBe(false);
  expect(refreshIsDue({ ...status, urgency: 'stopped' }, start + 400_000)).toBe(false);
});

test('the SAMPLE Signal Field is a still world with pointer parallax', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openSignalField(page);

  const quality = await page.evaluate(
    () => document.querySelector<HTMLCanvasElement>('canvas.fx-canvas')!.dataset.fxQuality
  );
  test.skip(quality === 'none', 'no drawing context in this environment');

  // No live market feed, so nothing in the field is happening: it settles.
  await expect.poll(async () => (await readFx(page)).state, { timeout: 5000 }).toBe('static');
  expect(await activeMotion(page)).toEqual([]);
  const settled = (await readFx(page)).frame;
  await page.waitForTimeout(800);
  expect((await readFx(page)).frame, 'an idle field draws no frames').toBe(settled);

  // A layer toggle is a real change, so it earns one finite ripple and stops.
  await page.locator('[data-node="layer-markets"]').click();
  await expect.poll(async () => Number((await readFx(page)).frame)).toBeGreaterThan(Number(settled));
  await expect.poll(async () => (await readFx(page)).state, { timeout: 6000 }).toBe('static');
});

test('Local News uses grounded instrument contours, never galaxy particles or orbital bands', () => {
  const shader = fxShaderSource('news');
  expect(shader).toContain('newsGraticule');
  expect(shader).not.toContain('signal dust');
  expect(shader).not.toContain('newsReachRings');
  expect(shader).not.toContain('newsContours');
  expect(shader).not.toContain('for (int i = 0; i < PARTICLES; i++)');

  const css = readFileSync(join(process.cwd(), 'src', 'style.css'), 'utf8');
  const atmosphere = css.match(/\.field-atmosphere\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  expect(atmosphere).not.toContain('radial-gradient(1px 1px');
});


/* ------------------------------------------------------------------------ */
/* The LLM template thinking engine                                          */
/* ------------------------------------------------------------------------ */

/**
 * The blueprint is the one thing a model is allowed to influence, and these
 * are the walls around it. Both normalizers — the wire-side gate in
 * `blueprintSchema.mjs` and the product-side gate in `templateBlueprint.ts` —
 * are exercised, because the browser must not have to trust the server and the
 * server must not have to trust the browser.
 */
test('the blueprint gate rejects markup, scripts, bad URLs and unknown fields', () => {
  const hostile = {
    version: 1,
    template: { family: 'journey-world', primaryAxis: 'space', worldMetaphor: 'a route world' },
    situation: { type: 'Airport Pickup!', label: 'meet BR26' },
    forces: [{ id: 'traffic', type: 'traffic', relevance: 9, visualMapping: 'density along the route' }],
    questions: [
      { id: 'q1', prompt: '<script>alert(1)</script>', materialEffect: 'changes the route' },
      { id: 'q2', prompt: 'Where are you starting from?', materialEffect: 'draws the route', choices: [] }
    ],
    handoffs: [
      { id: 'bad', label: 'Run this', url: 'javascript:alert(1)' },
      { id: 'data', label: 'Inline', url: 'data:text/html,<h1>x</h1>' },
      { id: 'ok', label: 'Maps', url: 'https://example.com/route' }
    ],
    styleSheet: 'body { display: none }',
    html: '<img src=x onerror=alert(1)>'
  };

  const wire = wireNormalize(hostile);
  const client = clientNormalize(hostile, 'sol-generated');
  for (const blueprint of [wire, client]) {
    expect(blueprint, 'a well-formed blueprint survives').not.toBeNull();
    // Unknown fields are dropped rather than forwarded.
    expect(Object.keys(blueprint!)).not.toContain('styleSheet');
    expect(Object.keys(blueprint!)).not.toContain('html');
    // A prompt carrying markup takes the whole question out.
    expect(blueprint!.questions.map((q: { id: string }) => q.id)).toEqual(['q2']);
    // Only https survives; nothing else is even kept as a string.
    expect(blueprint!.handoffs.find((h: { id: string }) => h.id === 'bad')!.url).toBeNull();
    expect(blueprint!.handoffs.find((h: { id: string }) => h.id === 'data')!.url).toBeNull();
    expect(blueprint!.handoffs.find((h: { id: string }) => h.id === 'ok')!.url).toBe('https://example.com/route');
    // Enums are clamped, not trusted.
    expect(blueprint!.forces[0].relevance).toBe(1);
    expect(blueprint!.situation.type).toBe('airport-pickup');
  }

  // Structural failures are ordinary, and they produce nothing at all.
  for (const rubbish of [
    'not an object',
    null,
    [],
    { version: 2, template: { family: 'journey-world' } },
    { version: 1, template: { family: 'wormhole' } },
    { version: 1 }
  ]) {
    expect(wireNormalize(rubbish)).toBeNull();
    expect(clientNormalize(rubbish, 'sol-generated')).toBeNull();
  }
});

test('a model answer that is prose, or truncated JSON, falls back instead of breaking', () => {
  expect(wireExtract('Sorry, I could not do that.')).toBeNull();
  expect(wireExtract('```json\n{ "version": 1, "template": { "fam')).toBeNull();
  expect(clientExtract('Sorry, I could not do that.')).toBeNull();

  const good = '```json\n{"version":1,"template":{"family":"signal-field"}}\n```';
  expect(wireNormalize(wireExtract(good))!.template.family).toBe('signal-field');
  expect(clientNormalize(clientExtract(good), 'sol-generated')!.template.family).toBe('signal-field');
});

test('question economics: a question must move the template, route, envelope or handoff', () => {
  const ask = (patch: Partial<BlueprintQuestion>): BlueprintQuestion => ({
    id: 'q',
    prompt: `Something about ${patch.id ?? 'q'}?`,
    whyNeeded: '',
    materialEffect: '',
    expectedInformationGain: 0.9,
    userCost: 0.1,
    choices: [{ id: 'a', label: 'A' }],
    ...patch
  });

  const result = selectQuestions([
    ask({ id: 'no-effect', materialEffect: '' }),
    ask({ id: 'weak-effect', materialEffect: 'It would refine our internal model of the party.' }),
    ask({ id: 'no-choices', materialEffect: 'changes the route', choices: [] }),
    ask({ id: 'too-costly', materialEffect: 'changes the route', expectedInformationGain: 0.2, userCost: 0.6 }),
    ask({ id: 'strong', materialEffect: 'Chooses the template this situation resolves to.' }),
    ask({ id: 'useful', materialEffect: 'Draws the route and sets the leave-by envelope.', expectedInformationGain: 0.8, userCost: 0.2 }),
    ask({ id: 'third', materialEffect: 'Changes the handoff link.', expectedInformationGain: 0.5, userCost: 0.2 })
  ]);

  expect(result.selected.map((q) => q.id), 'the two highest-value questions, and only two').toEqual([
    'strong',
    'useful'
  ]);
  const verdict = (id: string) => result.verdicts.find((entry) => entry.question.id === id)!;
  expect(verdict('no-effect').verdict).toContain('never said what answering it would change');
  expect(verdict('weak-effect').verdict).toContain('moves no template, route, envelope or handoff');
  expect(verdict('no-choices').verdict).toContain('nothing to answer with');
  expect(verdict('too-costly').verdict).toContain('costs the person more attention');
  expect(verdict('third').verdict).toContain('budget');

  // Determinism: the same input always produces the same order.
  const again = selectQuestions([
    ask({ id: 'useful', materialEffect: 'Draws the route and sets the leave-by envelope.', expectedInformationGain: 0.8, userCost: 0.2 }),
    ask({ id: 'strong', materialEffect: 'Chooses the template this situation resolves to.' })
  ]);
  expect(again.selected.map((q) => q.id)).toEqual(['strong', 'useful']);
});

test('the pickup blueprint asks the job, asks origin only for a pickup, and never asks party size', () => {
  const opening = pickupBlueprint({
    flightLabel: 'EVA Air BR26',
    chosenJob: null,
    hasOrigin: false,
    international: true
  });
  expect(opening.template.family, 'a pickup is a journey, not a timetable').toBe('journey-world');
  const openingIds = selectQuestions(opening.questions).selected.map((q) => q.id);
  expect(openingIds, 'before a job is chosen, only the job is worth asking').toEqual(['travel-job']);

  const chosen = pickupBlueprint({
    flightLabel: 'EVA Air BR26',
    chosenJob: 'pickup',
    hasOrigin: false,
    international: true
  });
  const chosenIds = selectQuestions(chosen.questions).selected.map((q) => q.id);
  expect(chosenIds, 'origin unlocks route, traffic and leave-by — so it is asked, once').toEqual(['travel-origin']);

  // Party size is *considered* and argued down, in every state.
  for (const blueprint of [opening, chosen]) {
    expect(blueprint.questions.map((q) => q.id)).toContain('passenger-count');
    const verdicts = selectQuestions(blueprint.questions).verdicts;
    const party = verdicts.find((entry) => entry.question.id === 'passenger-count')!;
    expect(party.selected).toBe(false);
    expect(party.verdict).toContain('moves no template, route, envelope or handoff');
  }

  // The checked bag is never a question at all — it is a stated assumption.
  expect(chosen.questions.map((q) => q.id)).not.toContain('checked-bag');
  expect(chosen.unknowns.map((entry) => entry.id)).toContain('checked-bag');

  // Origin is not asked when it is already known.
  const known = pickupBlueprint({
    flightLabel: 'EVA Air BR26',
    chosenJob: 'pickup',
    hasOrigin: true,
    international: true
  });
  expect(selectQuestions(known.questions).selected).toHaveLength(0);
});

test('the same grammar compiles a pickup to Journey World and a briefing to the Signal Field', () => {
  const journey = compileTemplate(
    pickupBlueprint({ flightLabel: 'BR26', chosenJob: 'pickup', hasOrigin: true, international: true })
  );
  expect(journey.view).toBe('journey');
  expect(journey.primary, 'space is the dominant plane').toBe('map');
  expect(journey.secondary, 'time is linked under it, not on another screen').toBe('timeline');
  expect(journey.fxMode).toBe('journey');
  expect(journey.layers).toEqual({ traffic: true, weather: true, airport: true, disruption: true });
  expect(describeTemplate(journey)).toBe('Journey World · map over a linked timeline');

  const field = compileTemplate(newsBlueprint({ label: 'What could reach my day', place: 'Seattle' }));
  expect(field.view).toBe('field');
  expect(field.primary).toBe('field');
  expect(field.secondary).toBeNull();
  expect(field.fxMode).toBe('news');
  expect(describeTemplate(field)).toBe('Signal Field · field only');

  // The Timeline lens moves the height, never the world.
  const timeline = compileTemplate(
    pickupBlueprint({ flightLabel: 'BR26', chosenJob: 'pickup', hasOrigin: true, international: true }),
    { lens: 'timeline' }
  );
  expect(timeline.primary).toBe('timeline');
  expect(timeline.secondary).toBe('map');
  expect(timeline.fxMode).toBe('travel');
});

/* ------------------------------------------------------------------------ */
/* Journey World                                                             */
/* ------------------------------------------------------------------------ */

async function openJourney(page: Page): Promise<void> {
  await askTravelResolved(page);
  await openPickup(page);
  await expect(page.locator('[data-node="journey-map"]')).toBeVisible();
}

async function setOrigin(page: Page, id = 'origin-bellevue'): Promise<void> {
  await page.locator('[data-node="choose-place"]').click();
  await page.locator(`[data-node="${id}"]`).click();
  await expect(page.locator('[data-node="waypoint-origin"]')).toBeVisible();
}

test('a pickup resolves to Journey World, and the blueprint says so in the open', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);

  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.blueprint!.family).toBe('journey-world');
  expect(state.blueprint!.source, 'the test build never calls a model for a blueprint').toBe('fallback');
  expect(state.template).toEqual({ view: 'journey', primary: 'map', secondary: 'timeline', fxMode: 'journey' });

  // The world says which blueprint it is standing on, without being asked.
  await expect(page.locator('[data-node="lens-note"]')).toContainText('Journey World');
  await expect(page.locator('[data-node="lens-note"]')).toContainText('blueprint: fallback');

  // And the Source sheet carries the whole argument.
  await page.locator('[data-node="sources-button"]').click();
  const sheet = page.locator('[data-node="sources-sheet"]');
  await expect(sheet).toContainText('World blueprint: fallback');
  await expect(sheet).toContainText('never emit user interface');
  await expect(sheet).toContainText('Question asked: Where are you starting from?');
  await expect(sheet).toContainText('Question not asked: How many people are you picking up?');
  await expect(sheet).toContainText('moves no template, route, envelope or handoff');
  await expect(sheet).toContainText('SAMPLE MAP');
});

test('a Sol-shaped blueprint is normalized, compiled, and can never reach the DOM as markup', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);

  const applied = await page.evaluate(() =>
    window.__canvasBrowser.applyBlueprint({
      version: 1,
      situation: { type: 'airport-pickup', label: 'Meeting BR26', place: 'SEA' },
      jobs: { primary: { id: 'pickup', label: 'Picking someone up', evidence: ['a flight and a meeting'] } },
      template: {
        family: 'journey-world',
        primaryAxis: 'space',
        secondaryAxis: 'time',
        worldMetaphor: 'one map where the drive and the airport share a clock'
      },
      forces: [
        { id: 'traffic', type: 'traffic', relevance: 0.9, visualMapping: 'density along the route' },
        { id: 'weather', type: 'weather', relevance: 0.1, visualMapping: 'a cell over the airport' }
      ],
      questions: [
        {
          id: 'vehicle',
          prompt: '<b>Which car?</b>',
          materialEffect: 'changes the route',
          expectedInformationGain: 1,
          userCost: 0,
          choices: [{ id: 'a', label: 'Sedan' }]
        }
      ],
      handoffs: [{ id: 'x', label: 'Directions', url: 'https://maps.example.com/a' }]
    })
  );
  expect(applied).toBe(true);

  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.blueprint!.source).toBe('sol-generated');
  expect(state.blueprint!.family).toBe('journey-world');
  expect(state.blueprint!.questionIds, 'the markup-bearing question never survived').toEqual([]);
  await expect(page.locator('[data-node="lens-note"]')).toContainText('blueprint: Sol-generated');

  // A force the blueprint thinks is irrelevant does not get to paint the map.
  await expect(page.locator('[data-node="map-weather"]')).toHaveCount(0);
  await expect(page.locator('[data-node="route-traffic"]')).toHaveCount(1);

  // Nothing the model wrote became an element.
  expect(await page.locator('[data-node="journey-map"] b').count()).toBe(0);
  expect(await page.locator('script[data-blueprint]').count()).toBe(0);
});

test('before an origin the Journey world states the spatial gap and what filling it buys', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);

  await expect(page.locator('[data-node="journey-map"]')).toHaveAttribute('data-route', 'unknown');
  await expect(page.locator('[data-node="route-main"]')).toHaveCount(1);
  await expect(page.locator('[data-node="waypoint-origin"]')).toHaveCount(0);
  await expect(page.locator('[data-node="origin-question"]')).toHaveText('Where are you starting from?');
  await expect(page.locator('[data-node="origin-why"]')).toHaveText(
    'Needed to build your route, traffic exposure and staging window. Coordinates stay local.'
  );
  // The half of the world that is known is still drawn.
  await expect(page.locator('[data-node="waypoint-lot"]')).toContainText('SEA Cell Phone Lot');
  await expect(page.locator('[data-node="waypoint-curb"]')).toContainText('SEA Arrivals curb');
  // And the question is asked in exactly one place.
  await expect(page.locator('[data-node="origin-picker"]')).toHaveCount(1);
});

test('after an origin the map carries route, stops, layers, timing and the envelope', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);
  await setOrigin(page);

  await expect(page.locator('[data-node="journey-map"]')).toHaveAttribute('data-route', 'known');

  // Route: a main path, an alternate, and distance/drive labels for both.
  await expect(page.locator('[data-node="route-main"]')).toHaveCount(1);
  await expect(page.locator('[data-node="route-alternate"]')).toHaveCount(1);
  await expect(page.locator('[data-node="route-main-label"]')).toContainText('I-405');
  await expect(page.locator('[data-node="route-main-label"]')).toContainText(/\d+ mi/);
  await expect(page.locator('[data-node="route-main-label"]')).toContainText(/\d+–\d+ min/);
  await expect(page.locator('[data-node="route-alternate-label"]')).toContainText('alternate');

  // The stop sequence, in order, ending at the curb after the passenger text.
  const order = await page.evaluate(() => window.__canvasBrowser.state().journey!.waypoints);
  expect(order).toEqual(['Bellevue', 'SEA Cell Phone Lot', 'SEA Arrivals curb']);

  // Overlays: traffic on the route, a projected weather cell, airport updates.
  await expect(page.locator('[data-node="route-traffic"] path')).not.toHaveCount(0);
  await expect(page.locator('[data-node="route-flow"]')).toHaveCount(1);
  await expect(page.locator('[data-node="map-weather"]')).toHaveCount(1);
  await expect(page.locator('[data-node="map-weather-label"]')).toContainText('SAMPLE');
  await expect(page.locator('[data-node="map-weather-label"]')).toContainText('projected over');
  await expect(page.locator('[data-node="map-note-curb-works"]')).toContainText('Arrivals curb lane work');
  await expect(page.locator('[data-node="map-note-curb-works"]')).toContainText('SAMPLE');
  await expect(page.locator('[data-node="map-stamp"]')).toContainText('SAMPLE MAP');

  // Time mapped onto space: every leg carries the clock window you are in it.
  const legs = page.locator('[data-node="route-legend"] .leg');
  expect(await legs.count()).toBeGreaterThan(1);
  await expect(legs.first()).toContainText(/\d{1,2}:\d{2}/);
  await expect(legs.first()).toContainText('traffic');
  await expect(page.locator('[data-node="map-now"]')).toContainText('NOW');
  // The scan is an attention state, not a metronome: the check was just made,
  // so nothing sweeps the plane.
  await expect(page.locator('[data-node="map-scan"]')).toHaveCount(0);

  // The linked arrival strip and the dominant envelope share the same screen.
  await expect(page.locator('[data-node="strip-title"]')).toContainText('landing → gate → CBP → bags → curb-ready');
  await expect(page.locator('[data-node="segment-cbp"]')).toBeVisible();
  await expect(page.locator('[data-node="envelope-primary"]')).toContainText(/Be in the SEA Cell Phone Lot|Leave now/);
  await expect(page.locator('[data-node="envelope-travel"]')).toContainText(/Leave Bellevue/);

  // Handoffs are links the person clicks. Nothing navigates on its own.
  const links = page.locator('[data-node="pickup-links"] a');
  await expect(links).toHaveCount(4);
  expect(page.url()).toContain('127.0.0.1:4175');
});

test('a Redmond origin stated in the prompt produces a Redmond-to-SEA route without another question', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page, 'I am in Redmond picking up EVA Air BR26 from TPE at SEA tonight');
  await openPickup(page);

  await expect(page.locator('[data-node="journey-map"]')).toHaveAttribute('data-route', 'known');
  await expect(page.locator('[data-node="waypoint-origin"]')).toContainText('Redmond');
  await expect(page.locator('[data-node="route-main-label"]')).toContainText('WA-520');
  await expect(page.locator('[data-node="origin-question"]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(
    'Your route is waiting on a starting point'
  );

  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.journey!.waypoints).toEqual(['Redmond', 'SEA Cell Phone Lot', 'SEA Arrivals curb']);
  expect(state.questionsAsked).toBe(1);
});

test('a late pickup plan never shows an impossible past route or sends the car to the curb before the passenger', async ({
  page
}) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);
  await setOrigin(page);

  const plan = await page.evaluate(() => window.__canvasBrowser.plan());
  const journey = (await page.evaluate(() => window.__canvasBrowser.state())).journey!;
  expect(plan?.travel?.lateForIdealWindow).toBe(true);
  expect(plan?.travel?.range.startMs).toBeGreaterThanOrEqual(plan!.nowMs);
  expect(plan?.travel?.arrivalWindow.startMs).toBeGreaterThanOrEqual(
    plan!.nowMs + plan!.travel!.driveMinutes.min * 60_000
  );

  const driveLeg = journey.segmentWindows.find((segment) => segment.label.includes('Bellevue'));
  expect(driveLeg?.startMs).toBeGreaterThanOrEqual(plan!.nowMs);

  const curbLeg = journey.segmentWindows.find((segment) => segment.label.includes('Cell Phone Lot → Arrivals curb'));
  expect(curbLeg?.startMs).toBeGreaterThanOrEqual(plan!.envelope!.curbWindow.startMs);
  await expect(page.locator('[data-node="envelope-primary"]')).toHaveText('Leave now for the SEA Cell Phone Lot');
  await expect(page.locator('[data-node="envelope-travel"]')).toContainText('expected Cell Phone Lot arrival');

  // The operational consequence of lane work must be fully readable.
  const detail = page.locator('[data-node="map-note-curb-works"] .map-note-detail');
  expect(await detail.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
  await expect(detail).toContainText('curb pickup runs slower at peak');
});

test('adding and removing a stop deforms the route and moves the leave-by, with no model call', async ({ page }) => {
  const agent = await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);
  await setOrigin(page);

  const before = await page.evaluate(() => window.__canvasBrowser.plan());
  const beforePath = await page.locator('[data-node="route-main"]').getAttribute('d');
  const calls = agent.get();

  // The stop states its cost before it is taken, and nothing asks about it.
  await expect(page.locator('[data-node="add-stop-coffee"]')).toContainText(/\+\d+–\d+ min/);
  await expect(page.locator('[data-node="stop-note"]')).toContainText('changes the route and moves your leave-by');
  await page.locator('[data-node="add-stop-coffee"]').click();

  await expect(page.locator('[data-node="waypoint-stop-coffee-1"]')).toContainText('Coffee');
  const after = await page.evaluate(() => window.__canvasBrowser.plan());
  const afterPath = await page.locator('[data-node="route-main"]').getAttribute('d');

  expect(afterPath, 'the drawn route deforms around the stop').not.toBe(beforePath);
  expect(after!.travel!.driveMinutes.max).toBeGreaterThan(before!.travel!.driveMinutes.max);
  if (before!.travel!.lateForIdealWindow) {
    expect(after!.travel!.arrivalWindow.endMs, 'a late stop widens the achievable arrival').toBeGreaterThan(
      before!.travel!.arrivalWindow.endMs
    );
  } else {
    expect(after!.travel!.departByMs, 'a stop means leaving earlier').toBeLessThan(before!.travel!.departByMs);
  }
  expect(after!.travel!.stopMinutes.max).toBeGreaterThan(0);
  await expect(page.locator('[data-node="envelope-conditions"]')).toContainText('your stops');
  expect(agent.get(), 'reshaping the world is local').toBe(calls);

  await page.locator('[data-node="remove-stop-coffee-1"]').click();
  await expect(page.locator('[data-node="waypoint-stop-coffee-1"]')).toHaveCount(0);
  const restored = await page.evaluate(() => window.__canvasBrowser.plan());
  expect(restored!.travel!.driveMinutes).toEqual(before!.travel!.driveMinutes);
  expect(agent.get()).toBe(calls);
});

test('the Journey and Timeline lenses are one world seen twice, never two pages', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);
  await setOrigin(page);

  // Journey is the default, and the arrival strip is linked under the map.
  await expect(page.locator('[data-node="lens-journey"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-node="world"]')).toHaveClass(/world--strip/);

  const mapBox = (await page.locator('[data-node="journey-map"]').boundingBox())!;
  const stripBox = (await page.locator('[data-node="world"]').boundingBox())!;
  expect(mapBox.height, 'space dominates in the Journey lens').toBeGreaterThan(stripBox.height);
  expect(stripBox.y, 'and time is linked directly beneath it').toBeGreaterThan(mapBox.y);

  await page.locator('[data-node="lens-timeline"]').click();
  await expect(page.locator('[data-node="journey-map"]')).toHaveCount(0);
  await expect(page.locator('[data-node="pipeline"]')).toBeVisible();
  await expect(page.locator('[data-node="lens-note"]')).toContainText('timeline over a linked map');
  // The world itself is untouched: same plan, same envelope, no model call.
  await expect(page.locator('[data-node="envelope-primary"]')).toContainText(
    /Be in the SEA Cell Phone Lot|Leave now for the SEA Cell Phone Lot/
  );
  expect(await page.evaluate(() => window.__canvasBrowser.state().lens)).toBe('timeline');

  await page.locator('[data-node="lens-journey"]').click();
  await expect(page.locator('[data-node="journey-map"]')).toBeVisible();
});

test('the checked bag states its own stakes, and party size is never a control or a question', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);

  const why = page.locator('[data-node="assumption-bags-why"]');
  await expect(why).toHaveText('Checked bag assumed · adds 12–28 min and may need cargo space');

  // No party control anywhere, and no question about it, on any route.
  await expect(page.locator('[data-node="assumption-passengers"]')).toHaveCount(0);
  await expect(page.locator('[data-node="situation-sentence"]')).not.toContainText('passenger');
  expect(await page.evaluate(() => window.__canvasBrowser.state().assumptions.passengerCount)).toBe(1);

  // Toggling the bag rewrites the stakes and moves the world.
  const before = await page.evaluate(() => window.__canvasBrowser.plan());
  await page.locator('[data-node="assumption-bags"]').click();
  await expect(why).toHaveText('No checked bag · curb-ready 12–28 min sooner, and no cargo space needed');
  await expect(page.locator('[data-node="segment-bags"]')).toHaveCount(0);
  const after = await page.evaluate(() => window.__canvasBrowser.plan());
  expect(after!.envelope!.curbWindow.endMs).toBeLessThan(before!.envelope!.curbWindow.endMs);
});

test('a party size the person already stated is heard, and still never asked about', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page, 'picking up 3 passengers off EVA AIR TPE to SEA tonight');
  await openPickup(page);

  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.assumptions.passengerCount).toBe(3);
  expect(state.questionsAsked, 'party size is heard; job and origin are the two questions').toBe(2);
  await expect(page.locator('[data-node="assumption-passengers"]')).toHaveCount(0);
});

test('every question the product shows carries one concise reason', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askTravel(page);

  await expect(page.locator('[data-node="clarify-question"]')).toBeVisible();
  await expect(page.locator('[data-node="clarify-reason"]')).toHaveText(
    'Each answer builds a different world, and only you know which one you are in.'
  );
});

test('the Journey plane feeds the GPU layer the same numbers the map is drawn from', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);

  const before = (await readTravelFx(page))!;
  expect(before.mode).toBe('journey');
  expect(before.routeKnown, 'no origin, no route current').toBe('0.00');

  await setOrigin(page);
  const after = (await readTravelFx(page))!;
  expect(after.routeKnown).toBe('1.00');
  expect(after.traffic, 'congestion drives the route current').toBeGreaterThan(0);
  expect(after.weather, 'the projection drives the airport field').toBeGreaterThan(0);
  expect(after.urgency, 'the five-minute cadence is the fastest scan').toBe(1);
  expect(after.phase, 'on the ground pushes the arrival pulse forward').toBeGreaterThan(0.5);
  expect(after.wind).toMatch(/^-?\d+\.\d{2},-?\d+\.\d{2}$/);
});

test('the Journey world becomes a vertical corridor on a phone, with no horizontal overflow', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await openJourney(page);
  await setOrigin(page);

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth
  }));
  expect(overflow.doc).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);

  const frame = (await page.locator('.map-frame').boundingBox())!;
  expect(frame.width).toBeLessThanOrEqual(391);
  expect(frame.height, 'the plane keeps real height on a phone').toBeGreaterThan(200);

  // The envelope stays sticky and legible over the world.
  const sticky = await page
    .locator('[data-node="decision-envelope"]')
    .evaluate((el) => getComputedStyle(el).position);
  expect(sticky).toBe('sticky');
});

/* ------------------------------------------------------------------------ */
/* Intent-to-World — Situation Intelligence, the graph, and Experience       */
/* Synthesis. Two engines, one contract, and a Microsoft Graph seam that is  */
/* honestly empty.                                                           */
/* ------------------------------------------------------------------------ */

function context(patch: Partial<DiscoveryContext> = {}): DiscoveryContext {
  return {
    nowMs: Date.now(),
    capabilities: defaultCapabilities({ webResearch: true, ...(patch.capabilities ?? {}) }),
    ...patch
  };
}

function travelGraphFor(patch: Partial<DiscoveryContext> = {}): SituationGraph {
  return situationIntelligence.discover(EVA_PROMPT, context(patch));
}

function needMap(graph: SituationGraph): Record<string, { provider: string; status: string; permission: string | null }> {
  const map: Record<string, { provider: string; status: string; permission: string | null }> = {};
  for (const need of graph.informationNeeds) {
    map[need.id] = { provider: need.provider, status: need.status, permission: need.permission };
  }
  return map;
}

test('the arrival graph states its hypotheses, every provider it wants, and what it refuses to ask', () => {
  const graph = travelGraphFor();

  expect(graph.kind).toBe('travel-arrival');
  expect(graph.hypotheses.map((entry) => entry.id)).toEqual(['track', 'connect', 'pickup']);
  expect(graph.hypotheses.every((entry) => entry.evidence.length > 0), 'a hypothesis states its evidence').toBe(true);

  const needs = needMap(graph);
  expect(needs['flight-status']).toEqual({ provider: 'web-search', status: 'available', permission: null });
  expect(needs['origin-location'].provider).toBe('geolocation');
  expect(needs['origin-location'].status, 'a fix is never assumed').toBe('needs-consent');
  expect(needs['route-traffic']).toEqual({ provider: 'bing-maps', status: 'available', permission: null });
  expect(needs['arrival-weather'].provider).toBe('weather');
  expect(needs['airport-conditions'].provider).toBe('airport');

  // Microsoft Graph is stated precisely, scoped minimally, and never assumed.
  for (const [id, scope] of [
    ['graph-travel-itinerary', 'Calendars.Read'],
    ['graph-flight-confirmation', 'Mail.ReadBasic'],
    ['graph-traveler-contact', 'People.Read']
  ] as const) {
    expect(needs[id].provider).toBe('microsoft-graph');
    expect(needs[id].status).toBe('needs-consent');
    expect(needs[id].permission).toBe(scope);
  }
  expect(needs['graph-shared-plan'].provider).toBe('microsoft-graph');
  for (const need of graph.informationNeeds.filter((entry) => entry.provider === 'microsoft-graph')) {
    expect(need.optional, 'the world resolves honestly without any of it').toBe(true);
    expect(need.changesGraphBy.length, 'each Graph need says exactly what it would change').toBeGreaterThan(20);
  }

  // The bag is inferred and editable — never a blocking question.
  const bag = graph.unknowns.find((entry) => entry.id === 'checked-bag')!;
  expect(bag.truth).toBe('inferred');
  expect(bag.blocking).toBe(false);
  expect(bag.resolvedBy).toContain('no question');
  expect(graph.facts.find((fact) => fact.id === 'checked-bag')!.editable).toBe(true);

  // Party size is argued down rather than silently dropped.
  expect(graph.questionPlan.selected.map((question) => question.id)).toEqual(['travel-job']);
  const party = graph.questionPlan.verdicts.find((verdict) => verdict.question.id === 'passenger-count')!;
  expect(party.selected).toBe(false);
  expect(party.verdict).toContain('moves no template, route, envelope or handoff');
});

test('the Living News graph wants local, markets, weather and mobility — and Graph only with consent', () => {
  const graph = situationIntelligence.discover(NEWS_OPEN_PROMPT, context());

  expect(graph.kind).toBe('living-news');
  const needs = needMap(graph);
  expect(needs['local-signals'].provider).toBe('local-news');
  expect(needs['market-moves'].provider).toBe('market-data');
  expect(needs['local-weather'].provider).toBe('weather');
  expect(needs['mobility'].provider).toBe('bing-maps');
  expect(needs['news-place'].provider).toBe('geolocation');

  expect(needs['graph-day-schedule']).toEqual({
    provider: 'microsoft-graph',
    status: 'needs-consent',
    permission: 'Calendars.Read'
  });
  expect(needs['graph-work-context'].permission).toBe('Mail.ReadBasic');
  expect(graph.informationNeeds.find((need) => need.id === 'graph-day-schedule')!.purpose).toContain('day');

  const connected = situationIntelligence.discover(
    NEWS_OPEN_PROMPT,
    context({ capabilities: defaultCapabilities({ webResearch: true, localNews: true, marketData: true }) })
  );
  const connectedNeeds = needMap(connected);
  expect(connectedNeeds['local-signals'].status).toBe('available');
  expect(connectedNeeds['market-moves'].status).toBe('available');

  // Neither scope nor horizon can be read, so exactly two questions survive.
  expect(graph.questionPlan.selected.map((question) => question.id)).toEqual(['news-scope', 'news-horizon']);
  expect(graph.questionPlan.budget).toBe(2);

  // A prompt that states both asks nothing at all.
  const strong = situationIntelligence.discover(NEWS_STRONG_PROMPT, context());
  expect(strong.questionPlan.selected).toHaveLength(0);
});

test('question economics is graph-native: at most two, each with a stated verdict', () => {
  const graph = travelGraphFor();
  expect(graph.questionPlan.selected.length).toBeLessThanOrEqual(2);
  for (const verdict of graph.questionPlan.verdicts) {
    expect(verdict.verdict.length, 'every question carries an argument either way').toBeGreaterThan(10);
    expect(verdict.question.materialEffect.length).toBeGreaterThan(10);
  }

  // Once the job is answered it stops being a question, and the origin becomes
  // the one thing left worth asking.
  const pickup = situationIntelligence.chooseJob(graph, 'pickup', context({ chosenJob: 'pickup' }));
  expect(pickup.questionPlan.selected.map((question) => question.id)).toEqual(['travel-origin']);
  expect(findNeed(pickup, 'travel-job')!.status).toBe('satisfied');

  // With an origin already known, nothing is worth asking at all.
  const located = situationIntelligence.chooseJob(graph, 'pickup', context({ chosenJob: 'pickup', hasOrigin: true }));
  expect(located.questionPlan.selected).toHaveLength(0);
  expect(findNeed(located, 'origin-location')!.status).toBe('satisfied');

  // A blueprint may propose questions; it cannot buy attention with them.
  const proposed = situationIntelligence.considerBlueprintQuestions(located, [
    {
      id: 'brand-question',
      prompt: 'Would you like a nicer theme?',
      whyNeeded: 'It would look better.',
      materialEffect: 'Changes the colours.',
      expectedInformationGain: 0.9,
      userCost: 0.1,
      choices: [{ id: 'yes', label: 'Yes' }],
      origin: 'blueprint',
      satisfiesNeedId: null
    }
  ]);
  expect(proposed.questionPlan.selected).toHaveLength(0);
  expect(
    proposed.questionPlan.verdicts.find((verdict) => verdict.question.id === 'brand-question')!.verdict
  ).toContain('moves no template, route, envelope or handoff');
});

test('context acquisition runs what it can, and never executes Microsoft Graph', async () => {
  const graph = travelGraphFor();
  const plan = situationIntelligence.planContextAcquisition(graph, defaultCapabilities({ webResearch: true }));

  expect(plan.steps.every((step) => step.executable), 'a planned step is a runnable step').toBe(true);
  expect(plan.steps.map((step) => step.need.id)[0], 'material effect comes first').toBe('flight-status');
  expect(plan.steps.some((step) => step.need.provider === 'microsoft-graph')).toBe(false);
  expect(plan.steps.some((step) => step.need.provider === 'user'), 'a person is not a provider to be polled').toBe(
    false
  );

  const deferred = plan.deferred.filter((step) => step.need.provider === 'microsoft-graph');
  expect(deferred.length).toBeGreaterThanOrEqual(3);
  for (const step of deferred) {
    expect(step.executable).toBe(false);
    expect(step.reason).toContain('no Microsoft Graph connector');
  }

  // Even if a connector were claimed, P0 still refuses to call it.
  const claimed = situationIntelligence.planContextAcquisition(
    graph,
    defaultCapabilities({ webResearch: true, microsoftGraph: true })
  );
  expect(
    claimed.steps.some((step) => step.need.provider === 'microsoft-graph'),
    'the seam exists; the call does not'
  ).toBe(false);

  // A location that has not been consented to is deferred, not attempted.
  expect(plan.deferred.some((step) => step.need.id === 'origin-location')).toBe(true);
  const consented = situationIntelligence.planContextAcquisition(
    graph,
    defaultCapabilities({ webResearch: true, locationConsent: true })
  );
  expect(consented.steps.some((step) => step.need.id === 'origin-location')).toBe(true);

  // The adapter itself answers without ever leaving the machine.
  const need = findNeed(graph, 'graph-travel-itinerary')!;
  const result = await situationIntelligence.microsoftGraph.acquire(need, graph);
  expect(result.status).toBe('not-connected');
  expect(result.statements, 'no fabricated mailbox, ever').toEqual([]);
  expect(result.note).toContain('Calendars.Read');
  const afterGraph = situationIntelligence.applyContextResult(graph, result);
  expect(findNeed(afterGraph, 'graph-travel-itinerary')!.status).toBe('needs-consent');
});

test('applying a provider result respects source authority and freshness', () => {
  const graph = travelGraphFor();
  const live = situationIntelligence.applyContextResult(graph, {
    needId: 'flight-status',
    provider: 'web-search',
    status: 'satisfied',
    retrievedAtMs: Date.now(),
    statements: [
      {
        nodeId: 'flight-identity',
        label: 'Inbound flight',
        statement: 'EVA Air BR26 is on the ground at SEA.',
        truth: 'observed',
        authority: 'live-research',
        freshness: 'live'
      }
    ],
    note: ''
  });
  expect(findNeed(live, 'flight-status')!.status).toBe('satisfied');
  expect(live.facts.find((fact) => fact.id === 'flight-identity')!.truth).toBe('observed');

  // A weaker, staler source cannot overwrite what a live one established.
  const weaker = situationIntelligence.applyContextResult(live, {
    needId: 'flight-status',
    provider: 'local-fixture',
    status: 'satisfied',
    retrievedAtMs: Date.now(),
    statements: [
      {
        nodeId: 'flight-identity',
        label: 'Inbound flight',
        statement: 'A sample flight.',
        truth: 'modeled',
        authority: 'fixture',
        freshness: 'static'
      }
    ],
    note: ''
  });
  expect(weaker.facts.find((fact) => fact.id === 'flight-identity')!.statement).toContain('on the ground');

  // A failed provider writes no fact at all — it only says it failed.
  const failed = situationIntelligence.applyContextResult(graph, {
    needId: 'arrival-weather',
    provider: 'weather',
    status: 'unavailable',
    retrievedAtMs: null,
    statements: [],
    note: 'no forecast API is wired up'
  });
  expect(findNeed(failed, 'arrival-weather')!.status).toBe('unavailable');
  expect(failed.facts).toEqual(graph.facts);
});

test('Experience Synthesis derives the world from the graph and rejects an incompatible blueprint', () => {
  const opening = travelGraphFor();
  expect(expectedFamily(opening), 'a forming pickup world is a journey').toBe('journey-world');

  const pickup = situationIntelligence.chooseJob(opening, 'pickup', context({ chosenJob: 'pickup' }));
  const journey = experienceSynthesis.synthesize({ graph: pickup });
  expect(journey.family).toBe('journey-world');
  expect(journey.compiled.view).toBe('journey');
  expect(journey.templateLabel).toBe('Journey World · map over a linked timeline');
  expect(journey.blueprintSource).toBe('fallback');
  expect(journey.graphId).toBe(pickup.id);
  expect(journey.visualForces.map((force) => force.id)).toContain('traffic');
  expect(journey.decisions[0].outcome).toBe('derived');
  expect(journey.questionContract.refused.map((entry) => entry.id)).toContain('passenger-count');

  const news = situationIntelligence.discover(NEWS_STRONG_PROMPT, context());
  const field = experienceSynthesis.synthesize({ graph: news });
  expect(field.family).toBe('signal-field');
  expect(field.compiled.view).toBe('field');

  // Tracking is a reading; a connection names the world it cannot yet build.
  const track = situationIntelligence.chooseJob(opening, 'track', context({ chosenJob: 'track' }));
  expect(experienceSynthesis.synthesize({ graph: track }).family).toBe('literal');
  const connect = experienceSynthesis.synthesize({
    graph: situationIntelligence.chooseJob(opening, 'connect', context({ chosenJob: 'connect' }))
  });
  expect(connect.blueprint.template.worldMetaphor).toContain('Coordination Constellation');
  expect(connect.decisions.map((decision) => decision.id)).toContain('coordination-constellation');

  // A blueprint that misreads the situation is rejected, not obeyed.
  const wrongFamily = clientNormalize(
    { version: 1, template: { family: 'signal-field', worldMetaphor: 'a field of signals' } },
    'sol-generated'
  )!;
  expect(blueprintCompatibility(pickup, wrongFamily).compatible).toBe(false);
  const rejected = experienceSynthesis.synthesize({ graph: pickup, blueprint: wrongFamily });
  expect(rejected.blueprintSource).toBe('fallback');
  expect(rejected.family, 'the graph keeps its own world').toBe('journey-world');
  expect(rejected.decisions.find((decision) => decision.id === 'blueprint')!.outcome).toBe('rejected');

  // A compatible one may adjust presentation, and nothing else.
  const compatible = clientNormalize(
    {
      version: 1,
      template: {
        family: 'journey-world',
        primaryAxis: 'space',
        secondaryAxis: 'time',
        worldMetaphor: '<b>one map</b> where the drive and the airport share a clock'
      },
      questions: [
        {
          id: 'model-question',
          prompt: 'Which route do you prefer?',
          materialEffect: 'Changes the route drawn on the map.',
          expectedInformationGain: 0.9,
          userCost: 0.1,
          choices: [{ id: 'a', label: 'I-5' }]
        }
      ]
    },
    'sol-generated'
  )!;
  const accepted = experienceSynthesis.synthesize({ graph: pickup, blueprint: compatible });
  expect(accepted.blueprintSource).toBe('sol-generated');
  expect(accepted.family).toBe('journey-world');
  // The compiler is still the only thing that draws, and markup never survives.
  expect(accepted.blueprint.template.worldMetaphor).not.toContain('<');
  expect(accepted.decisions.map((decision) => decision.id)).toContain('blueprint-questions');
  expect(
    accepted.questionContract.asked.map((entry) => entry.id),
    'presentation cannot ask a person anything'
  ).not.toContain('model-question');
});

test('the presentation engine cannot fetch, locate, or reach a provider', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'intent-to-world', 'experience-synthesis', 'index.ts'),
    'utf8'
  );
  const imports = [...source.matchAll(/^import[\s\S]*?from '([^']+)';/gm)].map((match) => match[1]).sort();
  expect(imports, 'Core 2 sees the graph and the compiler, and nothing else').toEqual([
    '../situation-graph',
    './templateBlueprint',
    './templateCompiler'
  ]);
  for (const forbidden of ['fetch(', 'navigator.', 'XMLHttpRequest', 'localStorage']) {
    expect(source, `presentation must not contain ${forbidden}`).not.toContain(forbidden);
  }

  // And the graph contract itself stays inert: types, not behaviour.
  const contract = readFileSync(
    join(process.cwd(), 'src', 'intent-to-world', 'situation-graph', 'index.ts'),
    'utf8'
  );
  for (const forbidden of ['fetch(', 'navigator.', 'document.']) {
    expect(contract).not.toContain(forbidden);
  }
});

test('Intent-to-World cores have explicit folder boundaries', () => {
  const root = join(process.cwd(), 'src', 'intent-to-world');
  for (const path of [
    join(root, 'situation-intelligence', 'index.ts'),
    join(root, 'situation-intelligence', 'contextProviders.ts'),
    join(root, 'situation-intelligence', 'questionEconomics.ts'),
    join(root, 'situation-graph', 'index.ts'),
    join(root, 'experience-synthesis', 'index.ts'),
    join(root, 'experience-synthesis', 'templateBlueprint.ts'),
    join(root, 'experience-synthesis', 'templateCompiler.ts')
  ]) {
    expect(existsSync(path), `${path} should exist`).toBe(true);
  }
  for (const legacy of [
    'situationIntelligence.ts',
    'situationGraph.ts',
    'experienceSynthesis.ts',
    'contextProviders.ts'
  ]) {
    expect(existsSync(join(process.cwd(), 'src', legacy)), `${legacy} should be moved`).toBe(false);
  }

  const intelligence = readFileSync(
    join(root, 'situation-intelligence', 'index.ts'),
    'utf8'
  );
  expect(intelligence, 'Core 1 must not depend on Core 2').not.toContain('../experience-synthesis');
});

test('live Local News facts are folded after graph re-derivation, not erased by it', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'ui', 'app.ts'), 'utf8');
  const start = source.indexOf('function rebuildNewsWorld');
  const end = source.indexOf('async function refreshLiveNewsContext', start);
  const body = source.slice(start, end);
  expect(body.indexOf('applyNewsAnswers')).toBeGreaterThan(-1);
  expect(body.indexOf('foldLiveLocalContextIntoGraph(state.news.liveContext)')).toBeGreaterThan(
    body.indexOf('applyNewsAnswers')
  );
});

test('the app routes on graph.kind and holds both engine artifacts', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await askTravelResolved(page);

  let state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.situation!.kind).toBe('travel-arrival');
  expect(state.situation!.chosenJob).toBeNull();
  expect(state.situation!.askedQuestionIds).toEqual(['travel-job']);
  expect(state.situation!.selectedQuestionIds).toEqual([]);
  expect(state.experience!.graphId, 'one graph, one experience').toBe(state.situation!.graphId);
  expect(state.questionsAsked).toBeLessThanOrEqual(2);

  await openPickup(page);
  state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.situation!.chosenJob).toBe('pickup');
  expect(state.situation!.needs.find((need) => need.id === 'graph-travel-itinerary')!.status).toBe('needs-consent');
  expect(state.situation!.unknownIds).toContain('checked-bag');
  expect(state.experience!.family).toBe('journey-world');
  expect(state.experience!.blueprintSource).toBe('fallback');
  expect(state.experience!.refusedQuestionIds).toContain('passenger-count');
  // Behaviour is unchanged: the same compiled template as before the refactor.
  expect(state.template).toEqual({ view: 'journey', primary: 'map', secondary: 'timeline', fxMode: 'journey' });

  const plan = await page.evaluate(() => window.__canvasBrowser.acquisitionPlan());
  expect(plan!.steps.some((step) => step.provider === 'microsoft-graph')).toBe(false);
  expect(plan!.deferred.some((step) => step.provider === 'microsoft-graph' && !step.executable)).toBe(true);

  // Choosing a place satisfies the need instead of asking again.
  await setOrigin(page);
  state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.situation!.needs.find((need) => need.id === 'origin-location')!.status).toBe('satisfied');
  expect(state.situation!.selectedQuestionIds).toHaveLength(0);
});

test('the news route builds its own graph, and the Signal Field is synthesised from it', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openSignalField(page);

  const state = await page.evaluate(() => window.__canvasBrowser.state());
  expect(state.situation!.kind).toBe('living-news');
  expect(state.experience!.family).toBe('signal-field');
  expect(state.experience!.templateLabel).toBe('Signal Field · field only');
  expect(state.situation!.needs.find((need) => need.id === 'graph-day-schedule')!.status).toBe('needs-consent');
  expect(state.questionsAsked, 'a fully-stated briefing costs no questions').toBe(0);
});

test('the Source sheet says why this world exists, and that Microsoft Graph is not connected', async ({ page }) => {
  await mockAgent(page, landedAnswer());
  await open(page);
  await openJourney(page);

  await page.locator('[data-node="sources-button"]').click();
  const sheet = page.locator('[data-node="sources-sheet"]');
  await expect(sheet).toContainText('Why this world · Situation Intelligence');
  await expect(sheet).toContainText('Read as travel-arrival');
  await expect(sheet).toContainText('considered and refused');
  await expect(sheet).toContainText('Why this world · Experience Synthesis');
  await expect(sheet).toContainText('Journey World');
  await expect(sheet).toContainText('derived:');
  await expect(sheet).toContainText('Microsoft Graph — Not connected');
  await expect(sheet).toContainText('Not connected · would use calendar/email/contact context for');
  await expect(sheet).toContainText('Calendars.Read');
  await expect(sheet).toContainText('no account is linked');
});

test('product-research opens the visual Compare surface — option cards, a best pick, no links', async ({ page }) => {
  const compareJson = JSON.stringify({
    headline: 'The M3 Air is the best all-round pick.',
    options: [
      { name: 'MacBook Air M3', price: '$1099', rating: 4.6, best: true, pros: ['light', 'battery'], cons: ['256GB base'] },
      { name: 'Dell XPS 13', price: '$999', rating: 4.2, pros: ['price'], cons: ['fan noise'] }
    ],
    verdict: 'Best balance of battery and performance.'
  });
  await mockAgent(page, compareJson);
  await open(page);
  await askRaw(page, 'best laptop 2024');

  await expect(page.locator('[data-node="decision"]')).toBeVisible();
  await expect(page.locator('[data-node="decision-headline"]')).toContainText('M3 Air');
  await expect(page.locator('[data-node="compare-option"]')).toHaveCount(2);
  await expect(page.locator('.compare-option--best')).toHaveCount(1);
  await expect(page.locator('[data-node="compare-verdict"]')).toContainText('battery');
  await expect(page.locator('[data-node="decision"] a')).toHaveCount(0);
  await expect(page.locator('[data-node="decision-refine-input"]')).toBeVisible();

  // The ambiguous news question still keeps its literal-plus-offer path.
  await page.locator('[data-node="back-home"]').click();
  await askRaw(page, NEWS_LITERAL_PROMPT);
  await waitForResearch(page);
  await expect(page.locator('[data-node="news-offer"]')).toBeVisible();
  await expect(page.locator('[data-node="decision"]')).toHaveCount(0);
});

test('urgent symptoms open the visual Triage surface — severity, emergency action, no links', async ({ page }) => {
  const triageJson = JSON.stringify({
    severity: 'emergency',
    headline: 'Chest pain with breathlessness can be serious.',
    actNow: ['Stop activity and sit down', 'Chew aspirin if not allergic'],
    emergency: ['Pain spreading to arm or jaw', 'Fainting'],
    causes: ['Muscle strain', 'Anxiety']
  });
  await mockAgent(page, triageJson);
  await open(page);
  await askRaw(page, 'chest pain and shortness of breath');

  await expect(page.locator('[data-node="triage-banner"]')).toHaveClass(/triage-banner--emergency/);
  await expect(page.locator('[data-node="triage-severity"]')).toContainText('emergency');
  await expect(page.locator('[data-node="triage-emergency"]')).toBeVisible();
  await expect(page.locator('[data-node="triage-actnow"] li')).not.toHaveCount(0);
  await expect(page.locator('[data-node="decision"] a')).toHaveCount(0);
});

test('the header brand returns home, and the scenario dropdown runs a wired scenario', async ({ page }) => {
  const compareJson = JSON.stringify({
    headline: 'The M3 Air is the pick.',
    options: [{ name: 'MacBook Air M3', price: '$1099', rating: 4.6, best: true, pros: ['light'], cons: ['storage'] }],
    verdict: 'Best all-round.'
  });
  await mockAgent(page, compareJson);
  await open(page);

  // The quick picker lists the wired scenarios; choosing one runs it, and the
  // result is the assembled visual surface.
  await page.locator('[data-node="scenario-menu"]').click();
  await page.locator('[data-node="scenario-menu-item-product-research"]').click();
  await expect(page.locator('[data-node="decision"]')).toBeVisible();
  await expect(page.locator('[data-node="compare-option"]')).not.toHaveCount(0);

  // The brand is now a control that returns to Home.
  await page.locator('[data-node="brand"]').click();
  await expect(page.locator('[data-node="home"]')).toBeVisible();
  await expect(page.locator('[data-node="display-question"]')).toHaveText(
    'What are you actually trying to do?'
  );
});

test('a real-estate query opens the spatial place world — map, drive times, no links', async ({ page }) => {
  // The static test server has no routing gateway; stub it so the estimate
  // stands and no 404 noise trips the console-error guard.
  await page.route('**/api/route', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ minutes: [] }) })
  );
  await open(page);
  await askRaw(page, 'Apartments for rent in Austin');

  // A location decision opens the map world instantly — no model call, no links.
  await expect(page.locator('[data-node="decision"]')).toBeVisible();
  await expect(page.locator('[data-node="place-plot"]')).toBeVisible();
  await expect(page.locator('[data-node="decision-headline"]')).toContainText('Best fit');

  // Neighborhoods are placed on a true-to-scale aerial (pins) and compared graphically.
  await expect(page.locator('[data-node^="place-pin-"]')).not.toHaveCount(0);
  await expect(page.locator('[data-node="place-map-base"]')).toHaveCount(1);
  await expect(page.locator('[data-node^="place-row-"]')).not.toHaveCount(0);
  await expect(page.locator('[data-node="decision"] a')).toHaveCount(0);

  // Space → time: re-anchoring the office re-times the map.
  await page.locator('[data-node="place-anchor-airport"]').click();
  await expect(page.locator('[data-node="place-anchor-airport"]')).toHaveClass(/place-anchor-chip--on/);
  await expect(page.locator('[data-node="place-plot"]')).toBeVisible();

  // The alternative direction is one tap away and re-roots the map.
  await expect(page.locator('[data-node="decision-alternative"]')).toContainText('Relocating (solo)');
  await page.locator('[data-node="decision-alternative"]').click();
  await expect(page.locator('[data-node="decision-alternative"]')).toContainText('Relocating with family');
});
