# Copilot CLI + Bing Banner

A local browser-based terminal that launches the real GitHub Copilot CLI and turns model wait time into a lightweight Bing Shopping promotion surface.

The shopping unit appears inside the terminal frame after a prompt is submitted, follows Copilot's visible activity state (such as Thinking, Searching, or Working), rotates while the CLI remains busy, and disappears when output settles or Copilot asks for input. It uses the same monospace, ASCII-line visual language as the CLI. Product placements are clearly labeled as demos, link to Bing Shopping searches, and can be dismissed.

## BytePet

The terminal includes an optional Tamagotchi-inspired ASCII companion called BytePet. It is hidden by default as a surprise; enter `/pet show` to reveal it. It starts as an egg and evolves as it earns demo **Sparks**:

- Opening a labeled rewarded Bing demo offer grants 3 Sparks.
- Each offer rewards once per day, with a maximum of five rewarded offers daily.
- Rewards are local prototype currency with no cash or transferable value.
- Ignoring or dismissing advertising never harms the pet.
- BytePet state is stored only in the browser's local storage.

Use the sidecar buttons or local terminal commands:

```text
/pet
/pet status
/pet feed
/pet play
/pet name Pixel
/pet hide
/pet show
```

Feeding and playing cost 2 Sparks. Evolution stages are Egg, Hatchling, Explorer, Builder, and Guardian.

## Requirements

- Node.js 20 or later
- GitHub Copilot CLI installed and available as `copilot`
- An authenticated Copilot CLI session (`copilot login` if needed)

## Run

```powershell
cd CopilotBingBanner
npm install
npm start
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787).

The server binds to localhost by default and starts one Copilot CLI pseudoterminal per browser connection.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Local HTTP port |
| `HOST` | `127.0.0.1` | Bind address |
| `COPILOT_WORKING_DIRECTORY` | Directory where `npm start` runs | Working directory given to Copilot |

For example, launch Copilot against another repository:

```powershell
$env:COPILOT_WORKING_DIRECTORY = "D:\source\my-project"
npm start
```

## How it works

- `node-pty` runs `copilot` inside a real Windows pseudoconsole.
- `ws` streams terminal input, output, and resize events.
- `xterm.js` renders the interactive terminal in the browser.
- `ActivityTracker` strips terminal control sequences and tracks submit, active, settled, and input-required states.
- Bing links are ordinary labeled demo shopping links; no search history or terminal content is sent to Bing.
- Product names, prices, merchants, and ratings are illustrative placeholders rather than a live Microsoft Advertising feed.

## Test

```powershell
npm test
```
