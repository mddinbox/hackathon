# Market-Data & Session-Visibility Design

**Status:** Draft for review
**Scope:** Yahoo market-data ingestion, session classification, and the
session-driven visibility of individual ticker cards and the pinned Market
Overview.
**Audience:** Engineers maintaining `FloatingStockTicker`.

> **Reading convention.** Statements tagged **[CURRENT]** describe code that
> exists in the repository today (including the uncommitted working-tree
> changes to `TickerCardViewModel`, `MarketOverviewViewModel`,
> `SparklineMetrics`, and the XAML/test edits). Statements tagged
> **[PROPOSED]** are *not implemented*; they are recommendations. Do not read a
> **[PROPOSED]** item as done.

---

## 1. Problem statement, goals, and non-goals

### 1.1 Problem statement

The widget shows live-ish quotes for user symbols and a pinned index overview.
Yahoo's unofficial endpoints expose several *session-dependent* prices for the
same instrument at the same instant: regular price, pre-market, after-hours,
and (via a second authenticated endpoint) overnight. Which of these should be
shown — and whether a "night" futures row or an extended-hours line should be
visible at all — depends on the current market session, on which quote arrived
most recently, and on whether the paired instrument (cash index vs. future) is
in its own regular session.

The core problem is **session-driven visibility under asynchronous, out-of-order
quote arrival**. Prices arrive per-symbol over many seconds; the cash index and
its future are distinct symbols polled sequentially; sessions roll over on wall
clock while polls are in flight; and WPF only repaints when the exact backing
property raises `PropertyChanged`. Getting any of these wrong produces a
plausible-looking but *stale or contradictory* display (e.g. a pre-market line
still showing after the open, or a futures row visible during the cash regular
session).

### 1.2 Goals

- **G1 — Correct primary price.** Every card's headline number is Yahoo's
  regular-market price (or a defensible fallback), independent of session.
- **G2 — Honest extended/overnight line.** The secondary extended line is shown
  only when it is *fresh and appropriate for the current session*, and it is
  labelled with the correct session icon.
- **G3 — Frozen final after-hours.** After the post-market close, the last valid
  after-hours print remains visible (frozen, un-aged) until an overnight or next
  pre-market print supersedes it.
- **G4 — Overnight prices.** After the after-hours close, eligible US symbols
  show Yahoo's `OVERNIGHT` price fetched from the authenticated quote endpoint,
  with graceful fallback to the frozen after-hours print.
- **G5 — Overview cash/future pairing.** Each index column pairs a cash index
  (`^DJI`/`^GSPC`/`^IXIC`) with its future (`YM=F`/`ES=F`/`NQ=F`). The futures
  row is hidden while the *cash* index is in its regular session and visible
  outside it. Unavailable values render as `--`.
- **G6 — Cash-only composite chart.** The overview chart overlays only the
  independently normalized cash-index intraday series around a shared zero line.
- **G7 — Resilience to arrival order & failure.** No single-symbol failure, no
  futures-before-cash ordering, and no session rollover leaves the UI in a
  contradictory state.
- **G8 — WPF notification correctness.** Every visible property change raises
  `PropertyChanged` for the exact bound property.

### 1.3 Non-goals

- Real-time streaming (the app polls; default 10 s). Sub-second latency is out
  of scope.
- A supported/paid market-data contract. Yahoo's endpoints are unofficial and
  may change without notice.
- Historical/multi-day charts. The chart window is the current trading day only
  (`range=1d`).
- Non-US overnight sessions or instruments outside Yahoo's `overnightMarketPrice`
  coverage.
- Persisting Yahoo cookies/crumbs across process restarts.

---

## 2. Current architecture and data flow

### 2.1 Component inventory (concrete files)

| Layer | File / type | Responsibility |
|---|---|---|
| Transport / polling | `Services/YahooFinancePollingClient.cs` — `YahooFinancePollingClient` | Owns the `HttpClient`, poll loop, per-symbol chart GETs, overnight batch GET, crumb/cookie bootstrap, retry/backoff, and raises `QuoteReceived`/`SymbolError`/`RefreshCompleted`/`StatusChanged`. |
| Chart parser | `Services/YahooChartParser.cs` — `YahooChartParser.TryParseQuote` | Parses the v8 chart JSON into a `QuoteTick` (primary price, intraday series, session, extended selection). |
| Overnight parser | `Services/YahooOvernightQuoteParser.cs` — `YahooOvernightQuoteParser.Parse`, `YahooOvernightQuote` | Parses the v7 quote JSON, keeping only rows with `marketState == "OVERNIGHT"`. |
| Session classifier | `Models/MarketSession.cs` — `MarketSession`, `TradingPeriod`, `TradingPeriods`, `MarketSessionClassifier` | Classifies a timestamp into a session using Yahoo's `currentTradingPeriod` (half-open intervals). |
| Domain state | `Models/StockModels.cs` — `QuoteTick`, `IntradayPoint`, `StockTickerState`, `TickerCollectionState`, `PriceDirection` | Immutable tick + mutable per-symbol reduced state. |
| Overview domain | `Models/MarketOverview.cs` — `MarketIndexDefinition`, `MarketOverviewSymbols`, `MarketOverviewState`, `NormalizedMarketPoint`, `MarketOverviewSeriesNormalizer`, `CompositeChartMath` | Index/future definitions, per-symbol overview state, cash-series normalization, chart domain math. |
| Card VM | `Models/TickerCardViewModel.cs` — `TickerCardViewModel` | Presents one user symbol; owns the **extended-line visibility policy** (`ShouldShowExtendedQuote`). |
| Overview VM | `Models/MarketOverviewViewModel.cs` — `MarketOverviewIndexViewModel`, `MarketOverviewViewModel`, `MarketOverviewChartSeries` | Presents index columns; owns the **futures-row visibility policy** (`FuturesVisibility`) and the cash-only `ChartSeries`. |
| Presentation metrics | `Models/SparklineMetrics.cs` — `SparklineMetrics` *(new, untracked)* | Shared stroke thicknesses (`SeriesStrokeThickness = 1.88`, `ReferenceStrokeThickness = 0.9`). |
| Rules/formatting | `Models/PriceDirectionRules.cs`, `Models/PriceDisplayFormatting.cs`, `Models/IntradaySeries.cs`, `Models/SessionIconKind.cs`, `Models/RefreshStatus.cs` | Direction, glyph/percent formatting, series cleaning, icon names, refresh health. |
| Controls | `Controls/SparklineControl.cs`, `Controls/CompositeSparklineControl.cs` | Per-card sparkline; overview composite chart. |
| Shell / wiring | `MainWindow.xaml`, `MainWindow.xaml.cs` | Subscribes to feed events, marshals to the UI thread via `Dispatcher.BeginInvoke`, routes ticks to `MarketOverview` or `TickerCards`. |
| Packaging | `FloatingStockTicker.csproj` (`<Version>`), `Installer/Product.wxs`, `Installer/Build-Msi.ps1`, `Models/ApplicationVersion.cs` | Version, WiX v4 per-user MSI, build script. |
| Tests | `Tests/Test1.cs` — `StockTickerLogicTests`, `StubHttpMessageHandler` | All existing unit/parser/polling/VM tests (offline). |

### 2.2 Data flow (happy path)

```
DispatcherTimer / poll loop (background thread)
        │
        ▼
YahooFinancePollingClient.PollLoopAsync
        │  for each configured symbol (sequential):
        ├── PollSymbolAsync ──► GET v8/finance/chart/{symbol}?interval=1m&range=1d&includePrePost=true
        │                        └── YahooChartParser.TryParseQuote ──► QuoteTick (Session ∈ {PreMarket,Regular,AfterHours,Closed,Unknown})
        │
        ├── collect symbols whose QuoteTick.Session == Closed
        ├── PollOvernightQuotesAsync(closedSymbols)
        │        ├── GetYahooCrumbAsync ──► GET fc.yahoo.com (cookie) ──► GET v1/test/getcrumb (crumb)
        │        └── GET v7/finance/quote?...&overnightPrice=true&crumb=... ──► YahooOvernightQuoteParser.Parse
        │        └── overlay ExtendedPrice/ExtendedTimestamp, ExtendedSession = Overnight onto matching Closed ticks
        │
        ├── raise QuoteReceived per successful tick, SymbolError per failure
        └── raise RefreshCompleted iff ≥1 successful quote this cycle
        │
        ▼  (MainWindow event handlers)
Dispatcher.BeginInvoke  ── marshal to UI thread ──►
        ├── if MarketOverviewSymbols.IsBuiltIn(symbol):  MarketOverview.Apply(tick)
        │        ├── MarketOverviewState.Apply ──► StockTickerState.Apply
        │        └── card.ApplyCash(...) or card.ApplyFutures(...) ──► raises PropertyChanged + NotifyOverview()
        └── else:  _tickerState.Apply(tick) ──► TickerCardViewModel.Apply(state) ──► raises PropertyChanged
```

### 2.3 Threading model **[CURRENT]**

- The poll loop runs on a background `Task` (`PollLoopAsync`). All Yahoo I/O and
  parsing happen off the UI thread.
- Feed events (`QuoteReceived`, `SymbolError`, `RefreshCompleted`,
  `StatusChanged`) are raised on that background thread.
- `MainWindow` re-marshals each event onto the WPF `Dispatcher` before touching
  any view model (`FeedClient_OnQuoteReceived` → `Dispatcher.BeginInvoke`).
  Therefore **all view-model mutation and `PropertyChanged` occurs on the UI
  thread**, satisfying WPF's affinity rules. View models themselves are *not*
  thread-safe and rely on this contract.
- Lifecycle transitions (`StartAsync`/`StopAsync`/`Pause`/`Resume`/interval
  change) are serialized by `_lifecycleGate` (a `SemaphoreSlim`). The symbol set
  is guarded by `_symbolsGate`; the wake signal by a 0/1 `SemaphoreSlim`
  (`_pollSignal`).

---

## 3. Authoritative domain model

### 3.1 Session enum and classifier **[CURRENT]**

`MarketSession` = `{ Unknown, PreMarket, Regular, AfterHours, Overnight, Closed }`.

`MarketSessionClassifier.Classify(timestamp, periods)`:

- `periods == null || !periods.HasAny` → `Unknown`.
- `pre.Contains(t)` → `PreMarket` (half-open `[start, end)`).
- `regular.Contains(t)` → `Regular`.
- `post.Contains(t)` → `AfterHours`.
- otherwise → `Closed`.

**`Overnight` is never produced by the classifier.** It exists only as a
`QuoteTick.ExtendedSession` value stamped by the polling client after a
successful overnight overlay. This asymmetry is load-bearing for the visibility
rules below and is a frequent source of confusion — see §9.

`TradingPeriods` carries optional `PreMarket`/`Regular`/`AfterHours`
(`TradingPeriod` = half-open `[Start,End)`). `IsInTradingDay` bounds the whole
day by `min(start)…max(end)` and is used to drop chart points outside today's
session window.

### 3.2 Reduced state: `StockTickerState.Apply(QuoteTick)` **[CURRENT]**

Applying a tick recomputes (rejecting the tick if `Symbol` mismatches or
`Price < 0`):

- `CurrentPrice`, `HasTrade = true`, `LastUpdate = tick.Timestamp.ToLocalTime()`.
- `HasDailyBaseline = PreviousClose is > 0`; `DailyChange`,
  `DailyChangePercent` (guarded against `OverflowException`), `DailyDirection`
  via `PriceDirectionRules.CompareDaily`.
- `Session = tick.Session`.
- `ExtendedPrice`/`ExtendedLastUpdate`/`ExtendedSession` (verbatim from tick),
  `ExtendedDirection = CompareExtended(CurrentPrice, ExtendedPrice)`.
- `IntradayPoints = IntradaySeries.Clean(tick.IntradayPoints)` (dedup by
  timestamp keeping last, drop negative, sort ascending);
  `IntradayTrendDirection` from first→last cleaned close.

`PriceDirectionRules.FlatTolerance = 0.005m`: moves within half a cent are
`Flat` (the display is 2-dp).

### 3.3 Ticker-card extended-line state machine **[CURRENT]**

The card shows the extended line iff `state.ExtendedPrice is not null` **and**
`ShouldShowExtendedQuote(state)` (`TickerCardViewModel.ShouldShowExtendedQuote`).
`ShouldShowExtendedQuote` = `IsExtendedSession(ExtendedSession)` **and** the
following table on `(ExtendedSession, primary Session)`:

| `ExtendedSession` \ primary `Session` | PreMarket | Regular | AfterHours | Closed | Overnight | Unknown |
|---|---|---|---|---|---|---|
| **PreMarket** | ✅ show | ❌ hide | ❌ | ❌ | ❌ | ❌ |
| **AfterHours** | ❌ | ❌ | ✅ show | ✅ show | ❌ | ❌ |
| **Overnight** | ❌ | ❌ | ❌ | ✅ show | ✅ show* | ❌ |
| Regular / Closed / Unknown | ❌ (not an extended session) | | | | | |

`*` The `(Overnight, Overnight)` cell is effectively **dead** today: the primary
`Session` is produced by the chart classifier, which never emits `Overnight`. A
tick carrying `ExtendedSession == Overnight` always has primary `Session ==
Closed` (overlay path). The `Overnight` alternative is defensive only.

**Icon selection** (`ExtendedSessionIconKind`): `PreMarket → PreMarket`,
`Overnight → Overnight`, else `AfterHours`.

Rationale for the table:

- **Pre-market never survives the open.** Once the chart reports `Regular`, a
  lingering pre-market extended value is suppressed (this is the new working-tree
  behavior; test `TickerCardHidesPremarketQuoteAfterRegularSessionOpens`).
- **After-hours survives into Closed** (frozen final after-hours, G3).
- **Overnight shows only while Closed** (there is no separate primary Overnight
  session).

#### 3.3.1 Normative ticker-card display matrix **[CURRENT contract]**

This is the user-visible contract. Implementations may change internally, but
the rendered result must continue to match this matrix.

| Market phase | Primary number line | Secondary number line | Secondary icon | Freshness/fallback |
|---|---|---|---|---|
| **Pre-market** | Latest regular-market price/close | Latest valid pre-market tick | Dawn / pre-market | Show only when no more than 15 minutes old |
| **Regular market** | Current regular-market tick | **Hidden** | None | Any retained pre-market value must be suppressed immediately |
| **After-hours (active)** | Regular closing price | Latest valid after-hours tick | Moon / after-hours | Show only when no more than 15 minutes old |
| **After-hours closed** | Regular closing price | Final after-hours tick, frozen | Moon / after-hours | No age limit after Yahoo marks the session Closed |
| **Overnight available** | Regular closing price | Live Yahoo overnight tick | Moon / overnight | Overnight supersedes the frozen after-hours tick |
| **Overnight unavailable** | Regular closing price | Final frozen after-hours tick, if present | Moon / after-hours | Fall back without converting failure into a success-shaped zero |
| **No valid secondary data** | Valid primary if available, otherwise `--` | **Hidden** | None | Never show stale pre-market during Regular |

Formatting requirements:

- The primary and secondary prices use two decimal places.
- Direction/change is computed against the primary regular-market price for the
  secondary line.
- A hidden secondary line contributes no empty row, icon, tooltip fragment, or
  accessibility element.
- The tooltip timestamp identifies the actual secondary tick time; frozen
  after-hours data must not be presented as freshly updated.

### 3.4 Market-overview futures-row visibility **[CURRENT]**

`MarketOverviewIndexViewModel.FuturesVisibility` is computed **only** in
`ApplyCash`, from the **cash** index's session:

```
FuturesVisibility = (cash.Session == Regular) ? Collapsed : Visible
```

| Cash index `Session` | Futures row |
|---|---|
| Regular | **Collapsed** (hidden) |
| PreMarket / AfterHours / Closed / Unknown | **Visible** |

The value is *not* recomputed by `ApplyFutures`, by `SetCashError`, or on any
timer. It only changes when a **cash** `QuoteTick` is applied. Initial state:
`Reset()` → `Collapsed`, but the constructor's `RefreshCards()` immediately calls
`ApplyCash` with a fresh state (`Session == Unknown`) → **Visible**. So a
freshly constructed overview shows futures rows until the first cash regular
quote collapses them.

Unavailable futures render as `FuturesPriceText = "--"` with empty change text
(`SetFuturesError` / `Reset`). When the row is Collapsed (regular session) the
`--` is not visible; outside regular session it shows until a futures quote
arrives.

#### 3.4.1 Normative Market Overview display matrix **[CURRENT contract]**

| Paired cash-index phase | Cash/day row | Futures/night row | Composite chart |
|---|---|---|---|
| **Pre-market** | Cash index's latest regular value and daily change | Visible; current future or `--` | Cash-index series only |
| **Regular market** | Current cash-index value and daily change | **Hidden completely** | Cash-index series only |
| **After-hours / Closed** | Final cash-index regular value and daily change | Visible; current future or `--` | Cash-index series only |
| **Cash session Unknown** | Cash value if available, otherwise unavailable | Visible under current policy; target policy must resolve this explicitly | Cash-index series only |
| **Cash quote failure** | Existing cash value may remain with an error | Visibility follows the last authoritative cash-session state | Existing cash series must not be removed |

The sun and moon icons align with the first numeric line. The heading color
ledger (`DOW —`, `S&P —`, `NASDAQ —`) uses
`SparklineMetrics.SeriesStrokeThickness`, the same global thickness as both
individual and composite trend lines.

### 3.5 Composite chart series **[CURRENT]**

- `MarketOverviewSeriesNormalizer.Normalize(state)` returns `[]` unless
  `HasDailyBaseline && DailyBaseline > 0`. It prefers `Session == Regular`
  intraday points, falling back to *all* points only if there are no regular
  points, and maps each to `PercentChange = (price − baseline)/baseline × 100`.
- `MarketOverviewIndexViewModel.SeriesPoints` is set **only in `ApplyCash`**;
  futures never contribute points. Therefore `MarketOverviewViewModel.ChartSeries`
  (cards with `SeriesPoints.Count > 0`) is **cash-only** (G6).
- `CompositeChartMath.TryGetDomain` always includes `0` in the domain, pads the
  range by 8 %, and clamps `min ≤ 0 ≤ max` so the shared zero reference line is
  always in view.

### 3.6 Shared presentation metrics **[CURRENT]**

`SparklineMetrics` (new) centralizes stroke geometry:

- `SeriesStrokeThickness = 1.88` (previously the derived
  `CompositeSparklineControl.PreviousSeriesStrokeThickness (2.35) × 0.8`, now a
  plain constant).
- `ReferenceStrokeThickness = 0.9`.

Consumed by `App.xaml` (per-card `SparklineControl` style), `MainWindow.xaml`
(overview mini-line + `CompositeSparklineControl`), `SparklineControl`
(`StrokeThickness` DP default and `OnRender` fallback), and
`CompositeSparklineControl.CreateSeriesPen`/`CreateReferencePen`. This removes a
presentation constant that previously lived on a *control* and was referenced by
another control, XAML, and tests.

---

## 4. Data-source contracts, precedence, and fallback

### 4.1 v8 chart endpoint **[CURRENT]**

`GET https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1m&range=1d&includePrePost=true`
(`YahooFinancePollingClient.BuildChartUrl`; the symbol is
`Uri.EscapeDataString`-escaped so `^DJI` → `%5EDJI`).

`YahooChartParser.TryParseQuote` contract:

- Requires `chart.result[0].meta`; `chart.error.description` is surfaced as the
  error string.
- **Timestamp:** `meta.regularMarketTime` (unix s) if valid, else
  `fallbackTimestamp` (the caller passes `DateTimeOffset.UtcNow`).
- **Primary price precedence** (`TrySelectPrimaryQuote`):
  1. `meta.regularMarketPrice` (if finite and ≥ 0) at the regular timestamp;
  2. else the last cleaned intraday point with `Timestamp ≤ observedAt`;
  3. else parse failure ("did not contain regularMarketPrice or a valid intraday
     quote").
- **Active session:** `MarketSessionClassifier.Classify(fallbackTimestamp,
  periods)` — i.e. classified against **now**, not against the quote timestamp.
- **Extended selection** (`TrySelectExtendedQuote`), by active session:
  - `PreMarket`/`AfterHours` → last point *of that same session* that is
    **usable** (`observedAt − t ∈ [0, 15 min]`, `MaxActiveQuoteAge`).
  - `Closed` → last `AfterHours` point with `t ≤ observedAt`, **no age cap**
    (frozen final after-hours, G3).
  - else → none.
- **Previous close:** `meta.previousClose`, else `meta.chartPreviousClose`, else
  none (chart still parses; daily change becomes "unavailable").
- **Intraday points:** timestamp/close pairs, dropped unless within the trading
  day (`IsInTradingDay`), then `IntradaySeries.Clean`d.

### 4.2 v7 authenticated quote endpoint (overnight) **[CURRENT]**

Triggered only for symbols whose chart tick returned `Session == Closed`
(`PollLoopAsync` → `PollOvernightQuotesAsync`).

- **Crumb/cookie bootstrap** (`GetYahooCrumbAsync`): `GET https://fc.yahoo.com`
  (discard body; seeds the `CookieContainer`) → `GET
  https://query1.finance.yahoo.com/v1/test/getcrumb`. The crumb is rejected if
  empty or starts with `{`/`<` (HTML/JSON error bodies). On success it is cached
  in `_yahooCrumb`; on failure a 5-minute cooldown (`_nextYahooSessionAttempt`,
  `YahooSessionRetryDelay`) is set.
- **Batch quote:** `GET https://query1.finance.yahoo.com/v7/finance/quote?symbols=A,B,C&fields=...overnightMarketPrice,overnightMarketTime...&formatted=false&overnightPrice=true&region=US&lang=en-US&crumb=...`
  (`BuildOvernightQuoteUrl`). **All closed symbols are batched into one request.**
- **Retry/backoff:** up to 2 attempts. On `401/403`, clear the crumb + reset the
  cooldown and retry (re-bootstrap). On any other non-success or exception,
  return empty. After the loop, apply the 5-minute cooldown.
- **Parser:** `YahooOvernightQuoteParser.Parse` keeps only rows with
  `marketState == "OVERNIGHT"` and valid `overnightMarketPrice`/`overnightMarketTime`;
  case-insensitive symbol keys.
- **Overlay:** for each matching closed tick, set
  `ExtendedPrice/ExtendedTimestamp` and `ExtendedSession = Overnight`.

### 4.3 Extended-price precedence (effective) **[CURRENT]**

For a symbol at any instant, the extended line resolves in this order:

1. **Overnight** (`v7`), if the chart said `Closed` and an `OVERNIGHT` row
   exists → `ExtendedSession = Overnight`.
2. **Frozen after-hours** (`v8`), if `Closed` and no overnight → the last
   after-hours print, un-aged → `ExtendedSession = AfterHours`.
3. **Live pre/after-hours** (`v8`), if the active session is `PreMarket`/
   `AfterHours` and a print exists within 15 minutes.
4. **None** → line collapsed; primary regular price stands alone.

The card then applies the §3.3 visibility table on top of this selection (a
second, independent gate).

### 4.4 HTTP client contract **[CURRENT]**

One reusable `HttpClient` (`CreateHttpClient`): `CookieContainer`,
`UseCookies=true`, GZip/Deflate auto-decompression, 8 s timeout, browser-like
`User-Agent`, and **no** `Accept` header (so the crumb endpoint's `text/plain`
body is not rejected — asserted by `YahooClientDoesNotRestrictCrumbResponseToJson`).

---

## 5. Invariants the implementation must preserve

- **I1.** A card's headline price is always the regular-market price (or the
  §4.1 fallback), never an extended/overnight price.
- **I2.** The extended line is visible **iff** `ExtendedPrice != null` **and**
  the §3.3 table permits it for `(ExtendedSession, Session)`.
- **I3.** After the after-hours close and before the next pre-market, a card with
  a prior after-hours print shows that print (frozen, un-aged) unless a fresh
  overnight print supersedes it.
- **I4.** Overnight overlay is attempted **only** for symbols whose chart tick is
  `Closed`, and only via the crumb-authenticated batch request.
- **I5.** The overview composite chart contains **only** cash-index series; the
  zero reference line is always within the plotted domain.
- **I6.** A futures row is Collapsed **iff** its paired cash index's last applied
  session is `Regular`.
- **I7.** One cash symbol's failure never removes another index's series, and a
  futures failure never removes its cash series (`MarketOverviewFuturesFailureDoesNotRemoveCashIndexSeries`).
- **I8.** Every property bound in XAML raises `PropertyChanged` when its value
  changes as a result of `Apply*`/`Set*`/`Reset` (see §6.5 for the notify sets).
- **I9.** All view-model mutation happens on the UI thread (via `Dispatcher`).
- **I10.** Built-in overview symbols are always fetched, are never persisted as
  user symbols, and cannot be added as duplicate user cards
  (`MarketOverviewSymbols.IsBuiltIn`, `TickerCollectionState` filtering).
- **I11.** `RefreshCompleted` fires only for cycles with ≥ 1 successful quote
  (`YahooPollingReportsOnlyCyclesWithAtLeastOneValidQuote`).
- **I12.** Yahoo cookies/crumbs live only in memory and are never written to
  `settings.json` or any file.

### 5.1 Invariants that are **at risk today** (see §7/§9)

- **I6 is only *edge-triggered by cash quotes*.** It is not re-established on
  cash-poll failure or on session rollover without a fresh cash quote. A cash
  `SymbolError` at the open leaves the futures row Visible until the next
  successful cash quote. **[CURRENT gap]**
- **I2's `Unknown` handling.** When Yahoo omits `currentTradingPeriod`, both
  primary and extended sessions collapse toward `Unknown`/`Closed`, and the
  extended line silently disappears (`Unknown` row is all-hide). This is
  data-source-driven, not a bug, but it is undocumented in the UI. **[CURRENT]**

---

## 6. Test-driven design plan

Existing tests live in `Tests/Test1.cs` (`StockTickerLogicTests`) and use
`StubHttpMessageHandler` (records `RequestUris`/`LastRequestUri`, signals
`RequestObserved`) and the `JsonResponse` helper. New tests below follow the same
harness. Each item lists **Setup / Action / Expected**. Items marked **[EXISTS]**
are already present (named); **[ADD]** are proposed **[PROPOSED]** tests that
close gaps.

### 6.1 Unit — session classifier & state

- **T-U1 [EXISTS] `MarketSessionClassifierUsesHalfOpenYahooBoundaries`.**
  *Setup:* periods pre `[100,200)`, regular `[200,300)`, post `[300,400)`.
  *Action:* classify boundary timestamps. *Expected:* `200 → Regular`,
  `300 → AfterHours`, `400 → Closed`; ends are exclusive.
- **T-U2 [EXISTS] `DailyDirectionTableUsesPreviousCloseAndFlatTolerance`.**
  *Setup:* previous close vs current within/outside `0.005`. *Action:* `Apply`.
  *Expected:* `Up/Down/Flat` per tolerance.
- **T-U3 [ADD] `ClassifierReturnsUnknownWithoutTradingPeriods`.**
  *Setup:* `periods == null`. *Action:* classify. *Expected:* `Unknown` (guards
  I2's Unknown row and the overnight trigger).

### 6.2 Parser — chart & overnight

- **T-P1 [EXISTS] `YahooParserReadsRegularMarketPriceAndTimestamp`** — primary
  price precedence #1.
- **T-P2 [EXISTS] `YahooParserFallsBackToLastPointWhenRegularPriceIsMissing`** —
  precedence #2.
- **T-P3 [EXISTS] `YahooParserFallsBackToRegularPriceWhenActiveExtendedQuoteIsStale`**
  — the 15-minute `MaxActiveQuoteAge` gate on live extended selection.
- **T-P4 [EXISTS] `YahooParserRetainsFinalAfterHoursQuoteWhenMarketIsClosed`.**
  *Setup:* meta with pre/regular/post and points `[299 (regular), 399 (post)]`,
  observed at unix `1000` (after post). *Action:* `TryParseQuote` then
  `StockTickerState.Apply` + `TickerCardViewModel.Apply`. *Expected:* primary
  `Session == Closed`, `ExtendedPrice == 101`, `ExtendedSession == AfterHours`,
  card extended line **Visible**, `"After-hours"` icon, tooltip contains
  `"Extended price: 101.00"` (I3, frozen after-hours).
- **T-P5 [EXISTS] `YahooOvernightParserReturnsOnlyActiveOvernightQuotes`.**
  *Setup:* v7 payload with one `OVERNIGHT` and one `POST` row. *Action:* `Parse`.
  *Expected:* only the `OVERNIGHT` symbol is returned (I4).
- **T-P6 [EXISTS] `YahooParserFiltersRegularSessionAndKeepsTimestampClosePairs`
  / `...IncludesMixedPreRegularAndPostPointsAndSelectsActivePostQuote`** — series
  cleaning + active post selection.
- **T-P7 [ADD] `YahooParserOmitsExtendedWhenNoTradingPeriods`.**
  *Setup:* chart with `regularMarketPrice` but no `currentTradingPeriod`.
  *Action:* parse. *Expected:* `Session == Unknown`, `ExtendedPrice == null`
  (documents the Unknown-collapse behavior, I2 risk).

### 6.3 Polling integration (stubbed HTTP)

- **T-I1 [EXISTS] `YahooPollingReportsOnlyCyclesWithAtLeastOneValidQuote`.**
  *Setup:* failing then succeeding `StubHttpMessageHandler`. *Action:* `StartAsync`.
  *Expected:* no `RefreshCompleted` on all-fail; one on success with
  `SuccessfulQuotes == 1`; request query contains `includePrePost=true` (I11).
- **T-I2 [EXISTS] `YahooPollingOverlaysOvernightQuoteOnClosedChartData`.**
  *Setup:* handler routing `/v8/finance/chart/` → closed chart, `/v1/test/getcrumb`
  → `text/plain` crumb, `/v7/finance/quote` → overnight payload. *Action:*
  `StartAsync(["AMD"])`. *Expected:* delivered `QuoteTick.Session == Closed`,
  `ExtendedPrice == 489.83`, `ExtendedSession == Overnight`, and a request URI
  containing `overnightPrice=true` (I4, §4.2).
- **T-I3 [EXISTS] `YahooPollingIntervalChangeWakesAnActiveLoopWithoutNetworkAccess`**
  — `_pollSignal` wake path.
- **T-I4 [EXISTS] `YahooChartUrlEscapesCaretBuiltInSymbols` /
  `YahooOvernightUrlRequestsBatchOvernightFields` /
  `YahooClientDoesNotRestrictCrumbResponseToJson`** — URL/headers contracts.
- **T-I5 [ADD] `OvernightOverlayFallsBackToFrozenAfterHoursWhenOvernightEmpty`.**
  *Setup:* chart → `Closed` with a final after-hours point; crumb ok; `/v7`
  returns `result: []`. *Action:* `StartAsync`. *Expected:* delivered tick keeps
  `ExtendedSession == AfterHours` and the after-hours price (precedence #2 end to
  end, I3).
- **T-I6 [ADD] `OvernightBootstrapReauthenticatesOn401ThenSucceeds`.**
  *Setup:* `/v7` returns `401` on first call, `200` overnight payload on second;
  crumb endpoint counts invocations. *Action:* one poll cycle over a closed
  symbol. *Expected:* crumb re-fetched exactly once, overlay succeeds (§4.2
  retry/backoff).
- **T-I7 [ADD] `OvernightSessionRetryCooldownSuppressesReattempts`.**
  *Setup:* crumb endpoint always fails. *Action:* two poll cycles within 5 min
  (injected clock — see §9 seam). *Expected:* the second cycle does **not** hit
  the crumb endpoint again (`YahooSessionRetryDelay`).
- **T-I8 [ADD] `RateLimitedSymbolReportsErrorAndOthersContinue`.**
  *Setup:* handler returns `429` for symbol A, `200` for B. *Action:* poll.
  *Expected:* `SymbolError` for A ("rate-limited … 429"), `QuoteReceived` for B,
  one `RefreshCompleted`.

### 6.4 View-model — quote arrival order & session transitions

- **T-V0 [ADD — table-driven display contract]
  `TickerCardDisplayMatrixMatchesMarketPhase`.**
  Implement as a `[DataRow]` matrix whose rows correspond one-for-one with
  §3.3.1: PreMarket/live pre tick, Regular/stale pre tick,
  AfterHours/live post tick, Closed/frozen post tick, Closed/live Overnight,
  Closed/overnight unavailable with frozen-post fallback, and no secondary
  data. *Setup:* construct the exact `QuoteTick`/`StockTickerState` tuple for
  each row. *Action:* `TickerCardViewModel.Apply`. *Expected:* assert primary
  text, `ExtendedVisibility`, secondary text, icon kind/name, and presence or
  absence of the secondary tooltip fragment. This is the authoritative
  acceptance test for the display matrix; narrower tests below diagnose
  individual failures.
- **T-V1 [EXISTS] `TickerCardHidesPremarketQuoteAfterRegularSessionOpens`.**
  *Setup:* `QuoteTick(Session=Regular, ExtendedSession=PreMarket, ExtendedPrice=102)`.
  *Action:* `state.Apply` + `card.Apply`. *Expected:* `ExtendedVisibility ==
  Collapsed`, `ExtendedPriceText`/`ExtendedChangeText` empty, tooltip has no
  "Extended price" (I2, pre-market suppression).
- **T-V2 [EXISTS] `TickerCardShowsRegularAndPreMarketQuotesWithIndependentDirections`
  / `TickerCardCollapsesExtendedLineWhenExtendedQuoteIsAbsentOrStale`** — the
  positive/negative extended-line cases.
- **T-V3 [EXISTS] `MarketOverviewPairsCashIndexesWithIndependentFuturesRows`** —
  cash+future pairing, independent previous closes, cash-only `ChartSeries`.
- **T-V4 [EXISTS] `MarketOverviewFuturesFailureDoesNotRemoveCashIndexSeries`** —
  I7.
- **T-V5 [EXISTS — arrival order + WPF notify]
  `MarketOverviewHidesFuturesRowDuringRegularCashSession`.**
  *Setup:* subscribe to `^GSPC` card `PropertyChanged` collecting names.
  *Action:* apply `ES=F` (Regular) **first**, then `^GSPC` (Regular), then later
  `^GSPC` (Closed). *Expected:* after cash-Regular, `FuturesVisibility ==
  Collapsed` **and** the change list contains
  `nameof(FuturesVisibility)`; after cash-Closed, `FuturesVisibility == Visible`
  and `FuturesPriceText == "205.00"` (futures value that arrived first is
  retained). *This is the canonical futures-before-cash + notification test.*
- **T-V6 [ADD — the missing arrival-order hazard]
  `FuturesArrivingBeforeCashDoesNotPrematurelyToggleVisibility`.**
  *Setup:* fresh `MarketOverviewViewModel`; subscribe to the card. *Action:*
  apply only `ES=F` (Regular). *Expected:* `FuturesVisibility` stays at its
  construction value (**Visible**) because `ApplyFutures` must not compute
  visibility; assert **no** `PropertyChanged(FuturesVisibility)` with a *changed*
  value was raised from the futures apply. Documents that visibility is a
  cash-only function (I6) and prevents a future refactor from keying it off
  futures.
- **T-V7 [ADD — I6 stale-state gap] `CashPollFailureLeavesFuturesRowStaleAtOpen`.**
  *Setup:* apply `^GSPC` (Closed) → row Visible; then the cash poll fails at the
  open. *Action:* `overview.SetError("^GSPC", "…")` (no fresh cash quote).
  *Expected (documents CURRENT behavior):* `FuturesVisibility` remains
  `Visible` — i.e. the row is **not** collapsed until a successful Regular cash
  quote arrives. This test pins the current gap; when the §7 centralized policy
  lands, it is updated to assert Collapsed. Marked `[Ignore]`/pending until then.
- **T-V8 [ADD — WPF notify completeness]
  `TickerCardApplyRaisesEveryBoundPropertyOnce`.**
  *Setup:* subscribe to a card, apply a fully populated state (regular + extended
  + intraday + previous close). *Action:* `Apply`. *Expected:* the collected
  `PropertyChanged` names are a **superset** of the XAML-bound set (`PriceText`,
  `ChangeText`, `ExtendedText`, `ExtendedPriceText`, `ExtendedChangeText`,
  `ExtendedVisibility`, `ExtendedSessionIconKind`, `ExtendedSessionIconName`,
  `ChartValues`, `PreviousCloseReference`, `PostMarketDividerFraction`,
  `ChartTooltipText`, `DailyDirectionBrush`, `ExtendedDirectionBrush`,
  `ErrorText`, `ErrorVisibility`). Guards I8 against `NotifyAll` drift.
- **T-V9 [ADD — WPF notify completeness]
  `OverviewIndexApplyRaisesFuturesVisibilityNotification`.**
  *Setup:* subscribe to an index card. *Action:* `ApplyCash(state with
  Session=Regular)`. *Expected:* change list contains `FuturesVisibility`,
  `PriceText`, `ChangeText`, `DirectionBrush`, `SeriesPoints` (guards the newly
  added `Notify(nameof(FuturesVisibility))` in `NotifyAll`).
- **T-V10 [EXISTS] `MarketOverviewNormalizesEachSeriesToItsOwnPreviousCloseAndIncludesZero`
  / `MarketOverviewUsesEachIndexOwnPreviousCloseIndependently`** — normalization
  + zero inclusion (I5).
- **T-V11 [ADD — table-driven overview display contract]
  `MarketOverviewDisplayMatrixMatchesCashSession`.**
  Use `[DataRow]` values for PreMarket, Regular, AfterHours, Closed, and Unknown
  from §3.4.1. *Setup:* apply a futures quote first, then the paired cash quote.
  *Action:* inspect the paired `MarketOverviewIndexViewModel`. *Expected:* cash
  price remains visible; `FuturesVisibility` matches the matrix; unavailable
  futures display exactly `--` with an empty change string; `ChartSeries`
  contains the cash label only. Subscribe to `PropertyChanged` and require a
  `FuturesVisibility` notification whenever the expected visibility differs
  from the prior state.
- **T-V12 [ADD — presentation consistency]
  `AllTrendAndLedgerLinesUseGlobalSeriesThickness`.**
  *Setup:* read `SparklineControl.StrokeThicknessProperty` metadata, create a
  composite series pen, and inspect the heading-ledger XAML binding through a
  focused resource/control test. *Expected:* all resolve to
  `SparklineMetrics.SeriesStrokeThickness`; no independent numeric thickness is
  permitted in styles or controls.

### 6.5 Presentation-metric & control tests

- **T-M1 [EXISTS] `MarketOverviewUsesStableDistinctSeriesColorsAndSolidStrokeMetrics`.**
  *Setup:* build overview; create series/reference pens. *Action:* read pen
  thicknesses and the `SparklineControl.StrokeThickness` DP default. *Expected:*
  all series pens == `SparklineMetrics.SeriesStrokeThickness (1.88)`, the DP
  default == the same, reference pen == `SparklineMetrics.ReferenceStrokeThickness
  (0.9)`, series thinner than reference, colors distinct from the neutral line.
  *This test was updated in the working tree to reference `SparklineMetrics`
  instead of the removed `CompositeSparklineControl` constants.*

### 6.6 Live smoke tests **[PROPOSED — not in CI]**

A separately-categorized, network-gated suite (`[TestCategory("LiveSmoke")]`,
excluded from the default `dotnet test` filter) exercising the real endpoints
during a manual pre-release check:

- **T-S1 `LiveChartReturnsParsablePayloadForAAPL`.** *Setup:* real `HttpClient`.
  *Action:* `PollSymbolAsync("AAPL")`. *Expected:* a `QuoteTick` with
  `HasTrade`-equivalent price > 0 and a non-`Unknown` session during US hours.
- **T-S2 `LiveOvernightBootstrapProducesCrumbAndOvernightBatch`.** *Action:*
  `GetYahooCrumbAsync` then `BuildOvernightQuoteUrl` GET for a liquid symbol
  after the after-hours close. *Expected:* non-error HTTP and either an
  `OVERNIGHT` row or a clean empty result (never an exception).
- **T-S3 `LiveOverviewPopulatesThreeCashIndexesAndSomeFutures`.** *Action:* start
  the client with `MarketOverviewSymbols.Symbols`. *Expected:* three cash cards
  populate; futures rows follow the §3.4 visibility depending on wall-clock
  session. *Manual assertion:* no futures row visible during 09:30–16:00 ET.

Live smoke tests are inherently flaky (market hours, Yahoo availability); they
gate release, not merge.

---

## 7. Failure handling, observability, performance, security

### 7.1 Failure handling **[CURRENT]**

- **Per-symbol chart failures** map to `SymbolError` with specific messages
  (`429` rate-limit, non-2xx, timeout, `HttpRequestException`, `IOException`);
  other symbols keep polling. Cancellation during shutdown is swallowed.
- **Overnight failures** are *silent by design*: any non-success returns an empty
  overlay so the frozen after-hours print (precedence #2) stands. Repeated
  crumb/network failures trigger a 5-minute cooldown.
- **Parser failures** never throw out of `TryParseQuote`/`Parse`; they return
  `false`/empty with an error string.
- **UI marshalling** guards against `_isShuttingDown` / `Dispatcher.HasShutdownStarted`.

### 7.2 Observability **[CURRENT gap → PROPOSED]**

**[CURRENT]** The only signals are per-symbol UI error strings, the header
`StatusChanged` line, and `RefreshStatusClassifier` health (Fresh ≤ 3 min, Aging
≤ 10 min, Stale > 10 min). There is **no structured logging or telemetry**; crumb
failures, `401/403` re-auths, 429 counts, and overnight-overlay hit rate are
invisible post-hoc.

**[PROPOSED]** Add a lightweight `IMarketDataDiagnostics` sink (no PII) counting:
poll cycles, per-endpoint success/failure, crumb bootstraps + cooldowns, 429s,
overlay attempts/hits, and parse rejections by reason. Surface a debug overlay
and optional rolling log under `%LOCALAPPDATA%\FloatingStockTicker\logs`.

### 7.3 Performance & rate limits **[CURRENT]**

- Chart requests are **sequential, one per symbol per cycle** — the dominant
  rate-limit exposure. With *N* symbols + 6 built-ins at a 10 s interval that is
  `N+6` chart GETs every 10 s.
- Overnight requests **are batched** (one `/v7` GET for all closed symbols),
  which is the right pattern.
- `HttpCompletionOption.ResponseHeadersRead` + streamed body read; single pooled
  `HttpClient`; GZip/Deflate.
- **[PROPOSED]** Batch chart quotes via `/v7/finance/quote` (or `spark`) to
  collapse `N` GETs into 1–2, and/or add jittered spacing and a shared 429
  backoff. Skip re-fetching symbols whose session cannot have changed since the
  last cycle.

### 7.4 Security & privacy of Yahoo cookies/crumbs **[CURRENT]**

- The crumb is an anti-CSRF token and the `fc.yahoo.com` cookie a consent/session
  cookie. **Both live only in memory** (`HttpClientHandler.CookieContainer` +
  `_yahooCrumb`) and are discarded on exit. They are **never** written to
  `settings.json` (I12) — the settings shape has no such field, and legacy
  API-key fields are explicitly ignored (`SettingsSaveDoesNotPersistApiKey`).
- No user credentials, account, or PII are involved; the endpoints are anonymous.
- The `User-Agent` is a spoofed desktop-Chrome string — a fragile, ToS-adjacent
  dependency (documented as a limitation in `README.md`).
- **Caveat:** the crumb is carried in the **query string**. If request-level
  logging is ever added (§7.2), the crumb (and symbol list) would land in logs;
  redact the `crumb` parameter. **[PROPOSED]**
- **[PROPOSED]** Treat 401/403 loops as a "session poisoned" signal and back off
  globally (not just 5 min per attempt) to avoid hammering the anti-abuse layer.

---

## 8. Rollout, versioning, MSI upgrade, acceptance

### 8.1 Versioning **[CURRENT]**

- `FloatingStockTicker.csproj` `<Version>1.0.6</Version>` drives assembly
  version; `ApplicationVersion.DisplayText` renders `Version {Major}.{Minor}.{Build}`
  in Settings (`ApplicationVersionUsesThreePartDisplayText`).
- `Installer/Build-Msi.ps1` defaults `-Version 1.0.6` (validated `^\d+\.\d+\.\d+$`)
  and passes it to both `dotnet publish` and the WiX build.

### 8.2 MSI upgrade **[CURRENT]**

- WiX v4, **per-user** (`Scope="perUser"`), single-file self-contained payload,
  Start-Menu + Desktop shortcuts.
- Stable `UpgradeCode` `{0E9F1A7C-56B2-4A6B-9D3A-2F2C7B4D91E8}` +
  `<MajorUpgrade>` → newer versions replace older in place; downgrades are
  blocked with a message.
- User settings under `%LOCALAPPDATA%\FloatingStockTicker` are intentionally
  retained across upgrade/uninstall.
- The MSI is **unsigned**; `README.md` calls for code-signing before
  distribution to avoid SmartScreen.

### 8.3 Rollout plan **[PROPOSED]**

1. Land the working-tree changes (extended-visibility table, `FuturesVisibility`,
   `SparklineMetrics`) with tests T-V1/T-V5/T-M1 green.
2. Bump `<Version>` and `Build-Msi.ps1` default in lockstep; tag the release.
3. Build + (proposed) sign the MSI; run the §6.6 live-smoke checklist manually.
4. Ship; because upgrades are in-place per-user, no migration is required.

### 8.4 Acceptance criteria

- **AC1.** `dotnet test Tests/FloatingStockTicker.Tests.csproj` is fully green,
  including T-V1, T-V5, and T-M1.
- **AC2.** During US regular hours, no card shows a pre-market/overnight line and
  no overview futures row is visible; each card's headline equals Yahoo's regular
  price. (§6.6 T-S3 manual.)
- **AC3.** After the after-hours close, a symbol with an after-hours print keeps
  it until an overnight print supersedes it (I3), and eligible US symbols show an
  overnight line (I4).
- **AC4.** Killing network access degrades to per-symbol errors and a Stale
  header without crashing or blank-screening; recovery resumes automatically.
- **AC5.** `settings.json` after a full session contains **no** crumb/cookie
  material (I12).
- **AC6.** MSI upgrade from the previous version preserves settings and replaces
  the binary; Settings shows the new version.

---

## 9. Known gaps and follow-up refactoring **[PROPOSED]**

### 9.1 Design debt (be critical)

1. **Two hand-rolled session→visibility policies with no single owner.** Card
   extended-line visibility (`TickerCardViewModel.ShouldShowExtendedQuote`, a
   `(ExtendedSession, Session)` switch) and overview futures visibility
   (`MarketOverviewIndexViewModel.ApplyCash`'s `Session == Regular ? Collapsed :
   Visible`) encode the *same conceptual rule* ("show the off-hours thing only
   outside the regular session") in two different shapes, in two files, with
   different enums and defaults. Adding a session (or fixing one) requires editing
   both, and only one is guarded by symmetric tests.
2. **Visibility is edge-triggered by the wrong events.** `FuturesVisibility` is a
   pure function of the cash session but is only recomputed on a *cash quote*.
   `SetCashError` and session rollover-without-a-fresh-cash-quote leave it stale
   (I6 risk; test T-V7 documents it). It should be recomputed wherever the cash
   session or availability changes.
3. **`Overnight` is a second-class session.** It never comes from the classifier,
   only from an overlay, which forces the `(Overnight, Closed)` special-case and
   leaves a dead `(Overnight, Overnight)` branch. The primary `Session` type and
   the extended `Session` type are conflated (`MarketSession` used for both) even
   though they have different legal value sets.
4. **Session policy is duplicated across the parser and the VM.** The parser
   already suppresses stale extended prints (15-min age gate, session-matched
   selection); the VM then suppresses them again (§3.3 table). Defense-in-depth,
   but the two must be kept consistent by hand.
5. **`MarketOverviewState.Get` throws** (`_states[symbol]`) for unknown symbols;
   callers currently guard, but it is a latent sharp edge.
6. **Construction-time `FuturesVisibility` flash.** A new overview shows futures
   rows (`Unknown → Visible`) until the first cash Regular quote, briefly
   displaying `--` rows during market hours.
7. **No batching of chart requests** (§7.3) and **no observability** (§7.2).
8. **Time source is ambient.** `DateTimeOffset.UtcNow`/`.ToLocalTime()` are called
   directly in the parser, polling client, and state, making the 15-min gate, the
   5-min cooldown, and session-boundary behavior hard to unit-test deterministically
   (blocks T-I7 without reflection/hacks).

### 9.2 Proposed target design

- **P1 — Centralized `SessionVisibilityPolicy`.** Introduce a single pure module
  (e.g. `Models/SessionVisibilityPolicy.cs`) exposing:
  - `bool ShouldShowExtended(MarketSession primary, MarketSession extended)`
  - `Visibility FuturesRow(MarketSession cashSession)`
  Both `TickerCardViewModel` and `MarketOverviewIndexViewModel` delegate to it.
  One truth table, one test fixture (a `[DataRow]` matrix over all
  `Session × Session`), zero duplication. This is the headline refactor.
- **P2 — Recompute visibility on every relevant edge.** Have the overview VM
  recompute `FuturesRow(cashSession)` from a cached last-known cash session on
  *cash quote*, *cash error*, and a periodic *session-tick* (reuse the existing
  `_scheduleTimer` cadence), so visibility tracks wall-clock session rollovers
  and survives cash-poll failures. Fixes I6.
- **P3 — Distinguish primary vs. extended session types.** Model the extended
  price as `ExtendedQuote { Kind ∈ {PreMarket, AfterHours, Overnight}, Price,
  Timestamp }` so `Overnight` cannot leak into the primary `Session`, deleting the
  dead branch and the `Closed`-means-maybe-overnight coupling.
- **P4 — Inject a clock.** Thread an `Func<DateTimeOffset>`/`TimeProvider` through
  the parser, polling client, and state to make the age gate, cooldown, and
  session boundaries deterministically testable (enables T-I7 cleanly).
- **P5 — Batch chart quotes** via `/v7/finance/quote` and add a shared 429
  backoff (§7.3); add the `IMarketDataDiagnostics` sink (§7.2).
- **P6 — Harden the overview state** (`TryGet` instead of throwing indexer) and
  make the initial `FuturesVisibility` `Collapsed` until a real session is known,
  eliminating the construction flash.

### 9.3 Test gaps to close (independent of refactor)

- T-V6 (futures-before-cash does not toggle visibility), T-V7 (cash-failure stale
  row), T-I5 (overnight→after-hours fallback end-to-end), T-I6 (401 re-auth),
  T-I7 (cooldown), T-I8 (429 isolation), T-P7/T-U3 (no-trading-period collapse),
  and the notify-completeness guards T-V8/T-V9.

---

## Appendix A — Key constants (grep anchors)

| Constant | Value | Location |
|---|---|---|
| `MaxActiveQuoteAge` | 15 min | `YahooChartParser` |
| `FlatTolerance` | `0.005m` | `PriceDirectionRules` |
| `DefaultPollInterval` | 10 s | `YahooFinancePollingClient` |
| `YahooSessionRetryDelay` | 5 min | `YahooFinancePollingClient` |
| HttpClient `Timeout` | 8 s | `YahooFinancePollingClient.CreateHttpClient` |
| Poll-interval range | 10–3600 s | settings / README |
| Refresh health | Fresh ≤ 3 min, Aging ≤ 10 min, Stale > 10 min | `RefreshStatusClassifier` |
| `SeriesStrokeThickness` | `1.88` | `SparklineMetrics` |
| `ReferenceStrokeThickness` | `0.9` | `SparklineMetrics` |
| Version | `1.0.5` | `csproj`, `Build-Msi.ps1` |
| Overview symbols | `^DJI`/`YM=F`, `^GSPC`/`ES=F`, `^IXIC`/`NQ=F` | `MarketOverviewSymbols.Definitions` |

## Appendix B — Session decision tables (single source for P1)

**Extended line (card):** show iff `ExtendedPrice != null` AND cell = ✅.

| ExtendedSession \ Session | PreMarket | Regular | AfterHours | Closed | Overnight | Unknown |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| PreMarket | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| AfterHours | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Overnight | ❌ | ❌ | ❌ | ✅ | ✅* | ❌ |
| (other) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

`*` currently unreachable (primary `Session` is never `Overnight`).

**Futures row (overview):** function of the paired **cash** index session only.

| Cash Session | PreMarket | Regular | AfterHours | Closed | Unknown |
|---|:--:|:--:|:--:|:--:|:--:|
| Futures row | Visible | **Collapsed** | Visible | Visible | Visible |
