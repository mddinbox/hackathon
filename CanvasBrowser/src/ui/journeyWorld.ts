/**
 * Journey World — the generated template for an airport pickup.
 *
 * This is not a map widget beside a dashboard. It is one world in which the
 * drive and the arrival share a single clock: the route is the dominant plane,
 * every force that could touch the trip is drawn *where it acts*, and the
 * arrival-processing terrain is a linked strip along the bottom rather than a
 * second screen.
 *
 * The geography is real. A sandboxed Bing Maps embed is the base layer, built
 * from coordinates by `bingMap.ts` — no key, no model-provided URL, no
 * referrer — so the streets, water and interchanges under the route are the
 * ones the driver will actually meet. Everything CanvasBrowser knows is drawn
 * *above* it as annotation: route load, the weather cell, airport rules, NOW.
 * If the frame cannot load, the illustrative SVG stands in and the world says
 * so rather than going blank.
 *
 * The blueprint chose this template; the compiler chose which layers may be
 * drawn. Nothing here executes anything a model wrote.
 */
import {
  BING_EMBED_HEIGHT,
  BING_EMBED_WIDTH,
  embedHeightFor,
  embedUrlForBox,
  isAllowedBingEmbed,
  kmToPercentX,
  kmToPercentY,
  projectToEmbed,
  viewportFor,
  type BingBase
} from '../bingMap';
import { STOP_OPTIONS, TERRAIN_SHAPES, type GeoPoint } from '../journeyFixtures';
import {
  fanLabels,
  geoAlong,
  pointAlong,
  routeBearing,
  toPathData,
  type JourneyWorld,
  type Point
} from '../journeyPlanner';
import { WEATHER_MOTION_THRESHOLD } from '../motion';
import { ORIGIN_OPTIONS, ORIGIN_VALUE_COPY } from '../pickupFixtures';
import type { CompiledTemplate } from '../intent-to-world/experience-synthesis/templateCompiler';
import { formatClock, formatMinuteRange, formatRangeLabel } from '../timeFormat';
import type { PickupPlan } from '../types';
import { fxCanvas, updateVisualEngine } from '../visualEngine';
import { h, s } from './dom';
import type { ViewContext } from './state';

const LOAD_BANDS: Array<{ max: number; level: string }> = [
  { max: 0.3, level: 'light' },
  { max: 0.55, level: 'moderate' },
  { max: 0.8, level: 'heavy' },
  { max: 1.1, level: 'severe' }
];

function loadLevel(load: number): string {
  return LOAD_BANDS.find((band) => load <= band.max)?.level ?? 'severe';
}

/* --------------------------------------------------------- the Bing base */

/**
 * One iframe, reused for the life of the tab.
 *
 * The app re-renders on every correction, and a fresh iframe per render would
 * re-request the base map each time — visible flicker, pointless traffic. So
 * the element is a module singleton and only its `src` changes, and only when
 * the route actually moved.
 */
let baseFrame: HTMLIFrameElement | null = null;
let baseSrc = '';
let baseTimer = 0;
let baseObserver: ResizeObserver | null = null;
/** The last measured map box, so the first paint already has the right shape. */
let baseBox = { width: BING_EMBED_WIDTH, height: BING_EMBED_HEIGHT };
/** The world the overlay is currently drawn from, so a resize can re-project. */
let alignedWorld: JourneyWorld | null = null;

/**
 * Fit the base to the map box exactly.
 *
 * Bing caps its render at 1200 px wide, so the frame is always 1200 wide and
 * its height is whatever makes that render, scaled up to the box width, come
 * out exactly the height of the box. Nothing is cropped — which is precisely
 * what keeps Bing's logo and its attribution on screen. A short box also gets
 * a wider zoom, because the whole drive still has to be in it.
 *
 * Because the render fills the box exactly, a percentage of the render is a
 * percentage of the box: the overlay can be projected straight through the
 * same viewport this method just chose, which is what `alignOverlay` does on
 * the very next line. Once per measurement — never per frame.
 */
function fitBase(box: HTMLElement, base: BingBase): void {
  const apply = (): void => {
    if (!baseFrame) return;
    const width = box.clientWidth;
    const height = box.clientHeight;
    if (width < 1 || height < 1) return;
    baseBox = { width, height };
    const renderHeight = embedHeightFor(width, height);
    baseFrame.height = String(renderHeight);
    baseFrame.style.height = `${renderHeight}px`;
    // The render is 1200 wide; scaling it to the box width fills the box, and
    // the height was chosen so the scale lands on the box height too.
    baseFrame.style.setProperty('--base-scale', String(Math.round((width / BING_EMBED_WIDTH) * 1000) / 1000));
    setBaseSrc(embedUrlForBox(base, width, height));
    alignOverlay();
  };
  apply();
  if (typeof ResizeObserver === 'function') {
    baseObserver?.disconnect();
    baseObserver = new ResizeObserver(apply);
    baseObserver.observe(box);
  }
}

function setBaseSrc(url: string): void {
  if (!baseFrame || !isAllowedBingEmbed(url) || baseSrc === url) return;
  baseSrc = url;
  baseFrame.dataset.loaded = 'false';
  baseFrame.src = url;
  window.clearTimeout(baseTimer);
  baseTimer = window.setTimeout(() => markBaseState('unavailable'), 6000);
}

type BaseState = 'pending' | 'live' | 'unavailable';

/** Who owns the route line and the traffic on screen right now. */
export type RouteSource = 'bing' | 'overlay';

/**
 * The map tells the app which of the two it is drawing.
 *
 * It matters outside this module because motion is a claim: while Bing owns
 * the route and its own traffic layer is on, CanvasBrowser must not animate
 * corridor particles that describe a corridor it is no longer drawing. One
 * listener, set once by the app, so the legend and the pixels agree.
 */
let routeSourceListener: ((source: RouteSource) => void) | null = null;
let lastRouteSource: RouteSource | null = null;

export function onRouteSourceChange(listener: (source: RouteSource) => void): void {
  routeSourceListener = listener;
}

function publishRouteSource(source: RouteSource): void {
  if (source === lastRouteSource) return;
  lastRouteSource = source;
  routeSourceListener?.(source);
}

function markBaseState(state: BaseState): void {
  const region = document.querySelector<HTMLElement>('[data-node="journey-map"]');
  if (region) region.dataset.baseState = state;
  // The frame's own flag is what the next render reads, so the two are set
  // together. Without this a re-render — including one caused by the route
  // source changing — would quietly resurrect a base that had gone away.
  if (baseFrame) baseFrame.dataset.loaded = state === 'live' ? 'true' : 'false';
  // The base becoming real (or going away) changes which projection is true,
  // so the overlay is re-laid immediately rather than at the next render.
  alignOverlay();
}

/** Test-only: drive the base state the way a real load or failure would. */
export function setJourneyBaseState(state: BaseState): void {
  markBaseState(state);
}

/* ------------------------------------------- the Bing-aligned overlay pass */

/**
 * What the map says about its own geometry, in each of its two states.
 *
 * Aligned, the overlay is projected through Bing's own Web Mercator viewport,
 * so a dot is where the place is. Unaligned — no base — it is the fitted
 * schematic, which reads well and is not a survey, and it says so.
 */
const BING_STAMP =
  'Bing Maps geography · CanvasBrowser projects the SAMPLE scenario onto it in Bing’s own Web Mercator';
const PENDING_STAMP = 'Bing Maps geography · CanvasBrowser draws the SAMPLE scenario over it';
const ILLUSTRATIVE_STAMP =
  'Bing Maps geography unavailable · CanvasBrowser’s overlay is an illustrative schematic, not to scale';

/**
 * Put every drawn thing where the base actually put it.
 *
 * The planner's plane geometry is a *fit*: it stretches the route to fill the
 * frame, which reads well and is, as a map, wrong — the screenshot that
 * started this had the Cell Phone Lot out by Vashon. So whenever the map box
 * is measured and a base URL is chosen, the same viewport those numbers
 * describe — centre, zoom, 1200 × render height — is used to project the
 * coordinates the planner kept, and the overlay is rewritten from them.
 *
 * The rules:
 *   - dots and paths land on their coordinate, full stop;
 *   - only labels may fan to stay readable, and a leader line then says which
 *     dot a fanned label belongs to;
 *   - it runs on measurement, resize and route change — never per frame.
 */
interface AlignedAnchor {
  at: Point;
  labelDy: number;
}

function alignOverlay(): void {
  const region = document.querySelector<HTMLElement>('[data-node="journey-map"]');
  if (!region || !alignedWorld) return;
  const stamp = region.querySelector<HTMLElement>('[data-node="map-stamp-note"]');
  const live = region.dataset.baseState === 'live';
  if (!live || baseBox.width < 1 || baseBox.height < 1) {
    // No base, no Bing geometry: the schematic the planner fitted stands, and
    // the world says in the open that it is illustrative rather than surveyed.
    // A base that *was* live and has gone away is put back to the schematic
    // rather than left holding coordinates for a map that is no longer there.
    restoreSchematic(alignedWorld);
    region.dataset.overlayProjection = 'illustrative';
    region.dataset.routeSource = 'overlay';
    publishRouteSource('overlay');
    if (stamp) {
      stamp.textContent = region.dataset.baseState === 'unavailable' ? ILLUSTRATIVE_STAMP : PENDING_STAMP;
    }
    return;
  }
  alignOverlayToBing(alignedWorld, baseBox.width, baseBox.height);
  region.dataset.overlayProjection = 'bing';
  if (stamp) stamp.textContent = BING_STAMP;
  // Over real geography the route belongs to Bing: the handoff opens the map
  // that draws it, with its own traffic. CanvasBrowser draws neither a
  // corridor nor congestion here — an authored line over real streets claims a
  // road the drive does not take, which is the misdirection this removes.
  const source: RouteSource = alignedWorld.base.route ? 'bing' : 'overlay';
  region.dataset.routeSource = source;
  publishRouteSource(source);
}

export function alignOverlayToBing(world: JourneyWorld, boxWidth: number, boxHeight: number): void {
  const view = viewportFor(world.base, boxWidth, boxHeight);
  const project = (geo: GeoPoint): Point => projectToEmbed(geo, view);
  const path = (geo: GeoPoint[]): string => toPathData(geo.map(project));

  const setPath = (node: string, geo: GeoPoint[]): void => {
    const element = document.querySelector<SVGPathElement>(`[data-node="${node}"]`);
    if (element && geo.length > 1) element.setAttribute('d', path(geo));
  };

  setPath('route-main', world.mainGeoPath);
  setPath('route-alternate', world.alternateGeoPath);
  setPath('route-flow', world.mainGeoPath);

  // Congestion stays on the corridor, as separated ticks rather than a second
  // continuous line: it annotates Bing's route, it does not compete with it.
  for (const band of world.trafficBands) {
    setPath(`route-load-${band.id}`, trimGeo(band.geoPath, 0.62));
  }

  // Anchors and notes share one plane, so they fan in one pass, in the same
  // order the planner used — geometry first, typography second.
  const anchors: AlignedAnchor[] = fanLabels([
    ...world.waypoints.map((waypoint) => ({ at: project(waypoint.geo) })),
    ...world.markers.map((marker) => ({ at: project(marker.geo) }))
  ]);
  const anchorFor = (index: number): AlignedAnchor => anchors[index] ?? { at: { x: 50, y: 50 }, labelDy: 0 };

  world.waypoints.forEach((waypoint, index) => {
    const anchor = anchorFor(index);
    placeAnchor(`waypoint-${waypoint.kind === 'stop' ? waypoint.id : waypoint.kind}`, anchor);
  });
  world.markers.forEach((marker, index) => {
    const anchor = anchorFor(world.waypoints.length + index);
    placeAnchor(`map-note-${marker.id}`, anchor);
  });

  // The weather cell is a projection over the airport, so it is drawn at the
  // airport's coordinate, with a radius that is a real distance on this base —
  // and two viewBox radii, because the plane's axes do not share a scale.
  if (world.weather) {
    const at = project(world.weather.geo);
    const rx = Math.max(0.4, kmToPercentX(world.weather.radiusKm, view));
    const ry = Math.max(0.4, kmToPercentY(world.weather.radiusKm, view));
    const group = document.querySelector<SVGGElement>('[data-node="map-weather"]');
    setEllipse(group?.querySelector<SVGEllipseElement>('.weather-cell'), at, rx, ry);
    setEllipse(group?.querySelector<SVGEllipseElement>('.weather-core'), at, rx * 0.55, ry * 0.55);
    const wind = group?.querySelector<SVGLineElement>('.weather-wind');
    if (wind) {
      const radians = (world.weather.windDegrees * Math.PI) / 180;
      wind.setAttribute('x1', String(round(at.x - Math.sin(radians) * rx)));
      wind.setAttribute('y1', String(round(at.y + Math.cos(radians) * ry)));
      wind.setAttribute('x2', String(round(at.x + Math.sin(radians) * rx)));
      wind.setAttribute('y2', String(round(at.y - Math.cos(radians) * ry)));
    }
  }

  const sea = project(world.seaGeo);
  setCircle(document.querySelector<SVGCircleElement>('.map-scan'), sea, null);

  // NOW is a place on the route, so it moves with the route.
  const nowGeo = geoAlong(world.mainGeoPath, world.nowOnRoute);
  const now = document.querySelector<HTMLElement>('[data-node="map-now"]');
  if (now && nowGeo) placeMarker(now, project(nowGeo), 0);

  // The GPU ground is aligned to the route the base actually drew, so the
  // atmosphere and the map cannot point in two different directions.
  const projectedMain = world.mainGeoPath.map(project);
  const bearing = routeBearing(projectedMain);
  updateVisualEngine('journey', {
    airportX: sea.x / 100,
    airportY: sea.y / 100,
    routeX: bearing.x,
    routeY: -bearing.y
  });
}

/**
 * Put the fitted schematic back.
 *
 * A base that was live and has gone offline must not be left with the overlay
 * still holding coordinates for a map that is no longer under it. This rewrites
 * exactly the nodes the alignment pass touched, from the planner's own fitted
 * geometry — and the world then says, in the stamp, that it is illustrative.
 */
function restoreSchematic(world: JourneyWorld): void {
  const setPath = (node: string, points: Point[]): void => {
    const element = document.querySelector<SVGPathElement>(`[data-node="${node}"]`);
    if (element && points.length > 1) element.setAttribute('d', toPathData(points));
  };
  setPath('route-main', world.mainPath);
  setPath('route-alternate', world.alternatePath);
  setPath('route-flow', world.mainPath);
  for (const band of world.trafficBands) setPath(`route-load-${band.id}`, band.path);

  for (const waypoint of world.waypoints) {
    placeAnchor(`waypoint-${waypoint.kind === 'stop' ? waypoint.id : waypoint.kind}`, {
      at: waypoint.at,
      labelDy: waypoint.labelDy
    });
  }
  for (const marker of world.markers) {
    placeAnchor(`map-note-${marker.id}`, { at: marker.at, labelDy: marker.labelDy });
  }

  if (world.weather) {
    const group = document.querySelector<SVGGElement>('[data-node="map-weather"]');
    const aspect = Math.max(1, baseBox.width) / Math.max(1, baseBox.height);
    const ry = Math.round(world.weather.radius);
    const rx = ry / aspect;
    setEllipse(group?.querySelector<SVGEllipseElement>('.weather-cell'), world.weather.at, rx, ry);
    setEllipse(group?.querySelector<SVGEllipseElement>('.weather-core'), world.weather.at, rx * 0.55, ry * 0.55);
    const wind = group?.querySelector<SVGLineElement>('.weather-wind');
    if (wind) {
      const radians = (world.weather.windDegrees * Math.PI) / 180;
      wind.setAttribute('x1', String(round(world.weather.at.x - Math.sin(radians) * rx)));
      wind.setAttribute('y1', String(round(world.weather.at.y + Math.cos(radians) * ry)));
      wind.setAttribute('x2', String(round(world.weather.at.x + Math.sin(radians) * rx)));
      wind.setAttribute('y2', String(round(world.weather.at.y - Math.cos(radians) * ry)));
    }
  }

  setCircle(document.querySelector<SVGCircleElement>('.map-scan'), world.seaAt, null);
  const now = document.querySelector<HTMLElement>('[data-node="map-now"]');
  if (now && world.mainPath.length > 1) placeMarker(now, pointAlong(world.mainPath, world.nowOnRoute), 0);

  const bearing = routeBearing(world.mainPath);
  updateVisualEngine('journey', {
    airportX: world.seaAt.x / 100,
    airportY: world.seaAt.y / 100,
    routeX: bearing.x,
    routeY: -bearing.y
  });
}

/** The middle share of a stretch, so bands read as ticks and leave gaps. */
function trimGeo(geo: GeoPoint[], share: number): GeoPoint[] {
  if (geo.length < 3) return geo;
  const drop = Math.floor((geo.length * (1 - share)) / 2);
  const trimmed = geo.slice(drop, geo.length - drop);
  return trimmed.length > 1 ? trimmed : geo;
}

function setCircle(node: SVGCircleElement | null | undefined, at: Point, radius: number | null): void {
  if (!node) return;
  node.setAttribute('cx', String(round(at.x)));
  node.setAttribute('cy', String(round(at.y)));
  if (radius !== null) node.setAttribute('r', String(round(radius)));
}

function setEllipse(node: SVGEllipseElement | null | undefined, at: Point, rx: number, ry: number): void {
  if (!node) return;
  node.setAttribute('cx', String(round(at.x)));
  node.setAttribute('cy', String(round(at.y)));
  node.setAttribute('rx', String(round(rx)));
  node.setAttribute('ry', String(round(ry)));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * One anchor: the dot on its coordinate, the label wherever it can be read,
 * and a leader line between them whenever those two are not the same place.
 *
 * The dot never moves. The label is fanned by `fanLabels` and then held inside
 * the frame, because a label that has walked off the bottom edge is not a
 * label — and the leader line follows it, so which dot it belongs to is never
 * in doubt.
 */
function placeAnchor(node: string, anchor: AlignedAnchor): void {
  const dot = document.querySelector<SVGEllipseElement>(`[data-anchor="${node}"]`);
  if (dot) {
    const radii = dotRadii(Number(dot.dataset.dotPx) || 5);
    setEllipse(dot, anchor.at, radii.rx, radii.ry);
  }
  const labelY = clamp(anchor.at.y + anchor.labelDy, 3, 74);
  const leader = document.querySelector<SVGLineElement>(`[data-leader="${node}"]`);
  if (leader) {
    leader.setAttribute('x1', String(round(anchor.at.x)));
    leader.setAttribute('y1', String(round(anchor.at.y)));
    leader.setAttribute('x2', String(round(anchor.at.x)));
    leader.setAttribute('y2', String(round(labelY)));
    leader.style.display = Math.abs(labelY - anchor.at.y) > 0.5 ? '' : 'none';
  }
  const marker = document.querySelector<HTMLElement>(`[data-node="${node}"]`);
  if (marker) placeMarker(marker, anchor.at, labelY - anchor.at.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function placeMarker(marker: HTMLElement, at: Point, labelDy: number): void {
  marker.style.setProperty('--x', `${round(clamp(at.x, 2, 97))}%`);
  marker.style.setProperty('--y', `${round(clamp(at.y + labelDy, 2, 88))}%`);
  marker.style.setProperty('--dy', `${round(labelDy)}%`);
  // Labels open away from the corridor. On a real base the drive runs up the
  // middle of the frame, so anything at or right of centre reads leftward and
  // the road it is describing stays visible underneath.
  marker.dataset.side = at.x > 45 ? 'left' : 'right';
}

/**
 * Cross-origin frames do not report much: a blocked or offline load can still
 * fire `load` on an error page. So the world never *claims* the base rendered.
 * It states the two things it can know — the browser is offline, or nothing
 * arrived within a few seconds — and otherwise leaves the illustrative overlay
 * exactly where it is, drawn above the base as annotation either way.
 */
function bingFrame(base: BingBase): HTMLIFrameElement | null {
  const url = embedUrlForBox(base, baseBox.width, baseBox.height);
  if (!isAllowedBingEmbed(url)) return null;
  if (!baseFrame) {
    baseFrame = document.createElement('iframe');
    baseFrame.className = 'map-base';
    baseFrame.dataset.node = 'map-base';
    baseFrame.title = 'Bing Maps route base';
    // No script from the frame may touch this document, and the frame is not
    // told where it was opened from.
    baseFrame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    baseFrame.setAttribute('referrerpolicy', 'no-referrer');
    baseFrame.setAttribute('loading', 'eager');
    baseFrame.setAttribute('tabindex', '-1');
    baseFrame.width = String(BING_EMBED_WIDTH);
    baseFrame.height = String(embedHeightFor(baseBox.width, baseBox.height));
    baseFrame.addEventListener('load', () => {
      window.clearTimeout(baseTimer);
      const state: BaseState = navigator.onLine === false ? 'unavailable' : 'live';
      baseFrame!.dataset.loaded = state === 'live' ? 'true' : 'false';
      markBaseState(state);
    });
    baseFrame.addEventListener('error', () => {
      window.clearTimeout(baseTimer);
      baseFrame!.dataset.loaded = 'false';
      markBaseState('unavailable');
    });
  }
  setBaseSrc(url);
  return baseFrame;
}

/** The compact line that names the base and hands off to the real map. */
function baseNote(world: JourneyWorld): HTMLElement {
  const open = h(
    'a',
    {
      class: 'map-base-open',
      'data-node': 'map-base-open',
      href: world.base.viewUrl,
      target: '_blank',
      rel: 'noopener noreferrer external',
      referrerpolicy: 'no-referrer'
    },
    ['Open full map to pan / zoom']
  );
  return h('p', { class: 'map-base-note', 'data-node': 'map-base-note' }, [
    h('span', { class: 'map-base-live' }, ['Static Bing Maps base · ']),
    h('span', { class: 'map-base-down', 'data-node': 'map-base-fallback' }, [
      'Bing Maps unavailable · illustrative overlay · '
    ]),
    open
  ]);
}

/* -------------------------------------------------------------- map layers */

/**
 * Waypoint and note geometry lives in the SVG, where the coordinates are.
 *
 * The plane's viewBox is 0–100 on both axes with `preserveAspectRatio: none`,
 * so one unit of x and one unit of y are different numbers of pixels. A
 * `<circle>` in that space is drawn as a flat lozenge, so every dot here is an
 * `<ellipse>` whose two radii are corrected against the measured box — which
 * is what makes a dot a dot rather than a smear.
 *
 * Dots sit exactly on the projected point. When a label had to be fanned to
 * stay readable — the airport, the lot and the curb really are a mile apart —
 * a leader line is drawn from the dot to the label, so the geometry is never
 * moved to make the typography convenient.
 */
const DOT_PX: Record<string, number> = { lot: 6.5, origin: 5, stop: 5, curb: 5, note: 4 };

/** A radius in pixels, as the two viewBox radii that draw it as a circle. */
function dotRadii(px: number): { rx: number; ry: number } {
  const width = Math.max(1, baseBox.width);
  const height = Math.max(1, baseBox.height);
  return { rx: Math.round((px / width) * 10000) / 100, ry: Math.round((px / height) * 10000) / 100 };
}

function anchorLayer(world: JourneyWorld, compiled: CompiledTemplate): SVGGElement {
  const children: SVGElement[] = [];
  const add = (
    node: string,
    at: { x: number; y: number },
    labelDy: number,
    className: string,
    px: number
  ): void => {
    children.push(
      s('line', {
        class: 'map-leader',
        'data-leader': node,
        style: Math.abs(labelDy) > 0.5 ? null : 'display:none',
        x1: String(at.x),
        y1: String(at.y),
        x2: String(at.x),
        y2: String(at.y + labelDy)
      })
    );
    const radii = dotRadii(px);
    children.push(
      s('ellipse', {
        class: className,
        'data-anchor': node,
        'data-dot-px': String(px),
        cx: String(at.x),
        cy: String(at.y),
        rx: String(radii.rx),
        ry: String(radii.ry)
      })
    );
  };

  for (const waypoint of world.waypoints) {
    add(
      `waypoint-${waypoint.kind === 'stop' ? waypoint.id : waypoint.kind}`,
      waypoint.at,
      waypoint.labelDy,
      `map-anchor map-anchor--${waypoint.kind}`,
      DOT_PX[waypoint.kind] ?? 5
    );
  }
  for (const note of world.markers) {
    if (note.kind === 'disruption' && !compiled.layers.disruption) continue;
    if (note.kind !== 'disruption' && !compiled.layers.airport) continue;
    add(
      `map-note-${note.id}`,
      note.at,
      note.labelDy,
      `map-anchor map-anchor--note map-anchor--${note.kind}`,
      DOT_PX.note
    );
  }
  return s('g', { class: 'map-anchors', 'aria-hidden': 'true' }, children);
}

/**
 * Abstract relief and a graticule under the route.
 *
 * With the Bing base behind it this layer is annotation, not geography: CSS
 * fades it right down so the real streets read through. It is a coordinate
 * system, so it never moves — and when the base cannot load it comes back up
 * to full strength as the illustrative fallback.
 */
function landLayer(): SVGGElement {
  const bands = TERRAIN_SHAPES.map((d, index) =>
    s('path', { class: `map-relief map-relief--${index + 1}`, d })
  );
  const graticule = [22, 40, 58, 76].map((y) =>
    s('path', { class: 'map-graticule', d: `M -5 ${y} C 25 ${y - 6}, 60 ${y + 6}, 105 ${y - 4}` })
  );
  return s('g', { class: 'map-land', 'aria-hidden': 'true' }, [
    s('rect', { class: 'map-ground', x: '0', y: '0', width: '100', height: '100' }),
    ...graticule,
    ...bands
  ]);
}

/** The route, split into stretches whose colour is that stretch's congestion. */
function trafficSegments(world: JourneyWorld, visible: boolean): SVGGElement | null {
  if (!visible || world.trafficBands.length === 0) return null;
  const children = world.trafficBands.map((band) => {
    const path = s('path', {
      class: 'route-load',
      d: toPathData(band.path),
      'data-node': `route-load-${band.id}`,
      'data-level': loadLevel(band.load)
    });
    path.style.setProperty('--load', String(Math.round(band.load * 100) / 100));
    return path;
  });
  return s('g', { class: 'route-loads', 'data-node': 'route-traffic', 'aria-hidden': 'true' }, children);
}

/**
 * The corridor flow: the one motion on this plane that means *vehicles are
 * moving*.
 *
 * It is a dashed line drifting along the route the map already draws, at a
 * speed congestion sets — nothing decorative rides on it, nothing pulses, and
 * it is not drawn at all when the traffic layer is hidden or the load is zero.
 */
function flowLayer(world: JourneyWorld, moving: boolean): SVGGElement | null {
  if (!moving || world.mainPath.length < 2) return null;
  const path = s('path', { class: 'route-flow', 'data-node': 'route-flow', d: toPathData(world.mainPath) });
  const group = s('g', { class: 'route-flow-layer', 'data-node': 'route-flow-layer', 'aria-hidden': 'true' }, [path]);
  const load = world.segments.length > 0 ? world.segments[world.segments.length - 1].load : 0;
  group.style.setProperty('--flow-speed', `${(5.5 + load * 9).toFixed(1)}s`);
  return group;
}

/**
 * The projected weather cell over the airport, with its wind bearing.
 *
 * The cell is drawn whenever the layer is on, because a clear sky over SEA is
 * information. It only *animates* once the projection is actually wet or
 * windy: `data-active` is the switch, and CSS holds a clear cell perfectly
 * still.
 */
function weatherLayer(world: JourneyWorld, visible: boolean): SVGGElement | null {
  if (!visible || !world.weather) return null;
  const cell = world.weather;
  const aspect = Math.max(1, baseBox.width) / Math.max(1, baseBox.height);
  // The cell is a real footprint, so it has to be drawn round: on a plane whose
  // two axes scale differently, that means two radii, not one.
  const ry = Math.round(cell.radius);
  const rx = Math.round((ry / aspect) * 100) / 100;
  const group = s(
    'g',
    {
      class: 'map-weather',
      'data-node': 'map-weather',
      'data-kind': cell.kind,
      'data-active': cell.intensity > WEATHER_MOTION_THRESHOLD ? 'true' : 'false',
      'aria-hidden': 'true'
    },
    [
      s('ellipse', {
        class: 'weather-cell',
        cx: String(cell.at.x),
        cy: String(cell.at.y),
        rx: String(rx),
        ry: String(ry)
      }),
      s('ellipse', {
        class: 'weather-core',
        cx: String(cell.at.x),
        cy: String(cell.at.y),
        rx: String(Math.round(rx * 55) / 100),
        ry: String(Math.round(ry * 0.55))
      }),
      s('line', {
        class: 'weather-wind',
        x1: String(cell.at.x - Math.sin((cell.windDegrees * Math.PI) / 180) * rx),
        y1: String(cell.at.y + Math.cos((cell.windDegrees * Math.PI) / 180) * ry),
        x2: String(cell.at.x + Math.sin((cell.windDegrees * Math.PI) / 180) * rx),
        y2: String(cell.at.y - Math.cos((cell.windDegrees * Math.PI) / 180) * ry)
      })
    ]
  );
  group.style.setProperty('--intensity', String(Math.round(cell.intensity * 100) / 100));
  return group;
}

/**
 * The refresh scan.
 *
 * It is not a metronome. A five-minute cadence is *said* — "next in 4 min" —
 * and drawn as a draining dial; the wave only appears when the next check is
 * actually due or overdue, which is the moment the world is asking for
 * attention rather than merely keeping time.
 */
function scanLayer(world: JourneyWorld): SVGGElement | null {
  if (!world.refreshDue) return null;
  const ring = s('circle', {
    class: 'map-scan',
    cx: String(world.seaAt.x),
    cy: String(world.seaAt.y),
    r: '10'
  });
  return s('g', { class: 'map-scan-layer', 'data-node': 'map-scan', 'aria-hidden': 'true' }, [ring]);
}

/* ------------------------------------------------------------ map furniture */

function routePaths(world: JourneyWorld): SVGGElement {
  const children: SVGElement[] = [];
  if (world.alternatePath.length > 1) {
    children.push(
      s('path', { class: 'route-path route-path--alternate', 'data-node': 'route-alternate', d: toPathData(world.alternatePath) })
    );
  }
  if (world.mainPath.length > 1) {
    children.push(s('path', { class: 'route-path route-path--main', 'data-node': 'route-main', d: toPathData(world.mainPath) }));
  }
  return s('g', { class: 'route-paths', 'aria-hidden': 'true' }, children);
}

function markerLayer(ctx: ViewContext, world: JourneyWorld, compiled: CompiledTemplate): HTMLElement[] {
  const nodes: HTMLElement[] = [];

  for (const waypoint of world.waypoints) {
    const marker = h(
      'div',
      {
        class: 'map-marker',
        'data-node': `waypoint-${waypoint.kind === 'stop' ? waypoint.id : waypoint.kind}`,
        'data-kind': waypoint.kind,
        'data-truth': waypoint.truth
      },
      [
        h('span', { class: 'map-marker-body' }, [
          h('span', { class: 'map-marker-label' }, [waypoint.label]),
          h('span', { class: 'map-marker-detail' }, [waypoint.detail]),
          waypoint.kind === 'stop'
            ? (() => {
                const remove = h(
                  'button',
                  { type: 'button', class: 'link-button map-marker-remove', 'data-node': `remove-${waypoint.id}` },
                  ['Remove stop']
                );
                remove.addEventListener('click', () => ctx.actions.removeStop(waypoint.id));
                return remove;
              })()
            : null
        ])
      ]
    );
    marker.style.setProperty('--x', `${waypoint.at.x}%`);
    marker.style.setProperty('--y', `${waypoint.at.y + waypoint.labelDy}%`);
    // A label near the right edge opens leftward, so nothing is ever clipped.
    marker.dataset.side = waypoint.at.x > 58 ? 'left' : 'right';
    nodes.push(marker);
  }

  const showAirportNotes = compiled.layers.airport || compiled.layers.disruption;
  if (showAirportNotes) {
    for (const note of world.markers) {
      if (note.kind === 'disruption' && !compiled.layers.disruption) continue;
      if (note.kind !== 'disruption' && !compiled.layers.airport) continue;
      const marker = h(
        'div',
        {
          class: 'map-note',
          'data-node': `map-note-${note.id}`,
          'data-kind': note.kind,
          'data-truth': note.truth
        },
        [
          h('span', { class: 'map-note-body' }, [
            h('span', { class: 'map-note-label' }, [note.label]),
            h('span', { class: 'map-note-detail' }, [note.detail]),
            h('span', { class: note.truth === 'sample' ? 'sample-tag sample-tag--inline' : 'live-tag' }, [
              note.truth === 'sample' ? 'SAMPLE' : 'OFFICIAL'
            ])
          ])
        ]
      );
      marker.style.setProperty('--x', `${note.at.x}%`);
      marker.style.setProperty('--y', `${note.at.y + note.labelDy}%`);
      marker.dataset.side = note.at.x > 58 ? 'left' : 'right';
      marker.style.setProperty('--dy', `${note.labelDy}%`);
      nodes.push(marker);
    }
  }

  // NOW, as a point on the route rather than a column on an axis.
  if (world.mainPath.length > 1 && world.departByMs !== null) {
    const at = pointAlong(world.mainPath, world.nowOnRoute);
    const now = h('div', { class: 'map-now', 'data-node': 'map-now' }, [
      h('span', { class: 'map-now-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'map-now-label' }, [`NOW ${formatClock(ctx.state.plan?.nowMs ?? Date.now())}`])
    ]);
    now.style.setProperty('--x', `${at.x}%`);
    now.style.setProperty('--y', `${at.y}%`);
    nodes.push(now);
  }

  return nodes;
}

/**
 * The route labels — in two variants, because the truth has two states.
 *
 * With a live Bing base the geography under the world is real. CanvasBrowser
 * cannot read that frame — it is
 * cross-origin, so Bing's chosen roads, ETA, tolls and alternatives are Bing's
 * to state and not ours to repeat — and the framed endpoint renders geography
 * only, so there is no routed line on the base either. The local corridor stays
 * visible after projection through Bing's exact viewport, explicitly labelled
 * SAMPLE; the live legend points to Bing for the exact route and traffic.
 *
 * Without a base the same corridor remains the only geographic orientation.
 *
 * Both variants are in the DOM and CSS picks between them from
 * `data-route-source`, so the switch costs no re-render and cannot lag the map.
 */
function routeLegend(world: JourneyWorld): HTMLElement {
  const legs = world.segments.map((segment) =>
    h('li', { class: 'leg', 'data-node': `leg-${segment.id}`, 'data-level': loadLevel(segment.load) }, [
      h('span', { class: 'leg-label' }, [segment.label]),
      h('span', { class: 'leg-meta' }, [
        segment.window ? `${formatRangeLabel(segment.window)} · ` : '',
        formatMinuteRange(segment.minutes),
        ` · traffic ${loadLevel(segment.load)} `,
        // Leg timing is a local fixture estimate in both states. It is never
        // Bing's ETA, and it may never be read as one.
        h('span', { class: 'sample-tag sample-tag--inline' }, ['SAMPLE'])
      ])
    ])
  );

  const live = h('div', { class: 'route-legend-variant route-legend-variant--live', 'data-node': 'route-legend-live' }, [
    h('p', { class: 'route-line route-line--bing', 'data-node': 'route-bing-label' }, [
      'Exact route and live traffic: Bing Maps · this base renders geography only'
    ]),
    h(
      'a',
      {
        class: 'route-line route-line--handoff',
        'data-node': 'route-bing-open',
        href: world.base.viewUrl,
        target: '_blank',
        rel: 'noopener noreferrer external',
        referrerpolicy: 'no-referrer'
      },
      ['Open full map for the routed line, live traffic, current road list, ETA, tolls and alternatives']
    ),
    h('p', { class: 'route-disclosure', 'data-node': 'route-disclosure' }, [
      'The visible corridor is a Web-Mercator-aligned SAMPLE estimate. Open Bing Maps for the exact route, live traffic, ETA, tolls and alternatives.'
    ])
  ]);

  const fallback = h(
    'div',
    { class: 'route-legend-variant route-legend-variant--fallback', 'data-node': 'route-legend-fallback' },
    [
      h('p', { class: 'route-line route-line--main', 'data-node': 'route-main-label' }, [
        h('span', { class: 'route-swatch route-swatch--main', 'aria-hidden': 'true' }),
        `${world.mainLabel} · ${world.mainDistanceLabel}`,
        h('span', { class: 'sample-tag sample-tag--inline' }, ['SAMPLE corridor'])
      ]),
      world.alternatePath.length > 1
        ? h('p', { class: 'route-line route-line--alternate', 'data-node': 'route-alternate-label' }, [
            h('span', { class: 'route-swatch route-swatch--alternate', 'aria-hidden': 'true' }),
            `${world.alternateLabel} · ${world.alternateDistanceLabel}`,
            h('span', { class: 'sample-tag sample-tag--inline' }, ['SAMPLE corridor'])
          ])
        : null
    ]
  );

  return h('div', { class: 'route-legend', 'data-node': 'route-legend' }, [
    live,
    fallback,
    legs.length > 0 ? h('ol', { class: 'leg-list' }, legs) : null
  ]);
}

/* ------------------------------------------------------------------- stops */

/**
 * `Add a stop`. It is never a question — nothing asks whether you have one.
 * It sits inside the world, states what a stop does before you add it, and
 * recomputes the route and the leave-by locally when you do.
 */
function stopControls(ctx: ViewContext, plan: PickupPlan): HTMLElement {
  const used = new Set(plan.stops.map((stop) => stop.id.replace(/-\d+$/, '')));
  const buttons = STOP_OPTIONS.map((option) => {
    const button = h(
      'button',
      {
        type: 'button',
        class: 'stop-chip',
        'data-node': `add-stop-${option.id}`,
        'aria-pressed': used.has(option.id) ? 'true' : 'false'
      },
      [
        h('span', { class: 'stop-chip-label' }, [option.label]),
        h('span', { class: 'stop-chip-cost' }, [`+${formatMinuteRange(option.minutes)}`])
      ]
    );
    button.title = option.reason;
    button.addEventListener('click', () => ctx.actions.addStop(option.id));
    return button;
  });

  return h('div', { class: 'stop-row', 'data-node': 'stop-row' }, [
    h('span', { class: 'stop-row-label' }, ['Add a stop']),
    ...buttons,
    h('span', { class: 'stop-row-note', 'data-node': 'stop-note' }, [
      'A stop changes the route and moves your leave-by. Times are SAMPLE estimates, computed on this device.'
    ])
  ]);
}

/* ------------------------------------------------------- the spatial gap */

/**
 * Before an origin exists, the map does not invent one. It draws the half it
 * knows — the airport, the lot, the curb — leaves the other half visibly
 * missing, and states what filling it in would buy.
 */
function spatialGap(ctx: ViewContext): HTMLElement {
  const question =
    ctx.state.travelQuestion?.id === 'travel-origin' ? ctx.state.travelQuestion : null;
  const useLocation = h('button', { type: 'button', class: 'primary-button', 'data-node': 'use-my-location' }, [
    'Use my location'
  ]);
  useLocation.addEventListener('click', () => void ctx.actions.useMyLocation());

  const choosePlace = h('button', { type: 'button', class: 'ghost-button', 'data-node': 'choose-place' }, [
    'Choose a place instead'
  ]);
  choosePlace.addEventListener('click', () => ctx.actions.showPlaces());

  const { locationState, placesVisible } = ctx.state;
  const notice =
    locationState === 'denied' ||
    locationState === 'unsupported' ||
    locationState === 'outside-region' ||
    locationState === 'timeout'
      ? h('p', { class: 'origin-notice', 'data-node': 'location-fallback', role: 'status' }, [
          locationState === 'denied'
            ? 'Location is off, so pick a starting point instead.'
            : locationState === 'timeout'
              ? 'Location took too long, so pick a starting point instead.'
              : locationState === 'outside-region'
                ? 'Current location is outside this prototype’s supported region, so pick a starting point instead.'
              : 'This browser cannot share location, so pick a starting point instead.'
        ])
      : null;

  const places = placesVisible
    ? h(
        'ul',
        { class: 'place-list', 'data-node': 'place-options' },
        ORIGIN_OPTIONS.map((option) => {
          const button = h('button', { type: 'button', class: 'place', 'data-node': `origin-${option.id}` }, [
            h('span', { class: 'place-name' }, [option.label]),
            h('span', { class: 'place-drive' }, [`${formatMinuteRange(option.driveMinutes)} est.`])
          ]);
          button.addEventListener('click', () => ctx.actions.chooseOrigin(option.id));
          return h('li', {}, [button]);
        })
      )
    : null;

  const typedInput = h('input', {
    type: 'text',
    class: 'origin-input',
    'data-node': 'origin-text',
    'aria-label': 'Other starting point',
    placeholder: 'Somewhere else'
  });
  const typedForm = placesVisible
    ? h('form', { class: 'origin-form' }, [
        typedInput,
        h('button', { type: 'submit', class: 'ghost-button', 'data-node': 'origin-text-submit' }, ['Use this'])
      ])
    : null;
  typedForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (typedInput.value.trim()) ctx.actions.chooseTypedOrigin(typedInput.value.trim());
  });

  return h('section', { class: 'origin-picker origin-picker--map', 'data-node': 'origin-picker' }, [
    h(
      'p',
      {
        class: 'origin-question',
        'data-node': question ? 'origin-question' : 'origin-status'
      },
      [
        question?.question ??
          (locationState === 'requesting'
            ? 'Locating your starting point…'
            : 'The route still needs a starting point.')
      ]
    ),
    h('p', { class: 'origin-why', 'data-node': 'origin-why' }, [
      question?.reason ?? ORIGIN_VALUE_COPY
    ]),
    notice,
    h('div', { class: 'origin-actions' }, [useLocation, placesVisible ? null : choosePlace]),
    places,
    typedForm,
    h('p', { class: 'origin-note' }, [
      'Drive times are local fixture estimates. CanvasBrowser has no live traffic source, and your coordinates never leave this device.'
    ])
  ]);
}

/* ---------------------------------------------------------------- handoffs */

/**
 * The map's own handoff lives in the decision envelope, beside the leave-by,
 * because that is the moment a person actually reaches for directions. The
 * links are not repeated here — one route world, one place to hand off.
 */

/* ------------------------------------------------------------------ export */

export interface JourneyViewInput {
  ctx: ViewContext;
  plan: PickupPlan;
  world: JourneyWorld;
  compiled: CompiledTemplate;
}

/**
 * The map plane itself.
 *
 * Bottom to top: the GPU atmosphere, the Bing Maps base, a harmonising wash,
 * CanvasBrowser's own SVG annotation, then the DOM labels. Everything above
 * the base is ordinary accessible SVG and DOM, so the world can be read by a
 * screen reader and inspected in dev tools.
 */
export function renderJourneyMap(input: JourneyViewInput): HTMLElement {
  const { ctx, plan, world, compiled } = input;
  const hasRoute = world.origin !== null;
  // The corridor flow means "vehicles are moving". No load, or a hidden layer,
  // and there is nothing on this route to animate.
  const trafficDrawn = compiled.layers.traffic && ctx.state.conditionLayers.traffic;
  const trafficMoving = trafficDrawn && (ctx.state.conditions?.traffic.congestion ?? 0) > 0;
  const weatherDrawn = compiled.layers.weather && ctx.state.conditionLayers.weather;
  // Every render rebuilds the overlay from the fitted schematic, so the world
  // the alignment pass re-projects has to be this one.
  alignedWorld = world;

  const plane = s(
    'svg',
    {
      class: 'map-plane',
      'data-node': 'journey-plane',
      viewBox: '0 0 100 100',
      preserveAspectRatio: 'none',
      role: 'img',
      'aria-label': `CanvasBrowser route overlay from ${
        world.origin?.label ?? 'an unknown starting point'
      } to the SEA arrivals curb, drawn over a Bing Maps base`
    },
    [
      landLayer(),
      routePaths(world),
      trafficSegments(world, trafficDrawn),
      flowLayer(world, trafficMoving),
      weatherLayer(world, weatherDrawn),
      scanLayer(world),
      anchorLayer(world, compiled)
    ]
  );

  const weatherLabel = world.weather
    ? h('p', { class: 'map-weather-label', 'data-node': 'map-weather-label', 'data-kind': world.weather.kind }, [
        `${world.weather.label} · ${world.weather.windLabel} · ${world.weather.timeLabel}`,
        h('span', { class: 'sample-tag sample-tag--inline' }, [world.weather.truth === 'sample' ? 'SAMPLE' : 'LIVE'])
      ])
    : null;

  const frame = bingFrame(world.base);
  const mapBox = h('div', { class: 'map-frame' }, [
    frame,
    // A single wash, stopping short of the bottom edge so Bing's own
    // attribution and logo are never covered.
    frame ? h('div', { class: 'map-wash', 'aria-hidden': 'true' }) : null,
    plane,
    h('div', { class: 'map-overlay' }, [
      ...markerLayer(ctx, world, compiled),
      h('p', { class: 'map-stamp', 'data-node': 'map-stamp' }, [
        world.label,
        h('span', { class: 'map-stamp-note', 'data-node': 'map-stamp-note' }, [PENDING_STAMP])
      ]),
      weatherLabel
    ])
  ]);
  if (frame) fitBase(mapBox, world.base);

  const region = h(
    'section',
    {
      class: 'journey-map',
      'data-node': 'journey-map',
      'data-surface': 'dark',
      'data-route': hasRoute ? 'known' : 'unknown',
      'data-base': world.base.kind,
      role: 'region',
      'aria-label': 'Journey world'
    },
    [
      fxCanvas('journey'),
      mapBox,
      h('div', { class: 'map-foot' }, [
        baseNote(world),
        hasRoute ? routeLegend(world) : null,
        hasRoute ? stopControls(ctx, plan) : null,
        hasRoute ? null : spatialGap(ctx)
      ])
    ]
  );
  region.dataset.baseState = frame
    ? navigator.onLine === false
      ? 'unavailable'
      : (baseFrame?.dataset.loaded === 'true' ? 'live' : 'pending')
    : 'unavailable';
  // Until the box has been measured against a live base, what is on screen is
  // the fitted schematic. The world says which of the two it is drawing, so a
  // person — or a test — never has to guess.
  region.dataset.overlayProjection = 'illustrative';
  region.dataset.routeSource = 'overlay';
  // A fresh region has no history, so the next alignment pass is always
  // allowed to state which source it landed on.
  lastRouteSource = null;
  return region;
}
