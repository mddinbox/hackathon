# CanvasBrowser design

## Product thesis

CanvasBrowser is a desktop-first **Intent-to-World** browser prototype. It does
not append an assistant panel to a conventional browser shell. It interprets
the user's job, builds an evidence-aware situation, and synthesizes one
purpose-built visual world.

The prototype has two hero experiences:

- **Journey World** — a time-and-space airport-pickup world that combines an
  actual map, route context, flight state, arrival processing, weather,
  disruptions, refresh cadence, and a leave/staging decision.
- **Local News** — a FutureGlass-derived, place-tethered map where current
  weather/air, local headlines, market quotes, and explicitly sample mobility
  signals are arranged by geographic relevance and impact.

The prototype is implemented in TypeScript, Vite, Node.js, WebGL/GLSL, and
Playwright. Chromium and Rust are production directions, not current
implementation claims.

## Product principles

1. **One dominant world**
   - No dashboard grid, browser toolbar replica, or assistant side panel.
   - The prompt is the only Home-page task entry.

2. **Ask less**
   - At most two clarification questions.
   - A question must materially change the template, route, decision envelope,
     or handoff.
   - Correctable assumptions are controls, not questions.

3. **Truth is visible**
   - Every fact or force carries truth, source authority, freshness, and
     material effect.
   - `LIVE`, `SAMPLE`, inferred, modeled, and unavailable states never borrow
     one another's authority.

4. **Place and time are structural**
   - Journey information is attached to the route, airport, and arrival clock.
   - Local News information is attached to a static Bing aerial viewport or a
     separate non-geographic market axis.

5. **Motion is a claim**
   - Static coordinates remain still.
   - Animation is allowed only for ongoing traffic, weather, flight,
     disruption, due refresh, or a finite update transition.

6. **The human controls disclosure and handoff**
   - Exact device coordinates are discarded inside the geolocation adapter.
   - Only allowlisted coarse Puget Sound places enter the graph and maps.
   - Full Bing interaction, external sources, and directions open only after a
     click.

## Intent-to-World architecture

```text
Prompt + local context
        |
        v
Situation Intelligence Engine
  - intent and job discovery
  - context acquisition plan
  - provider-result interpretation
  - question economics
        |
        v
Situation Graph
  - entities, events, facts, forces
  - constraints and unknowns
  - provider needs and consent
  - question plan and handoffs
        |
        v
Experience Synthesis Engine
  - template-family derivation
  - generated-blueprint compatibility gate
  - safe visual-force selection
  - constrained compiler
        |
        v
Journey World / Local News / literal result
```

### Folder boundaries

```text
src/intent-to-world/
  situation-intelligence/
    index.ts
    contextProviders.ts
    questionEconomics.ts
  situation-graph/
    index.ts
  experience-synthesis/
    index.ts
    templateBlueprint.ts
    templateCompiler.ts
```

Boundary rules:

- Situation Intelligence may inspect prompts and provider results, but cannot
  render.
- Situation Graph is inert: types and pure accessors only.
- Experience Synthesis may read the graph and compile approved primitives, but
  cannot fetch, geolocate, or infer a new fact.
- A generated blueprint may alter presentation emphasis only after its template
  family agrees with the graph.
- Question economics belongs to Situation Intelligence, not presentation.

## Situation Graph

The graph is the shared, versioned contract. Important node classes are:

- `SituationEntity`
- `SituationEvent`
- `SituationFact`
- `SituationForce`
- `SituationConstraint`
- `SituationUnknown`
- `InformationNeed`
- `QuestionPlan`
- `DecisionGoal`
- `HandoffNeed`

Each material node records:

- truth kind
- source authority
- freshness
- spatial and temporal anchor
- material effect

Provider results are folded under authority/freshness rules. A weaker fixture
cannot overwrite a stronger live statement. A failed provider changes need
status but writes no success-shaped fact.

## Context providers

The current provider vocabulary includes:

- live web research
- local news feeds
- market quote data
- Open-Meteo weather/air
- Bing Maps
- coarse geolocation
- airport guidance
- local fixtures
- the user
- Microsoft Graph (declared, not connected)

### Live Local News pipeline

`POST /api/local-context` accepts one of five server-allowlisted place IDs:
Seattle, Bellevue, Redmond, Tacoma, or Everett. It never accepts a client URL
or arbitrary coordinate.

The server reads:

- Open-Meteo current weather
- Open-Meteo current air quality
- direct municipal/publisher RSS where configured
- Google News RSS as fallback
- Yahoo Finance index chart data

The browser:

1. immediately renders an honest local fallback;
2. starts a globally versioned live-context request;
3. rejects stale responses by session identity, request generation, and place;
4. transforms live rows with their source and retrieval time;
5. keeps mobility sample-labeled until a structured feed exists;
6. rebuilds the graph, then folds provider results so satisfied needs and live
   facts survive presentation edits.

## Location and privacy

- Home never turns a timezone into a city.
- `Use current location` is a one-time, session-only action.
- `Always use my location` is a separate explicit persistent consent.
- The stored value is only `{ version, alwaysUse }`.
- Raw latitude/longitude never leaves `requestCoarseOrigin()`.
- A fix farther than 120 miles from all supported places is rejected as
  `outside-region`.
- Local headlines without geocoding say `coarse local context`; synthetic
  display offsets never become numeric distance claims.

## Journey World

Journey World combines:

- a static Bing geography base and exact full-map handoff;
- a Web-Mercator-aligned sample corridor;
- optional stops;
- weather and airport/disruption annotations;
- arrival-processing time ranges;
- adaptive 60/15/5-minute refresh;
- a decision envelope for leave time, cell-lot arrival, and curb readiness.

The embedded map is intentionally non-pannable. Bing is cross-origin, so
CanvasBrowser cannot observe pan/zoom state and safely reproject overlays.
Interactive exploration uses the full-map handoff.

## Local News

Local News combines:

- a static Bing aerial base;
- a selected 5/25/60/120-mile extent with visible margin;
- map-anchored dots for geographic signals;
- a single four-item current-headline rail;
- one weather footprint and arrowed transport vector;
- one solid reach boundary and one center halo;
- only high-impact mobility leaders;
- a separate current-market axis;
- a warm consequence ribbon and evidence sheet.

The map viewport has a stable CSS height, so toggling Local, Markets,
Weather/air, or Roads & transit cannot change Bing zoom.

Visible layers:

- **Local** — municipal and publisher headlines.
- **Markets** — current non-geographic index data.
- **Weather/air** — current weather, wind, AQI, PM2.5, and weather extent.
- **Roads & transit** — traffic, transit, ferries, and airport-access
  disruptions. This remains sample-labeled in the current prototype.

## Rendering

- Semantic content is ordinary accessible DOM/SVG.
- A single `aria-hidden`, pointer-inert GPU canvas adds bounded atmosphere.
- Home uses a calm split horizon: time strata plus a grounded context grid.
- Local News uses real map geography rather than orbital or galaxy motifs.
- Reduced-motion mode renders one still frame and starts no animation loop.
- Mobile replaces spatial composition with a semantic vertical reading order.

## Security

- Demo server binds to `127.0.0.1`.
- API requests require approved loopback Host/Origin and the demo header.
- Static and API responses carry restrictive security headers.
- Local-context upstream URLs are hardcoded server-side.
- Payload size and prompt size are capped.
- Upstream requests have timeouts and partial-failure reporting.
- Model-generated blueprints are independently normalized on server and client.
- Model output cannot contain executable UI.

## Current limitations

- This is not a Chromium fork yet.
- No Rust component is implemented yet.
- Local mobility is still a labeled sample layer.
- Local-news article anchors are coarse until a structured geocoder/source
  provides claim-level coordinates.
- Microsoft Graph has a typed seam and minimal proposed scopes, but no connector
  or token flow.
- Yahoo Finance and RSS endpoints are prototype integrations and should be
  replaced with production-supported data contracts.

