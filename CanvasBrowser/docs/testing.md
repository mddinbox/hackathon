# CanvasBrowser testing

## Release commands

From `CanvasBrowser/`:

```powershell
npm test
npm run build
npm run build:demo
git diff --check
```

Current release baseline: **137 Playwright tests**.

Build outputs:

- `dist/` — production static build
- `dist-test/` — deterministic test build with `window.__canvasBrowser`
- `dist-demo/` — loopback live-data/model Demo build

All outputs are ignored by Git.

## Test strategy

### 1. Pure logic

Pure functions are tested directly for:

- arrival and news intent detection
- flight-answer parsing
- uncited-landing refusal
- pickup and journey planning
- route geometry and timing
- adaptive refresh boundaries
- question economics
- blueprint normalization
- safe template compilation
- Web Mercator projection
- reach and bearing calculations
- live-context-to-signal transformation
- authority/freshness provider folding

### 2. Product acceptance

Playwright drives the product through its accessible tree. Coverage includes:

- one-prompt Home
- keyboard-only Journey flow
- clarification budget
- Track / Pickup / Connection branches
- unknown and resolved pickup states
- checked-bag correction
- route stops and undo
- Journey / Timeline lenses
- Local News layer and radius edits
- source and More dialogs
- mobile layout and overflow
- focus restoration
- reduced motion

### 3. Intent-to-World boundaries

Tests enforce:

- explicit folder boundaries
- inert Situation Graph
- provider-free Experience Synthesis imports
- Situation Intelligence ownership of questions
- incompatible blueprint rejection
- live provider folding after graph re-derivation
- Microsoft Graph remaining not connected
- matching graph and experience IDs

### 4. Deterministic provider behavior

Automated tests never depend on current internet content.

- `/api/agent` is mocked.
- `/api/local-context` is enabled only with `?live-context=1` in the test build
  and is mocked with a fixed typed response.
- Bing requests are aborted; tests assert iframe URL, sandbox, referrer policy,
  projection, and fallback behavior.
- Geolocation is replaced with counted deterministic callbacks.
- Clocks and sample scenario offsets are injected.

The live Demo is validated separately with smoke tests.

### 5. Visual contracts

Tests assert semantic visual properties rather than screenshot pixels:

- one GPU canvas per world
- no accumulated animation loops
- static coordinate functions contain no time input
- no orbital particles/rings in Home or Local News
- one reach boundary
- one weather footprint and arrow
- one center halo
- one high-impact mobility tether in the baseline
- one four-item live-headline rail
- zero floating live-headline labels on desktop
- live rail labels restored on mobile
- map URL and stage height remain unchanged across layer toggles
- labels avoid center, controls, map anchors, and one another

Screenshots are still captured for human visual review at 1600×1000.

## Critical invariants

### Question budget

- `questionsAsked <= 2` on every route.
- Every visible question includes its material reason.
- Party size is never asked.

### Evidence

- No uncited landing can commit a pickup.
- LIVE and SAMPLE provenance must survive into the consequence ribbon and
  Sources sheet.
- Coarse news anchors never display numeric mileage.
- Weather and air retain separate source links.

### Location

- No request before a user gesture unless persistent consent is enabled.
- One physical geolocation promise is shared across competing worlds.
- Late callbacks cannot overwrite a manual place.
- Exact coordinates never enter storage, state, model prompts, or map URLs.
- Unsupported regions are rejected.
- Home one-time use does not enable persistent consent.

### Maps

- Embedded maps are pointer-inert.
- Overlay and map use the same projected viewport.
- Radius boundary keeps margin.
- Resize reprojects; it never stretches.
- Layer toggles never alter map URL, map height, or zoom.

### Live context

- Client can request only a place ID.
- Server accepts only allowlisted places.
- Upstream URLs are hardcoded.
- Requests time out.
- Partial failures remain visible.
- Stale request IDs and stale session objects are rejected.
- Local edits preserve satisfied provider state.

## Live smoke test

Start:

```powershell
npm run demo
```

Health:

```powershell
$headers = @{ 'x-canvas-browser-demo' = '1' }
Invoke-RestMethod http://127.0.0.1:4173/api/health -Headers $headers
```

Local context:

```powershell
$headers = @{
  'x-canvas-browser-demo' = '1'
  'content-type' = 'application/json'
}

Invoke-RestMethod `
  http://127.0.0.1:4173/api/local-context `
  -Method Post `
  -Headers $headers `
  -Body '{"placeId":"redmond"}'
```

Verify:

- place matches the request;
- weather and air have separate source URLs;
- direct local headlines include feed and publisher;
- market changes use the previous session close;
- `errors` is empty or explicitly describes partial failures;
- an unsupported `placeId` returns 400.

## Manual visual review

### Home

- no orbital rings or particles;
- time strata and context grid stay behind the prompt;
- current place is never inferred from timezone;
- prompt remains the dominant object.

### Journey World

- route starts at the chosen coarse origin;
- sample corridor aligns to Bing geography;
- embedded base cannot pan beneath overlays;
- timing, map, and envelope agree;
- motion legend names only active motion.

### Local News

- current center and map center agree;
- map is zoomed to the chosen radius with margin;
- layer toggles do not change zoom;
- live headlines appear in one edge rail;
- weather is one borderless wash plus labeled wind arrow;
- market quotes remain on the market axis;
- Roads & transit is understandable from label and tooltip;
- source sheet clearly separates LIVE from SAMPLE.

## Adding tests

Prefer the smallest layer that proves the behavior:

1. pure unit assertion for algorithms and transforms;
2. DOM acceptance assertion for interaction and accessibility;
3. source-boundary assertion for architectural prohibitions;
4. live smoke test only for external integration availability.

Do not make the deterministic suite depend on internet access, actual browser
location, current market state, or model output.

