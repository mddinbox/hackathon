/**
 * Signal Field — the Living News template.
 *
 * A feed answers "what was published". This world answers "what changed
 * around me, what actually reaches me, and what deserves attention in the
 * next few hours".
 *
 * The geometry is reach, not time: the person is the centre, rings are how
 * close a thing gets to them, size is impact, and a tether states whether
 * something arrives through the ground under their feet or through the market
 * axis at the edge. Light and dark are used by function — the field is a deep
 * atmospheric space because spatial contrast reads best there, and the
 * briefing ribbon is warm light because that is where reading happens.
 */
import { LAYER_LABELS, NEWS_PLACES } from '../newsFixtures';
import type { LayerId } from '../newsIntent';
import type { AxisSignal, PositionedSignal, SignalWorld } from '../newsPlanner';
import type { TruthKind } from '../types';
import { fxCanvas } from '../visualEngine';
import {
  BING_EMBED_WIDTH,
  bingFieldBase,
  fieldEmbedUrlForBox,
  isAllowedBingEmbed,
  kmToPercentX,
  kmToPercentY,
  projectToEmbed,
  viewportFor
} from '../bingMap';
import { brandRow } from './chrome';
import { h, s } from './dom';
import type { ViewContext } from './state';

const TRUTH_LABEL: Record<TruthKind, string> = {
  observed: 'Observed',
  modeled: 'Modeled',
  inferred: 'Inferred',
  unknown: 'Unavailable'
};

const LAYER_ORDER: LayerId[] = ['local', 'markets', 'weather', 'mobility'];
const RADIUS_PRESETS = [5, 25, 60, 120] as const;
const LAYER_DESCRIPTIONS: Record<LayerId, string> = {
  local: 'City, civic, and neighborhood headlines',
  markets: 'Current index and market signals',
  weather: 'Weather, wind, air quality, and smoke',
  mobility: 'Road traffic, transit, ferries, and airport access disruptions'
};
let fieldBaseFrame: HTMLIFrameElement | null = null;
let observedFieldPlot: HTMLElement | null = null;
let fieldResizeObserver: ResizeObserver | null = null;
let fieldResizeFrame = 0;

function fieldMapFrame(world: SignalWorld): HTMLElement | null {
  const base = bingFieldBase({ lat: world.place.lat, lon: world.place.lon }, world.radiusMiles);
  if (!isAllowedBingEmbed(base.embedUrl)) return null;
  if (!fieldBaseFrame) {
    fieldBaseFrame = document.createElement('iframe');
    fieldBaseFrame.className = 'field-map-base';
    fieldBaseFrame.dataset.node = 'field-map-base';
    fieldBaseFrame.title = 'Static Bing aerial map for Local News';
    fieldBaseFrame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    fieldBaseFrame.setAttribute('referrerpolicy', 'no-referrer');
    fieldBaseFrame.setAttribute('loading', 'eager');
    fieldBaseFrame.setAttribute('tabindex', '-1');
    fieldBaseFrame.width = String(BING_EMBED_WIDTH);
  }
  if (fieldBaseFrame.dataset.baseKey !== base.embedUrl) {
    fieldBaseFrame.src = base.embedUrl;
    fieldBaseFrame.dataset.baseKey = base.embedUrl;
  }
  return h('div', { class: 'field-map-frame', 'data-node': 'field-map-frame', 'aria-hidden': 'true' }, [
    fieldBaseFrame,
    h('div', { class: 'field-map-wash', 'aria-hidden': 'true' })
  ]);
}

/** Rings and tethers share one coordinate space with the positioned signals. */
function geometry(world: SignalWorld): SVGSVGElement {
  const region = world.rings.find((ring) => ring.id === 'region')!;
  const boundary = s('ellipse', {
    class: 'field-reach-boundary',
    'data-node': 'field-reach-boundary',
    cx: world.centerX,
    cy: 50,
    rx: region.rx,
    ry: region.ry,
    'vector-effect': 'non-scaling-stroke'
  });
  const weatherAreas = world.signals
    .filter((signal) => signal.weatherArea)
    .map((signal) => {
      const weather = signal.weatherArea!;
      const vectorLabel = s('text', {
        class: 'field-weather-vector-label',
        x: signal.x,
        y: signal.y,
        'text-anchor': 'middle'
      });
      vectorLabel.textContent = 'WIND';
      return s(
        'g',
        {
          class: 'field-weather-area',
          'data-node': `weather-area-${signal.id}`,
          'data-weather-id': signal.id,
          'data-radius-miles': String(weather.radiusMiles),
          'data-intensity': String(weather.intensity),
          'data-wind-degrees': String(weather.windDegrees),
          'aria-hidden': 'true'
        },
        [
          s('ellipse', {
            class: 'field-weather-footprint',
            cx: signal.x,
            cy: signal.y,
            rx: 8,
            ry: 8,
            'vector-effect': 'non-scaling-stroke'
          }),
          s('line', {
            class: 'field-weather-wind',
            x1: signal.x,
            y1: signal.y,
            x2: signal.x,
            y2: signal.y,
            'vector-effect': 'non-scaling-stroke'
          }),
          s('polygon', {
            class: 'field-weather-arrow',
            points: `${signal.x},${signal.y} ${signal.x},${signal.y} ${signal.x},${signal.y}`
          }),
          vectorLabel
        ]
      );
    });

  const tethers = world.signals
    .filter((signal) => signal.layer === 'mobility' && signal.impact >= 0.65)
    .map((signal) =>
    s('line', {
      class: 'field-tether',
      'data-node': `tether-${signal.id}`,
      'data-tether': signal.tether,
      'data-layer': signal.layer,
      'data-truth': signal.truth,
      x1: signal.x,
      y1: signal.y,
      x2: signal.tetherX,
      y2: signal.tetherY,
      'vector-effect': 'non-scaling-stroke'
    })
    );

  return s(
    'svg',
    {
      class: 'field-geometry',
      'data-node': 'field-geometry',
      viewBox: '0 0 100 100',
      preserveAspectRatio: 'none',
      'aria-hidden': 'true',
      focusable: 'false'
    },
    [boundary, ...weatherAreas, ...tethers]
  );
}

function ringLabels(world: SignalWorld): HTMLElement {
  const items: HTMLElement[] = [];
  const outer = world.rings.find((ring) => ring.id === 'region')!;
  const reach = h('li', { class: 'ring-label ring-label--reach', 'data-ring': 'selected' }, [
    h('span', { class: 'ring-name' }, ['Reach']),
    h('span', { class: 'ring-count' }, [`≤ ${world.radiusMiles} mi`])
  ]);
  reach.style.setProperty('--x', '8%');
  reach.style.setProperty('--y', '90%');
  items.push(reach);

  const compass: Array<[string, number]> = [
    ['N', 0],
    ['E', 90],
    ['S', 180],
    ['W', 270]
  ];
  for (const [letter, bearing] of compass) {
    const radians = (bearing * Math.PI) / 180;
    const point = h('li', { class: 'compass-mark' }, [letter]);
    point.style.setProperty('--x', `${world.centerX + outer.rx * 1.14 * Math.sin(radians)}%`);
    point.style.setProperty('--y', `${50 - outer.ry * 1.14 * Math.cos(radians)}%`);
    items.push(point);
  }

  return h('ul', { class: 'ring-labels', 'data-node': 'reach-rings', 'aria-hidden': 'true' }, items);
}

function placePicker(ctx: ViewContext): HTMLElement | null {
  if (!ctx.state.news.placesVisible) return null;

  const useLocation = h('button', { type: 'button', class: 'ghost-button', 'data-node': 'field-use-location' }, [
    'Use my location'
  ]);
  useLocation.addEventListener('click', () => void ctx.actions.useNewsLocation());

  const places = NEWS_PLACES.map((place) => {
    const button = h('button', { type: 'button', class: 'place place--field', 'data-node': `news-place-${place.id}` }, [
      h('span', { class: 'place-name' }, [place.label])
    ]);
    button.addEventListener('click', () => ctx.actions.chooseNewsPlace(place.id));
    return h('li', {}, [button]);
  });

  return h('div', { class: 'center-places', 'data-node': 'field-place-options' }, [
    h('ul', { class: 'place-list' }, places),
    useLocation,
    h('p', { class: 'center-places-note' }, [
      'Coarse category only. Your coordinates never leave this device and are never sent to a model.'
    ])
  ]);
}

function centerCluster(ctx: ViewContext, world: SignalWorld): HTMLElement {
  const placeButton = h(
    'button',
    {
      type: 'button',
      class: 'center-place',
      'data-node': 'field-place-button',
      'data-place-truth': ctx.state.news.placeTruth,
      'aria-expanded': ctx.state.news.placesVisible ? 'true' : 'false'
    },
    [
      ctx.state.news.placeTruth === 'inferred'
        ? 'sample place · change'
        : ctx.state.news.placeTruth === 'coarse-location'
          ? 'from your device · change'
          : 'you chose this · change'
    ]
  );
  placeButton.addEventListener('click', () => ctx.actions.toggleNewsPlaces());

  const cluster = h('div', { class: 'field-center', 'data-node': 'field-center' }, [
    h('span', { class: 'center-pulse', 'aria-hidden': 'true' }),
    h('p', { class: 'center-label', 'data-node': 'field-center-label' }, [
      h('span', { class: 'center-you' }, ['YOU']),
      h('span', { class: 'center-dot' }, ['·']),
      h('span', { class: 'center-place-name', 'data-node': 'field-place' }, [world.place.label]),
      h('span', { class: 'center-dot' }, ['·']),
      h('span', { class: 'center-clock', 'data-node': 'field-clock' }, [world.clockLabel])
    ]),
    placeButton,
    placePicker(ctx)
  ]);
  cluster.style.setProperty('--x', `${world.centerX}%`);
  cluster.style.setProperty('--y', '50%');
  return cluster;
}

/** Labels sit on the outward side of the dot: never toward the centre. */
function labelPlacement(angleDeg: number): 'above' | 'right' | 'below' | 'left' {
  const angle = ((angleDeg % 360) + 360) % 360;
  if (angle < 40 || angle >= 320) return 'above';
  if (angle < 140) return 'right';
  if (angle < 220) return 'below';
  return 'left';
}

/* --------------------------------------------------------------------- */
/* Direct type on the field                                               */
/* --------------------------------------------------------------------- */

/**
 * Signal names are set directly on the field — content width, no plate, no
 * border — so the world reads as a space with type in it rather than a
 * scatter of grey chips. That only works if type never lands on something
 * that carries meaning, so the anchor (`YOU · place · time`), the reach ring
 * names, the compass and the market axis are treated as no-fly rectangles and
 * each label is pushed outward along its own bearing until it is clear.
 *
 * The dots never move: only the type slides, which is why the geometry stays
 * truthful.
 */
const NO_FLY_SELECTORS = [
  '[data-node="field-center-label"]',
  '.center-place',
  '.center-places',
  '.ring-label',
  '.compass-mark',
  '[data-node="market-axis"]'
];

const LABEL_GAP = 8;
const PUSH_STEP = 12;
const RADIAL_STEPS = 16;
const TANGENT_STEPS = 8;

function overlapArea(a: DOMRect, b: DOMRect, gap: number): number {
  const width = Math.min(a.right + gap, b.right) - Math.max(a.left - gap, b.left);
  const height = Math.min(a.bottom + gap, b.bottom) - Math.max(a.top - gap, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

function contains(outer: DOMRect, inner: DOMRect): boolean {
  return (
    inner.left >= outer.left - 1 &&
    inner.right <= outer.right + 1 &&
    inner.top >= outer.top - 1 &&
    inner.bottom <= outer.bottom + 1
  );
}

/**
 * Candidate offsets, nearest first: straight out along the bearing, then out
 * with a tangential slide. Sorting by distance means a label only moves as far
 * as it has to, so the type still reads as belonging to its dot.
 */
function candidateOffsets(): Array<{ radial: number; tangent: number; distance: number }> {
  const list: Array<{ radial: number; tangent: number; distance: number }> = [];
  for (let r = 0; r <= RADIAL_STEPS; r++) {
    for (let t = -TANGENT_STEPS; t <= TANGENT_STEPS; t++) {
      const radial = r * PUSH_STEP;
      const tangent = t * PUSH_STEP;
      list.push({ radial, tangent, distance: Math.hypot(radial, tangent) });
    }
  }
  return list.sort((a, b) => a.distance - b.distance);
}

const OFFSETS = candidateOffsets();

/**
 * Runs after layout, because the only honest way to keep type off the anchor
 * is to measure it. Cheap: a handful of signals, a bounded candidate set.
 */
export function layoutFieldLabels(root: ParentNode): void {
  const plot = root.querySelector<HTMLElement>('[data-node="field-plot"]');
  const stage = root.querySelector<HTMLElement>('[data-node="world"]');
  const centre = root.querySelector<HTMLElement>('[data-node="field-center"]');
  if (!plot || !stage || !centre) return;

  if (typeof ResizeObserver === 'function' && observedFieldPlot !== plot) {
    fieldResizeObserver?.disconnect();
    observedFieldPlot = plot;
    fieldResizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(fieldResizeFrame);
      fieldResizeFrame = requestAnimationFrame(() => layoutFieldLabels(document));
    });
    fieldResizeObserver.observe(plot);
  }

  // The phone view is a static list, but the observer remains installed so
  // widening across the breakpoint projects map anchors immediately.
  if (getComputedStyle(plot).position === 'static') return;

  const plotRect = plot.getBoundingClientRect();
  const centerLat = Number(stage.dataset.centerLat);
  const centerLon = Number(stage.dataset.centerLon);
  const radiusMiles = Number(stage.dataset.radiusMiles);
  const frame = root.querySelector<HTMLIFrameElement>('[data-node="field-map-base"]');
  if (
    frame &&
    Number.isFinite(centerLat) &&
    Number.isFinite(centerLon) &&
    Number.isFinite(radiusMiles)
  ) {
    const base = bingFieldBase({ lat: centerLat, lon: centerLon }, radiusMiles);
    const view = viewportFor(base, plotRect.width, plotRect.height);
    const url = fieldEmbedUrlForBox(base, plotRect.width, plotRect.height);
    if (frame.src !== url) frame.src = url;
    frame.width = String(BING_EMBED_WIDTH);
    frame.height = String(view.height);
    frame.style.setProperty('--field-map-scale-x', String(plotRect.width / BING_EMBED_WIDTH));
    frame.style.setProperty('--field-map-scale-y', String(plotRect.height / view.height));
    const boundary = root.querySelector<SVGEllipseElement>('[data-node="field-reach-boundary"]');
    const radiusKm = radiusMiles * 1.60934;
    boundary?.setAttribute('cx', '50');
    boundary?.setAttribute('cy', '50');
    boundary?.setAttribute('rx', String(kmToPercentX(radiusKm, view)));
    boundary?.setAttribute('ry', String(kmToPercentY(radiusKm, view)));

    for (const signal of root.querySelectorAll<HTMLElement>('button.signal[data-lat][data-lon]')) {
      const lat = Number(signal.dataset.lat);
      const lon = Number(signal.dataset.lon);
      const point = projectToEmbed({ lat, lon }, view);
      signal.style.setProperty('--x', `${point.x}%`);
      signal.style.setProperty('--y', `${point.y}%`);
      const id = signal.dataset.signalId;
      const tether = id
        ? root.querySelector<SVGLineElement>(`[data-node="tether-${id}"]`)
        : null;
      tether?.setAttribute('x1', String(point.x));
      tether?.setAttribute('y1', String(point.y));
    }

    for (const area of root.querySelectorAll<SVGGElement>('[data-weather-id]')) {
      const signal = root.querySelector<HTMLElement>(
        `[data-signal-id="${area.dataset.weatherId}"]`
      );
      if (!signal) continue;
      const point = projectToEmbed(
        { lat: Number(signal.dataset.lat), lon: Number(signal.dataset.lon) },
        view
      );
      const radiusKm = Number(area.dataset.radiusMiles) * 1.60934;
      const rx = kmToPercentX(radiusKm, view);
      const ry = kmToPercentY(radiusKm, view);
      const intensity = Math.max(0, Math.min(1, Number(area.dataset.intensity)));
      area.style.setProperty('--weather-intensity', String(intensity));
      for (const ellipse of area.querySelectorAll<SVGEllipseElement>('ellipse')) {
        const scale = 1;
        ellipse.setAttribute('cx', String(point.x));
        ellipse.setAttribute('cy', String(point.y));
        ellipse.setAttribute('rx', String(rx * scale));
        ellipse.setAttribute('ry', String(ry * scale));
      }
      const radians = (Number(area.dataset.windDegrees) * Math.PI) / 180;
      const wind = area.querySelector<SVGLineElement>('.field-weather-wind');
      wind?.setAttribute('x1', String(point.x - Math.sin(radians) * rx * 0.55));
      wind?.setAttribute('y1', String(point.y + Math.cos(radians) * ry * 0.55));
      wind?.setAttribute('x2', String(point.x + Math.sin(radians) * rx * 0.55));
      wind?.setAttribute('y2', String(point.y - Math.cos(radians) * ry * 0.55));
      const tipX = point.x + Math.sin(radians) * rx * 0.55;
      const tipY = point.y - Math.cos(radians) * ry * 0.55;
      const dx = Math.sin(radians);
      const dy = -Math.cos(radians);
      const px = -dy;
      const py = dx;
      const baseX = tipX - dx * 2.1;
      const baseY = tipY - dy * 2.1;
      area
        .querySelector<SVGPolygonElement>('.field-weather-arrow')
        ?.setAttribute(
          'points',
          `${tipX},${tipY} ${baseX + px * 1.25},${baseY + py * 1.25} ${baseX - px * 1.25},${baseY - py * 1.25}`
        );
      const vectorLabel = area.querySelector<SVGTextElement>('.field-weather-vector-label');
      vectorLabel?.setAttribute('x', String(point.x - dx * rx * 0.68));
      vectorLabel?.setAttribute('y', String(point.y - dy * ry * 0.68));
    }
  }

  const stageRect = stage.getBoundingClientRect();
  const centreRect = centre.getBoundingClientRect();
  const originX = centreRect.left + centreRect.width / 2;
  const originY = centreRect.top + centreRect.height / 2;

  const blockers: DOMRect[] = [];
  for (const selector of NO_FLY_SELECTORS) {
    for (const node of root.querySelectorAll<HTMLElement>(selector)) {
      blockers.push(node.getBoundingClientRect());
    }
  }

  const signals = [...root.querySelectorAll<HTMLElement>('button.signal[data-node^="signal-"]')].sort(
    (a, b) => Number(b.style.getPropertyValue('--size') || 1) - Number(a.style.getPropertyValue('--size') || 1)
  );

  // Dots never move, so they are measured once and treated as no-fly too: a
  // name may never cover another signal's position.
  const dots = signals.map((signal) => ({
    signal,
    rect: (signal.querySelector<HTMLElement>('.signal-dot') ?? signal).getBoundingClientRect()
  }));

  for (const signal of signals) {
    const label = signal.querySelector<HTMLElement>('.signal-label');
    if (!label) continue;

    const dotRect = dots.find((entry) => entry.signal === signal)!.rect;
    const obstacles = [...blockers, ...dots.filter((entry) => entry.signal !== signal).map((entry) => entry.rect)];
    let vx = dotRect.left + dotRect.width / 2 - originX;
    let vy = dotRect.top + dotRect.height / 2 - originY;
    const length = Math.hypot(vx, vy) || 1;
    vx /= length;
    vy /= length;
    const px = -vy;
    const py = vx;

    let bestDx = 0;
    let bestDy = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const offset of OFFSETS) {
      const dx = Math.round(vx * offset.radial + px * offset.tangent);
      const dy = Math.round(vy * offset.radial + py * offset.tangent);
      label.style.setProperty('--dx', `${dx}px`);
      label.style.setProperty('--dy', `${dy}px`);
      const rect = label.getBoundingClientRect();

      let score = 0;
      for (const blocker of obstacles) score += overlapArea(rect, blocker, LABEL_GAP);
      if (!contains(stageRect, rect)) score += 40_000;

      if (score < bestScore) {
        bestScore = score;
        bestDx = dx;
        bestDy = dy;
      }
      if (score === 0) break;
    }

    label.style.setProperty('--dx', `${bestDx}px`);
    label.style.setProperty('--dy', `${bestDy}px`);
    blockers.push(label.getBoundingClientRect());
  }
}

function signalNode(ctx: ViewContext, signal: PositionedSignal, centerX: number): HTMLElement {
  const node = h(
    'button',
    {
      type: 'button',
      class: 'signal',
      'data-node': `signal-${signal.id}`,
      'data-layer': signal.layer,
      'data-reach': signal.reach,
      'data-truth': signal.truth,
      'data-tether': signal.tether,
      'data-place': labelPlacement(signal.angleDeg),
      'data-side': signal.x < centerX ? 'left' : 'right',
      'data-detail': signal.layer === 'weather' ? 'weather' : signal.impact >= 0.55 ? 'high' : 'low',
      'data-provenance': signal.provenance,
      'data-anchor-precision': signal.anchorPrecision,
      'data-display':
        signal.layer === 'local' && signal.provenance === 'live' ? 'rail' : 'map',
      'data-signal-id': signal.id,
      'data-lat': String(signal.lat),
      'data-lon': String(signal.lon),
      'aria-label': `${signal.headline} — ${TRUTH_LABEL[signal.truth]}, ${signal.distanceLabel}, ${signal.stamp}${
        signal.weatherArea
          ? `, ${signal.weatherArea.condition}, ${signal.weatherArea.radiusMiles} mile footprint, wind toward ${signal.weatherArea.windDegrees} degrees`
          : ''
      }`
    },
    [
      h('span', { class: 'signal-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'signal-label' }, [
        h('span', { class: 'signal-short' }, [signal.short]),
        h('span', { class: 'signal-meta' }, [
          `${signal.distanceLabel} · ${signal.stamp} · ${signal.provenance === 'live' ? 'LIVE' : 'SAMPLE'}`
        ])
      ])
    ]
  );
  node.style.setProperty('--x', `${signal.x}%`);
  node.style.setProperty('--y', `${signal.y}%`);
  node.style.setProperty('--size', String(signal.size));
  node.addEventListener('click', () => ctx.actions.openSources());
  return node;
}

function localNewsRail(ctx: ViewContext, world: SignalWorld): HTMLElement | null {
  const entries = world.signals
    .filter((signal) => signal.layer === 'local' && signal.provenance === 'live')
    .slice(0, 4);
  if (entries.length === 0) return null;
  return h(
    'aside',
    {
      class: 'local-news-rail',
      'data-node': 'local-news-rail',
      role: 'region',
      'aria-label': 'Current local headlines'
    },
    [
      h('p', { class: 'local-news-rail-title' }, ['Current local']),
      h(
        'ol',
        { class: 'local-news-rail-list' },
        entries.map((entry, index) => {
          const button = h(
            'button',
            {
              type: 'button',
              class: 'local-news-rail-item',
              'data-node': `local-news-item-${entry.id}`
            },
            [
              h('span', { class: 'local-news-index' }, [String(index + 1).padStart(2, '0')]),
              h('span', { class: 'local-news-copy' }, [
                h('span', { class: 'local-news-headline' }, [entry.headline]),
                h('span', { class: 'local-news-meta' }, [
                  `${entry.source?.label ?? 'Public feed'} · ${entry.stamp}`
                ])
              ])
            ]
          );
          button.addEventListener('click', () => ctx.actions.openSources());
          return h('li', {}, [button]);
        })
      )
    ]
  );
}

function axisNode(ctx: ViewContext, entries: AxisSignal[]): HTMLElement {
  const rows = entries.map((entry) => {
    const row = h(
      'li',
      {
        class: 'axis-signal',
        'data-node': `market-signal-${entry.id}`,
        'data-direction': entry.direction,
        'data-truth': entry.truth,
        'data-provenance': entry.provenance
      },
      [
        h('span', { class: 'axis-move' }, [entry.move]),
        h('span', { class: 'axis-name' }, [entry.short]),
        h('span', { class: 'axis-when' }, [
          `${entry.when} · ${entry.stamp} · ${entry.provenance === 'live' ? 'LIVE' : 'SAMPLE'}`
        ])
      ]
    );
    row.style.setProperty('--y', `${entry.y}%`);
    return row;
  });

  return h(
    'aside',
    { class: 'market-axis', 'data-node': 'market-axis', role: 'group', 'aria-label': 'Market axis' },
    [
      h('span', { class: 'axis-spine', 'aria-hidden': 'true' }),
      h('p', { class: 'axis-title' }, ['Market']),
      h('ul', { class: 'axis-list' }, rows)
    ]
  );
}

function layerControls(ctx: ViewContext, world: SignalWorld): HTMLElement {
  const buttons = LAYER_ORDER.map((layer) => {
    const on = world.layers[layer];
    const button = h(
      'button',
      {
        type: 'button',
        class: 'layer-toggle',
        'data-node': `layer-${layer}`,
        'data-layer': layer,
        'data-active': on ? 'true' : 'false',
        'aria-pressed': on ? 'true' : 'false',
        'aria-label': `${LAYER_LABELS[layer]}: ${LAYER_DESCRIPTIONS[layer]}`,
        title: LAYER_DESCRIPTIONS[layer]
      },
      [h('span', { class: 'layer-swatch', 'aria-hidden': 'true' }), h('span', {}, [LAYER_LABELS[layer]])]
    );
    button.addEventListener('click', () => ctx.actions.toggleLayer(layer));
    return button;
  });

  return h(
    'div',
    { class: 'layer-controls', 'data-node': 'layer-controls', role: 'group', 'aria-label': 'Layers' },
    buttons
  );
}

function radiusControls(ctx: ViewContext, world: SignalWorld): HTMLElement {
  const buttons = RADIUS_PRESETS.map((radius) => {
    const active = world.radiusMiles === radius;
    const button = h(
      'button',
      {
        type: 'button',
        class: 'radius-preset',
        'data-node': `field-radius-${radius}`,
        'data-active': active ? 'true' : 'false',
        'aria-pressed': active ? 'true' : 'false'
      },
      [String(radius)]
    );
    button.addEventListener('click', () => {
      ctx.actions.editWorld(`only things within ${radius} miles`);
    });
    return button;
  });
  return h(
    'div',
    { class: 'radius-controls', 'data-node': 'field-radius-controls', role: 'group', 'aria-label': 'Reach in miles' },
    [h('span', { class: 'instrument-label' }, ['Reach']), ...buttons, h('span', { class: 'instrument-unit' }, ['mi'])]
  );
}

function instrumentRail(ctx: ViewContext, world: SignalWorld): HTMLElement {
  const base = bingFieldBase({ lat: world.place.lat, lon: world.place.lon }, world.radiusMiles);
  const map = h(
    'a',
    {
      class: 'field-map-open',
      'data-node': 'field-map-open',
      href: base.viewUrl,
      target: '_blank',
      rel: 'noopener noreferrer external',
      referrerpolicy: 'no-referrer'
    },
    ['Explore in Bing Maps ↗']
  );
  return h('div', { class: 'field-instrument-rail', 'data-node': 'field-instrument-rail' }, [
    layerControls(ctx, world),
    radiusControls(ctx, world),
    h('p', { class: 'field-statusline', 'data-node': 'field-freshness' }, [world.freshnessLine]),
    map
  ]);
}

function briefing(ctx: ViewContext, world: SignalWorld): HTMLElement {
  const consequences =
    world.consequences.length > 0
      ? h(
          'ol',
          { class: 'consequences', 'data-node': 'briefing-consequences' },
          world.consequences.map((item, index) =>
            h(
              'li',
              {
                class: 'consequence',
                'data-node': `consequence-${index + 1}`,
                'data-layer': item.layer,
                'data-truth': item.truth
              },
              [
                h('span', { class: 'consequence-rank', 'aria-hidden': 'true' }, [String(index + 1)]),
                h('div', { class: 'consequence-body' }, [
                  h('p', { class: 'consequence-text' }, [item.text]),
                  h('p', { class: 'consequence-source' }, [
                    `${TRUTH_LABEL[item.truth]} · ${item.sourceLabel} · ${
                      item.provenance === 'live' ? 'LIVE' : 'SAMPLE'
                    }`
                  ])
                ])
              ]
            )
          )
        )
      : h('p', { class: 'consequence-empty', 'data-node': 'briefing-empty' }, [
          'Nothing in this field reaches the horizon you chose. That is the answer, not an empty state.'
        ]);

  const absence =
    world.absences.length > 0
      ? h(
          'ul',
          { class: 'absence-list', 'data-node': 'field-absence' },
          world.absences.map((entry) =>
            h('li', { class: 'absence', 'data-absence': entry.id }, [
              h('span', { class: 'absence-title' }, [entry.title]),
              h('span', { class: 'absence-reason' }, [`${entry.reason} ${entry.unblocker}`])
            ])
          )
        )
      : null;

  return h(
    'section',
    {
      class: 'briefing',
      'data-node': 'briefing-ribbon',
      'data-surface': 'light',
      role: 'region',
      'aria-label': 'Decision envelope'
    },
    [
      h('div', { class: 'briefing-head' }, [
        h('h2', { class: 'briefing-title', 'data-node': 'briefing-title' }, [world.horizonLabel])
      ]),
      consequences,
      absence
    ]
  );
}

function fieldControls(ctx: ViewContext, world: SignalWorld): HTMLElement {
  const input = h('input', {
    type: 'text',
    class: 'followup-input',
    'data-node': 'field-followup',
    'aria-label': 'Reshape this world',
    placeholder: 'hide markets'
  });
  const form = h('form', { class: 'followup' }, [
    input,
    h('button', { type: 'submit', class: 'ghost-button', 'data-node': 'field-followup-apply' }, ['Apply'])
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (ctx.actions.editWorld(input.value)) input.value = '';
  });

  const sources = h('button', { type: 'button', class: 'ghost-button', 'data-node': 'sources-button' }, ['Sources']);
  sources.addEventListener('click', () => ctx.actions.openSources());

  const back = h('button', { type: 'button', class: 'link-button', 'data-node': 'back-home' }, ['Start over']);
  back.addEventListener('click', () => ctx.actions.backHome());

  const notes = ctx.state.news.notes;
  const noteLine =
    notes.length > 0
      ? h('p', { class: 'field-notes', 'data-node': 'field-notes' }, [
          `${notes[notes.length - 1]} · radius ${world.radiusMiles} mi${world.focus === 'commute' ? ' · commute focus' : ''}`
        ])
      : null;

  return h('div', { class: 'field-controls' }, [form, sources, back, noteLine]);
}

export function renderSignalField(ctx: ViewContext): HTMLElement {
  const world = ctx.state.news.world;
  if (!world) return h('div', { class: 'shell' }, []);

  const plot = h(
    'div',
    { class: 'field-plot', 'data-node': 'field-plot' },
    [
      geometry(world),
      ringLabels(world),
      centerCluster(ctx, world),
      ...world.signals.map((signal) => signalNode(ctx, signal, world.centerX))
    ]
  );
  plot.style.setProperty('--center-x', `${world.centerX}%`);

  const stage = h(
    'div',
    {
      class: 'field-stage',
      'data-node': 'world',
      'data-surface': 'dark',
      'data-markets': world.layers.markets ? 'on' : 'off',
      'data-center-lat': String(world.place.lat),
      'data-center-lon': String(world.place.lon),
      'data-radius-miles': String(world.radiusMiles),
      'data-revision': String(ctx.state.worldRevision)
    },
    [
      fieldMapFrame(world),
      // The spatial field itself: density, radial energy from YOU, orbiting
      // signal dust, and market currents — all beneath the readable geometry.
      fxCanvas('news'),
      h('div', { class: 'field-atmosphere', 'aria-hidden': 'true' }),
      plot,
      localNewsRail(ctx, world),
      world.axis && world.axis.length > 0 ? axisNode(ctx, world.axis) : null
    ]
  );
  stage.style.setProperty('--center-x', `${world.centerX}%`);

  return h('div', { class: 'shell shell--field', 'data-node': 'field-shell' }, [
    brandRow(ctx, 'world'),
    h(
      'main',
      { class: 'field', 'data-node': 'signal-field', role: 'region', 'aria-label': 'Signal field' },
      [instrumentRail(ctx, world), stage, briefing(ctx, world), fieldControls(ctx, world)]
    )
  ]);
}
