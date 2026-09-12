# FutureGlass

FutureGlass is a portable local intelligence dashboard that combines live weather, air quality, sourced regional news, and satellite imagery in a sci-fi map interface.

[Watch the 15-second demo](FutureGlass-demo-15s.mp4).

## Quick start

Requirements:

- Python 3.9 or later
- Internet access
- A modern browser

```powershell
python server.py
```

Open [http://localhost:8765](http://localhost:8765).

The server uses only Python's standard library. No package installation, build step, account, or API key is required.

## Features

- Continuous high-accuracy browser geolocation
- Live Open-Meteo temperature, apparent temperature, humidity, wind, and US AQI
- Esri World Imagery satellite tiles rendered with Leaflet
- Accurate geographic projection for the location marker, radius ring, news pins, and atmospheric overlays
- Selectable 25-250 mile news horizon
- Multi-select news categories with select-all and clear-all behavior
- Sourced Google News RSS headlines with publisher, timestamp, and original article link
- Fifteen-minute regional news cache spanning representative localities within 250 miles
- Client-side radius filtering without news refetches or satellite-map reloads
- Deduplicated stories with publisher diversity
- Draggable floating news tiles with persistent geographic anchor lines
- Animated smoke, wind, and time-aware sun/moon layers
- Responsive layout and themed vertical scrollbars

## Controls

| Control | Behavior |
| --- | --- |
| News Horizon | Changes the visible news radius without refetching the regional cache |
| Radius presets | Quickly selects 50, 100, or 250 miles |
| News Preference | Selects one or more news categories; All selects or clears every category |
| Atmospheric Layers | Toggles smoke, wind, and sun/moon overlays |
| Map drag | Rotates the satellite map and compass |
| Location button | Restarts high-accuracy browser location tracking |
| News tile drag | Repositions a tile while keeping its anchor attached |
| Story arrow | Opens source verification, publication details, and article/map links |

## Architecture

`server.py` serves the static application and exposes `GET /api/news`.

The news endpoint:

1. Samples representative localities across a 250-mile radius.
2. Reverse-geocodes samples with BigDataCloud.
3. Queries Google News RSS for selected categories in those localities.
4. Deduplicates similar headlines and limits publisher dominance.
5. Caches up to 48 stories for 15 minutes.

The browser filters this regional cache instantly when the radius changes and displays up to six geographically diverse tiles to preserve map visibility.

## Runtime data providers

| Provider | Purpose |
| --- | --- |
| Google News RSS | Current sourced headlines and publisher metadata |
| BigDataCloud | Reverse geocoding for regional locality discovery |
| Open-Meteo | Current weather and air quality |
| Esri World Imagery | Satellite tiles |
| Leaflet via unpkg | Interactive geographic map projection |
| Bing Maps | External location links |

## Location and source precision

- Location tracking uses the browser Geolocation API. Accuracy depends on the device, browser permission, and operating-system location services.
- News feeds generally provide locality context rather than exact incident coordinates. FutureGlass labels these anchors as locality-level positions instead of presenting them as exact addresses.
- FutureGlass does not generate article bodies or infer unsupported claims. The story view displays source metadata and links to the publisher-provided article.

## Privacy and network access

Location coordinates are used by the local server and external data providers to retrieve relevant map, weather, geocoding, and news results. The prototype does not include user accounts or persistent server-side location storage. Category preferences are stored in browser `localStorage`.

## Configuration

Set `PORT` to use a port other than 8765:

```powershell
$env:PORT = 9000
python server.py
```

On macOS or Linux:

```bash
PORT=9000 python3 server.py
```
