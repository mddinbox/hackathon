export interface LiveAgentResponse {
  answer: string;
  model: string;
  contextTier: string;
  reasoningEffort: string;
  normalization?: string | null;
  retrievedAt: string;
}

export interface AgentHealth {
  mode: string;
  model: string;
  contextTier: string;
  reasoningEffort: string;
  webSearch: boolean;
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Live gateway failed with HTTP ${response.status}.`;
  } catch {
    return `Live gateway failed with HTTP ${response.status}.`;
  }
}

export async function getAgentHealth(): Promise<AgentHealth | null> {
  try {
    const response = await fetch('/api/health', { headers: { accept: 'application/json' } });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
    return (await response.json()) as AgentHealth;
  } catch {
    return null;
  }
}

export async function askLiveAgent(prompt: string): Promise<LiveAgentResponse> {
  const response = await fetch('/api/agent', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-canvas-browser-demo': '1'
    },
    body: JSON.stringify({ prompt })
  });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as LiveAgentResponse;
}

export interface RouteMinutes {
  id: string;
  minutes: number | null;
}

/**
 * Best-effort real driving times. Returns null on any failure — offline, no
 * gateway (a static preview), rate-limited — so the caller keeps its estimate.
 */
export async function fetchRoute(
  origin: { lat: number; lon: number },
  points: Array<{ id: string; lat: number; lon: number }>
): Promise<RouteMinutes[] | null> {
  try {
    const response = await fetch('/api/route', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-canvas-browser-demo': '1' },
      body: JSON.stringify({ origin, points })
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
    const data = (await response.json()) as { minutes?: RouteMinutes[] };
    return Array.isArray(data.minutes) ? data.minutes : null;
  } catch {
    return null;
  }
}
