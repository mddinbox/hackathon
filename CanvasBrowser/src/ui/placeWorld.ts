/**
 * The Place Decision World — where a "where to live" answer is made in space
 * and time, not paragraphs.
 *
 * A schematic map carries the candidate neighborhoods at their true *relative*
 * positions — north up, correct bearings — each tied to the anchor (the office)
 * by a line labelled with a drive time, so distance is read in minutes, the way
 * a person actually weighs it. It is a diagram, not satellite tiles: precise
 * pins cannot be aligned over a cross-origin Bing base, so the real map is one
 * honest handoff away instead of a wrong overlay. Beside it the trade-offs are
 * drawn, not written; the recommendation leads; and moving the office with one
 * line of refine text re-times the whole map.
 */
import {
  BING_EMBED_WIDTH,
  bingFieldBase,
  fieldEmbedUrlForBox,
  isAllowedBingEmbed,
  projectToEmbed,
  viewportFor
} from '../bingMap';
import { brandRow } from './chrome';
import { h, s } from './dom';
import type { ViewContext } from './state';
import type { PlaceWorld, PlacedNeighborhood } from '../intent-to-world/situation-intelligence/scenarios/places/cities';

let placeBaseFrame: HTMLIFrameElement | null = null;
let placeResizeObserver: ResizeObserver | null = null;
let observedPlacePlot: HTMLElement | null = null;
let placeResizeFrame = 0;

/**
 * A true-to-scale aerial base with the neighborhoods and drive-time lines
 * projected onto it — the Journey/Signal pattern. The 1200-wide Bing frame is
 * scaled to fill the measured plot box and every point is placed by
 * `projectToEmbed`, so pins sit on their real coordinates. The projection is
 * finished in `layoutPlaceWorld`, which runs after the box has a size.
 */
function mapPanel(
  ctx: ViewContext,
  world: PlaceWorld,
  center: { lat: number; lon: number },
  radiusMiles: number
): HTMLElement {
  const base = bingFieldBase({ lat: center.lat, lon: center.lon }, radiusMiles);
  const allowed = isAllowedBingEmbed(base.embedUrl);
  if (allowed && !placeBaseFrame) {
    placeBaseFrame = document.createElement('iframe');
    placeBaseFrame.className = 'place-map-base';
    placeBaseFrame.dataset.node = 'place-map-base';
    placeBaseFrame.title = 'Aerial map';
    placeBaseFrame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    placeBaseFrame.setAttribute('referrerpolicy', 'no-referrer');
    placeBaseFrame.setAttribute('loading', 'eager');
    placeBaseFrame.setAttribute('tabindex', '-1');
    placeBaseFrame.width = String(BING_EMBED_WIDTH);
  }

  const lines = s(
    'svg',
    { class: 'place-lines', 'data-node': 'place-lines', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    world.neighborhoods.map((n) =>
      s('line', {
        class: `place-route${n.id === world.recommendedId ? ' place-route--best' : ''}`,
        'data-node': `place-line-${n.id}`
      })
    )
  );

  const anchorEl = h(
    'div',
    {
      class: 'place-anchor',
      'data-node': 'place-anchor',
      'data-lat': String(world.anchor.lat),
      'data-lon': String(world.anchor.lon)
    },
    [h('span', { class: 'place-anchor-dot' }, []), h('span', { class: 'place-anchor-name' }, [world.anchor.name])]
  );

  const pins = world.neighborhoods.map((n) => {
    const best = n.id === world.recommendedId;
    return h(
      'div',
      {
        class: `place-pin${best ? ' place-pin--best' : ''}`,
        'data-node': `place-pin-${n.id}`,
        'data-pin-id': n.id,
        'data-lat': String(n.lat),
        'data-lon': String(n.lon)
      },
      [
        h('span', { class: 'place-pin-dot' }, []),
        h('span', { class: 'place-pin-tip' }, [
          h('span', { class: 'place-pin-name' }, [n.name]),
          h('span', { class: 'place-pin-min' }, [`~${n.commuteMin}m`])
        ])
      ]
    );
  });

  const plot = h(
    'div',
    {
      class: 'place-plot',
      'data-node': 'place-plot',
      'data-center-lat': String(center.lat),
      'data-center-lon': String(center.lon),
      'data-radius-miles': String(radiusMiles)
    },
    [allowed && placeBaseFrame ? placeBaseFrame : null, lines, anchorEl, ...pins]
  );

  const openMap = h('button', { type: 'button', class: 'place-openmap', 'data-node': 'place-openmap' }, ['Open in Bing Maps ↗']);
  openMap.addEventListener('click', () =>
    window.open(`https://www.bing.com/maps?cp=${center.lat}~${center.lon}&lvl=12`, '_blank', 'noopener')
  );

  const ctrlBtn = (label: string, id: string, title: string, on: () => void): HTMLElement => {
    const button = h('button', { type: 'button', class: 'place-ctrl', 'data-node': `place-ctrl-${id}`, title, 'aria-label': title }, [label]);
    button.addEventListener('click', on);
    return button;
  };
  const controls = h('div', { class: 'place-controls', 'data-node': 'place-controls' }, [
    ctrlBtn('＋', 'zoom-in', 'Zoom in', () => ctx.actions.zoomPlace(0.65)),
    ctrlBtn('－', 'zoom-out', 'Zoom out', () => ctx.actions.zoomPlace(1.5)),
    ctrlBtn('↑', 'pan-up', 'Pan north', () => ctx.actions.panPlace(0.4, 0)),
    ctrlBtn('↓', 'pan-down', 'Pan south', () => ctx.actions.panPlace(-0.4, 0)),
    ctrlBtn('←', 'pan-left', 'Pan west', () => ctx.actions.panPlace(0, -0.4)),
    ctrlBtn('→', 'pan-right', 'Pan east', () => ctx.actions.panPlace(0, 0.4)),
    ctrlBtn('⟲', 'recenter', 'Reset view', () => ctx.actions.recenterPlace())
  ]);

  return h('section', { class: 'place-map-panel', 'data-node': 'place-map-panel' }, [
    plot,
    controls,
    h('span', { class: 'place-map-tag' }, [
      `${world.cityLabel} · ${world.routed ? 'live drive times' : 'drive times estimated'}`
    ]),
    openMap
  ]);
}

/**
 * Finish the projection once the plot has a measured size: scale the aerial
 * frame to fill it, then place the anchor, the pins, and the connecting lines by
 * `projectToEmbed`. Re-runs on resize. This is the same measured-alignment loop
 * the Signal Field uses, so the pins sit on their true coordinates.
 */
export function layoutPlaceWorld(root: ParentNode): void {
  const plot = root.querySelector<HTMLElement>('[data-node="place-plot"]');
  if (!plot) return;

  if (typeof ResizeObserver === 'function' && observedPlacePlot !== plot) {
    placeResizeObserver?.disconnect();
    observedPlacePlot = plot;
    placeResizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(placeResizeFrame);
      placeResizeFrame = requestAnimationFrame(() => layoutPlaceWorld(document));
    });
    placeResizeObserver.observe(plot);
  }

  const rect = plot.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const centerLat = Number(plot.dataset.centerLat);
  const centerLon = Number(plot.dataset.centerLon);
  const radiusMiles = Number(plot.dataset.radiusMiles);
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon) || !Number.isFinite(radiusMiles)) return;

  const base = bingFieldBase({ lat: centerLat, lon: centerLon }, radiusMiles);
  const view = viewportFor(base, rect.width, rect.height);

  const frame = root.querySelector<HTMLIFrameElement>('[data-node="place-map-base"]');
  if (frame) {
    const url = fieldEmbedUrlForBox(base, rect.width, rect.height);
    if (frame.dataset.baseKey !== url) {
      frame.src = url;
      frame.dataset.baseKey = url;
    }
    frame.width = String(BING_EMBED_WIDTH);
    frame.height = String(view.height);
    frame.style.setProperty('--place-map-scale-x', String(rect.width / BING_EMBED_WIDTH));
    frame.style.setProperty('--place-map-scale-y', String(rect.height / view.height));
  }

  let ax = 50;
  let ay = 50;
  const anchorEl = plot.querySelector<HTMLElement>('[data-node="place-anchor"]');
  if (anchorEl) {
    const p = projectToEmbed({ lat: Number(anchorEl.dataset.lat), lon: Number(anchorEl.dataset.lon) }, view);
    ax = p.x;
    ay = p.y;
    anchorEl.style.setProperty('--x', `${p.x}%`);
    anchorEl.style.setProperty('--y', `${p.y}%`);
  }

  for (const pin of plot.querySelectorAll<HTMLElement>('.place-pin[data-lat][data-lon]')) {
    const p = projectToEmbed({ lat: Number(pin.dataset.lat), lon: Number(pin.dataset.lon) }, view);
    pin.style.setProperty('--x', `${p.x}%`);
    pin.style.setProperty('--y', `${p.y}%`);
    const id = pin.dataset.pinId;
    const line = id ? root.querySelector<SVGLineElement>(`[data-node="place-line-${id}"]`) : null;
    if (line) {
      line.setAttribute('x1', String(ax));
      line.setAttribute('y1', String(ay));
      line.setAttribute('x2', String(p.x));
      line.setAttribute('y2', String(p.y));
    }
  }
}

function bar(value: number, max: number, extraClass = ''): HTMLElement {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  const fill = h('span', { class: `meter-fill ${extraClass}` }, []);
  fill.style.width = `${pct}%`;
  return h('span', { class: 'meter' }, [fill]);
}

function schoolDots(score: number): HTMLElement {
  const dots = Array.from({ length: 5 }, (_, i) =>
    h('span', { class: `school-dot${i < score ? ' school-dot--on' : ''}` }, [])
  );
  return h('span', { class: 'school-dots', 'aria-label': `schools ${score} of 5` }, dots);
}

function comparisonRow(world: PlaceWorld, p: PlacedNeighborhood): HTMLElement {
  const best = p.id === world.recommendedId;
  return h('div', { class: `place-row${best ? ' place-row--best' : ''}`, 'data-node': `place-row-${p.id}` }, [
    h('div', { class: 'place-row-head' }, [
      h('span', { class: 'place-row-name' }, [p.name]),
      best ? h('span', { class: 'place-row-badge' }, ['Best fit']) : null,
      h('span', { class: 'place-row-vibe' }, [p.vibe])
    ]),
    h('div', { class: 'place-metric' }, [
      h('span', { class: 'place-metric-label' }, ['Rent 2BR']),
      bar(p.rent2br - world.rentMin, world.rentMax - world.rentMin, 'meter-fill--rent'),
      h('span', { class: 'place-metric-val' }, [`~$${p.rent2br.toLocaleString()}`])
    ]),
    h('div', { class: 'place-metric' }, [
      h('span', { class: 'place-metric-label' }, ['Commute']),
      bar(p.commuteMin, world.commuteMax, 'meter-fill--commute'),
      h('span', { class: 'place-metric-val' }, [`~${p.commuteMin} min`])
    ]),
    h('div', { class: 'place-metric' }, [
      h('span', { class: 'place-metric-label' }, ['Schools']),
      schoolDots(p.schools)
    ])
  ]);
}

const DIRECTION_LABEL: Record<string, string> = {
  'relocate-family': 'Relocating with family',
  'relocate-solo': 'Relocating (solo)',
  invest: 'Investing'
};

export function renderPlaceWorld(ctx: ViewContext): HTMLElement {
  const world = ctx.state.placeWorld!;
  const best = world.neighborhoods.find((n) => n.id === world.recommendedId) ?? world.neighborhoods[0];

  const headline = best
    ? `Best fit: ${best.name} — ~$${best.rent2br.toLocaleString()}/mo, ~${best.commuteMin} min to ${world.anchor.name}.`
    : 'Assembling neighborhoods…';

  const lead = h('section', { class: 'place-lead', 'data-node': 'place-lead' }, [
    h('p', { class: 'decision-direction', 'data-node': 'decision-direction' }, [
      h('span', { class: 'decision-direction-tag' }, ['Looks like']),
      `${DIRECTION_LABEL[world.direction] ?? world.direction} · anchored to ${world.anchor.name}`
    ]),
    h('h1', { class: 'decision-headline', 'data-node': 'decision-headline' }, [headline])
  ]);

  const alternatives = h(
    'div',
    { class: 'place-anchor-picker', 'data-node': 'place-anchor-picker' },
    [
      h('span', { class: 'place-anchor-picker-label' }, ['Anchor commute to:']),
      ...world.anchors.map((anchor) => {
        const on = world.anchor.id === anchor.id;
        const button = h(
          'button',
          {
            type: 'button',
            class: `place-anchor-chip${on ? ' place-anchor-chip--on' : ''}`,
            'data-node': `place-anchor-${anchor.id}`
          },
          [anchor.name]
        );
        button.addEventListener('click', () => ctx.actions.reanchorPlace(anchor.id));
        return button;
      })
    ]
  );

  const radiusMiles = ctx.state.placeRadiusMiles ?? world.radiusMiles;
  const center = {
    lat: world.center.lat + ctx.state.placeCenterDLat,
    lon: world.center.lon + ctx.state.placeCenterDLon
  };
  const map = mapPanel(ctx, world, center, radiusMiles);

  const rows = h(
    'div',
    { class: 'place-rows', 'data-node': 'place-rows' },
    world.neighborhoods.slice(0, 6).map((n) => comparisonRow(world, n))
  );

  // Re-root direction (family ↔ invest) — teaches the engine, like the surface.
  const altDir = ctx.state.decisionPlan?.alternative ?? null;
  const rerootChip = altDir
    ? (() => {
        const button = h('button', { type: 'button', class: 'decision-alternative', 'data-node': 'decision-alternative' }, [
          h('span', { class: 'decision-alt-tag' }, ['Actually']),
          `${altDir.label}?`
        ]);
        button.addEventListener('click', () => ctx.actions.rerootDecision(altDir.id));
        return button;
      })()
    : null;

  const action = h('button', { type: 'button', class: 'decision-action', 'data-node': 'decision-action' }, [
    'Show live listings that match'
  ]);
  action.addEventListener('click', () => ctx.actions.actOnDecision());

  const refineInput = h('input', {
    type: 'text',
    class: 'decision-refine-input',
    'data-node': 'decision-refine-input',
    placeholder: 'Set your office or correct — e.g. “my office is near The Domain”, or “I’m investing”'
  }) as HTMLInputElement;
  const refineForm = h('form', { class: 'decision-refine' }, [
    refineInput,
    h('button', { type: 'submit', class: 'decision-refine-submit', 'data-node': 'decision-refine-submit' }, ['Refine'])
  ]);
  refineForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = refineInput.value.trim();
    if (text) ctx.actions.refineDecision(text);
  });

  const back = h('button', { type: 'button', class: 'link-button', 'data-node': 'back-home' }, ['Start over']);
  back.addEventListener('click', () => ctx.actions.backHome());

  const note = ctx.state.placeNote
    ? h('p', { class: 'place-note', 'data-node': 'place-note', role: 'status' }, [ctx.state.placeNote])
    : null;

  return h('div', { class: 'shell shell--place', 'data-node': 'decision' }, [
    brandRow(ctx, 'world'),
    h('main', { class: 'place-stage' }, [
      lead,
      alternatives,
      map,
      rows,
      h('div', { class: 'decision-actions' }, [action, rerootChip].filter(Boolean) as HTMLElement[]),
      refineForm,
      note,
      h('div', { class: 'decision-controls' }, [back])
    ])
  ]);
}
