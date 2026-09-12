export interface LiveNewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string | null;
  feed: string;
}

export interface LiveMarketItem {
  id: string;
  label: string;
  price: number;
  changePercent: number;
  asOf: string | null;
  url: string;
}

export interface LiveLocalContext {
  place: { id: string; label: string; lat: number; lon: number };
  retrievedAt: string;
  weather: {
    temperatureF: number;
    weatherCode: number;
    condition: string;
    windMph: number;
    windDegrees: number;
    sourceUrl: string;
  } | null;
  air: { usAqi: number; pm25: number; sourceUrl: string } | null;
  news: LiveNewsItem[];
  markets: LiveMarketItem[];
  errors: string[];
}

export async function requestLocalContext(placeId: string): Promise<LiveLocalContext> {
  const response = await fetch('/api/local-context', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-canvas-browser-demo': '1' },
    body: JSON.stringify({ placeId })
  });
  if (!response.ok) throw new Error(`Local context gateway returned ${response.status}.`);
  return (await response.json()) as LiveLocalContext;
}
