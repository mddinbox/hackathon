# Floating Stock Ticker

A compact Windows 11-style WPF widget that stays on top of other windows and polls live-ish quotes for multiple symbols. Each card includes a color-coded intraday sparkline for the available current trading day, including extended sessions when Yahoo provides them.

## Prerequisites

- Windows 11 (Windows 10 should also work)
- .NET 8 SDK for building from source
- Internet access

No API key or account is required. Quotes use Yahoo Finance's unofficial chart endpoint:

```text
https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1m&range=1d&includePrePost=true
```

The app uses one reusable `HttpClient`, a browser-like User-Agent, and a configurable
10-to-3600-second polling interval (10 seconds by default).

## Build and run

From the `FloatingStockTicker` project directory:

```powershell
dotnet build .\FloatingStockTicker.sln
dotnet run --project .\FloatingStockTicker.csproj
dotnet test .\Tests\FloatingStockTicker.Tests.csproj
```

## Portable single-file publish

```powershell
dotnet publish .\FloatingStockTicker.csproj -c Release -p:PublishProfile=PortableWinX64
```

The exact copyable executable is:

`.\bin\Release\net8.0-windows\win-x64\publish\FloatingStockTicker.exe`

The executable embeds the multi-resolution icon from
`Assets\FloatingStockTicker.ico`; its editable vector source and deterministic
generator are `Assets\FloatingStockTicker.svg` and
`Assets\generate_icon.py`. To regenerate the ICO locally, install Pillow for
the development environment and run:

```powershell
python .\Assets\generate_icon.py
```

The publish directory contains one application executable (plus any generated
runtime satellite resource folders). Copy the publish directory, or the
executable when those localized resources are not needed, to any Windows x64
folder or machine and launch it directly; the .NET runtime is bundled.

Ticker settings are stored separately under:

```text
%LOCALAPPDATA%\FloatingStockTicker\settings.json
```

The settings file contains the configured symbol list, always-on-top preference,
polling interval, optional quiet-hours schedule, and global shortcut preference.
Missing settings fields are added with safe defaults: quiet-hours pausing and
the global shortcut are enabled by default. Existing explicit settings are
preserved, including an explicit quiet-hours value of `false`. Older settings
containing a single `Symbol` value are migrated without losing that symbol. Any
old API-key field is ignored and is not written to the new settings shape. A
malformed or out-of-range saved polling interval is reset to 10 seconds with a
warning.

## MSI installer

The repository includes a WiX Toolset v4 MSI definition under `Installer`. The
build uses a project-scoped NuGet dependency, so it does not require a
machine-wide WiX installation. From the project directory, run:

```powershell
.\Installer\Build-Msi.ps1
```

To build another semantic version:

```powershell
.\Installer\Build-Msi.ps1 -Version 1.0.3
```

The MSI is written to:

`.\artifacts\installer\FloatingStockTicker-1.0.3-x64.msi`

It is a per-user installation for Windows 10/11 x64. The application is
installed under `%LOCALAPPDATA%\Programs\Floating Stock Ticker`, with Start
Menu and Desktop shortcuts. No administrator rights, login auto-start, or
post-install launch are requested. Windows Installer handles major-version
upgrades and uninstall; the app's settings under
`%LOCALAPPDATA%\FloatingStockTicker` are intentionally retained when the MSI
is uninstalled.

Install by opening the MSI or with:

```powershell
msiexec.exe /i .\artifacts\installer\FloatingStockTicker-1.0.3-x64.msi
```

Uninstall from Apps & features, or with the MSI's product code:

```powershell
msiexec.exe /x .\artifacts\installer\FloatingStockTicker-1.0.3-x64.msi
```

The MSI is unsigned. Code-sign the MSI and executable before distribution to
avoid Windows SmartScreen warnings.

## Use

- On first run, only the pinned Dow/S&P 500/Nasdaq market overview is shown.
  Add user symbols with the `+` button.
- Drag the header or background to move the widget.
- Resize from any window edge.
- Press the global shortcut `Ctrl+Alt+Shift+F12` to restore and foreground the
  widget at the exact normal size and screen position it had before
  minimization or hiding, or minimize it when it is already active. If another
  application owns the shortcut, the ticker continues normally and shows a
  warning; the enabled preference remains saved for a later retry. The
  shortcut can be disabled from Ticker settings.
- On every launch, the widget starts in the lower-right of the primary
  screen's usable work area with a 16-pixel logical margin; its position is
  not restored from a prior run. The default window size is 450×500 logical
  pixels. A valid last non-minimized width and height are restored and
  clamped to the current work area; position is never persisted.
- Click the compact **+** header button to reveal the symbol editor, then press
  Enter or the confirmation button to add a symbol. Escape cancels the editor.
- Remove symbols with the × button on each card.
- Symbols are trimmed, uppercased, validated, and de-duplicated.
- When the window is widened, user ticker cards reflow into one, two, or
  three equal-width columns based on the available content width. The pinned
  Market Overview remains full-width at the top, and dragging cards still
  reorders and persists the symbol list.
- The first card is a pinned Market Overview for DOW (`^DJI`), S&P
  (`^GSPC`), and NASDAQ (`^IXIC`). Each column pairs a sun-icon cash-index
  row with a moon-icon futures row (`YM=F`, `ES=F`, and `NQ=F`), each using
  its own previous close for daily changes. The chart continues to overlay
  independently normalized cash-index intraday series around a shared zero
  line. These built-in symbols are always fetched, never persisted as user
  symbols, and cannot be added as duplicate cards.
- Each card shows the latest successful quote, absolute/percentage daily
  change versus Yahoo Finance's previous close, and a compact intraday
  sparkline. The primary quote remains Yahoo's regular-market price and its
  first quote line uses a neutral regular-session icon followed by the price
  and daily direction/change. A fresh pre-market, after-hours, or overnight
  quote appears on one compact secondary line with a distinct dawn or moon icon
  and its move versus the regular price; hover or accessibility metadata
  identifies the session. The sparkline includes a subtle neutral
  dashed previous-close reference line when a valid previous close is available;
  its price-path geometry remains intraday while the visible line color follows
  the daily direction. Hover for the exact previous-close value and day low/high
  values. Price moves within half a cent are shown as neutral.
  Pre-market and after-hours quotes are included when Yahoo supplies valid
  current trading-period boundaries. After the standard after-hours session,
  eligible US symbols use Yahoo's overnight quote feed and fall back to the
  final after-hours price when an overnight quote is unavailable. Session words
  are not rendered in the compact tile, but remain available through icon
  tooltips and accessibility names.
  Chart timestamps and closes remain paired, are filtered to the current
  trading-day session window, and are sorted chronologically; duplicate
  timestamps use the last valid source value. Tooltips identify the current
  session and latest quote time.
- The header shows one global refresh status, the latest successful refresh
  time, and the compact polling interval. Its dot turns green within 3
  minutes, yellow through 10 minutes, and red after 10 minutes. During a
  scheduled pause, the existing timestamp line replaces the polling suffix
  with exactly `Paused` (for example, `Updated 4:10:00 PM · Paused`) and the
  dot remains neutral/warning instead of aging to red.
- The gear button controls always-on-top behavior, polling interval, and
  optional quiet-hours pausing. The interval accepts whole seconds from 10
  through 3600. When enabled, polling pauses for all Saturday and Sunday and
  from 6:00 PM through 6:00 AM on weekdays using Windows local time. The
  header keeps the last successful timestamp and displayed data, and resumes
  with an immediate refresh at 6:00 AM Monday-Friday.

## Limitations

- Yahoo Finance's chart endpoint is unofficial and may change, rate-limit,
  reject, delay, or discontinue access without notice.
- Quotes may be delayed and availability depends on Yahoo Finance, exchange
  coverage, market hours, and symbol validity.
- Extended-hours availability varies by symbol and exchange. If no recent
  extended-hours trade is available, the widget falls back to Yahoo's regular
  market price or the latest valid chart point while keeping the session state
  honest.
- The neutral chart reference line uses the same valid Yahoo previous close as
  the daily change calculation and is omitted when that baseline is unavailable.
- HTTP failures, HTTP 429 responses, malformed payloads, and missing/delisted
  symbols are reported per symbol; other cards continue polling.
- When the symbol list exceeds the available widget height, only the ticker
  collection scrolls vertically; the header and controls remain fixed.
