import type { LiveLocalContext } from './localContextGateway';
import { sampleSignalsForPlace, type NewsPlace, type SampleSignal } from './newsFixtures';

const OFFSETS = [
  { lat: 0.018, lon: -0.026 },
  { lat: -0.024, lon: -0.018 },
  { lat: 0.012, lon: 0.034 },
  { lat: -0.03, lon: 0.026 },
  { lat: 0.035, lon: 0.012 },
  { lat: -0.012, lon: -0.04 }
];

function minutesAgo(value: string | null, retrievedAt: string): number | null {
  if (!value) return null;
  const published = Date.parse(value);
  const retrieved = Date.parse(retrievedAt);
  if (!Number.isFinite(published) || !Number.isFinite(retrieved)) return null;
  return Math.max(0, Math.round((retrieved - published) / 60_000));
}

export function liveSignalsFromContext(context: LiveLocalContext, place: NewsPlace): SampleSignal[] {
  const signals: SampleSignal[] = [];
  const weather = context.weather;
  const air = context.air;
  if (weather) {
    const wind = Number(weather?.windMph);
    signals.push({
      id: `${place.id}-live-weather`,
      short: `${Math.round(weather.temperatureF)}° · ${weather.condition}`,
      layer: 'weather',
      headline: `${weather.condition} over ${place.label}`,
      detail: [
        `${Math.round(weather.temperatureF)}°F`,
        Number.isFinite(wind)
          ? `wind ${Math.round(wind)} mph from ${Math.round(weather.windDegrees)}°`
          : null
      ]
        .filter(Boolean)
        .join(' · '),
      truth: 'modeled',
      method: 'Open-Meteo current weather API.',
      minutesAgo: 0,
      impact: Math.min(1, Math.max(0.3, Number.isFinite(wind) ? wind / 45 : 0.35)),
      horizons: ['now', 'today'],
      source: { label: 'Open-Meteo current weather', url: weather.sourceUrl },
      lat: place.lat,
      lon: place.lon,
      provenance: 'live',
      retrievedAt: context.retrievedAt,
      anchorPrecision: 'coarse',
      weatherArea: {
        radiusMiles: 4,
        intensity: Math.min(1, Math.max(0.3, Number.isFinite(wind) ? wind / 35 : 0.4)),
        // Open-Meteo reports where wind comes FROM; the arrow shows transport TOWARD.
        windDegrees: Number.isFinite(weather.windDegrees)
          ? (Number(weather.windDegrees) + 180) % 360
          : 0,
        condition: `${weather.condition} weather footprint`
      }
    });
  }
  if (air) {
    const aqi = Number(air.usAqi);
    signals.push({
      id: `${place.id}-live-air`,
      short: Number.isFinite(aqi) ? `AQI ${Math.round(aqi)}` : 'Current air',
      layer: 'weather',
      headline: `Air quality over ${place.label}`,
      detail: [
        Number.isFinite(aqi) ? `US AQI ${Math.round(aqi)}` : null,
        Number.isFinite(air.pm25) ? `PM2.5 ${Number(air.pm25).toFixed(1)} µg/m³` : null
      ]
        .filter(Boolean)
        .join(' · '),
      truth: 'modeled',
      method: 'Open-Meteo current air-quality API.',
      minutesAgo: 0,
      impact: Math.min(1, Math.max(0.3, Number.isFinite(aqi) ? aqi / 160 : 0.35)),
      horizons: ['now', 'today'],
      source: { label: 'Open-Meteo current air quality', url: air.sourceUrl },
      lat: place.lat + 0.015,
      lon: place.lon + 0.018,
      provenance: 'live',
      retrievedAt: context.retrievedAt,
      anchorPrecision: 'coarse',
      consequence: Number.isFinite(aqi)
        ? { text: `Current air quality in ${place.label}: US AQI ${Math.round(aqi)}.`, weight: 0.46 }
        : undefined
    });
  }

  context.news.slice(0, 4).forEach((item, index) => {
    const offset = OFFSETS[index];
    signals.push({
      id: `${place.id}-live-${item.id}`,
      short: item.title.split(/\s+/).slice(0, 4).join(' '),
      layer: 'local',
      headline: item.title,
      detail: `Retrieved for ${place.label}; exact address is not geocoded, so this is anchored to the coarse local context.`,
      truth: 'observed',
      method: `${item.feed} · publisher ${item.source}.`,
      minutesAgo: minutesAgo(item.publishedAt, context.retrievedAt),
      impact: Math.max(0.32, 0.7 - index * 0.07),
      horizons: ['now', 'today'],
      source: { label: item.source, url: item.url },
      lat: place.lat + offset.lat,
      lon: place.lon + offset.lon,
      provenance: 'live',
      retrievedAt: context.retrievedAt,
      anchorPrecision: 'coarse',
      ...(index < 2
        ? {
            consequence: {
              text: item.title,
              weight: Math.max(0.5, 0.76 - index * 0.08)
            }
          }
        : {})
    });
  });

  context.markets.forEach((market, index) => {
    const move = `${market.changePercent >= 0 ? '+' : ''}${market.changePercent.toFixed(2)}%`;
    signals.push({
      id: `live-market-${market.id}`,
      short: market.label,
      layer: 'markets',
      headline: `${market.label} ${move}`,
      detail: `Current quote ${market.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}.`,
      truth: 'observed',
      method: 'Yahoo Finance chart endpoint.',
      minutesAgo: minutesAgo(market.asOf, context.retrievedAt),
      impact: Math.min(1, 0.35 + Math.abs(market.changePercent) / 5),
      horizons: ['now', 'today', 'week'],
      source: { label: `Yahoo Finance — ${market.label}`, url: market.url },
      lat: null,
      lon: null,
      axis: {
        slot: index,
        move,
        direction: market.changePercent > 0.02 ? 'up' : market.changePercent < -0.02 ? 'down' : 'flat',
        when: 'current market'
      },
      provenance: 'live',
      retrievedAt: context.retrievedAt
    });
  });

  // Until a structured mobility feed is connected, keep only that fixture
  // layer and label it SAMPLE. Live news/weather/markets never borrow its truth.
  const mobility = sampleSignalsForPlace(place)
    .filter(
      (signal) =>
        signal.layer === 'mobility' &&
        (place.id === 'seattle' ? signal.impact >= 0.5 : signal.id.startsWith(`${place.id}-`))
    )
    .slice(0, 2);
  return [...signals, ...mobility];
}
