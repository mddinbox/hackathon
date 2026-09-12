/**
 * The real map base under the Journey World.
 *
 * CanvasBrowser draws its own scenario — route load, weather cell, airport
 * rules, NOW — but the *geography* underneath is no longer invented. It is a
 * Bing Maps embed, so a person sees the actual streets, water and interchanges
 * they are about to drive, with Bing's own attribution intact.
 *
 * Three rules make that safe:
 *
 *   1. **The URL is built here, from numbers.** Nothing a model wrote ever
 *      reaches an `src`. The only inputs are the coarse origin the user chose
 *      and the airport fixtures, both of which are plain coordinates.
 *   2. **One host, one path.** `isAllowedBingEmbed` is the gate every URL
 *      passes through, and the CSP `frame-src` at the demo server repeats it,
 *      so a mistake in this file still cannot frame something else.
 *   3. **No key, no account, no telemetry hook.** The public embed endpoint
 *      needs none, and the frame is sandboxed and referrer-free.
 *
 * Nothing here fetches: it returns strings. Whether the frame actually loads
 * is the browser's business, and the world states the fallback when it cannot.
 */
import { CELL_PHONE_LOT_POINT, SEA_AIRPORT, type GeoPoint } from './journeyFixtures';

/** The only host CanvasBrowser will ever frame. */
export const BING_EMBED_HOST = 'www.bing.com';
const BING_EMBED_PATH = '/maps/embed';
const BING_MAP_PATH = '/maps';

/**
 * Bing renders the map at the size the URL asks for, and caps it at 1200 px
 * wide. So the frame is always 1200 wide and only its *height* follows the
 * shape of the box the Journey World has; scaling that render up to the box
 * width then fills the box exactly, with nothing cropped — which is what keeps
 * Bing's logo and its attribution on screen.
 */
export const BING_EMBED_WIDTH = 1200;
/** The height used before the map box has been measured. */
export const BING_EMBED_HEIGHT = 420;
/**
 * Bing's traffic layer, in Bing's own URL vocabulary.
 *
 * It is on both the embed and the `Open full map` handoff. On the handoff it
 * works: `bing.com/maps` draws the routed line and colours the roads with live
 * congestion. On `/maps/embed` it is currently **inert** — see the note on
 * `bingBase` — so nothing in the product is allowed to claim that the framed
 * base is showing traffic. The parameter is sent anyway, because it is the
 * documented one and costs nothing if the endpoint starts honouring it again.
 */
export const BING_TRAFFIC_PARAM = 'trfc=1';
/** How much of the frame the route may take before it is uncomfortably tight. */
const FILL = 0.8;

/** Where the world centres when no origin exists yet: SEA and its cell lot. */
export const BING_FALLBACK_CENTER: GeoPoint = {
  lat: (SEA_AIRPORT.lat + CELL_PHONE_LOT_POINT.lat) / 2,
  lon: (SEA_AIRPORT.lon + CELL_PHONE_LOT_POINT.lon) / 2
};

export interface BingBase {
  /** The `src` of the framed base map, at a default shape. Always allowed. */
  embedUrl: string;
  /** Where `Open full map` hands off to, in a real tab the user controls. */
  viewUrl: string;
  /** `route` once an origin exists, `airport` while the origin is a gap. */
  kind: 'route' | 'airport';
  /** One short line under the map, so the base names itself. */
  label: string;
  /** The centre and the extent the base has to hold, for re-sizing later. */
  center: GeoPoint;
  spanLat: number;
  spanLon: number;
  /** The route, when there is one, in Bing's own directions parameter. */
  route: string | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Coordinates are rounded to four decimals — roughly 10 m.
 *
 * That is finer than any decision this product makes, and it keeps the URL
 * free of the spurious precision a device fix carries. It is the last
 * narrowing a fresh position gets before it becomes a route endpoint: the
 * route starts where the driver is, at street resolution and no finer.
 */
function coord(value: number, limit: number): string {
  return clamp(Number.isFinite(value) ? value : 0, -limit, limit).toFixed(4);
}

function position(point: GeoPoint): string {
  return `pos.${coord(point.lat, 90)}_${coord(point.lon, 180)}`;
}

/** Clamped before any arithmetic, so a nonsense fix cannot skew the centre. */
function safePoint(point: GeoPoint): GeoPoint {
  return {
    lat: clamp(Number.isFinite(point.lat) ? point.lat : 0, -90, 90),
    lon: clamp(Number.isFinite(point.lon) ? point.lon : 0, -180, 180)
  };
}

function midpoint(a: GeoPoint, b: GeoPoint): GeoPoint {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}

/**
 * A zoom that holds the whole span inside a render of this shape.
 *
 * Bing tiles are 256 px and each level doubles the scale, so a level gives
 * `256 · 2^level / 360` pixels per degree of longitude. The span has to fit
 * horizontally *and* vertically, and a degree of latitude is taller than a
 * degree of longitude in Mercator, so both axes are solved and the tighter one
 * wins. A short, wide map box therefore zooms *out*, which is exactly right:
 * the whole drive still has to be on screen.
 */
export function zoomForSpan(
  spanLat: number,
  spanLon: number,
  centerLat: number,
  width = BING_EMBED_WIDTH,
  height = BING_EMBED_HEIGHT
): number {
  const dLat = Math.max(spanLat, 0.004);
  const dLon = Math.max(spanLon, 0.004);
  const ppdX = (FILL * width) / dLon;
  const ppdY = (FILL * height * Math.cos((centerLat * Math.PI) / 180)) / dLat;
  const level = Math.floor(Math.log2((Math.min(ppdX, ppdY) * 360) / 256));
  return clamp(level, 6, 15);
}

function embedQuery(base: BingBase, level: number, height: number): string {
  const parts = [
    `h=${height}`,
    `w=${BING_EMBED_WIDTH}`,
    `cp=${coord(base.center.lat, 90)}~${coord(base.center.lon, 180)}`,
    `lvl=${level}`,
    // `typ=d` is the road map, `sty=r` its road style: the geography a driver
    // recognises, not an aerial photograph the overlays would fight with.
    'typ=d',
    'sty=r',
    // Bing's own traffic layer, requested. The current embed ignores it, so
    // nothing on screen says the frame is showing traffic — but CanvasBrowser
    // still does not draw its own over a live base, because an invented
    // congestion band on real streets is the claim this correction removes.
    BING_TRAFFIC_PARAM,
    'src=SHELL',
    'FORM=MBEDV8'
  ];
  if (base.route) parts.push(`rtp=${base.route}`);
  return parts.join('&');
}

/**
 * The Bing base for one journey.
 *
 * With an origin the embed carries the route itself (`rtp=` — the same
 * directions parameter the Bing embed builder emits) *and* a centre and zoom,
 * so a build of the embed that ignores route parameters still lands on the
 * right geography rather than on the middle of the ocean. Without an origin
 * the world centres on SEA and its cell-phone lot, which is the half of the
 * situation that is genuinely known.
 *
 * **What `/maps/embed` actually renders, measured.** Requesting the endpoint
 * with `rtp=`, with `trfc=1`, with labelled positions, with `adr.` addresses,
 * with `rtop=`, and with no route parameter at all returns a byte-identical
 * image: geography only. No routed line, no congestion colouring. The same
 * `rtp=` on `bing.com/maps` — the `viewUrl` below — draws the route, its
 * alternates, their ETAs and live traffic correctly.
 *
 * So the division of labour is: the frame is **real geography**, the handoff
 * is **the real route**, and CanvasBrowser draws neither a route nor traffic
 * of its own over a live base rather than putting an invented corridor on top
 * of real streets. Nothing in the UI claims the frame is showing a route.
 *
 * The query is assembled by hand rather than with `URLSearchParams`, because
 * Bing's `cp` and `rtp` separator is `~` and percent-encoding it turns a valid
 * position pair into a string the endpoint does not recognise. Every value
 * here is a number this module produced, so there is nothing to escape.
 */
export function bingBase(rawOrigin: GeoPoint | null, rawDestination: GeoPoint = CELL_PHONE_LOT_POINT): BingBase {
  const origin = rawOrigin ? safePoint(rawOrigin) : null;
  const destination = safePoint(rawDestination);
  // With no origin the base still has a job: show the airport and the lot the
  // whole decision is about, rather than an invented starting point.
  const a = origin ?? safePoint(SEA_AIRPORT);
  const b = origin ? destination : safePoint(CELL_PHONE_LOT_POINT);
  const center = origin ? midpoint(a, b) : BING_FALLBACK_CENTER;
  const route = origin ? `${position(origin)}~${position(destination)}` : null;

  const base: BingBase = {
    embedUrl: '',
    viewUrl: '',
    kind: origin ? 'route' : 'airport',
    label: origin ? 'Bing Maps base · your route' : 'Bing Maps base · SEA and the cell phone lot',
    center,
    spanLat: Math.abs(a.lat - b.lat),
    spanLon: Math.abs(a.lon - b.lon),
    route
  };

  const level = zoomForSpan(base.spanLat, base.spanLon, center.lat);
  base.embedUrl = `https://${BING_EMBED_HOST}${BING_EMBED_PATH}?${embedQuery(base, level, BING_EMBED_HEIGHT)}`;
  const view = [`cp=${coord(center.lat, 90)}~${coord(center.lon, 180)}`, `lvl=${level}`, BING_TRAFFIC_PARAM];
  if (route) view.push(`rtp=${route}`);
  base.viewUrl = `https://${BING_EMBED_HOST}${BING_MAP_PATH}?${view.join('&')}`;
  return base;
}

/** The render height that makes a 1200-wide base fill a box of this shape. */
export function embedHeightFor(boxWidth: number, boxHeight: number): number {
  if (boxWidth < 1 || boxHeight < 1) return BING_EMBED_HEIGHT;
  // Quantised, so nudging a window edge never re-requests a map.
  return clamp(Math.round((boxHeight * BING_EMBED_WIDTH) / boxWidth / 20) * 20, 200, 1200);
}

/* ------------------------------------------------------- the projection */

/**
 * Web Mercator, at Bing's own numbers.
 *
 * Bing's tiles are 256 px and every level doubles them, so the whole world at
 * a level is `256 · 2^level` pixels square. Latitude is clamped to the value
 * that makes that square — ±85.05112878° — which is the standard Web Mercator
 * limit and the one Bing itself documents.
 */
export const MERCATOR_LAT_LIMIT = 85.05112878;
export const BING_TILE_SIZE = 256;

export function mapSize(level: number): number {
  return BING_TILE_SIZE * Math.pow(2, level);
}

/** Where a coordinate lands in Bing's global pixel space at this level. */
export function globalPixel(point: GeoPoint, level: number): { x: number; y: number } {
  const size = mapSize(level);
  const lon = clamp(Number.isFinite(point.lon) ? point.lon : 0, -180, 180);
  const lat = clamp(Number.isFinite(point.lat) ? point.lat : 0, -MERCATOR_LAT_LIMIT, MERCATOR_LAT_LIMIT);
  const sinLat = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * size
  };
}

/**
 * The exact frame the embed is rendering.
 *
 * Every number here is the one that reaches the URL: the same 1200 width, the
 * same quantised height, the same zoom `embedUrlForBox` asks for, and the
 * centre *as it is written in the query* — rounded to four decimals, because
 * that is the centre Bing is actually given. Anything that projects through
 * this viewport therefore lands where the base drew it, not near it.
 */
export interface BingViewport {
  level: number;
  width: number;
  height: number;
  center: GeoPoint;
}

export interface BingViewportSource {
  center: GeoPoint;
  spanLat: number;
  spanLon: number;
  radiusMiles?: number;
  zoomBias?: number;
  viewportPadding?: number;
}

export function viewportFor(base: BingViewportSource, boxWidth: number, boxHeight: number): BingViewport {
  const rawHeight = boxWidth < 1 || boxHeight < 1 ? BING_EMBED_HEIGHT : embedHeightFor(boxWidth, boxHeight);
  const height = clamp(
    Math.round((rawHeight * Math.max(1, base.viewportPadding ?? 1)) / 20) * 20,
    200,
    1200
  );
  let level = zoomForSpan(base.spanLat, base.spanLon, base.center.lat, BING_EMBED_WIDTH, height);
  const bias = Math.max(0, Math.floor(base.zoomBias ?? 0));
  for (let step = 0; step < bias; step++) {
    const nextLevel = Math.min(15, level + 1);
    if (nextLevel === level) break;
    const candidate: BingViewport = {
      level: nextLevel,
      width: BING_EMBED_WIDTH,
      height,
      center: base.center
    };
    const radiusKm = (base.radiusMiles ?? 0) * 1.60934;
    if (
      radiusKm > 0 &&
      kmToPercentX(radiusKm, candidate) <= 46 &&
      kmToPercentY(radiusKm, candidate) <= 46
    ) {
      level = nextLevel;
    }
  }
  return {
    level,
    width: BING_EMBED_WIDTH,
    height,
    center: {
      lat: Number(coord(base.center.lat, 90)),
      lon: Number(coord(base.center.lon, 180))
    }
  };
}

export interface BingFieldBase extends BingViewportSource {
  radiusMiles: number;
  embedUrl: string;
  viewUrl: string;
}

function fieldEmbedQuery(base: BingFieldBase, level: number, height: number): string {
  return [
    `h=${height}`,
    `w=${BING_EMBED_WIDTH}`,
    `cp=${coord(base.center.lat, 90)}~${coord(base.center.lon, 180)}`,
    `lvl=${level}`,
    'typ=a',
    'sty=h',
    'src=SHELL',
    'FORM=MBEDV8'
  ].join('&');
}

/** Static aerial geography for Local News. Signals project through this exact viewport. */
export function bingFieldBase(rawCenter: GeoPoint, radiusMiles: number): BingFieldBase {
  const center = safePoint(rawCenter);
  const radius = clamp(radiusMiles, 2, 200);
  const radiusLat = radius / 69;
  const radiusLon = radiusLat / Math.max(0.2, Math.cos((center.lat * Math.PI) / 180));
  const base: BingFieldBase = {
    center,
    radiusMiles: radius,
    zoomBias: 1,
    viewportPadding: 1.12,
    spanLat: radiusLat * 2,
    spanLon: radiusLon * 2,
    embedUrl: '',
    viewUrl: ''
  };
  const level = viewportFor(base, BING_EMBED_WIDTH, BING_EMBED_HEIGHT).level;
  base.embedUrl = `https://${BING_EMBED_HOST}${BING_EMBED_PATH}?${fieldEmbedQuery(base, level, BING_EMBED_HEIGHT)}`;
  base.viewUrl =
    `https://${BING_EMBED_HOST}${BING_MAP_PATH}?` +
    `cp=${coord(center.lat, 90)}~${coord(center.lon, 180)}&lvl=${level}&style=a`;
  return base;
}

export function fieldEmbedUrlForBox(base: BingFieldBase, boxWidth: number, boxHeight: number): string {
  if (boxWidth < 1 || boxHeight < 1) return base.embedUrl;
  const view = viewportFor(base, boxWidth, boxHeight);
  return `https://${BING_EMBED_HOST}${BING_EMBED_PATH}?${fieldEmbedQuery(base, view.level, view.height)}`;
}

/**
 * A coordinate as a percentage of the render frame — which, because the frame
 * is scaled to fill the map box exactly, is also a percentage of the box, and
 * so is directly usable as an SVG plane coordinate or a CSS `--x` / `--y`.
 *
 * Values outside 0–100 are returned as they are: a point genuinely off the
 * base is off the base, and pinning it to an edge would be a lie.
 */
export function projectToEmbed(point: GeoPoint, view: BingViewport): { x: number; y: number } {
  const at = globalPixel(point, view.level);
  const centre = globalPixel(view.center, view.level);
  return {
    x: ((view.width / 2 + (at.x - centre.x)) / view.width) * 100,
    y: ((view.height / 2 + (at.y - centre.y)) / view.height) * 100
  };
}

/** How many percent of the frame's width one kilometre covers at this view. */
export function kmToPercentX(km: number, view: BingViewport): number {
  return (kmToPixels(km, view) / view.width) * 100;
}

/** The same distance down the frame — the render is not square, so it differs. */
export function kmToPercentY(km: number, view: BingViewport): number {
  return (kmToPixels(km, view) / view.height) * 100;
}

function kmToPixels(km: number, view: BingViewport): number {
  const size = mapSize(view.level);
  const metresPerPixel = (Math.cos((view.center.lat * Math.PI) / 180) * 2 * Math.PI * 6_378_137) / size;
  return (km * 1000) / metresPerPixel;
}

/**
 * The same base, rendered to fit a map box of this shape exactly — both its
 * height and, because a short box has less room for latitude, its zoom.
 */
export function embedUrlForBox(base: BingBase, boxWidth: number, boxHeight: number): string {
  if (boxWidth < 1 || boxHeight < 1) return base.embedUrl;
  const view = viewportFor(base, boxWidth, boxHeight);
  return `https://${BING_EMBED_HOST}${BING_EMBED_PATH}?${embedQuery(base, view.level, view.height)}`;
}

/**
 * The gate. Anything that is about to become an iframe `src` goes through it,
 * and the demo document's `frame-src` says the same thing at the browser.
 */
export function isAllowedBingEmbed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname === BING_EMBED_HOST &&
    parsed.pathname === BING_EMBED_PATH &&
    parsed.username === '' &&
    parsed.password === ''
  );
}
