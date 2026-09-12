# CanvasBrowser

Project documentation:

- [Edge Intent Worlds proposal](docs/proposal.md)
- [Airport Intent World pitch video](docs/airport-intent-world-pitch-65s.mp4)
- [Design](docs/design.md)
- [Testing and release gates](docs/testing.md)

**Tabs are a half-assembled situation model.** You open five of them, hold the situation in your head, and do the assembly yourself. CanvasBrowser does the assembly instead: it takes one real question, lets a model **design the shape of the world that question deserves**, asks for at most two things it genuinely cannot infer — and only when the answer materially changes something — then builds that world, and hands you a single decision you can commit to with its uncertainty intact.

This repository is a working prototype (Vite + TypeScript, no UI framework) with **two generated templates**, built end to end:

- **Journey World** — someone is landing at SEA and you have to pick them up. One time-and-space world: the route, the traffic in it, the weather over the airport, the airport's own updates, the arrival processing, and the leave-by, all on one clock.
- **Signal Field** — what changed around you this morning, and what actually reaches your day.

Both come out of the **same blueprint grammar**. Neither is a skin, and neither is chosen from a fixed list of layouts.

> **The rule that makes this safe:** a model may propose a **blueprint** — a strict, versioned, enum-checked JSON description of what kind of world a situation deserves. It may never emit user interface. There is no field in the schema that could carry HTML, CSS, JavaScript, a selector, a class, a colour or a pixel size, and every string is scrubbed twice before anything reads it.

---

## 1. Product thesis

A browser tab is a container for a document. A situation is not a document. And a feed is not a situation either: a feed answers *"what was published"*, when the real job is *"what changed in my world, what reaches me, and what deserves attention or action."*

CanvasBrowser's claim is that the interesting product is not a better search result or a better feed. It is **the assembled situation**, rendered so you can see the shape of what is known, correct the parts the machine guessed, and commit.

### The shared intelligence grammar

Both templates run through the same pipeline. Only the geometry differs.

| Stage | What it means here |
| --- | --- |
| **Situation** | The prompt plus the local context goes to the **Situation Intelligence Engine**, which produces a **Situation Graph**: the latent job, its hypotheses, what is known and how, what is missing, and which providers could fill it. A recognised situation opens its own world-shaped surface at once; live research and blueprint generation both run beside it, never in front of it. |
| **Context acquisition** | The graph states what it needs from whom, ordered by material effect and permission cost. Available providers run; consent-gated ones wait; **Microsoft Graph is stated and never silently used**. |
| **Blueprint** | A model may be asked what *kind* of world this is. The answer is normalized on the wire and again in the browser, and then it must still pass the **Experience Synthesis** compatibility gate against the graph. A failure — or a misread situation — is not an error; it is the deterministic world. |
| **Visual compiler** | The blueprint is compiled into visual primitives this build already owns: a template family, a geometry balance, which map layers may be drawn, which GPU mode is mounted, and the sentences of the motion legend. |
| **Question economics (≤ 2)** | Owned by the Situation Intelligence Engine. A question is asked only if answering it changes the **template, the route, the decision envelope or the handoff** — and it must say which. At most two, ever, and presentation cannot add one. |
| **Shared world** | A full-viewport world both you and the system can point at. Editing it is the conversation. |
| **Decision envelope** | One dominant, prioritised commitment. Never fake precision. |
| **Adaptive watch** | A situation that is still moving keeps being looked at. The world states when it last checked, when it will check again, and **why that cadence** — and it stops when the trip is over. |
| **User handoff** | Prepared links you click yourself. CanvasBrowser never navigates, sends, or acts for you. |

### Templates are generated, not selected

A template is not a theme, a skin, or an arrangement of widgets. It is a claim about **what shape the answer has**, expressed as geometry — and that claim is *reasoned about per situation*, not looked up:

- **Journey World** is a **hybrid time-and-space** geometry. Space is the dominant plane: an origin, a route, the stops you add, the cell-phone lot, the arrivals curb. Time is mapped *onto* that space — every stretch of road carries the clock window you are inside it, NOW is a point on the route rather than a column on an axis — and the arrival-processing terrain is a compressed strip linked directly beneath the map, sharing the same clock. Rendering an airport pickup as a list of cards destroys both halves at once.
- **Signal Field** uses **reach / proximity / impact geometry.** You are the centre, rings are how close a thing actually gets to you, size is impact, and a tether says whether something arrives through the ground under your feet or through the market axis at the edge. Rendering "what's happening near me" as a feed of equal cards destroys exactly the thing that matters: that a lane closure three miles away outranks a national headline.
- **Time Terrain** is still here, as the Journey World's **Timeline lens** — the same world, with the height given to the arrival processing instead of the route.

Same pipeline, same truth rules, same evidence sheet, same blueprint grammar — worlds that look and behave nothing alike, because the outcomes have different shapes.

Future template families (named, not built): **Coordination Constellation** for several people or legs that must line up, **Resource Flow** for how much moves between what, **Decision Frontier** for trade-off surfaces. A blueprint can already *name* them; the compiler simply does not know how to build them yet, and says so by falling back.

**Explicitly rejected and deleted:** shopping comparison grids and simulated bill pay. They produce a dashboard of cards, not a situation.

---

## 2. Intent-to-World: two engines, one contract

Everything above is produced by two engines that never touch each other's job, joined by one typed artifact.

```
      prompt + user/context (clock, place, capabilities, consents)
                              │
                              ▼
        ┌─────────────────────────────────────────────┐
        │  Core 1 · SITUATION INTELLIGENCE ENGINE      │
        │  src/intent-to-world/situation-intelligence/ │
        │  • discovers the latent job + hypotheses     │
        │  • states information needs and providers    │
        │  • decides what can be inferred              │
        │  • question economics: at most two, ever     │
        └─────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────────────┐
        │           SITUATION GRAPH  (contract)        │
        │  src/intent-to-world/situation-graph/ —      │
        │  typed, versioned,                           │
        │  evidence- and provenance-aware, no UI       │
        └─────────────────────────────────────────────┘
                     │                    ▲
                     ▼                    │ applyContextResult()
        ┌──────────────────────────────────────────────┐
        │  context acquisition plan → providers         │
        │  situation-intelligence/contextProviders.ts  │
        │  web-search · bing-maps · geolocation ·       │
        │  weather · airport · local-fixture · user ·   │
        │  microsoft-graph (seam, not connected)        │
        └──────────────────────────────────────────────┘
                              │ updated Situation Graph
                              ▼
        ┌─────────────────────────────────────────────┐
        │  Core 2 · EXPERIENCE SYNTHESIS ENGINE        │
        │  src/intent-to-world/experience-synthesis/  │
        │  • derives the outcome template from the     │
        │    graph alone                               │
        │  • may accept a Sol blueprint for            │
        │    presentation, after a compatibility gate  │
        │  • cannot fetch, cannot infer, cannot ask    │
        └─────────────────────────────────────────────┘
                              │
                              ▼
     constrained blueprint → templateCompiler.ts → the immersive world
```

### Who is allowed to do what

| | Situation Intelligence (Core 1) | Situation Graph | Experience Synthesis (Core 2) |
| --- | --- | --- | --- |
| Reads the prompt and the detectors | ✅ owns them | — | ❌ never |
| Decides what information is needed | ✅ | records it | ❌ |
| Calls a provider | ✅ through the acquisition plan | — | ❌ no `fetch`, no geolocation, no provider import |
| Establishes a fact | ✅ with truth + authority + freshness | carries it | ❌ reads only |
| Decides which questions are worth asking | ✅ question economics | records verdicts | ❌ renders the plan, never adds to it |
| Chooses the template family and geometry | ❌ | — | ✅ |
| Accepts a model's opinion | ❌ | — | ✅ presentation only, behind a compatibility gate |
| Emits HTML / CSS / JS | ❌ | ❌ | ❌ — the compiler owns pixels, from enum-checked primitives |

The shell (`ui/app.ts`) owns neither side. It calls Core 1 once per ask, holds the two artifacts as `state.situationGraph` and `state.experiencePlan`, and routes on `graph.kind` — the arrival and news detectors are dependencies *inside* Core 1 and are never called from the app. A lens change, a corrected assumption, a chosen origin and an answered news question all re-enter through Core 1 and come back out through Core 2, so there is exactly one path from a situation to a template.

A test reads `src/intent-to-world/experience-synthesis/index.ts` as text and asserts its entire import list is the shared graph contract plus its local blueprint and compiler — the wall between the two engines is enforced by the suite, not by convention.

### The Situation Graph

Every node — fact, force, unknown, information need — carries a **truth kind**, the **source authority** that stated it, its **freshness**, a spatial/temporal **anchor**, and a stated **material effect**. A node that cannot say what it changes has no business shaping a world, and a question that cannot say what it changes has no business costing a person their attention.

The graph also carries what is *missing*: `informationNeeds` name the provider, the exact fields, the permission it would cost, and — this is the part that matters — *exactly how the graph would change* if it were satisfied.

### Providers, consent, and the Microsoft Graph seam

`src/intent-to-world/situation-intelligence/contextProviders.ts` describes every source the engine may reach for, what it costs in permission, and whether this build can actually run it. An information need's status is one of `available`, `needs-consent`, `planned`, `unavailable`, `satisfied` — and the acquisition plan only ever *executes* the `available` ones.

Demo-mode Local News uses first-class `local-news`, `market-data`, and `weather` providers through `POST /api/local-context`. The server accepts only five allowlisted coarse place IDs and calls hardcoded public sources: Open-Meteo weather/air, direct municipal/publisher RSS with a Google News RSS fallback, and Yahoo Finance index charts. Partial failures stay partial; arbitrary coordinates and URLs are rejected.

**Microsoft Graph is a real extension seam and a deliberately empty one.**

- The needs are stated explicitly: a calendar travel itinerary, a flight-confirmation email, the traveller's contact, an optional shared plan for a pickup; the day's schedule and work context for a briefing.
- Each is tied to a **minimal scope with a justification**: `Calendars.Read` (an itinerary already states the flight and the day), `Mail.ReadBasic` (a confirmation carries the flight number and terminal — full `Mail.Read` is *not* requested), `People.Read` (so the handoff can name the person instead of "someone").
- Every one of them stays `needs-consent` in P0. `MicrosoftGraphProvider.acquire()` performs **no network call**, returns `not-connected`, and produces no statements. There is no token flow, no Graph SDK dependency, and no sample response pretending to be a mailbox.
- The acquisition plan marks Graph needs non-executable *even if a connector were configured*, and a test asserts it.
- The Source sheet says so out loud: `Microsoft Graph — Not connected · would use calendar/email/contact context for …`, with the scopes it would ask for.

A future connector implements the same `ContextProvider` interface, flips `capabilities.microsoftGraph` only after a real consent, and returns `ContextStatement`s that `applyContextResult()` folds into the graph under the same authority and freshness rules as every other source. Nothing above that adapter changes.

---

## 3. The LLM template thinking engine

`src/intent-to-world/experience-synthesis/templateBlueprint.ts` defines the only thing a model is allowed to influence, and `blueprintSchema.mjs` enforces the same contract independently on the wire. A blueprint is a presentation proposal: it reaches the compiler only after the graph's compatibility gate accepts it, and it can never establish a fact or buy a question.

### The blueprint

```jsonc
{
  "version": 1,
  "situation": { "type": "airport-pickup", "label": "…", "entities": ["…"], "localTime": "…", "place": "…" },
  "jobs":      { "primary": { "id": "pickup", "label": "…", "evidence": ["…"] }, "alternates": [ … ] },
  "template":  { "family": "journey-world|signal-field|time-terrain|literal",
                 "primaryAxis": "…", "secondaryAxis": "…", "worldMetaphor": "…", "visualForces": ["…"] },
  "forces":    [ { "id": "traffic", "type": "flight|weather|traffic|airport|disruption|person|market|local",
                   "relevance": 0.85, "truth": "observed|modeled|inferred|unknown",
                   "freshness": "…", "spatialAnchor": "route", "temporalAnchor": "leave-by window",
                   "visualMapping": "density and current along the route path" } ],
  "unknowns":  [ { "id": "checked-bag", "reason": "…", "resolvedBy": "…" } ],
  "questions": [ { "id": "travel-origin", "prompt": "…", "whyNeeded": "…", "materialEffect": "…",
                   "expectedInformationGain": 0.88, "userCost": 0.22, "choices": [ … ] } ],
  "handoffs":  [ { "id": "…", "label": "…", "action": "…", "url": "https://…" } ],
  "refresh":   { "targetEvent": "the curb-ready text", "cadenceHint": "…" }
}
```

**Two independent gates, deliberately not shared code.** `blueprintSchema.mjs` runs in the Node gateway before a model answer ever reaches a browser; `templateBlueprint.ts` runs in the browser on whatever the gateway returns. The browser does not have to trust the server, and the server does not have to trust the browser. Both:

- accept exactly one JSON object, pulled from the first fenced block or the answer body;
- **drop unknown fields** instead of forwarding them;
- collapse whitespace, strip control characters, cap every string, and **reject outright** any string containing `<`, `>`, `&#`, `javascript:`, `data:`, `vbscript:`, an `on…=` handler, `${…}` or `{{…}}`;
- keep only absolute `https:` URLs that actually parse;
- cap every array, de-duplicate by id, check every enum against a fixed list, and clamp every 0–1 number;
- return **nothing at all** on a structural failure — an unknown template family, a wrong version, a non-object — which the route answers with `{ source: 'fallback' }` and a `200`.

A blueprint that fails is not an error state the user sees. It is simply the deterministic blueprint, labelled `fallback`, and the world is already standing on it before the request was even made.

### The visual compiler

`src/intent-to-world/experience-synthesis/templateCompiler.ts` is the only thing that turns a blueprint into pixels, and it does so by choosing from primitives that already exist:

| Blueprint says | Compiler chooses |
| --- | --- |
| `template.family` | which view renders (`journey` / `field` / `terrain` / `literal`), which plane dominates, and which GPU mode is mounted |
| `forces[].type` + `relevance ≥ 0.25` | which map layers may be drawn — traffic, weather, airport, disruption. A force the blueprint thinks barely matters does not get to paint over the route. |
| `forces[].type` | which clause appears in the motion legend, from a fixed vocabulary |
| lens (`journey` / `timeline`) | which of the two linked planes gets the height |

Nothing else crosses the boundary. `visualMapping` is prose the compiler *reads for its type*, not a command it executes.

### Where the model actually runs

`POST /api/blueprint` runs `gpt-5.6-sol` at `long_context` with `medium` reasoning and `web_search` as the only tool, exactly like `/api/agent`. It is a **Demo-mode capability only**: the test build always stands on the deterministic fallback, because a suite that depended on a model's design opinion would not be a suite. The Source sheet always states which one you are looking at — `World blueprint: Sol-generated` or `fallback` — and shows the full question argument underneath it.

---

## 4. Question economics

`src/inference.ts` enforces the runtime ceiling and `src/intent-to-world/situation-intelligence/questionEconomics.ts` owns the harder rule — *which* two are worth asking at all. Experience Synthesis only receives the resulting question plan.

A question is rejected unless it can state, in `materialEffect`, that answering it changes one of exactly four things a person actually feels:

**the template · the route · the decision envelope · the handoff**

The ranking is deterministic: reject anything with no stated effect, no effect on those four levers, no choices, or a non-positive `expectedInformationGain − userCost`; de-duplicate by id and by prompt; sort by score with ties broken by id; take at most two.

This is a **self-critical rule encoded**, not a hard-coded ban list. Watch it argue:

| Candidate | Verdict |
| --- | --- |
| *"Are you tracking, connecting, or picking up?"* | **kept** — it chooses the template. Gain 0.92 − cost 0.12. |
| *"Where are you starting from?"* (only once Pickup is chosen) | **kept** — it draws the route, applies traffic to it, and sets the leave-by. Gain 0.88 − cost 0.22. |
| *"How many people are you picking up?"* | **dropped** — "adds roughly four minutes of assembly time per extra passenger" moves no template, no route, no envelope, no handoff. |
| A checked bag | **never a question.** It genuinely moves curb-ready by 12–28 minutes and may decide whether the car fits the luggage — so it is a *visible inferred assumption* with its stakes written next to it: `Checked bag assumed · adds 12–28 min and may need cargo space`. One click corrects it. |
| Adding a stop | **never a question.** Nothing asks whether you have one. The control sits in the world, states its cost before you take it, and recomputes locally when you do. |

Party size is still *heard* when you say it — `picking up 3 passengers off EVA AIR TPE to SEA` sets it silently — it is simply never asked for and never surfaced as a control.

Every question that does appear renders one concise reason line under it, because a question that cannot say what it changes should not have been asked.

| Prompt | Questions | Why |
| --- | --- | --- |
| `EVA AIR TPE to SEA landed tonight?` | 1 | The Journey world starts forming immediately and asks one job question while research runs in parallel. |
| … then **Picking someone up** | 1 more | Origin — it unlocks route, traffic exposure and leave-by. Then the budget is spent, and the world resolves. |
| `What local news and market moves matter to me this morning?` | 0 | Briefing intent, scope and horizon are all in the words. Straight into the world. |
| `What is happening around me that could change my day?` | 2 | Briefing intent is stated, but scope and horizon are not. |
| `Did the Fed change rates in the news this morning?` | 1 | A specific factual question. A temporal word is **not** briefing intent, so the literal answer comes first, then one offer. |

The count is never displayed. There is no wizard, no stepper, no "2 of 3". You just notice that it stops asking.

**The literal answer is an exception, not the default.** It is reached only when no world job has been chosen yet.

---

## 5. Hero scenarios

### Journey World (airport pickup)

- **Airport pickup** — shipped end to end: route map, stops, traffic, weather, airport updates, arrival processing, cell-lot staging, leave-by envelope.
- **Train connection / departure** — same grammar, different segments.
- **Event leave-by** — one anchor time, backwards through the unknowns.

The flow: ask → **a forming world with one question on it** — *"Are you tracking the arrival, making a connection, or picking someone up?"*, with its reason underneath — while live research and blueprint generation run in parallel → the world the blueprint chose.

For a pickup the blueprint resolves **Journey World**, and it is one screen with two linked planes:

**The route plane (dominant).** The geography is real: a sandboxed **Bing Maps embed** is the base layer, so the streets, water and interchanges under the route are the ones the driver will actually meet, with Bing's own logo, scale bar and `© TomTom, © Microsoft` attribution left intact. Everything CanvasBrowser knows is drawn **above** it as annotation — SVG and DOM, stamped `SAMPLE MAP · Bing Maps geography · CanvasBrowser draws the SAMPLE scenario over it as a schematic`. On it:

- **origin → optional stops → SEA Cell Phone Lot → SEA Arrivals curb**, in that order, because the arrivals curb comes *after* the passenger texts, not before;
- **the routed line, and who owns it**. When the Bing base is live, the geography under the world is real and the **route belongs to Bing**: the legend says `Driving route and traffic: Bing Maps · this base renders geography only`, and hands off with `Open full map for the routed line, live traffic, current road list, ETA, tolls and alternatives`. CanvasBrowser draws no corridor of its own over real streets. When the base cannot load, its hand-authored **main route** and **alternate** come back as the only route there is, each named as what it is — `I-405 south → I-518 · 19 mi · 30–55 min · SAMPLE corridor`;
- **traffic**, from whichever party can actually see it: on a live base, none is drawn in-world and Bing's map is where congestion is read; with the base down, CanvasBrowser's illustrative congestion is painted on its own corridor stretch by stretch — a dark casing with coloured asphalt whose width and hue follow congestion, direction particles running at a speed congestion decides, and an incident marker on the stretch that is worst. The two are never on screen together;
- a **projected weather cell** over the airport with its wind bearing, its intensity, its truth tag, and — crucially — *the time it refers to*: `Overcast 54°F · wind 9 mph · projected over 8:45–10:10 AM · SAMPLE`;
- **airport updates and disruptions** as markers where they physically apply: the cell-lot rule, arrivals curb lane work, a corridor incident when traffic is severe;
- **time mapped onto space** — every leg carries the clock window you are inside it (`Bellevue → Cell Phone Lot 7:40–8:07 AM · 15–28 min · traffic moderate`), and NOW is a **point on the route** rather than a column on an axis. It is a position indicator, so it holds still.
- **`Add a stop`** — gas or charge, pick up another person, coffee. Nothing asks whether you have one; the control states its cost first (`+5–11 min`), and taking it deforms the drawn route, grows the drive range and moves the leave-by, **locally, with no model call**. Removing it puts everything back.

#### The Bing base, and what it is allowed to be

| Rule | How it is enforced |
| --- | --- |
| The URL is built locally, from coarse coordinates | `src/bingMap.ts` composes it from a chosen or locally coarsened origin and the airport fixtures. Exact device coordinates never reach the app or Bing. **No model-provided URL ever reaches an `src`.** |
| One host, one path, https only | `isAllowedBingEmbed()` is the gate in code; `frame-src 'self' https://www.bing.com https://*.bing.com` is the same rule at the browser. Script, connect, object and form origins are untouched. |
| No key, no account | The public embed endpoint needs none, so there is nothing to leak. |
| No referrer, no reach into the page | `sandbox="allow-scripts allow-same-origin allow-popups"`, `referrerpolicy="no-referrer"`, `title="Bing Maps route base"`, and a visible `Bing Maps base · Open full map` handoff that opens the real map in a tab you control. |
| A fixed viewport keeps overlays anchored | The embedded cross-origin frame has `pointer-events: none`, so it cannot pan or zoom underneath a stale overlay. `Open full map to pan / zoom` owns interactive exploration. |
| Nothing is cropped | Bing renders at the size the URL asks for and caps its map at 1200 px wide, so the frame is 1200 wide, its height is chosen to match the shape of the map box, and CSS scales it to fill. A short, wide box also zooms *out*, so the whole drive stays on screen — and Bing's attribution never leaves it. |
| Offline or blocked is stated, not hidden | Cross-origin frames report almost nothing, so the world never *claims* the base rendered. If the browser is offline, or nothing arrives, the region flips to `data-base-state="unavailable"`, the illustrative SVG relief comes back to full strength, and the foot says **`Bing Maps unavailable · illustrative overlay`**. The world is never blank. |

The overlay is drawn over the base at every moment, live or not — it is **annotation, not a second map**. Because Bing's embeddable endpoint renders geography but not its `rtp` route, CanvasBrowser keeps one Web-Mercator-aligned corridor visible and labels it **SAMPLE corridor**. Congestion and flow disappear on a live base; the exact route still belongs to the full Bing Maps handoff.

#### Route parity with Bing Maps — the comparison that produced this rule

This was not reasoned about; it was **checked**. We opened Bing Maps for the same trip — the same current location, to the SEA Cell Phone Lot — and read what Bing actually returned:

| Bing's answer | Time | Distance | Delay | Notes |
| --- | --- | --- | --- | --- |
| **Fastest** — WA-520 W → I-5 S | 34 min | 27.6 mi | none | toll |
| Alternate — I-405 S | 35 min | 22.5 mi | 8 min | |
| Alternate — I-90 W → WA-509 S | 40 min | 26.3 mi | 4 min | |

Beside it, CanvasBrowser was still drawing its fixture corridor and printing fixture road names — `I-405 south → I-518`, `I-90 → I-5 south` — with fixture distances and schematic congestion strokes, over a *correctly aligned* Bing base. Two routes on one map, disagreeing about which roads the drive takes. Web Mercator alignment had fixed the geometry and left the **claim** wrong, which is worse than an obviously schematic map: it looked authoritative.

So the rule is now explicit, and it is enforced in code rather than in prose.

**But first: what the framed endpoint actually renders, measured rather than assumed.** `https://www.bing.com/maps/embed` was requested with `rtp=`, with `trfc=1`, with labelled positions (`pos.…_Start`), with `adr.` street addresses, with `rtop=`, and with **no route parameter at all**. Every response rendered a **byte-identical** image: geography only — no routed line, no congestion colouring. The same `rtp=` on `https://www.bing.com/maps` — the `Open full map` handoff — draws the route, its alternates, their ETAs and live traffic correctly. So the honest division of labour is:

| | Draws real geography | Draws the route | Draws live traffic | Can be framed |
| --- | --- | --- | --- | --- |
| `bing.com/maps/embed` (the base) | **yes** | no | no | yes |
| `bing.com/maps` (the handoff) | yes | **yes** | **yes** | no |

`trfc=1` is sent on both anyway: it is the documented parameter, it works on the handoff, and it costs nothing if the embed starts honouring it again. Nothing in the interface claims the framed base is showing traffic, because it is not.

Given that, the world behaves like this:

| While the base is live | While the base is unavailable |
| --- | --- |
| The geography is real; the visible route is a projected **SAMPLE corridor** | CanvasBrowser draws the same illustrative corridor over fallback relief |
| Congestion bands and flow particles are hidden because they are not live Bing traffic | They return as labelled SAMPLE behavior |
| The legend names both sources: Bing for exact routing and CanvasBrowser for the sample estimate | The legend names the corridor and tags it `SAMPLE corridor` |
| Fixture road names and distances remain only beside `SAMPLE corridor` | Fixture road names and distances remain labelled |
| `traffic` is removed from the active motion set, so neither the SVG particles nor the WebGL route current animates | Traffic motion runs, because there is a CanvasBrowser corridor to run it on |
| The map stamp still says `SAMPLE MAP` — the *scenario* over the base is still a sample | The stamp says the overlay is an illustrative schematic, not to scale |

**The honest limitation, stated in-world.** The base is a cross-origin iframe. CanvasBrowser cannot read Bing's chosen route, ETA, tolls or alternatives. It can project an explicitly approximate corridor onto Bing's geography and hand the same endpoints to the full map:

> `The visible corridor is a Web-Mercator-aligned SAMPLE estimate. Open Bing Maps for the exact route, live traffic, ETA, tolls and alternatives.`

Leg timing labels stay — `Bellevue → Cell Phone Lot 7:40–8:07 AM · 15–28 min · traffic moderate` — and each one now carries its own `SAMPLE` tag, because those minutes come from `pickupFixtures.ts` on this device and must never be mistaken for the number Bing just displayed above them. Wiring a structured routing API (Bing Maps REST Routes, or any equivalent) is the one change that would let CanvasBrowser state a road list and an ETA of its own; until then it names the source and defers.

**The definition of done** is that the route is never absent: the embedded world has one aligned, labelled SAMPLE corridor; the full Bing map has the exact routed line.

#### The origin privacy boundary

A granted fix is converted inside `requestCoarseOrigin()` to the nearest supported area (`Redmond`, `Bellevue`, and so on). The raw latitude/longitude is discarded before the function returns. Only that coarse area's published coordinate may reach the embedded Bing URL; exact device coordinates reach neither app state, storage, Sol, blueprints, nor Bing.

**The arrival-processing strip (linked).** The Time Terrain, compressed, directly beneath the map and on the same clock: `landing → gate → CBP → bags → curb-ready`, with the NOW rule, the landing marker, and CBP still the widest hatched band because it genuinely is the widest unknown.

**The decision envelope (dominant object).** Warm paper over the dark world: *"Be in the SEA Cell Phone Lot between 8:10–8:30 AM"*, *"Expect their curb-ready text 8:40–10:00 AM"*, *"Leave Bellevue by 7:35 AM"*, with the condition notes that moved it and the official links you click yourself.

A **Journey / Timeline lens** moves the height between the two planes. It is one world seen twice, never two pages: same plan, same envelope, no model call, and the caption says which — `Journey World · map over a linked timeline · blueprint: fallback`.

**Before an origin exists the map does not invent one.** It draws the half it knows — the lot, the curb, the airport field — leaves the other half visibly empty, and asks the one question that fills it, with the value stated: *"Needed to build your route, traffic exposure and staging window. Coordinates stay local."*

Choosing **Picking someone up** before research lands opens the world **immediately**, with honest unknowns on it; when the facts arrive the same world resolves in place — you are never sent back to prose. **Tracking the arrival** is the one path where a sentence *is* the outcome. **Making a connection** resolves to an honest surface that names Coordination Constellation as the next template.

If no source states an **actual** landing time, CanvasBrowser refuses to shape a leave-time out of a scheduled arrival. You get **"Not enough to commit yet"**, the reason, and an unblocker — plus a clearly tagged `SAMPLE DATA` preview so the grammar can still be judged.

#### The pickup is a situation, not an answer

This is the line between CanvasBrowser and a search-result browser, stated as concretely as it can be:

> A failing browser answers **"BR26 lands at 7:40"** and stops. The question is closed and the world is frozen at the instant you asked.
>
> CanvasBrowser holds an airport pickup as **one continuously changing situation** — flight phase, weather near SEA, traffic on *your* corridor, airport processing, where you are starting from, and the moment the passenger is actually curb-ready. The world tells you when to stage, what could still move the plan, **and when it will look again**.

Everything below follows from that.

**The adaptive refresh policy** (`src/refreshPolicy.ts`, pure and injected-clock) decides how often the situation deserves to be looked at:

| Situation | Cadence | Why this is the right cadence |
| --- | --- | --- |
| Arrival more than 2 h out | **every 60 min** | Nothing can plausibly change your leave time yet. |
| Arrival ≤ 2 h and > 1 h out | **every 15 min** | Gate and ETA changes start to matter. |
| Arrival ≤ 1 h out, or en route with an ETA inside the hour | **every 5 min** | This is the window where a leave time is actually decided. |
| On the ground, processing still running | **every 5 min** | Taxi, CBP and bags are moving; the curb window is live. |
| The curb-ready window has passed | **stops entirely** | The trip is over. Polling a finished trip is noise, not diligence. |
| No arrival time established at all | **every 15 min** | The missing fact *is* the thing being watched. |

The boundaries are inclusive and tested exactly: 2 h → 15 min, 2 h + 1 s → 60 min, 1 h → 5 min. The policy returns `{ intervalMs, nextRefreshMs, reason, urgency }` and nothing else; it owns no timers.

**The runtime controller** lives in `ui/app.ts` and is deliberately boring, because this is where refresh systems normally leak:

- exactly **one** armed timer, ever — re-entering the world does not stack schedulers (the suite asserts the armed-timer count);
- cancelled on **Start over**, on leaving the world, and on a new ask;
- **parked while the document is hidden** — a background tab does not poll — and it performs the overdue check *immediately* on return rather than waiting out a fresh interval;
- a manual **Re-check** resets the schedule instead of adding to it;
- **generation tokens** on both the request and the refresh, so a slow answer belonging to a question you have already left can never overwrite a newer world;
- a refresh updates the reading, advances the conditions, rebuilds the terrain **in place**, and bumps the world revision. It never sends you back to prose.

The world says all of this out loud, in one compact line above the terrain:

> `ON THE GROUND · Steady rain 49°F SAMPLE · Traffic heavy, building SAMPLE · Checked 7:00 AM · next in 5 min · every 5 min because they are on the ground and moving through the airport`

with a small dial beside it that drains as the next check comes due. It is typographically secondary on purpose — the leave-window is still the dominant object on the page.

#### Weather and traffic are forces over the world, not cards

Two projections shape the plan, and both are drawn as layers *over* the terrain rather than tiles beside it:

- **Weather** near SEA is an atmospheric wash whose streak angle follows the wind bearing and whose density follows the projection. It is allowed exactly one effect on the plan: it widens the **upper bound of one named segment** by a **stated** number of minutes — `steady rain widens walk to arrivals curb uncertainty by 5 min`. It never moves a landing, never narrows anything, and never invents precision.
- **Traffic** on your corridor is a flow deformation along your own travel lane, and it is expressed as a **delay added to the fixture drive range**, so the underlying estimate stays visible: `26–46 min` becomes `34–60 min`, and the envelope says `+8–14 min traffic on I-405 → I-518 → SEA (heavy, building) — SAMPLE`.

Each force carries exactly one compact label, anchored where it acts. The `Weather` and `Traffic` switches control **visibility only** — the note next to them says so, and the suite asserts it: hiding a layer hides the drawing, never its effect on the plan. You cannot make the situation calmer by looking away from it.

#### Honest SAMPLE / live boundaries

| Thing | Status | Where it comes from |
| --- | --- | --- |
| Flight status, landing time, phase | **live** in Demo mode | The loopback gateway's web research, parsed conservatively. A missing status is `unknown`, never `landed`. |
| Scheduled / estimated arrival | **live** when a source states one | Read only from a sentence that carries both the qualifier and a clock. Never promoted to an actual landing. |
| Weather near SEA | **SAMPLE** | `travelConditionsFixtures.ts`. The gateway returns prose, and prose is not promoted into a structured fact. Source authority: [NWS Seattle](https://www.weather.gov/sew/), [Open-Meteo](https://open-meteo.com/en/docs). |
| Traffic on your corridor | **SAMPLE** | `travelConditionsFixtures.ts`. Source authority: [WSDOT real-time map](https://wsdot.com/travel/real-time/map). |
| Drive ranges by origin | **fixture estimate** | `pickupFixtures.ts`. There is no live traffic source and CanvasBrowser never claims one. |
| Airport processing ranges | **modeled locally** | `pickupFixtures.ts`, computed with no model call. |
| The base map | **real geography** | A sandboxed [Bing Maps](https://www.bing.com/maps) embed, built locally from coordinates by `bingMap.ts` — no key, no model-provided URL, no referrer — with Bing's own attribution intact. The framed endpoint renders geography only: measured, it draws no route and no traffic. If it cannot load, the world says `Bing Maps unavailable · illustrative overlay`. |
| The route on a **live** base | **Bing's, in the full map** | CanvasBrowser draws none. The `Open full map` handoff carries the same two endpoints to `bing.com/maps`, which routes them and shows live traffic. No road name, distance or ETA is claimed in-world, because none can be read out of a cross-origin frame. |
| The route line on an **unavailable** base | **SAMPLE MAP** | `journeyFixtures.ts` — local coordinates and hand-authored corridor waypoints. It is a **schematic drawn over** the real map, labelled `SAMPLE corridor`, and it is not a survey of the road. |
| Leg timing under either | **SAMPLE estimate** | `pickupFixtures.ts`, computed on this device and tagged `SAMPLE` on every leg. It is never Bing's ETA. |
| Stops you add | **SAMPLE estimate** | `journeyFixtures.ts`, applied to the drive range and the leave-by on this device. |
| Cell-lot and curb rules | **official** | Port of Seattle pages, linked and labelled `OFFICIAL`. |
| Airport updates / corridor incidents | **SAMPLE** | `journeyFixtures.ts`, tagged `SAMPLE` on the marker itself. |
| The world blueprint | **Sol-generated** or **fallback** | Stated in the world caption and in the Source sheet, always. |

Every sampled value is tagged `SAMPLE` on screen, in the situation line, on its layer label, in the envelope's condition notes, and on its row in the sources sheet — which also states the source authority and the time it was checked. The conditions advance through a short authored sequence on each re-check, so the world visibly changes for a reason rather than shimmering.

### Signal Field (living news)

- **Local-impact briefing** — *"what is happening around me that could change my day?"*
- **Market / work morning briefing** — *"what local news and market moves matter to me this morning?"*
- **Weather, air, and mobility consequence briefing** — *"what affects my commute?"*

The flow: ask → at most two choice screens → the field. You are at the centre: `YOU · Seattle · 7:42 PM`. A static Bing aerial base shows the real geography; every local signal is projected from its fixture coordinate through the same Web Mercator viewport. Size is impact. Tethers point at the centre, while non-geographic market signals stay on the separate market axis.

The Local News world folds in FutureGlass as a **place-tethered instrument**: Bing aerial geography, thin cyan keylines, an edge-to-edge force rail, direct **5 / 25 / 60 / 120 mi** reach controls, and `Explore in Bing Maps`. The embedded map is static so overlays cannot drift; the rail states exactly how many rows are `LIVE` versus `SAMPLE` and when they were retrieved.

Four layers are forces, not panels: **Local**, **Markets**, **Weather/air**, **Mobility**. Switching one off removes its signals *and* its consequences while every remaining geographic anchor stays attached to the map, and rewrites the briefing — locally, with **no model call**. So does typing `hide markets`, `only things within 25 miles`, or `what affects my commute`. The world *is* the conversation; nothing is ever appended as chat.

Changing the centre is a context refresh, not merely a reproject. The browser immediately rebuilds a labeled local fallback, then the loopback gateway retrieves current weather/air, local headlines, and market quotes for the new allowlisted coarse place. At `Redmond + 5 mi`, Redmond-specific anchors replace an otherwise empty Seattle-only result.

Weather/air is an **area force** over the map, not just a link: separate sourced weather and AQI labels anchor the evidence, while one Web-Mercator-projected translucent wash shows modeled weather extent and a labeled arrow shows transport direction. Open-Meteo’s “wind from” bearing is converted to the opposite “transport toward” bearing before drawing. Turning Weather/air off removes the wash, vector, and both accessible anchors.

The polished map keeps only one solid reach boundary, one borderless weather wash with a labeled directional arrow, one center halo, and high-impact mobility leaders. Live headlines remain map-anchored as small dots but read in a single four-item edge rail; low-priority map labels reveal only on hover/focus.

The dominant object is a warm-light briefing ribbon: **`Your next 6 hours`**, with one to three prioritised consequences — *"Leave 20 minutes earlier — the I-5 queue reaches your route around 5:30"*, *"Your watched tech names moved after earnings"*, *"Air quality is moderate; outdoor plans unchanged"* — not a list of headlines.

The field is deliberately **mixed provenance**. Current Open-Meteo weather/air, direct municipal/publisher RSS headlines, and Yahoo Finance index quotes are labeled `LIVE` with retrieval times and links. Mobility remains a labeled `SAMPLE` fixture until a structured live mobility feed is connected. Headlines without geocoding say `coarse local context` rather than fabricating a mile distance.

---

## 6. Hybrid light and dark, by function

There is **no theme switch**, because light and dark are not a preference here — they are doing different jobs:

- **The worlds are dark.** Spatial contrast, glow, tethers, depth, and time-width geometry only read on a deep atmospheric ground. A light field would flatten reach into decoration.
- **Every reading and committing surface is warm light.** The Signal Field's briefing ribbon, the Time Terrain's decision envelope, and the sources sheet are all the same paper, laid over the dark world. Sentences, evidence, method, and timestamps are read, not scanned spatially, and reading performs best on paper-like warm light.
- **Signal names are direct type on the field** — content width, no plate, no border, a tight shadow for contrast. A measured layout pass keeps every name off the `YOU · place · time` anchor, the reach-ring names, the compass, the market axis, and every other name. Hue stays on the dots and tethers, where it means *force*.

Surfaces declare themselves with `data-surface="light" | "dark"` per component. There is no global binary theme, no dark/light toggle to offer, and the test suite asserts there never is one. `More` keeps only what is genuinely an accessibility preference: **contrast**, **text size**, and **motion**.

---

## 7. Truth states

Every value on screen carries how it is known.

| State | In Time Terrain | In the Signal Field | Meaning |
| --- | --- | --- | --- |
| **Observed** | electric mint band | solid glowing dot | A claim-level source said this, with a timestamp. |
| **Modeled** | amber band | ringed dot, method stated | Locally computed. The method is named next to it. |
| **Inferred** | slate band | hollow dot | An assumption. Always visibly editable. |
| **Unavailable** | hatch | dashed, hatched dot | Not established. Carries a reason *and* an unblocker. |

In the Signal Field, **hue means force** (local / markets / weather / mobility) and **texture means truth**, so the two never compete. Absence is stated out loud: *"Neighbourhood incident reports — no public feed for this radius. Open the police data dashboard yourself."*

Evidence lives in one warm-light bottom sheet behind a single `Sources` control — never as clutter in a world.

---

## 8. Location, handled coarsely

- Location is requested **only** after an explicit click, in either template — or, if you have turned the preference below on, once per session by the world that genuinely needs it.
- The request is `{ enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }`.
- Raw coordinates never reach the model, storage, app state, or Bing. `requestCoarseOrigin()` converts the fix **locally** to the nearest coarse area and discards the raw point before returning.
- A pending fix is **invalidated** the moment you pick or type a place yourself, or leave the view. A slow callback that lands afterwards is discarded, so a location the user already overruled can never silently move their world.
- Denied, unsupported, or not asked: Seattle / Bellevue / Redmond / Tacoma / Everett. The Signal Field opens on **Seattle labelled as a sample place**, and says so under the centre, until you choose.
- A device fix more than 120 miles from every supported Puget Sound place is rejected as `outside-region`; it is never relabelled as the nearest supported city.
- Home never converts a timezone into a city. It offers `Use current location`; that click is session-only. The separate `Always use my location` setting is the only way to persist consent for one fresh coarse fix on later sessions.
- Drive times and reach distances are local computations over fixture data. There is no live traffic source and CanvasBrowser never claims one.

### `Always use my location for relevant worlds`

One checkbox in `More`, above `Developer mode`. It is a behaviour preference, not an appearance one, and it is the only persistent setting that changes what the product does.

> Requests a fresh fix when Travel or Living News needs it. Coordinates are coarsened on this device, never stored, and never sent to the model.

What is stored, exactly and only:

```json
{ "version": 1, "alwaysUse": true }
```

under `canvasbrowser.location.v1` in `localStorage`. Off is the *absence* of that record. Malformed, half-written, or hostile storage validates back to off. No coordinate, no place label, no origin id, no route, and nothing derived from a fix is ever written — which is why a new session always starts with **no** location and asks for a fresh one instead of remembering the last.

What it does, and does not, do:

- **Consent, not a capability.** It fires the same `requestCoarseOrigin()` the explicit buttons fire. The **browser permission stays authoritative**: if the browser refuses, there is no fix.
- **Only in a world that needs it.** A fresh fix is requested after the Pickup world opens with no starting point, or after the Signal Field resolves with a centre that is still only inferred. Never on Home, never on a literal answer, never in a flow the location could not change.
- **Never twice.** One fix per world, tracked by the same geolocation generation token the explicit path uses — not one per render.
- **Already located means nothing happens.** If the world already has a place you chose or typed, the preference is a no-op.
- **Failure does not switch it off.** Denied, unsupported, or timed out leaves the preference exactly as you set it, brings back the manual place choices, and states the reason in `More` — `Enabled · browser permission denied`. It is never silently disabled on your behalf.
- **A manual choice always wins.** Choosing or typing a place while an automatic fix is pending invalidates it, exactly as it invalidates an explicit one. So do a new ask, `Start over`, leaving the view, and switching the preference off.
- **Switching it off keeps your world.** It invalidates any pending fix and stops future ones; it does not erase the location the world is already standing on.
- **Nothing precise leaves the device.** Turning it on does not add one word to a model request. Bing receives only the supported coarse area's published coordinate.
- **The explicit buttons stay.** `Use my location` remains in both worlds; this is a convenience, never the only path.

### The loopback gateway

The Demo gateway binds to `127.0.0.1`, but binding is not a boundary — any page can point a hostname it controls at the loopback address. `serverSecurity.mjs` therefore rejects every `/api/*` request whose `Host` is not exactly `127.0.0.1:<port>`, `localhost:<port>`, or `[::1]:<port>`, and whose `Origin` — when the browser sends one — is not the exactly matching loopback origin. The demo header is still required on top of that. Every response carries `nosniff`, `no-referrer`, `DENY` framing, and same-origin COOP/CORP; the document also carries a restrictive CSP. Static serving is unaffected, so the same-origin demo keeps working untouched.

---

## 9. Architecture

```
serverSecurity.mjs    loopback host/origin guard + security headers (pure, unit-tested)
blueprintSchema.mjs   the WIRE-side blueprint gate: extract, normalize, cap, scrub, reject
server.mjs            the Demo gateway itself (static files + /api/agent + /api/blueprint)
src/
  intent-to-world/
    situation-graph/
      index.ts          SHARED CONTRACT: typed, versioned, evidence- and
                        provenance-aware. No UI, no I/O, no provider logic
    situation-intelligence/
      index.ts          CORE 1: latent job, graph construction, acquisition plans,
                        provider-result interpretation, question economics (≤ 2)
      contextProviders.ts
                        provider seam, consent and the Microsoft Graph stub
      questionEconomics.ts
                        human-attention scoring and the global two-question limit
    experience-synthesis/
      index.ts          CORE 2: graph → outcome template. Cannot fetch/infer/ask
      templateBlueprint.ts
                        schema, browser-side gate, fallback worlds, selectQuestions()
      templateCompiler.ts
                        blueprint → safe visual primitives
  blueprintGateway.ts   the /api/blueprint client; every failure resolves to null
  inference.ts        the two-question ceiling + template ids (one hard invariant)
  pickupIntent.ts     travel situation detection + literal-answer reading + party capture
  pickupPlanner.ts    pure time planner: injected now, ranges only, stops applied
  pickupFixtures.ts   labelled travel data: processing ranges, SEA links, bag rationale
  journeyFixtures.ts  the route plane: rotated projection, corridors, stops, airport notes
  journeyPlanner.ts   pure route planner: waypoints, legs with clock windows, traffic
                      bands, weather cell, label de-collision, route-fitted framing
  refreshPolicy.ts    pure adaptive refresh policy: 60 / 15 / 5 min, then stop
  travelConditionsFixtures.ts
                      labelled SAMPLE weather + traffic projections around SEA,
                      with the real source authority a live version would read
  newsIntent.ts       news situation detection, scope/horizon inference, follow-up parsing
  newsPlanner.ts      pure signal-field planner: reach, bearing, spread, briefing
  newsFixtures.ts     labelled SAMPLE signal set + public source links + places
  newsSession.ts      news state: what is known, what is asked, what is switched on
  geolocation.ts      gesture-gated coarse area; coordinates never leave the function
  locationPreference.ts
                      the persistent location consent: { version, alwaysUse } and
                      nothing else, with a validator that reads malformed storage as off
  agentGateway.ts     the loopback Demo gateway client (literal answers only)
  visualEngine.ts     dependency-free WebGL2 atmosphere (Canvas2D fallback): one
                      reused canvas per surface, `home` | `travel` | `journey` | `news`
  ui/
    app.ts            Home → forming world → Journey | Field | Literal state machine.
                      Runs the Intent-to-World pipeline: Core 1 once per ask, the
                      graph and the experience plan held as state, routing on
                      graph.kind, and Core 2 on every change — with request, refresh
                      and geolocation generations so nothing stale lands, the
                      single-timer adaptive refresh controller, and the automatic
                      coarse-fix helper behind the location preference
    home.ts           home + its two ambient world seeds, literal answer, connection world
    clarify.ts        one question, its one reason line, rendered inside its world
    journeyWorld.ts   the route plane: SVG map, overlays, markers, stops, spatial gap
    timeTerrain.ts    the pickup surface: situation line, lens switch, map + linked strip,
                      warm-light envelope
    signalField.ts    news world: rings, centre, direct field type, market axis, briefing
    sourcesSheet.ts   warm-light evidence, one control away — including `Why this
                      world`: what Core 1 read and asked for, what Core 2 decided,
                      every question verdict, and Microsoft Graph as *not connected*
    moreMenu.ts       contrast / text size / motion, the persistent location consent,
                      optional developer readout (the full graph + experience plan)
```

**The division of labour is the point.** The model establishes live facts and citations, and proposes a *blueprint*. It is never asked to emit a world, and there is no path by which it could. Pure, deterministic local planners own uncertainty, geometry, routing and the envelope — which is why hiding a layer, adding a stop, or dropping a checked bag is instant and free.

`planPickup({ nowMs, reading, assumptions, origin, conditions, stops })`, `planJourney({ plan, originLabel, originId, originPoint, conditions, refreshDue })`, `computeRefreshPolicy({ … })` and `planSignalField({ … })` all take an injected clock and return a complete result. No `Date.now`, no randomness, no I/O.

### The visual engine

Desktop is not treated as a larger phone. CanvasBrowser spends sustained GPU
and screen area on visual computation because a world—not an answer—is the
desktop advantage. P1 is visual correctness and desire; performance tuning
follows after the visual grammar proves itself.

`src/visualEngine.ts` computes the ground each world stands on, per pixel, on the GPU. It is deliberately *beneath* the product: the canvas is `aria-hidden`, `pointer-events: none`, carries no text and no state, and sits at surface plane `0`; semantic content is promoted above that plane, and the warm-light envelope and briefing ribbon remain outside the canvas entirely.

- **Home** is a calm split horizon: time strata on one side and a grounded local-context grid on the other, joined by quiet horizontal keylines behind one dominant prompt. It has no orbital rings, particles, or moving scenery.
- **Journey** draws the **route plane** beneath the Bing base and the annotation: a static graticule and relief as the coordinate system, a current along the route bearing that moves *only while vehicles are moving on the corridor*, a weather field on the airport anchor that ripples *only while the projection is wet*, an arrival marker that travels *only while the aircraft is in the air*, and a scan ring *only while a check is due*.
- **Time Terrain** (the Timeline lens) draws a true perspective floor: lines of constant time running to a horizon, and rows of constant depth that advance only when there is traffic to advance them.
- **Signal Field** draws a density field, standing reach rings, and two parallax layers of signal dust. In SAMPLE mode — which is every session not wired to a live feed — nothing in it is happening in real time, so nothing in it moves.

#### Motion is a claim, and CanvasBrowser only makes claims it can support

Two rules decide every animation in the product:

> **Coordinate systems hold still.** A graticule, a perspective floor, a contour, a reach ring, the NOW rule, the NOW dot on the route, an airport rule marker — these are *places to read values against*. They do not drift, breathe, shimmer or sweep. Nothing is animated for texture.
>
> **Motion is spent only on something ongoing, or something asking for attention.** Traffic flowing on your corridor. Rain falling. An aircraft still in the air. A disruption that is live. A check that is due. The world having just changed under you. That is the entire list.

`src/motion.ts` is the single place that decides which of those are true, from the current situation. Both the GPU layer and the words under the map read the same answer, so the legend can never promise a motion the world is not running — and every remaining movement has a sentence attached to it.

| Motion | Runs only when | What it means |
| --- | --- | --- |
| `traffic` | the traffic layer is drawn **and** congestion > 0 | Vehicles are moving on your corridor. Speed and density follow the load and its trend; a jam visibly slows and compresses. Hide the layer and the particles are not drawn at all. |
| `weather` | the weather layer is drawn **and** the projection's intensity clears the threshold | Precipitation and wind streaks run along the wind bearing. A clear sky is still *drawn* — that is information — but it does not move. |
| `flight` | the phase is `scheduled`, `en route` or `approaching` | The aircraft is still in the air, so its marker travels. Landed or at-gate is one stationary observed marker: no orbiting, no breathing. |
| `disruption` | a corridor disruption exists and is drawn | The one thing on the plane that wants a decision. Airport rules and informational notes stay still. |
| `refresh-due` | the countdown to the next check is at or past its last 12 % | The world is asking to be looked at. **Cadence is not motion:** 60 / 15 / 5 minutes are said in words (`next in 4 min · every 5 min because …`) and drained on a dial. Nothing sweeps just because a policy is fast. |
| `world-update` | the world revision changed | One finite ripple, then it stops. |

The canvas publishes the live answer as `data-fx-active-motion` — a comma list such as `traffic,weather` — alongside the `data-fx-*` readings that drive it. Nothing renders from these; they exist so the animation can be **checked** rather than taken on faith, and the suite asserts that a landed flight under a clear sky with no check due lists nothing at all. The same mapping is honoured by the Canvas2D fallback and by the CSS animations on the map.

**The engine stops when the world does.** If no state-driven motion is active, `visualEngine.ts` draws one composed frame and **cancels its RAF loop entirely** (`data-fx-state="static"`); a pointer move or a revision change redraws it. A finite ripple is allowed to finish before the loop stops. This is efficient, but efficiency is the side effect — the point is that a still world is the honest picture of a situation in which nothing is happening.

| Uniform | Derived from | What it does on screen |
| --- | --- | --- |
| `u_flightPhase`, `u_flightProgress`, `u_flightActive` | flight phase and the best known target's position on the horizon | Places the **arrival marker**; `u_flightActive` decides whether it travels or simply sits where it is. |
| `u_weather`, `u_wind`, `u_weatherActive` | the projection's precipitation, wind speed and compass bearing | Sizes and stretches the airport field along the wind; `u_weatherActive` decides whether it rains. |
| `u_traffic`, `u_trafficTrend`, `u_trafficActive` | corridor congestion (0–1), its trend, and whether it is drawn at all | Sets the pitch and colour of the route current; `u_trafficActive` decides whether it flows. |
| `u_route`, `u_routeProgress`, `u_routeKnown` | the bearing of the drawn route at its midpoint, NOW's position along it, and whether an origin exists | Aligns the ground to the route the SVG actually drew and puts the still NOW point where NOW is. |
| `u_airport` | the projected airport anchor, in the map's own coordinates | Puts the weather field, the arrival marker and the scan ring on the airport. |
| `u_refreshDue` | the refresh countdown crossing into its last 12 % | The **only** thing that can start a scan. |
| `u_disruptionActive` | a live corridor disruption | One slow beat on the blocked stretch. |
| `u_marketLive` | a live market source driving the News axis (never, in this build) | Market currents flow. Sample prices are a reading, not a river. |
| `u_pulse` (revision) | a world rebuild | One finite knowledge ripple, then still. |

One canvas exists per mode and is reused across renders; `syncVisualEngine()` disposes the previous engine before mounting the current one, so RAF loops, listeners and GL contexts never accumulate. Device pixel ratio is capped at 2, resize goes through `ResizeObserver`, and the only layout read happens on resize. `prefers-reduced-motion`, the `motion=reduced` appearance, or `?motion=off` render exactly one composed still frame and start no loop. Without WebGL2 the engine falls back to Canvas2D, and if there is no drawing context at all the CSS world underneath is simply left alone — silently, with no console noise. Everything is procedural: no textures, no dependencies, and the only network request the product makes for a picture is the Bing base itself.

---

## 10. Setup, demo, and tests

```powershell
npm install
npm run test:install     # one-time Playwright Chromium download
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on 5183. No gateway — literal answers say so plainly. |
| `npm run demo` | **Live.** Builds `dist-demo` and serves it on <http://127.0.0.1:4173> with the loopback gateway. |
| `npm run build` | Type-check + production build to `dist` (no test API, no gateway server). |
| `npm test` | Playwright product acceptance suite on port 4175. |

### Demo script

1. `npm run demo`, open <http://127.0.0.1:4173>.
2. Click the second example — *"What local news and market moves matter to me this morning?"* — and press Ask. **No questions**: the Signal Field assembles immediately, then replaces weather/news/markets with linked current public data while keeping unavailable live layers explicitly `SAMPLE`.
3. Click **Markets** off. The axis leaves, the world recentres, the ribbon rewrites. No network request happens.
4. Type `only things within 8 miles`. The region ring empties. Still no network request.
5. Open **Sources**: a warm light reading sheet, every row labelled sample, every link real and public — with **`Why this world`** at the top: what the Situation Intelligence Engine read and which providers it used, planned or is waiting on consent for; what the Experience Synthesis Engine decided and why; every question verdict; and `Microsoft Graph — Not connected`.
6. **Start over**, then ask `What is happening around me that could change my day?` — exactly two questions, then the world.
7. **Start over**, then ask `EVA AIR TPE to SEA landed tonight?` — this performs **real live research**, and asks Sol for a **blueprint** in parallel. The world starts forming and asks its one job question straight away, with its reason under it. Choose **Picking someone up**.
8. The Journey world opens on **real Bing Maps geography** — SEA, the water, the interchanges — with **half a route**: the airport, the cell-phone lot and the arrivals curb are drawn on it, the rest is honestly empty, and one question sits in the gap — *"Where are you starting from? Needed to build your route, traffic exposure and staging window. Coordinates stay local."*
9. Pick **Bellevue**. The base recentres on the corridor you are actually driving, and CanvasBrowser's schematic draws itself over it from Bellevue through I-405 → I-518 to the lot and on to the curb, with congestion painted on the road, an alternate corridor dashed above it, a weather cell over the airport with the window it refers to, the arrivals curb lane-work marker, NOW held on the route, and every leg carrying the clock window you are inside it. The foot says `Bing Maps base · Open full map`, and Bing's own attribution stays on the map.
10. Read the line above it: **`ON THE GROUND · Overcast 54°F SAMPLE · Traffic moderate, steady SAMPLE · Checked 8:03 AM · next in 5 min · every 5 min because they are on the ground and moving through the airport`**, and the caption beside the lens switch: `Journey World · map over a linked timeline · blueprint: Sol-generated`.
11. Click **Coffee** under *Add a stop*. The drawn route deforms around it, the drive range grows, the leave-by moves earlier, and the envelope says why — `+5–11 min for coffee — your stops, SAMPLE estimate`. **No model call.** Remove it and everything goes back.
12. Click the **checked bag** in the situation line. The rationale rewrites itself — `No checked bag · curb-ready 12–28 min sooner, and no cargo space needed` — the bags segment dissolves from the strip, and the curb window contracts. Nobody was asked a question. **Nobody is ever asked how many passengers there are.**
13. Switch to the **Timeline** lens. The same world, the same envelope, the height given to the arrival processing instead of the route. Switch back.
14. Click **Re-check arrival status**. The world re-checks in place, the conditions advance, the corridor reddens, the leave-by moves, and the envelope's condition notes change. **No chat transcript appears anywhere.**
15. Toggle **Traffic** off. The drawing goes; the plan does not move. The note beside the switch says exactly that — and watch the world **stop moving**: with the corridor hidden, the flight down and no check due, the legend reads *"Nothing is moving"* and the GPU layer draws no further frames. Toggle it back on and the particles return, because now something is happening.

The static `dist` build has no gateway; it says so instead of pretending. The test build never asks for a blueprint at all — it always stands on the deterministic one.

### Test suite

Product acceptance, not implementation trivia. It covers, for both templates: home minimalism, its two ambient world seeds and its quiet examples; **world-first Travel** — the job question and forming terrain on screen before a deliberately delayed gateway answers, Pickup opening unknown terrain and resolving in place, Track showing the literal reading when it is ready, and the honest Coordination Constellation surface; the **two-question invariant on every route**; terrain resolution and the unknown state withholding a leave window; Time Terrain carrying no outer frame and no repeated truth chips; the Signal Field's centre, reach rings, layers, `SAMPLE DATA` labelling, prioritised envelope, and stated absence; **direct field type** having no plate, no border, no clipping, and never landing on the anchor, the ring names, or another name; that neither world is a card grid, tab set, or panel layout; layer toggles and follow-ups reshaping the world with **zero extra `/api/agent` calls**; the warm-light envelope and sheet versus the dark worlds, measured functionally; geolocation never firing before a click **and never landing after the user has decided**; the persistent `Always use my location` preference — off by default, stored as a version and a boolean and nothing else, surviving reload, requesting exactly one fresh fix only once a Travel pickup or a resolved Signal Field genuinely needs one, never on Home, staying enabled and stating the reason when the browser denies it, and losing to any manual choice, new ask, or being switched off mid-flight; dialogs restoring focus to whatever opened them; `More` having no theme switch; keyboard-only reachability; mobile at 390×844 with no horizontal scroll; **the decorative GPU layer** — exactly one `aria-hidden` canvas per world, correctly moded and behind everything, never accumulating across a full round trip, and rendering one still frame with no loop under `?motion=off`; the loopback host/origin guard, both as a pure function and over a real socket; and artifact separation (`__canvasBrowser` exists only in `dist-test`).

It also covers **the living pickup situation** end to end: the refresh policy at every boundary it claims (> 2 h, exactly 2 h, 2 h + 1 s, 1 h–2 h, exactly 1 h, on the ground with processing active, trip completed, and nothing known at all); the controller keeping **exactly one armed timer** across repeated entries, cancelling on view exit, parking while the tab is hidden and doing the overdue check on return, resetting on a manual re-check, and discarding a refresh answer that belongs to a dead session; the world stating **checked / next / why** and tagging its weather and traffic `SAMPLE`; a traffic fixture moving the drive range **and** the leave-by, and a weather fixture widening one named segment by exactly the stated minutes; a mocked refresh taking an **en-route world to landed in place**, tightening the cadence 15 min → 5 min with no trip back to prose; hiding a layer removing the drawing but not its effect on the plan; and the Travel canvas publishing **state-correlated** flight / weather / traffic / urgency values that move when the situation moves — while reduced motion still renders one still frame.

The model gateway is always mocked; **no test makes a live model call**, including the refresh tests, which drive one controller tick directly rather than waiting out a real five-minute interval, and the blueprint tests, which feed payloads through the real normalizer and compiler via a narrow test-only seam.

It also covers **the template thinking engine and the Journey World**:

- **both blueprint gates** — the wire-side `blueprintSchema.mjs` and the browser-side `templateBlueprint.ts` — rejecting markup-bearing strings, `javascript:` and `data:` URLs, unknown template families, wrong versions, non-objects and arrays; dropping unknown fields; clamping out-of-range numbers; and normalizing ids;
- **parse failure falling back**, for prose answers and for truncated JSON, without an error ever reaching the user;
- **question economics**: a question with no stated `materialEffect`, a stated effect that moves none of the four levers, no choices, or a non-positive score is rejected; duplicates collapse; at most two are selected; and the order is deterministic;
- **the pickup blueprint** asking the job first, asking origin **only** once Pickup is chosen and only while it is unknown, carrying party size as a *considered and argued-down* question, and never carrying the checked bag as a question at all;
- **one grammar, two worlds**: the same compiler resolving a pickup to `journey / map over a linked timeline / fx journey` and a briefing to `field / field only / fx news`, and the Timeline lens swapping the planes without changing the world;
- **the spatial gap** before an origin — the known half drawn, the route absent, the value of answering stated, and the question asked in exactly one place;
- **the route world** after an origin: main and alternate paths with distance and drive labels, the origin → stop → lot → curb sequence, traffic bands, direction particles, the projected weather cell with its time label and `SAMPLE` tag, the airport-update marker, the `SAMPLE MAP` stamp, per-leg clock windows, NOW on the route, the linked arrival strip, and the envelope;
- **the Bing base** — an allowed host, path and protocol, route, centre and `trfc=1` traffic parameters, no credential-shaped query, the right `title`, `sandbox` and `referrerpolicy`, the base beneath the annotation and the annotation beneath the labels, an unknown origin still landing on SEA, an offline browser stating `Bing Maps unavailable · illustrative overlay` rather than blanking, and a CSP whose `frame-src` allows Bing and nothing else while every other directive stays exactly as narrow as it was. **No test depends on a live Bing response**: the suite aborts everything leaving for `bing.com` and asserts the contract instead;
- **route parity and privacy** — a granted fix yielding only a coarse origin, with the exact fix absent from the Bing URL, storage and test API; a live base keeping one Web-Mercator-aligned `SAMPLE corridor`, hiding invented congestion/flow, and handing exact routing to Bing;
- **motion semantics** — coordinate systems (graticules, relief, leaders, route casings, the NOW dot, airport and rule markers) carrying no CSS animation at all; a landed flight under a clear sky with no check due publishing an empty `data-fx-active-motion` and stopping the RAF loop; an aircraft in the air adding `flight`; rain adding `weather`; a live corridor disruption adding `disruption` while rule markers stay still; hiding the traffic layer removing `traffic` and its particles; the scan appearing **only** when a check is due and never merely because the cadence is fast; the refresh-due rule exact at its boundary; and the SAMPLE Signal Field settling into a still field that redraws on a layer toggle;
- **adding and removing a stop** deforming the drawn path, growing the drive range, moving the leave-by earlier, writing itself into the envelope's condition notes, and doing all of it with **zero extra `/api/agent` calls**;
- **the bag rationale** reading `Checked bag assumed · adds 12–28 min and may need cargo space`, rewriting itself when toggled, and contracting the curb window — while **no passenger control exists anywhere**, a stated party size is still heard from the prompt, and every visible question carries one reason line;
- **the Journey GPU plane** publishing route-known, route-progress, traffic, weather, wind, phase and urgency that match the map, and the phone layout becoming a vertical corridor with a sticky envelope and no horizontal overflow.

And it covers **the Intent-to-World architecture itself**:

- **the arrival graph** naming its three job hypotheses with evidence, stating every provider it wants — live web research for the flight, coarse geolocation for the origin, Bing for the route and its traffic, weather over the airport, official airport guidance — and holding the checked bag as an *inferred, editable* unknown rather than a question, while party size is argued down with a recorded verdict;
- **the Living News graph** wanting local signals, market moves, weather and mobility, plus an optional consent-gated day schedule and work context, and asking exactly two questions when neither scope nor horizon can be read and none when both can;
- **question economics as a graph-native pass**: at most two, every verdict carrying an argument, the job question disappearing once answered, the origin question disappearing once a place is known, and a **blueprint-proposed question being unable to buy a person's attention**;
- **context acquisition** ordering available providers by material effect, deferring anything without permission, never polling a human as if they were an API, and **never making Microsoft Graph executable** — not without a connector, and not even when one is claimed. `MicrosoftGraphProvider.acquire()` answers `not-connected` with no statements and names the scope it *would* have used;
- **provider results folded in under authority rules**: a live-research statement promotes a fact, a fixture cannot overwrite it, and a failed provider writes no fact at all — only the reason it failed;
- **Experience Synthesis** deriving Journey World for a pickup and the Signal Field for a briefing, keeping tracking literal, naming the unbuilt **Coordination Constellation** for a connection, **rejecting a blueprint that misreads the situation** while accepting a compatible one for presentation only, and still scrubbing markup out of everything it compiles;
- **the wall between the engines**, asserted by reading the Experience Synthesis folder entrypoint as text: its entire import list is the graph contract, its local blueprint schema and compiler — no `fetch(`, no `navigator.`, no provider module — and the graph contract itself stays inert;
- **the app routing on `graph.kind`**, holding one graph and one experience plan with matching ids, compiling the same template as before the refactor, and the Source sheet stating `Why this world` for both engines, including `Microsoft Graph — Not connected`.

---

## 11. Non-goals

CanvasBrowser does **not**: take actions on your behalf, open or send anything, move money, compare products, store your coordinates, claim live traffic or live weather, send a coordinate or a referrer to the map provider it frames, treat a URL as proof, promote unstructured live text into a verified signal, **let a model emit user interface**, ask a question whose answer changes nothing you can feel, **animate anything that is not happening**, poll in a background tab, keep watching a trip that is over, or convert a missing flight status into "landed".

It also does **not read your calendar, your mail or your contacts**. Microsoft Graph is a stated need and a real extension seam — with minimal scopes and a reason for each — and in this build it is not connected, not consented to, and never called. The product says so on the world's own Source sheet rather than quietly implying otherwise.
