/**
 * Context providers — the extension seam the Situation Intelligence Engine
 * acquires information through.
 *
 * A provider describes *what it could know*, *what that would cost in
 * permission*, and *whether it is actually available in this build*. Nothing in
 * this file renders, and nothing in this file is imported by the Experience
 * Synthesis Engine: presentation is not allowed to fetch.
 *
 * ## Microsoft Graph
 *
 * `MicrosoftGraphProvider` is a real seam and a deliberately empty one. It
 * declares the minimal scopes a future connector would request, ties each scope
 * to the exact need that justifies it, and then performs **no network call at
 * all**. There is no token flow, no Graph SDK dependency, and no sample
 * response pretending to be a mailbox. In P0 it always answers `not-connected`,
 * which is what the Source sheet shows the person.
 */
import type {
  ContextProviderId,
  Freshness,
  InformationNeed,
  SituationGraph,
  SourceAuthority
} from '../situation-graph';

/** A permission a provider would request, and the need that justifies it. */
export interface ProviderScope {
  scope: string;
  justification: string;
  /** Information need ids that would be satisfied by this scope. */
  needIds: string[];
}

export interface ContextProviderDescriptor {
  id: ContextProviderId;
  label: string;
  kind: 'device' | 'network' | 'local' | 'connector' | 'human';
  requiresConsent: boolean;
  /** 0–1: latency + permission weight + attention cost, combined. */
  cost: number;
  scopes: ProviderScope[];
  note: string;
}

/**
 * What this build can actually reach right now.
 *
 * `microsoftGraph` is true only when a connector exists **and** the person has
 * consented. There is no way to set it from a prompt, a blueprint or a model.
 */
export interface ProviderCapabilities {
  webResearch: boolean;
  geolocation: boolean;
  /** Browser permission already granted, or the persistent consent is on. */
  locationConsent: boolean;
  bingMaps: boolean;
  weather: boolean;
  airport: boolean;
  localFixtures: boolean;
  localNews: boolean;
  marketData: boolean;
  microsoftGraph: boolean;
}

export function defaultCapabilities(patch: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return {
    webResearch: false,
    geolocation: true,
    locationConsent: false,
    bingMaps: true,
    weather: true,
    airport: true,
    localFixtures: true,
    localNews: false,
    marketData: false,
    // P0 has no connector. This is the only place it could ever flip, and
    // nothing in the product sets it.
    microsoftGraph: false,
    ...patch
  };
}

export type ContextResultStatus = 'satisfied' | 'unavailable' | 'declined' | 'not-connected';

/** One statement a provider is willing to stand behind. */
export interface ContextStatement {
  /** The graph node this updates: a fact, force or unknown id. */
  nodeId: string;
  label: string;
  statement: string;
  truth: 'observed' | 'modeled' | 'inferred' | 'unknown';
  authority: SourceAuthority;
  freshness: Freshness;
  /** Event fields are present only when the statement resolves a timed event. */
  whenMs?: number | null;
  whenLabel?: string;
  /** Unknown nodes this statement resolves without requiring matching ids. */
  resolvesUnknownIds?: string[];
}

export interface ContextResult {
  needId: string;
  provider: ContextProviderId;
  status: ContextResultStatus;
  /** Epoch ms the provider answered. Null when it never ran. */
  retrievedAtMs: number | null;
  statements: ContextStatement[];
  note: string;
}

export interface ContextProvider {
  readonly descriptor: ContextProviderDescriptor;
  available(capabilities: ProviderCapabilities): boolean;
  /**
   * Acquire one need. Implementations must resolve — never throw — so a dead
   * provider degrades the graph instead of breaking a render.
   */
  acquire(need: InformationNeed, graph: SituationGraph): Promise<ContextResult>;
}

/* ---------------------------------------------------------- descriptors */

export const WEB_SEARCH_PROVIDER: ContextProviderDescriptor = {
  id: 'web-search',
  label: 'Live web research',
  kind: 'network',
  requiresConsent: false,
  cost: 0.5,
  scopes: [],
  note: 'Prose with citations. Nothing it says is promoted past what a claim-level source states.'
};

export const GEOLOCATION_PROVIDER: ContextProviderDescriptor = {
  id: 'geolocation',
  label: 'This device’s coarse position',
  kind: 'device',
  requiresConsent: true,
  cost: 0.35,
  scopes: [
    {
      scope: 'browser geolocation',
      justification: 'Turns "somewhere near Seattle" into a route, a traffic exposure and a leave-by time.',
      needIds: ['origin-location', 'news-place']
    }
  ],
  note: 'Coarsened on this device to a category, never stored, and never sent to a model.'
};

export const BING_MAPS_PROVIDER: ContextProviderDescriptor = {
  id: 'bing-maps',
  label: 'Bing Maps base and route',
  kind: 'network',
  requiresConsent: false,
  cost: 0.3,
  scopes: [],
  note: 'A framed base map and a routed line. The route belongs to Bing; CanvasBrowser draws no corridor over it.'
};

export const WEATHER_PROVIDER: ContextProviderDescriptor = {
  id: 'weather',
  label: 'Weather projection',
  kind: 'network',
  requiresConsent: false,
  cost: 0.25,
  scopes: [],
  note: 'P0 stands on a labelled SAMPLE projection; a live build would read a forecast API directly.'
};

export const AIRPORT_PROVIDER: ContextProviderDescriptor = {
  id: 'airport',
  label: 'Airport operations guidance',
  kind: 'network',
  requiresConsent: false,
  cost: 0.25,
  scopes: [],
  note: 'Official curb and lot rules. Published guidance, not a live feed.'
};

export const LOCAL_FIXTURE_PROVIDER: ContextProviderDescriptor = {
  id: 'local-fixture',
  label: 'Local sample fixtures',
  kind: 'local',
  requiresConsent: false,
  cost: 0.05,
  scopes: [],
  note: 'Shipped with the build, computed on this device, always labelled SAMPLE DATA.'
};

export const LOCAL_NEWS_PROVIDER: ContextProviderDescriptor = {
  id: 'local-news',
  label: 'Local news feeds',
  kind: 'network',
  requiresConsent: false,
  cost: 0.35,
  scopes: [],
  note: 'Direct municipal/publisher RSS where available, with a public news-feed fallback.'
};

export const MARKET_DATA_PROVIDER: ContextProviderDescriptor = {
  id: 'market-data',
  label: 'Market quote data',
  kind: 'network',
  requiresConsent: false,
  cost: 0.25,
  scopes: [],
  note: 'Current public index quotes with source links and retrieval time.'
};

export const USER_PROVIDER: ContextProviderDescriptor = {
  id: 'user',
  label: 'The person',
  kind: 'human',
  requiresConsent: false,
  // The most expensive provider in the product. Question economics exists
  // because of this number.
  cost: 0.9,
  scopes: [],
  note: 'At most two questions, and only for what genuinely cannot be inferred.'
};

/**
 * The Microsoft Graph seam.
 *
 * Each scope is minimal and tied to the need that justifies it. Nothing here is
 * requested, consented to, or called in P0.
 */
export const MICROSOFT_GRAPH_PROVIDER: ContextProviderDescriptor = {
  id: 'microsoft-graph',
  label: 'Microsoft Graph',
  kind: 'connector',
  requiresConsent: true,
  cost: 0.7,
  scopes: [
    {
      scope: 'Calendars.Read',
      justification:
        'A travel itinerary or a meeting already states the flight, the traveller and the day the pickup has to fit into — so the world stops guessing the arrival and stops asking about the day.',
      needIds: ['graph-travel-itinerary', 'graph-day-schedule']
    },
    {
      scope: 'Mail.ReadBasic',
      justification:
        'A flight confirmation carries the record locator, the flight number and the scheduled arrival. Basic read is enough to find and open that one message; full Mail.Read is not requested.',
      needIds: ['graph-flight-confirmation']
    },
    {
      scope: 'People.Read',
      justification:
        'Names the person being met, so the handoff can be "text Mei" instead of "text someone".',
      needIds: ['graph-traveler-contact']
    }
  ],
  note: 'Not connected in this build. No token flow, no SDK, no sample responses.'
};

export const PROVIDER_DESCRIPTORS: Record<ContextProviderId, ContextProviderDescriptor> = {
  'web-search': WEB_SEARCH_PROVIDER,
  'bing-maps': BING_MAPS_PROVIDER,
  geolocation: GEOLOCATION_PROVIDER,
  weather: WEATHER_PROVIDER,
  airport: AIRPORT_PROVIDER,
  'local-news': LOCAL_NEWS_PROVIDER,
  'market-data': MARKET_DATA_PROVIDER,
  'microsoft-graph': MICROSOFT_GRAPH_PROVIDER,
  'local-fixture': LOCAL_FIXTURE_PROVIDER,
  user: USER_PROVIDER
};

export function providerDescriptor(id: ContextProviderId): ContextProviderDescriptor {
  return PROVIDER_DESCRIPTORS[id];
}

/** True when this build can actually run the provider right now. */
export function providerAvailable(id: ContextProviderId, capabilities: ProviderCapabilities): boolean {
  switch (id) {
    case 'web-search':
      return capabilities.webResearch;
    case 'geolocation':
      return capabilities.geolocation && capabilities.locationConsent;
    case 'bing-maps':
      return capabilities.bingMaps;
    case 'weather':
      return capabilities.weather;
    case 'airport':
      return capabilities.airport;
    case 'local-news':
      return capabilities.localNews;
    case 'market-data':
      return capabilities.marketData;
    case 'local-fixture':
      return capabilities.localFixtures;
    case 'user':
      return true;
    case 'microsoft-graph':
      // Consent *and* a configured connector. Neither exists in P0.
      return capabilities.microsoftGraph;
    default:
      return false;
  }
}

/**
 * The Graph adapter.
 *
 * It exists so the seam is real — the engine can ask it what it would need and
 * whether it may run — and it deliberately does nothing else. `acquire` never
 * opens a socket; it states, in one line, that the connector is absent.
 */
export class MicrosoftGraphProvider implements ContextProvider {
  readonly descriptor = MICROSOFT_GRAPH_PROVIDER;

  available(capabilities: ProviderCapabilities): boolean {
    return capabilities.microsoftGraph;
  }

  /** The scopes this need would cost, so consent can be asked for precisely. */
  scopesFor(needId: string): string[] {
    return this.descriptor.scopes
      .filter((scope) => scope.needIds.includes(needId))
      .map((scope) => scope.scope);
  }

  async acquire(need: InformationNeed): Promise<ContextResult> {
    // No network call, by design. A future connector replaces this body; the
    // engine above it does not change.
    return {
      needId: need.id,
      provider: 'microsoft-graph',
      status: 'not-connected',
      retrievedAtMs: null,
      statements: [],
      note:
        `No Microsoft Graph connector is configured, so nothing was requested. ` +
        `Connected, this need would read ${need.fields.join(', ')} using ${
          this.scopesFor(need.id).join(' + ') || need.permission || 'a minimal scope'
        }.`
    };
  }
}

export const microsoftGraphProvider = new MicrosoftGraphProvider();
