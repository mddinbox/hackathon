/**
 * The visual engine — a dependency-free WebGL2 atmosphere that sits *beneath*
 * the semantic DOM.
 *
 * CanvasBrowser runs on a desktop with a real GPU and no battery anxiety, so
 * the ground each world stands on is computed per pixel rather than faked with
 * a handful of gradients. Four modes exist, one per surface:
 *
 *   home    latent worlds — a Time Terrain current on the left, a Signal Field
 *           on the right, joined by one continuous field around the prompt.
 *   travel  temporal depth — a perspective time topology whose floor is a
 *           coordinate system, with the corridor flowing through it.
 *   journey the route plane — a flat ground aligned to the drawn route, with a
 *           current along its bearing and a weather cell on the airport.
 *   news    civic instrument ground — quiet contour haze and fixed keylines
 *           beneath the semantic reach diagram.
 *
 * Rules the engine never breaks:
 *   - it is decorative: `aria-hidden`, `pointer-events: none`, no text, no
 *     product state. The DOM above it stays the truth.
 *   - one canvas element per mode, reused across renders, so re-rendering the
 *     app never accumulates contexts, RAF loops, or listeners.
 *   - reduced motion renders exactly one high-quality frame and never starts a
 *     RAF loop.
 *   - no textures, no network, no dependencies: procedural noise only.
 *
 * And the rule this file exists to enforce:
 *
 *   **Nothing animates unless a datum says it is happening.** Coordinate
 *   systems — graticules, the perspective floor, reach rings, the NOW rule —
 *   are places to read values against, so they hold perfectly still. Motion is
 *   spent only on something ongoing (traffic flowing, rain falling, an
 *   aircraft in the air) or something asking for attention (a check is due, a
 *   disruption is live, the world just changed). When none of those is true
 *   the engine draws one frame and **stops the loop entirely** — the still
 *   world is the honest picture, and the idle CPU is the proof.
 */

export type FxMode = 'home' | 'travel' | 'news' | 'journey';

export interface FxParams {
  /** News: field centre as a fraction of canvas width. */
  centerX: number;
  /** News: region-ring radius as a fraction of canvas width / height. */
  ellipseX: number;
  ellipseY: number;
  /** Travel: the NOW rule as a fraction of canvas width. */
  nowX: number;
  /** Travel: 1 when the world has a real anchor, 0 while it is unknown. */
  resolved: number;
  /** Bumped whenever knowledge changes; drives a one-shot ripple. */
  revision: number;
  /** Global brightness multiplier (high contrast pulls this down). */
  intensity: number;

  /* ---- Travel: the situation itself, not decoration ---- */

  /**
   * Where the passenger is, 0–1: scheduled 0 · en route 0.35 · landed 0.7 ·
   * at gate 1. Moves the dominant knowledge pulse along the time horizon.
   */
  flightPhase: number;
  /** How far the situation has travelled across its own horizon, 0–1. */
  flightProgress: number;
  /** 0–1 atmospheric density from the weather projection. */
  weatherIntensity: number;
  /** Screen-space wind direction, from the projection's compass bearing. */
  windX: number;
  windY: number;
  /** 0–1 congestion on the user's corridor. Compresses the flow lines. */
  trafficLoad: number;
  /** −1 easing · 0 steady · +1 building. */
  trafficTrend: number;
  /**
   * 1 while vehicles are actually moving on the drawn corridor — the layer is
   * shown and the load is above zero. 0 freezes the corridor flow.
   */
  trafficActive: number;
  /** 1 while the projection is wet or windy enough to see. 0 freezes it. */
  weatherActive: number;
  /** 1 while the aircraft is in the air. Landed or at-gate is a still dot. */
  flightActive: number;
  /** 1 while a live corridor disruption is drawn. */
  disruptionActive: number;
  /** 1 only when the next check is due or overdue — never a cadence metronome. */
  refreshDue: number;
  /** 1 when a live market feed is driving the axis. Sample data is still. */
  marketLive: number;
  /** 0–1 watch intensity: 0 stopped · 0.2 hourly · 0.55 quarter · 1 five-minute. */
  refreshUrgency: number;
  /** 1 just after a check, falling to 0 as the next one comes due. */
  minutesToRefresh: number;

  /* ---- Journey: the route plane, in the map's own coordinates ---- */

  /** The airport anchor, as a fraction of the canvas. */
  airportX: number;
  airportY: number;
  /** The unit bearing of the route at its midpoint. Aligns the ground flow. */
  routeX: number;
  routeY: number;
  /** Where NOW sits along the route, 0 at the origin, 1 at the curb. */
  routeProgress: number;
  /** 1 once a route exists at all; 0 while the spatial half is a stated gap. */
  routeKnown: number;
}

const DEFAULT_PARAMS: FxParams = {
  centerX: 0.46,
  ellipseX: 0.3,
  ellipseY: 0.46,
  nowX: 0.32,
  resolved: 0,
  revision: 0,
  intensity: 1,
  flightPhase: 0,
  flightProgress: 0,
  weatherIntensity: 0,
  windX: 0,
  windY: 0,
  trafficLoad: 0,
  trafficTrend: 0,
  trafficActive: 0,
  weatherActive: 0,
  flightActive: 0,
  disruptionActive: 0,
  refreshDue: 0,
  marketLive: 0,
  refreshUrgency: 0,
  minutesToRefresh: 0,
  airportX: 0.46,
  airportY: 0.62,
  routeX: 0,
  routeY: -1,
  routeProgress: 0,
  routeKnown: 0
};

/** The frame a still surface is rendered at: a composed, deliberate moment. */
const STATIC_TIME = 11.4;

const MAX_DPR = 2;

/* ------------------------------------------------------------------ shaders */

const VERTEX_SOURCE = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const COMMON = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_pointer;
uniform float u_centerX;
uniform vec2 u_ellipse;
uniform float u_nowX;
uniform float u_resolved;
uniform float u_pulse;
uniform float u_intensity;
uniform float u_flightPhase;
uniform float u_flightProgress;
uniform float u_weather;
uniform vec2 u_wind;
uniform float u_traffic;
uniform float u_trafficTrend;
uniform float u_trafficActive;
uniform float u_weatherActive;
uniform float u_flightActive;
uniform float u_disruptionActive;
uniform float u_refreshDue;
uniform float u_marketLive;
uniform float u_refreshUrgency;
uniform float u_refreshCountdown;
uniform vec2 u_airport;
uniform vec2 u_route;
uniform float u_routeProgress;
uniform float u_routeKnown;

const vec3 MINT = vec3(0.31, 0.94, 0.75);
const vec3 AMBER = vec3(0.95, 0.70, 0.36);
const vec3 SKY = vec3(0.46, 0.68, 1.00);
const vec3 ICE = vec3(0.74, 0.86, 1.00);

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.55;
  for (int i = 0; i < OCTAVES; i++) {
    sum += amp * vnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    amp *= 0.5;
  }
  return sum;
}

/** A thin bright line wherever \`v\` crosses an integer boundary. */
float band(float v, float width) {
  return smoothstep(width, 0.0, abs(fract(v) - 0.5));
}

/** The same idea, antialiased against the pixel derivative. */
float gridBand(float v, float softness) {
  float g = abs(fract(v) - 0.5);
  float aa = max(fwidth(v) * 1.4, softness);
  return 1.0 - smoothstep(0.0, aa, g);
}

float glowPoint(vec2 d, float size) {
  return exp(-dot(d, d) / max(size * size, 1e-6));
}
`;

const HOME_MAIN = `
/* Home has no scenario: no flight, no corridor, no weather, nothing being
   watched. So it is a *frozen latent world* — every structure below is
   computed once and holds still, and the only thing that responds is the
   pointer, because that is the person moving, not the world. */

/** Home's latent strata. Static by construction: no time enters here. */
float homeStrata(vec2 p, float relief) {
  float layerV = p.y * 7.5 + relief * 2.4;
  float lane = hash21(vec2(floor(layerV), 2.0));
  return band(layerV, 0.026) * (0.35 + 0.65 * lane);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  vec2 par = u_pointer * 0.045;

  vec3 worlds = vec3(0.0);

  float left = smoothstep(0.06, -0.52, p.x);
  float right = smoothstep(-0.06, 0.52, p.x);

  /* ---- Time Terrain: strata of time, layered and still ---- */
  vec2 tp = vec2(p.x * 0.62, p.y * 1.05) + par * vec2(0.8, 1.6);
  float relief = fbm(tp);
  float strata = homeStrata(p, relief);
  vec3 terrainInk = mix(MINT, AMBER, smoothstep(0.32, 0.68, relief));
  worlds += terrainInk * strata * 0.85 * left;

  /* Fine grain inside each stratum, so the terrain has material. */
  float grain = band(p.y * 23.0 + relief * 4.2 + p.x * 0.6, 0.10);
  worlds += terrainInk * grain * 0.10 * left;

  /* Uncertainty widens toward the left edge, as hatch does in the real world. */
  float hatch = band((p.x * 2.4 - p.y * 2.4) * 3.2, 0.14);
  worlds += AMBER * hatch * smoothstep(-0.20, -0.70, p.x) * 0.035;

  /* The terrain's own edge: a standing ridge of light, not a sweeping scan.
     Nothing is being watched here, so nothing sweeps. */
  float ridge = exp(-abs(p.x + 0.30) * 24.0);
  worlds += MINT * ridge * 0.55 * left;
  worlds += MINT * exp(-max(-(p.x + 0.30), 0.0) * 5.0) * 0.060 * left;

  /* ---- Local context: a grounded instrument grid, never orbital ---- */
  vec2 mp = vec2((p.x - 0.16) * 1.15, p.y) + par * 0.7;
  float mapGrid = gridBand(mp.x * 9.0, 0.007) + gridBand(mp.y * 9.0, 0.007);
  float mapRelief = fbm(mp * 1.4);
  worlds += mix(vec3(0.05, 0.24, 0.23), SKY, 0.22) * mapGrid * 0.20 * right;
  worlds += vec3(0.04, 0.18, 0.18) * mapRelief * 0.16 * right;
  float contextEdge = exp(-abs(p.x - 0.34) * 18.0);
  worlds += MINT * contextEdge * 0.16 * right;

  /* The two worlds stay out of the middle: the prompt owns the centre. */
  worlds *= 0.20 + 0.80 * smoothstep(0.10, 0.46, abs(p.x));

  /* ---- one continuous field, so the sides are never two screenshots ---- */
  float horizon = gridBand((p.y + par.y) * 7.0, 0.008);
  vec3 link = mix(MINT, SKY, smoothstep(-0.55, 0.55, p.x)) * horizon * 0.10;

  /* The prompt is the subject: the worlds open right around it, while the
     filaments that join them are allowed to keep crossing behind the type. */
  vec2 fp = vec2(p.x * 1.05, p.y * 2.3);
  float focus = exp(-dot(fp, fp) * 3.4);
  vec3 col = worlds * (1.0 - 0.92 * focus) + link * (1.0 - 0.62 * focus);

  /* Brand row, edges and floor stay quiet. */
  col *= smoothstep(0.0, 0.09, uv.y) * smoothstep(1.0, 0.90, uv.y);
  col *= smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 0.95, uv.x);

  col *= u_intensity * 0.95;
  float a = clamp(max(col.r, max(col.g, col.b)) * 0.75, 0.0, 0.86);
  fragColor = vec4(col, a);
}
`;

const TRAVEL_MAIN = `
/* A true perspective floor: uv.y below the horizon is ground running away
   from the viewer, so depth in this world literally is elapsed time.

   The floor is a *coordinate system*. Its lines of constant time and constant
   depth are computed by the three functions immediately below, none of which
   takes time as an argument or reads \`u_time\` — that is the guarantee, in
   the source, that the grid cannot drift, breathe or shimmer. What moves,
   moves because something is happening:

     u_trafficActive   vehicles are moving, inside the corridor and only there
     u_weatherActive   the projection is actually wet or windy
     u_flightActive    the aircraft is still in the air
     u_refreshDue      the next check is due or overdue
     u_pulse           the world was just rebuilt (one finite ripple)

   Set all of those to zero and this shader renders a completely still
   world — which is exactly what a landed flight in clear weather is. */
const float HORIZON = 0.72;
const float EYE = 0.20;
const float VPX = 0.62;

float gridLine(float v, float softness) {
  float g = abs(fract(v) - 0.5);
  float aa = max(fwidth(v) * 1.4, softness);
  return 1.0 - smoothstep(0.0, aa, g);
}

/* ---- static coordinate system: no time in, no time out ---- */

/** Lines of constant time, running away toward the horizon. */
float travelTimeLines(float wx) {
  return gridLine(wx * 0.85, 0.004);
}

/** Rows of constant depth. A fixed pitch, so the axis never rescales itself. */
float travelDepthRows(float z) {
  return gridLine(log(z) * 2.2, 0.006);
}

/** Ground material. Static: it is the floor, not an event on it. */
float travelRelief(float wx, float z) {
  return fbm(vec2(wx * 0.55, log(z) * 2.4));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float t = u_time;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 par = u_pointer * vec2(0.020, 0.010);

  vec3 col = vec3(0.0);
  vec3 known = mix(AMBER, MINT, u_resolved);

  float horizon = HORIZON + par.y;
  float below = horizon - uv.y;

  /* Depth and the world coordinates it implies. Computed for every pixel —
     never inside a branch — so the derivatives the grid needs stay defined. */
  float safeBelow = max(below, 0.004);
  float z = EYE / safeBelow;
  float wx = (uv.x - VPX + par.x) * z * 2.0 * aspect;
  float floorMask = smoothstep(0.0, 0.02, below);
  float fade = exp(-z * 0.13) * floorMask;

  /* The travel corridor: the user's own lane. It is bounded in depth *and*
     across the floor, so traffic acts on a route and never on the whole grid. */
  float lane = exp(-wx * wx * 0.55);
  float corridor = smoothstep(2.6, 0.35, z) * floorMask * lane;

  /* The coordinate system itself. Both terms are time-independent. */
  col += known * travelTimeLines(wx) * fade * 0.26;
  col += known * travelDepthRows(z) * fade * 0.20;
  col += known * travelRelief(wx, z) * fade * 0.12;

  /* Traffic: rows advancing *inside the corridor* at a speed congestion sets,
     so a jammed corridor visibly slows and compresses. No traffic, no drift,
     and nothing outside the lane ever moves. */
  float flowSpeed = 0.22 * (1.0 - 0.62 * u_traffic) * (1.0 - 0.12 * u_trafficTrend);
  float flowPitch = 1.9 + 1.5 * u_traffic;
  float flowRows = log(z) * flowPitch + t * flowSpeed * u_trafficActive;
  col += AMBER * gridLine(flowRows, 0.020) * corridor * u_traffic * u_trafficActive * 0.34;
  col += AMBER * fbm(vec2(wx * 0.9, log(z) * 3.0 - t * flowSpeed * 0.5 * u_trafficActive))
         * corridor * u_traffic * 0.16;

  /* Weather: streaks along the wind vector, moving only while there is
     weather to move. Clear removes both the density and the motion. */
  vec2 wind = u_wind;
  float windMag = length(wind) + 1e-4;
  vec2 windDir = wind / windMag;
  vec2 wp = vec2(uv.x * aspect, uv.y);
  float along = dot(wp, windDir);
  float across = dot(wp, vec2(-windDir.y, windDir.x));
  float weatherTime = t * u_weatherActive;
  float streak = band(across * (14.0 + 22.0 * u_weather) + along * 2.0 - weatherTime * (0.5 + 2.4 * windMag), 0.20);
  float wash = fbm(vec2(across * 3.4, along * 2.2 - weatherTime * (0.10 + 0.5 * windMag)));
  col += ICE * streak * u_weather * 0.10;
  col += mix(ICE, SKY, 0.5) * wash * u_weather * 0.13 * smoothstep(0.05, 0.55, uv.y);

  /* Visibility falls as the atmosphere thickens: the horizon is genuinely
     harder to read in weather, which is the point. */
  float clarity = 1.0 - 0.35 * u_weather;

  /* The passenger. One marker, where the situation actually is along its own
     horizon — a still observation, with nothing breathing around it. While the
     aircraft is in the air, and only then, a faint trail runs up the approach
     behind it; that trail is the whole of this marker's motion. */
  float leadZ = mix(6.2, 0.42, clamp(u_flightProgress, 0.0, 1.0));
  vec2 leadPos = vec2(VPX + (u_flightPhase * 1.1 - 0.55) / (leadZ * 2.0 * aspect), horizon - EYE / leadZ);
  vec2 ld = uv - leadPos;
  ld.x *= aspect * 0.75;
  float leadSize = clamp(0.22 / leadZ, 0.010, 0.17);
  col += mix(AMBER, MINT, u_flightPhase) * glowPoint(ld, leadSize) * (0.75 + 0.85 * u_flightPhase);

  float inbound = fract(t * 0.16);
  vec2 trailPos = mix(leadPos - vec2(0.13, 0.045), leadPos, inbound);
  vec2 td = uv - trailPos;
  td.x *= aspect * 0.75;
  col += MINT * glowPoint(td, leadSize * 0.5) * u_flightActive * 0.5 * (1.0 - inbound);

  /* Above the horizon: thin atmosphere, so the depth has somewhere to go. */
  float sky = fbm(vec2(uv.x * 2.6, uv.y * 5.0));
  col += SKY * sky * smoothstep(0.98, 0.72, uv.y) * (1.0 - floorMask) * 0.06;

  /* The horizon: where this world's answer finally lands. */
  col += known * exp(-abs(uv.y - horizon) * 130.0) * 0.32 * clarity * smoothstep(0.06, 0.26, uv.x);
  col += known * exp(-abs(uv.y - horizon) * 26.0) * 0.09 * clarity * smoothstep(0.05, 0.7, uv.x);

  /* NOW: one standing column of light the whole terrain is measured against.
     A position indicator holds still — it is where you are, not an alarm. */
  float ndist = abs(uv.x - u_nowX);
  col += MINT * exp(-ndist * 170.0) * 0.75;
  col += MINT * exp(-ndist * 18.0) * 0.05;

  /* Hatch haze past NOW while the landing is still unknown. */
  float hatch = band((uv.x * aspect - uv.y) * 30.0, 0.26);
  col += AMBER * hatch * smoothstep(u_nowX + 0.05, u_nowX + 0.45, uv.x) * 0.05 *
         (1.0 - u_resolved * 0.6);

  /* The watch. Not a metronome: the cadence is stated in words and drawn as a
     draining dial, and this sweep appears only when the check is actually due
     or overdue — the one moment the world is asking to be looked at. */
  float scan = fract(t * 0.55);
  col += mix(AMBER, MINT, u_resolved) *
         exp(-abs(uv.y - (horizon - 0.02 - scan * 0.34)) * 220.0) *
         u_refreshDue * (0.45 + 0.35 * (1.0 - scan));

  /* A finite ripple across the terrain each time the world is rebuilt. */
  col += MINT * gridLine((uv.x - (1.0 - u_pulse)) * 6.0 + 0.5, 0.01) * u_pulse * 0.25;

  /* The axis strip at the top and the legend at the foot stay legible. */
  col *= smoothstep(1.0, 0.88, uv.y);
  col *= 0.40 + 0.60 * smoothstep(0.0, 0.14, uv.y);

  col *= u_intensity * 0.90;
  float a = clamp(max(col.r, max(col.g, col.b)) * 0.80, 0.0, 0.88);
  fragColor = vec4(col, a);
}
`;

const JOURNEY_MAIN = `
/* The Journey plane.
   This is the atmosphere *under* a real Bing Maps base and CanvasBrowser's own
   overlays, so it is deliberately quiet and, by default, completely still.

   The graticule and the relief are a coordinate system, computed by the two
   functions below — neither takes time, neither reads \`u_time\`. The route
   current runs only while vehicles are moving, and only inside a bounded
   corridor along the route; the airport cell ripples only while the projection
   is wet; the arrival trail runs only while the aircraft is in the air; the
   scan appears only when a check is due. Landed, clear and just-checked
   renders one frozen frame. */

/* ---- static coordinate system: no time in, no time out ---- */

/** The graticule: a place to read positions against, so it never moves. */
float journeyGraticule(vec2 uv) {
  return gridBand(uv.x * 22.0, 0.02) + gridBand(uv.y * 14.0, 0.02);
}

/** Ground relief under the map. Material, not event. */
float journeyRelief(vec2 p) {
  return fbm(vec2(p.x * 2.1, p.y * 2.4));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float t = u_time;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 par = u_pointer * vec2(0.012, 0.008);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) + par;

  vec3 col = vec3(0.0);

  /* Terrain relief under the map: soft land masses so the route has ground. */
  float relief = journeyRelief(p);
  col += mix(vec3(0.05, 0.09, 0.10), vec3(0.09, 0.13, 0.12), relief) * 0.55;
  col += ICE * journeyGraticule(uv) * 0.020;

  /* The corridor: a narrow, bounded band along the drawn route — the lane the
     user actually drives, not the whole plane. */
  vec2 dir = normalize(u_route + vec2(1e-4, 1e-4));
  float along = dot(p, dir);
  float across = dot(p, vec2(-dir.y, dir.x));
  float lane = exp(-across * across * (240.0 - 90.0 * u_traffic));
  float corridor = lane * smoothstep(0.62, 0.42, abs(along)) * u_routeKnown;

  /* The route current: literally the vehicles on that corridor. It advances at
     a speed congestion sets, and it is not drawn at all when the traffic layer
     is hidden or the load is zero — there is nothing to flow. */
  float speed = 0.30 * (1.0 - 0.60 * u_traffic) * (1.0 - 0.10 * u_trafficTrend);
  float pitch = 9.0 + 12.0 * u_traffic;
  float current = gridBand(along * pitch - t * speed * pitch * 0.35, 0.10);
  col += mix(MINT, AMBER, u_traffic) * current * corridor * u_trafficActive * (0.18 + 0.30 * u_traffic);

  /* NOW on the route: a position indicator, so it holds still. */
  vec2 carPos = dir * mix(-0.34, 0.34, clamp(u_routeProgress, 0.0, 1.0));
  vec2 cd = p - carPos;
  col += MINT * glowPoint(cd, 0.045) * u_routeKnown * 0.55;

  /* The airport field. Its edge ripples only while there is weather. */
  vec2 air = vec2((u_airport.x - 0.5) * aspect, (1.0 - u_airport.y) - 0.5);
  vec2 ad = p - air;
  float windMag = length(u_wind) + 1e-4;
  vec2 windDir = u_wind / windMag;
  float stretch = 1.0 + 1.3 * windMag * u_weather;
  vec2 warped = vec2(dot(ad, windDir) / stretch, dot(ad, vec2(-windDir.y, windDir.x)));
  float ar = length(warped);
  float weatherTime = t * u_weatherActive;
  float ripple = 0.012 * u_weather * sin(ar * 46.0 - weatherTime * (1.2 + 3.0 * windMag));
  float cellR = 0.13 + 0.10 * u_weather;
  col += mix(ICE, SKY, 0.45) * smoothstep(0.035, 0.0, abs(ar - cellR + ripple)) * (0.10 + 0.45 * u_weather);
  col += mix(ICE, SKY, 0.6) * exp(-ar * ar * 9.0) * u_weather * 0.16;

  /* Precipitation streaks, running along the wind, only inside the cell and
     only while it is actually raining. */
  float streak = gridBand(dot(p, vec2(-windDir.y, windDir.x)) * (26.0 + 30.0 * u_weather)
                          + dot(p, windDir) * 3.0 - weatherTime * (0.6 + 3.0 * windMag), 0.16);
  col += ICE * streak * u_weather * smoothstep(cellR * 1.5, 0.0, ar) * 0.16;

  /* The arrival. Its place is set by the phase alone — on the ground it is one
     still observed marker. While the aircraft is in the air, and only then, a
     faint trail closes on the airport behind it. */
  float orbit = mix(0.30, 0.045, clamp(u_flightPhase, 0.0, 1.0));
  float bearing = 2.4 - u_flightPhase * 2.2;
  vec2 approach = air + vec2(cos(bearing), sin(bearing)) * orbit;
  col += mix(AMBER, MINT, u_flightPhase) * glowPoint(p - approach, 0.05) * (0.60 + 0.80 * u_flightPhase);

  float inbound = fract(t * 0.16);
  vec2 trail = mix(air + vec2(cos(bearing), sin(bearing)) * (orbit + 0.16), approach, inbound);
  col += MINT * glowPoint(p - trail, 0.028) * u_flightActive * 0.5 * (1.0 - inbound);

  /* The watch: a ring out from the airport, only while a check is due. */
  float scan = fract(t * 0.5);
  col += MINT
         * smoothstep(0.030, 0.0, abs(ar - scan * 0.95))
         * u_refreshDue * 0.40 * (1.0 - scan);

  /* A live disruption keeps one slow beat on the corridor, because it is the
     thing on this plane that wants a decision. */
  col += vec3(1.0, 0.36, 0.29) * corridor * u_disruptionActive * (0.05 + 0.05 * sin(t * 2.2));

  /* A finite knowledge ripple each time the world is rebuilt. */
  col += MINT * smoothstep(0.05, 0.0, abs(ar - (1.0 - u_pulse) * 1.1)) * u_pulse * 0.5;

  /* Vignette, so the semantic map above always wins the contrast fight. */
  float vig = smoothstep(1.15, 0.25, length(p));
  col *= 0.45 + 0.55 * vig;

  col *= u_intensity * 0.62;
  float a = clamp(max(col.r, max(col.g, col.b)) * 0.80, 0.0, 0.80);
  fragColor = vec4(col, a);
}
`;

const NEWS_MAIN = `
/* The Signal Field.
   Local News is a civic instrument, not a galaxy. The semantic DOM owns reach
   rings and signals; this layer contributes only quiet grounded depth. */

/** Static instrument grid. No time, orbit, particle, or map claim enters. */
float newsGraticule(vec2 p) {
  float x = gridBand(p.x * 14.0, 0.005);
  float y = gridBand(p.y * 9.0, 0.005);
  return x + y;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 par = u_pointer * vec2(0.012, 0.009);
  vec2 p = uv + par;
  p.x *= aspect;

  vec3 col = vec3(0.0);
  float relief = fbm(p * 1.2);
  col += vec3(0.18, 0.72, 0.69) * newsGraticule(p) * 0.035;

  /* A grounded regional wash, deliberately broad and non-orbital. */
  float regional = smoothstep(1.1, 0.0, length(vec2((uv.x - u_centerX) * 0.75, uv.y - 0.58)));
  col += vec3(0.04, 0.23, 0.24) * regional * (0.28 + relief * 0.20);

  /* The market is a fixed edge instrument, not a flowing cosmic band. */
  float marketEdge = exp(-abs(uv.x - 0.91) * 32.0);
  col += AMBER * marketEdge * 0.075;

  /* Protect the human anchor by darkening the ground beneath it. */
  vec2 cd = vec2((uv.x - u_centerX) * aspect, uv.y - 0.5);
  float centreMask = smoothstep(0.07, 0.19, length(cd));
  col *= mix(0.18, 1.0, centreMask);

  col *= smoothstep(0.0, 0.06, uv.y) * smoothstep(1.0, 0.94, uv.y);

  col *= u_intensity;
  float a = clamp(max(col.r, max(col.g, col.b)) * 0.78, 0.0, 0.72);
  fragColor = vec4(col, a);
}
`;

function fragmentSource(mode: FxMode, low: boolean): string {
  const defines = low
    ? '#define OCTAVES 3\n#define PARTICLES 10\n#define PULSES 4\n'
    : '#define OCTAVES 5\n#define PARTICLES 30\n#define PULSES 8\n';
  const main =
    mode === 'home'
      ? HOME_MAIN
      : mode === 'travel'
        ? TRAVEL_MAIN
        : mode === 'journey'
          ? JOURNEY_MAIN
          : NEWS_MAIN;
  const header = COMMON.replace('precision highp float;', `precision highp float;\n${defines}`);
  return `${header}\n${main}`;
}

/* ------------------------------------------------- the static-coordinate claim */

/**
 * Every coordinate system in this engine, by the name of the function that
 * computes it.
 *
 * The claim these worlds make is that a graticule, a perspective floor, a set
 * of reach rings and a stratum of latent time are *places to read values
 * against*, and therefore do not move. That claim is only worth anything if it
 * can be checked, so each of them is a named function that takes no time
 * argument — and `fxFunctionSource` below hands its body to anyone who wants
 * to confirm that `u_time` never appears inside it.
 */
export const FX_STATIC_COORDINATE_FUNCTIONS: Record<FxMode, string[]> = {
  home: ['homeStrata'],
  travel: ['travelTimeLines', 'travelDepthRows', 'travelRelief'],
  journey: ['journeyGraticule', 'journeyRelief'],
  news: ['newsGraticule']
};

/** The exact fragment source a mode compiles, for inspection. */
export function fxShaderSource(mode: FxMode): string {
  return fragmentSource(mode, false);
}

/** One function's full text, braces matched, or null when it is not there. */
export function fxFunctionSource(source: string, name: string): string | null {
  const start = source.search(new RegExp(`(^|[^\\w])${name}\\s*\\(`, 'm'));
  if (start < 0) return null;
  const open = source.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/* ---------------------------------------------------------------- lifecycle */

function prefersReducedMotion(): boolean {
  if (document.documentElement.dataset.motion === 'reduced') return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

interface Renderer {
  draw(time: number, params: FxParams, pointer: { x: number; y: number }, pulse: number): void;
  resize(width: number, height: number): void;
  release(): void;
  readonly quality: string;
}

/* ------------------------------------------------------------------- WebGL2 */

class GLRenderer implements Renderer {
  readonly quality: string;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject | null;
  private readonly loc: Record<string, WebGLUniformLocation | null>;

  private constructor(gl: WebGL2RenderingContext, program: WebGLProgram, quality: string) {
    this.gl = gl;
    this.program = program;
    this.quality = quality;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.useProgram(program);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const name = (key: string): WebGLUniformLocation | null => gl.getUniformLocation(program, key);
    this.loc = {
      res: name('u_res'),
      time: name('u_time'),
      pointer: name('u_pointer'),
      centerX: name('u_centerX'),
      ellipse: name('u_ellipse'),
      nowX: name('u_nowX'),
      resolved: name('u_resolved'),
      pulse: name('u_pulse'),
      intensity: name('u_intensity'),
      flightPhase: name('u_flightPhase'),
      flightProgress: name('u_flightProgress'),
      weather: name('u_weather'),
      wind: name('u_wind'),
      traffic: name('u_traffic'),
      trafficTrend: name('u_trafficTrend'),
      trafficActive: name('u_trafficActive'),
      weatherActive: name('u_weatherActive'),
      flightActive: name('u_flightActive'),
      disruptionActive: name('u_disruptionActive'),
      refreshDue: name('u_refreshDue'),
      marketLive: name('u_marketLive'),
      refreshUrgency: name('u_refreshUrgency'),
      refreshCountdown: name('u_refreshCountdown'),
      airport: name('u_airport'),
      route: name('u_route'),
      routeProgress: name('u_routeProgress'),
      routeKnown: name('u_routeKnown')
    };
  }

  static create(canvas: HTMLCanvasElement, mode: FxMode): GLRenderer | null {
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false
      }) as WebGL2RenderingContext | null;
    } catch {
      return null;
    }
    if (!gl) return null;

    const low = isSoftwareRenderer(gl);
    const program = buildProgram(gl, VERTEX_SOURCE, fragmentSource(mode, low));
    if (!program) return null;
    return new GLRenderer(gl, program, low ? 'low' : 'high');
  }

  resize(width: number, height: number): void {
    this.gl.viewport(0, 0, width, height);
  }

  draw(time: number, params: FxParams, pointer: { x: number; y: number }, pulse: number): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.bindVertexArray(this.vao);
    gl.useProgram(this.program);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.loc.res) gl.uniform2f(this.loc.res, gl.drawingBufferWidth, gl.drawingBufferHeight);
    if (this.loc.time) gl.uniform1f(this.loc.time, time);
    if (this.loc.pointer) gl.uniform2f(this.loc.pointer, pointer.x, pointer.y);
    if (this.loc.centerX) gl.uniform1f(this.loc.centerX, params.centerX);
    if (this.loc.ellipse) gl.uniform2f(this.loc.ellipse, params.ellipseX, params.ellipseY);
    if (this.loc.nowX) gl.uniform1f(this.loc.nowX, params.nowX);
    if (this.loc.resolved) gl.uniform1f(this.loc.resolved, params.resolved);
    if (this.loc.pulse) gl.uniform1f(this.loc.pulse, pulse);
    if (this.loc.intensity) gl.uniform1f(this.loc.intensity, params.intensity);
    if (this.loc.flightPhase) gl.uniform1f(this.loc.flightPhase, params.flightPhase);
    if (this.loc.flightProgress) gl.uniform1f(this.loc.flightProgress, params.flightProgress);
    if (this.loc.weather) gl.uniform1f(this.loc.weather, params.weatherIntensity);
    if (this.loc.wind) gl.uniform2f(this.loc.wind, params.windX, params.windY);
    if (this.loc.traffic) gl.uniform1f(this.loc.traffic, params.trafficLoad);
    if (this.loc.trafficTrend) gl.uniform1f(this.loc.trafficTrend, params.trafficTrend);
    if (this.loc.trafficActive) gl.uniform1f(this.loc.trafficActive, params.trafficActive);
    if (this.loc.weatherActive) gl.uniform1f(this.loc.weatherActive, params.weatherActive);
    if (this.loc.flightActive) gl.uniform1f(this.loc.flightActive, params.flightActive);
    if (this.loc.disruptionActive) gl.uniform1f(this.loc.disruptionActive, params.disruptionActive);
    if (this.loc.refreshDue) gl.uniform1f(this.loc.refreshDue, params.refreshDue);
    if (this.loc.marketLive) gl.uniform1f(this.loc.marketLive, params.marketLive);
    if (this.loc.refreshUrgency) gl.uniform1f(this.loc.refreshUrgency, params.refreshUrgency);
    if (this.loc.refreshCountdown) gl.uniform1f(this.loc.refreshCountdown, params.minutesToRefresh);
    if (this.loc.airport) gl.uniform2f(this.loc.airport, params.airportX, params.airportY);
    if (this.loc.route) gl.uniform2f(this.loc.route, params.routeX, params.routeY);
    if (this.loc.routeProgress) gl.uniform1f(this.loc.routeProgress, params.routeProgress);
    if (this.loc.routeKnown) gl.uniform1f(this.loc.routeKnown, params.routeKnown);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Frees the program and the vertex array. The drawing context itself is
   * deliberately kept: there are at most three canvases (one per mode) and
   * they are reused, so nothing accumulates — while force-losing a context
   * would permanently break the canvas the next time its world is opened.
   */
  release(): void {
    const gl = this.gl;
    try {
      if (gl.isContextLost()) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindVertexArray(null);
      if (this.vao) gl.deleteVertexArray(this.vao);
      gl.deleteProgram(this.program);
    } catch {
      /* the context is already gone; nothing to release */
    }
  }
}

function isSoftwareRenderer(gl: WebGL2RenderingContext): boolean {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const raw = info
      ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|software|basic render/i.test(raw);
  } catch {
    return true;
  }
}

function buildProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram | null {
  const compile = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vs = compile(gl.VERTEX_SHADER, vertex);
  const fs = vs ? compile(gl.FRAGMENT_SHADER, fragment) : null;
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/* ----------------------------------------------------------- Canvas2D fallback */

/**
 * When WebGL is unavailable the world must still feel authored, so the same
 * four compositions are approximated with gradients and strokes. It follows
 * exactly the same rule as the shaders: structure is drawn at a fixed time,
 * and only a datum that says something is happening is allowed to move.
 */
class Canvas2DRenderer implements Renderer {
  readonly quality = 'canvas2d';
  private readonly ctx: CanvasRenderingContext2D;
  private readonly mode: FxMode;
  private width = 1;
  private height = 1;

  private constructor(ctx: CanvasRenderingContext2D, mode: FxMode) {
    this.ctx = ctx;
    this.mode = mode;
  }

  static create(canvas: HTMLCanvasElement, mode: FxMode): Canvas2DRenderer | null {
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d', { alpha: true });
    } catch {
      return null;
    }
    return ctx ? new Canvas2DRenderer(ctx, mode) : null;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  draw(time: number, params: FxParams): void {
    const { ctx } = this;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.85 * params.intensity;

    const halo = (x: number, y: number, radius: number, colour: string): void => {
      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
      grad.addColorStop(0, colour);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    };

    if (this.mode === 'home') {
      halo(w * 0.16, h * 0.5, h * 0.75, 'rgba(79,240,192,0.16)');
      const context = ctx.createLinearGradient(w * 0.5, 0, w, h);
      context.addColorStop(0, 'rgba(3,20,22,0)');
      context.addColorStop(1, 'rgba(32,87,92,0.18)');
      ctx.fillStyle = context;
      ctx.fillRect(w * 0.5, 0, w * 0.5, h);
      ctx.strokeStyle = 'rgba(93,245,233,0.10)';
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.moveTo(w * (0.54 + i * 0.075), 0);
        ctx.lineTo(w * (0.48 + i * 0.075), h);
        ctx.stroke();
      }
      // Home has no scenario, so its strata are ruled lines, not a wave.
      ctx.strokeStyle = 'rgba(79,240,192,0.22)';
      for (let i = 0; i < 6; i++) {
        const y = h * (0.24 + i * 0.1);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w * 0.34, y + 10);
        ctx.stroke();
      }
    } else if (this.mode === 'travel' || this.mode === 'journey') {
      halo(w * 0.8, h * 0.2, h * 1.1, 'rgba(79,240,192,0.14)');

      // The corridor: one bounded lane, not a fan across the whole floor. Its
      // dashes drift only while vehicles are actually moving on it.
      const load = Math.max(0, Math.min(1, params.trafficLoad));
      if (load > 0) {
        const drift = params.trafficActive > 0 ? (time * (14 + load * 30)) % 28 : 0;
        ctx.save();
        ctx.setLineDash([10, 18]);
        ctx.lineDashOffset = -drift;
        ctx.lineWidth = 2 + load * 4;
        ctx.strokeStyle = `rgba(242,179,92,${(0.18 + load * 0.3).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(w * 0.16, h);
        ctx.lineTo(w * 0.8, h * 0.2);
        ctx.stroke();
        ctx.restore();
      }

      // The weather wash runs along the wind vector, and vanishes when clear.
      const weather = Math.max(0, Math.min(1, params.weatherIntensity));
      if (weather > 0.02) {
        const len = Math.hypot(params.windX, params.windY) || 1;
        const dx = (params.windX / len) * w * 0.25;
        const dy = (params.windY / len) * h * 0.25;
        const rain = params.weatherActive > 0 ? ((time * 0.6) % 1) * h * 0.07 : 0;
        ctx.strokeStyle = `rgba(189,220,255,${(weather * 0.18).toFixed(3)})`;
        for (let i = 0; i < 14; i++) {
          const y = h * (i / 14) + rain;
          ctx.beginPath();
          ctx.moveTo(-w * 0.1, y);
          ctx.lineTo(-w * 0.1 + dx + w * 0.6, y + dy);
          ctx.stroke();
        }
      }

      // The passenger sits where the situation is on the horizon. On the
      // ground it is a still marker; in the air a faint trail runs inbound
      // behind it, and that trail is the whole of its motion.
      const lead = Math.max(0, Math.min(1, params.flightProgress));
      const leadX = w * (0.2 + lead * 0.6);
      const leadY = h * (0.28 + lead * 0.35);
      halo(leadX, leadY, h * 0.22, 'rgba(79,240,192,0.30)');
      if (params.flightActive > 0) {
        const inbound = (time * 0.16) % 1;
        halo(leadX - w * 0.09 * (1 - inbound), leadY - h * 0.05 * (1 - inbound), h * 0.09, 'rgba(79,240,192,0.18)');
      }

      ctx.fillStyle = 'rgba(79,240,192,0.5)';
      if (this.mode === 'travel') {
        ctx.fillRect(w * params.nowX - 1, 0, 2, h);
      } else {
        // Journey: the current sits on the route, not on a time column.
        const cx = w * params.airportX;
        const cy = h * params.airportY;
        ctx.strokeStyle = 'rgba(79,240,192,0.35)';
        ctx.beginPath();
        ctx.moveTo(cx - params.routeX * w * 0.4, cy - params.routeY * h * 0.4);
        ctx.lineTo(cx, cy);
        ctx.stroke();
      }

      // The watch sweep — only while a check is actually due.
      if (params.refreshDue > 0) {
        const scan = (time * 0.5) % 1;
        ctx.fillStyle = 'rgba(79,240,192,0.30)';
        ctx.fillRect(0, h * (0.28 + scan * 0.34), w, 2);
      }
    } else {
      // Local News is an instrument ground, not an orbital field.
      const background = ctx.createLinearGradient(0, 0, w, h);
      background.addColorStop(0, 'rgba(3,24,30,0.42)');
      background.addColorStop(0.65, 'rgba(5,31,34,0.22)');
      background.addColorStop(1, 'rgba(30,24,12,0.12)');
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(93,245,233,0.10)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const y = h * (0.16 + i * 0.12);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(w * 0.25, y - h * 0.05, w * 0.58, y + h * 0.04, w, y - h * 0.025);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(93,245,233,0.055)';
      ctx.setLineDash([2, 8]);
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(w * (i / 7), 0);
        ctx.lineTo(w * (i / 7 - 0.12), h);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  release(): void {
    try {
      this.ctx.clearRect(0, 0, this.width, this.height);
    } catch {
      /* nothing to clear */
    }
  }
}

/* ------------------------------------------------------------------- engine */

class VisualEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly mode: FxMode;
  private readonly renderer: Renderer | null;
  private readonly observer: ResizeObserver | null = null;
  private readonly onPointerMove: (event: PointerEvent) => void;
  private readonly onContextLost: (event: Event) => void;

  private params: FxParams = { ...DEFAULT_PARAMS };
  private pointer = { x: 0, y: 0 };
  private target = { x: 0, y: 0 };
  private rect = { left: 0, top: 0, width: 1, height: 1 };
  private raf = 0;
  private frames = 0;
  private started = performance.now();
  private pulseAt = -100;
  private revision = -1;
  private staticMode = false;
  private disposed = false;
  private pixelWidth = 0;
  private pixelHeight = 0;

  constructor(canvas: HTMLCanvasElement, mode: FxMode) {
    this.canvas = canvas;
    this.mode = mode;
    this.renderer = GLRenderer.create(canvas, mode) ?? Canvas2DRenderer.create(canvas, mode);

    if (!this.renderer) {
      canvas.dataset.fxState = 'off';
      canvas.dataset.fxQuality = 'none';
      canvas.style.display = 'none';
      this.onPointerMove = () => undefined;
      this.onContextLost = () => undefined;
      return;
    }

    canvas.style.display = '';
    canvas.dataset.fxQuality = this.renderer.quality;

    this.onPointerMove = (event: PointerEvent): void => {
      const { left, top, width, height } = this.rect;
      this.target.x = Math.max(-1.5, Math.min(1.5, ((event.clientX - left) / width) * 2 - 1));
      this.target.y = Math.max(-1.5, Math.min(1.5, 1 - ((event.clientY - top) / height) * 2));
      // A still world still answers the pointer: the parallax is the person
      // moving, not the world, so it redraws exactly one frame.
      if (this.raf === 0) this.renderOnce();
    };
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });

    this.onContextLost = (event: Event): void => {
      event.preventDefault();
      this.stopLoop();
      canvas.dataset.fxState = 'off';
    };
    canvas.addEventListener('webglcontextlost', this.onContextLost);

    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const box = entry.contentRect;
        // The only layout read in the engine, and it happens on resize alone.
        const bounds = this.canvas.getBoundingClientRect();
        this.rect = { left: bounds.left, top: bounds.top, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) };
        this.applySize(box.width, box.height);
      });
      this.observer.observe(canvas);
    }

    const bounds = canvas.getBoundingClientRect();
    this.rect = { left: bounds.left, top: bounds.top, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) };
    this.applySize(bounds.width, bounds.height);
  }

  private applySize(cssWidth: number, cssHeight: number): void {
    if (!this.renderer || this.disposed) return;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const scale = this.renderer.quality === 'high' ? dpr : 1;
    const width = Math.max(1, Math.round((cssWidth || this.rect.width) * scale));
    const height = Math.max(1, Math.round((cssHeight || this.rect.height) * scale));
    if (width === this.pixelWidth && height === this.pixelHeight) return;
    this.pixelWidth = width;
    this.pixelHeight = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.renderer.resize(width, height);
    this.renderOnce();
  }

  /** Called after every app render: cheap, idempotent, never re-allocates. */
  update(params: Partial<FxParams>): void {
    if (this.disposed) return;
    const next: FxParams = { ...this.params, ...params };
    if (next.revision !== this.revision) {
      // A real knowledge change earns exactly one finite ripple.
      if (this.revision >= 0) this.pulseAt = (performance.now() - this.started) / 1000;
      this.revision = next.revision;
    }
    this.params = next;
    this.publishState();
    if (!this.renderer) return;

    const reduced = prefersReducedMotion();
    this.staticMode = reduced;
    if (reduced) {
      this.stopLoop();
      this.canvas.dataset.fxState = 'static';
      this.renderOnce();
      return;
    }
    if (this.shouldRun()) {
      this.canvas.dataset.fxState = 'running';
      this.startLoop();
    } else {
      // Nothing is happening in this world, so nothing is drawn twice. The
      // still frame is the honest picture and the idle CPU is the proof.
      this.stopLoop();
      this.canvas.dataset.fxState = 'static';
      this.renderOnce();
    }
  }

  /**
   * The motions the current readings justify, as a machine-readable list.
   *
   * This is the same vocabulary `motion.ts` uses for the words under the map,
   * so the legend and the pixels cannot drift apart — and a test can assert
   * that a landed flight in clear weather with no check due animates nothing.
   */
  private continuousMotion(): string[] {
    const p = this.params;
    const motions: string[] = [];
    if (this.mode === 'travel' || this.mode === 'journey') {
      if (p.trafficActive > 0 && p.trafficLoad > 0) motions.push('traffic');
      if (p.weatherActive > 0 && p.weatherIntensity > 0) motions.push('weather');
      if (p.flightActive > 0) motions.push('flight');
      if (p.disruptionActive > 0) motions.push('disruption');
      if (p.refreshDue > 0) motions.push('refresh-due');
    }
    if (this.mode === 'news' && p.marketLive > 0) motions.push('market');
    return motions;
  }

  private pulsePending(): boolean {
    const since = (performance.now() - this.started) / 1000 - this.pulseAt;
    return since >= 0 && since < 3;
  }

  private shouldRun(): boolean {
    return this.continuousMotion().length > 0 || this.pulsePending();
  }

  private startLoop(): void {
    if (this.raf !== 0 || this.disposed || !this.renderer) return;
    const tick = (): void => {
      this.raf = requestAnimationFrame(tick);
      this.frames += 1;
      const time = (performance.now() - this.started) / 1000;
      // Pointer easing keeps parallax fluid without reading layout.
      this.pointer.x += (this.target.x - this.pointer.x) * 0.06;
      this.pointer.y += (this.target.y - this.pointer.y) * 0.06;
      this.renderer!.draw(time, this.params, this.pointer, this.pulse(time));
      this.canvas.dataset.fxFrame = String(this.frames);
      // The moment the last thing that was happening stops happening, so does
      // the loop. A finite ripple is allowed to finish first.
      if (!this.shouldRun()) {
        this.stopLoop();
        this.canvas.dataset.fxState = 'static';
        this.publishState();
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /**
   * Mirrors the scenario inputs onto the canvas element as data attributes.
   *
   * This is not product state and nothing reads it to render the DOM. It is
   * how the animation can be *checked*: an assertion (or a person with dev
   * tools) can confirm that what the world is doing is what the situation
   * says, rather than taking "it looks alive" on faith.
   */
  private publishState(): void {
    const round = (value: number): string => (Math.round(value * 100) / 100).toFixed(2);
    const data = this.canvas.dataset;

    // The one attribute that matters most: what is moving, right now, and why.
    // Empty means the world is genuinely still.
    const motions = this.continuousMotion();
    if (this.pulsePending()) motions.push('world-update');
    data.fxActiveMotion = motions.join(',');

    // Travel and Journey are the same situation seen two ways, so both publish
    // the scenario readings that drive them.
    if (this.mode !== 'travel' && this.mode !== 'journey') {
      delete data.fxFlightPhase;
      delete data.fxFlightProgress;
      delete data.fxWeather;
      delete data.fxWind;
      delete data.fxTraffic;
      delete data.fxTrafficTrend;
      delete data.fxRefreshUrgency;
      delete data.fxRoute;
      delete data.fxRouteProgress;
      delete data.fxRouteKnown;
      return;
    }
    data.fxFlightPhase = round(this.params.flightPhase);
    data.fxFlightProgress = round(this.params.flightProgress);
    data.fxWeather = round(this.params.weatherIntensity);
    data.fxWind = `${round(this.params.windX)},${round(this.params.windY)}`;
    data.fxTraffic = round(this.params.trafficLoad);
    data.fxTrafficTrend = round(this.params.trafficTrend);
    data.fxRefreshUrgency = round(this.params.refreshUrgency);
    if (this.mode === 'journey') {
      data.fxRoute = `${round(this.params.routeX)},${round(this.params.routeY)}`;
      data.fxRouteProgress = round(this.params.routeProgress);
      data.fxRouteKnown = round(this.params.routeKnown);
    }
  }

  private pulse(time: number): number {
    const since = time - this.pulseAt;
    return since < 0 || since > 3 ? 0 : Math.exp(-since * 1.5) * Math.min(1, since * 6);
  }

  /** One deliberate, high-quality still. Used by reduced motion and resize. */
  private renderOnce(): void {
    if (!this.renderer || this.disposed) return;
    this.frames += 1;
    this.pointer.x = this.target.x;
    this.pointer.y = this.target.y;
    this.renderer.draw(STATIC_TIME, this.params, this.pointer, 0);
    this.canvas.dataset.fxFrame = String(this.frames);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();
    this.observer?.disconnect();
    window.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer?.release();
    delete this.canvas.dataset.fxState;
    delete this.canvas.dataset.fxFrame;
    delete this.canvas.dataset.fxActiveMotion;
  }
}

/* --------------------------------------------------------------- module API */

const canvases = new Map<FxMode, HTMLCanvasElement>();
let active: { mode: FxMode; engine: VisualEngine } | null = null;

/**
 * The canvas element for a mode. The same element is handed back on every
 * render, so moving it into a freshly built view keeps one live GPU context
 * per mode instead of leaking one per render.
 */
export function fxCanvas(mode: FxMode): HTMLCanvasElement {
  const existing = canvases.get(mode);
  if (existing) return existing;
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  canvas.dataset.fxMode = mode;
  canvas.dataset.node = `fx-${mode}`;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('role', 'presentation');
  canvases.set(mode, canvas);
  return canvas;
}

/**
 * Points the engine at whatever the current view is. Any engine for a previous
 * mode is disposed first, so RAF loops, listeners and GL contexts never
 * accumulate across view changes.
 */
export function syncVisualEngine(mode: FxMode | null, params: Partial<FxParams> = {}): void {
  if (active && active.mode !== mode) {
    active.engine.dispose();
    active = null;
  }
  if (!mode) return;
  if (!active) {
    active = { mode, engine: new VisualEngine(fxCanvas(mode), mode) };
  }
  active.engine.update(params);
}

/**
 * A correction to the engine already running, without re-deciding the mode.
 *
 * The Journey overlay only learns where the airport and the route landed once
 * the map box has been measured against the Bing viewport, which is after the
 * render that created the engine. This lets that pass hand the corrected
 * numbers back, so the GPU ground and the drawn map can never point in two
 * different directions. It is a no-op when the surface has since changed.
 */
export function updateVisualEngine(mode: FxMode, params: Partial<FxParams>): void {
  if (!active || active.mode !== mode) return;
  active.engine.update(params);
}

/** Tears the engine down completely. Exists for symmetry and for teardown. */
export function disposeVisualEngine(): void {
  active?.engine.dispose();
  active = null;
}
