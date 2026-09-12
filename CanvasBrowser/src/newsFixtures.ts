/**
 * Offline fixtures for the Living News template.
 *
 * Everything in this file is **SAMPLE DATA**: a hand-authored signal set used
 * to render the Signal Field deterministically. Nothing here was retrieved,
 * and nothing here may be presented as a live fact. The sources are real,
 * public, human-clickable pages — they are what you would read to verify a
 * signal of this shape, not proof that this particular signal happened.
 */
import type { LayerId, NewsHorizon } from './newsIntent';
import type { Citation, TruthKind } from './types';

export const NEWS_SAMPLE_LABEL = 'SAMPLE DATA';

export interface NewsPlace {
  id: string;
  /** Coarse label only. No street, no coordinates shown, nothing stored. */
  label: string;
  lat: number;
  lon: number;
}

export const NEWS_PLACES: NewsPlace[] = [
  { id: 'seattle', label: 'Seattle', lat: 47.6062, lon: -122.3321 },
  { id: 'bellevue', label: 'Bellevue', lat: 47.6101, lon: -122.2015 },
  { id: 'redmond', label: 'Redmond', lat: 47.674, lon: -122.1215 },
  { id: 'tacoma', label: 'Tacoma', lat: 47.2529, lon: -122.4443 },
  { id: 'everett', label: 'Everett', lat: 47.9789, lon: -122.2021 }
];

/** Only chosen explicitly, or used for the labelled sample preview. */
export const DEFAULT_NEWS_PLACE = NEWS_PLACES[0];

export interface SampleSignal {
  id: string;
  layer: LayerId;
  /** Two or three words. This is what the field itself is allowed to say. */
  short: string;
  headline: string;
  /** One line of evidence-shaped detail. Never a paragraph of copy. */
  detail: string;
  truth: TruthKind;
  /** How the value was established, in plain language. */
  method: string;
  minutesAgo: number | null;
  /** 0–1. Drives size, order, and whether it earns a consequence. */
  impact: number;
  horizons: NewsHorizon[];
  source: Citation | null;
  provenance?: 'sample' | 'live';
  retrievedAt?: string | null;
  /** Whether the map point is a real coordinate or a coarse contextual placement. */
  anchorPrecision?: 'exact' | 'coarse';
  /** Geographic anchor. Null means the signal is anchored to the market axis. */
  lat: number | null;
  lon: number | null;
  /** Market-axis residents are compact and time-ordered, never map pins. */
  axis?: { slot: number; move: string; direction: 'up' | 'down' | 'flat'; when: string };
  /** The consequence this signal earns in the briefing, if any. */
  consequence?: { text: string; weight: number };
  /** Present only for signals that are explicitly not available. */
  unavailable?: { reason: string; unblocker: string };
  /** Weather is an area force, not only a point label. */
  weatherArea?: {
    radiusMiles: number;
    intensity: number;
    /** Screen bearing the modeled transport moves toward: 0 north, 90 east. */
    windDegrees: number;
    condition: string;
  };
}

const WSDOT: Citation = { label: 'WSDOT Seattle traffic', url: 'https://wsdot.com/travel/real-time/map' };
const SOUND_TRANSIT: Citation = { label: 'Sound Transit service alerts', url: 'https://www.soundtransit.org/ride-with-us/service-alerts' };
const WSF: Citation = { label: 'Washington State Ferries — Bainbridge', url: 'https://wsdot.com/ferries/schedule/' };
const PORT_OF_SEATTLE: Citation = { label: 'Port of Seattle newsroom', url: 'https://www.portseattle.org/news' };
const SEA_AIRPORT: Citation = { label: 'SEA Airport — dropping off / picking up', url: 'https://www.portseattle.org/sea/dropping-off-picking-up' };
const OPEN_METEO: Citation = { label: 'Open-Meteo air quality API', url: 'https://open-meteo.com/en/docs/air-quality-api' };
const NWS: Citation = { label: 'National Weather Service — Seattle', url: 'https://www.weather.gov/sew/' };
const SEATTLE_COUNCIL: Citation = { label: 'Seattle City Council agenda', url: 'https://seattle.legistar.com/Calendar.aspx' };
const CITY_LIGHT: Citation = { label: 'Seattle City Light outage map', url: 'https://www.seattle.gov/city-light/outages' };
const SPD_DASHBOARD: Citation = { label: 'SPD crime dashboard', url: 'https://www.seattle.gov/police/information-and-data/data-dashboards' };
const MARKET_INDEX: Citation = { label: 'S&P 500 index — public quote page', url: 'https://www.google.com/finance/quote/.INX:INDEXSP' };
const MARKET_EARNINGS: Citation = { label: 'SEC EDGAR full-text search', url: 'https://efts.sec.gov/LATEST/search-index?q=earnings' };
const BLS_CPI: Citation = { label: 'BLS CPI release schedule', url: 'https://www.bls.gov/schedule/news_release/cpi.htm' };

/**
 * The sample signal set. Geography is real; the events are illustrative.
 * Reach is *computed* from the distance to wherever the user is standing —
 * it is never authored, so moving the centre genuinely moves the world.
 */
export const SAMPLE_SIGNALS: SampleSignal[] = [
  {
    id: 'i5-incident',
    short: 'I-5 blocked',
    layer: 'mobility',
    headline: 'I-5 southbound blocking incident',
    detail: 'Two right lanes closed south of the Spokane St interchange; queue is growing toward downtown.',
    truth: 'observed',
    method: 'State traffic feed, incident record with a timestamp.',
    minutesAgo: 14,
    impact: 0.92,
    horizons: ['now', 'today'],
    source: WSDOT,
    lat: 47.565,
    lon: -122.31,
    consequence: {
      text: 'Leave 20 minutes earlier on your next southbound trip — the I-5 queue is growing toward downtown.',
      weight: 0.92
    }
  },
  {
    id: 'link-single-track',
    short: 'Link single-track',
    layer: 'mobility',
    headline: 'Link single-tracking, SODO → Beacon Hill',
    detail: 'Maintenance window holds until 7 PM; southbound headways roughly double.',
    truth: 'observed',
    method: 'Transit agency service alert.',
    minutesAgo: 52,
    impact: 0.54,
    horizons: ['now', 'today'],
    source: SOUND_TRANSIT,
    lat: 47.5795,
    lon: -122.3275,
    consequence: { text: 'Southbound Link trips are taking another 12–18 minutes in this sample.', weight: 0.54 }
  },
  {
    id: 'ferry-cancel',
    short: 'Ferry cancelled',
    layer: 'mobility',
    headline: 'Bainbridge sailing cancelled for crewing',
    detail: 'One afternoon sailing dropped; the following boat absorbs the load.',
    truth: 'observed',
    method: 'Ferry system alert.',
    minutesAgo: 38,
    impact: 0.36,
    horizons: ['now', 'today'],
    source: WSF,
    lat: 47.623,
    lon: -122.511
  },
  {
    id: 'sea-curb-work',
    short: 'SEA curb work',
    layer: 'mobility',
    headline: 'SEA arrivals curb narrowed for paving',
    detail: 'Active-load only is being enforced harder than usual this week.',
    truth: 'observed',
    method: 'Airport operations notice.',
    minutesAgo: 175,
    impact: 0.34,
    horizons: ['today', 'week'],
    source: SEA_AIRPORT,
    lat: 47.4502,
    lon: -122.3088
  },
  {
    id: 'council-levy',
    short: 'Transit levy vote',
    layer: 'local',
    headline: 'Council votes on the transit levy tonight',
    detail: 'On the evening agenda; the outcome sets next year’s service funding.',
    truth: 'observed',
    method: 'Published council agenda.',
    minutesAgo: 96,
    impact: 0.38,
    horizons: ['today', 'week'],
    source: SEATTLE_COUNCIL,
    lat: 47.6045,
    lon: -122.33,
    consequence: { text: 'The levy vote lands tonight — it changes next year’s service, not your evening.', weight: 0.38 }
  },
  {
    id: 'ballard-power',
    short: 'Power restored',
    layer: 'local',
    headline: 'Power restored to 1,900 homes in Ballard',
    detail: 'Outage cleared; the utility has not published a cause yet.',
    truth: 'observed',
    method: 'Utility outage map, cleared record.',
    minutesAgo: 63,
    impact: 0.26,
    horizons: ['now', 'today'],
    source: CITY_LIGHT,
    lat: 47.6685,
    lon: -122.383
  },
  {
    id: 'everett-hiring',
    short: 'Second shift',
    layer: 'local',
    headline: 'Everett aerospace supplier adds a second shift',
    detail: 'Regional hiring signal; commuting volume north of the city rises with it.',
    truth: 'modeled',
    method: 'Local reporting summarised into a regional employment signal.',
    minutesAgo: 240,
    impact: 0.3,
    horizons: ['today', 'week'],
    source: PORT_OF_SEATTLE,
    lat: 47.9789,
    lon: -122.2021
  },
  {
    id: 'blotter-unavailable',
    short: 'Incident reports',
    layer: 'local',
    headline: 'Neighbourhood incident reports',
    detail: 'Nothing is being claimed here.',
    truth: 'unknown',
    method: 'No machine-readable feed exists for this radius in this build.',
    minutesAgo: null,
    impact: 0.2,
    horizons: ['now', 'today', 'week'],
    source: SPD_DASHBOARD,
    lat: 47.6182,
    lon: -122.3205,
    unavailable: {
      reason: 'No public feed for this radius.',
      unblocker: 'Open the police data dashboard yourself.'
    }
  },
  {
    id: 'air-moderate',
    short: 'AQI 74',
    layer: 'weather',
    headline: 'Air quality moderate, AQI 74 and holding',
    detail: 'Regional smoke transport is flat through the evening.',
    truth: 'modeled',
    method: 'Air-quality model output, not a station reading at your address.',
    minutesAgo: 21,
    impact: 0.32,
    horizons: ['now', 'today'],
    source: OPEN_METEO,
    lat: 47.3,
    lon: -121.9,
    weatherArea: {
      radiusMiles: 18,
      intensity: 0.42,
      windDegrees: 246,
      condition: 'Moderate air-quality transport'
    },
    consequence: { text: 'Air quality is moderate; outdoor plans unchanged.', weight: 0.32 }
  },
  {
    id: 'wind-advisory',
    short: 'Wind advisory',
    layer: 'weather',
    headline: 'Wind advisory in the Cascade foothills',
    detail: 'Gusts to 45 mph after 8 PM; the city itself stays under the threshold.',
    truth: 'observed',
    method: 'Weather service advisory product.',
    minutesAgo: 47,
    impact: 0.29,
    horizons: ['today', 'week'],
    source: NWS,
    lat: 47.72,
    lon: -121.62,
    weatherArea: {
      radiusMiles: 15,
      intensity: 0.58,
      windDegrees: 258,
      condition: 'Wind advisory footprint'
    }
  },
  {
    id: 'port-freight',
    short: 'Container volume',
    layer: 'markets',
    headline: 'Harbor Island container volume up 4%',
    detail: 'Freight demand is the one market force with an address in this field.',
    truth: 'modeled',
    method: 'Monthly port volume series, seasonally adjusted locally.',
    minutesAgo: 310,
    impact: 0.42,
    horizons: ['today', 'week'],
    source: PORT_OF_SEATTLE,
    lat: 47.585,
    lon: -122.348
  },
  {
    id: 'index-move',
    short: 'S&P 500',
    layer: 'markets',
    headline: 'S&P 500 +0.6%',
    detail: 'Broad tape is up; breadth is narrower than the index move suggests.',
    truth: 'observed',
    method: 'Index close, public quote page.',
    minutesAgo: 25,
    impact: 0.46,
    horizons: ['now', 'today', 'week'],
    source: MARKET_INDEX,
    lat: null,
    lon: null,
    axis: { slot: 0, move: '+0.6%', direction: 'up', when: 'at the close' }
  },
  {
    id: 'watchlist-move',
    short: 'Your watchlist',
    layer: 'markets',
    headline: 'Your watched tech names +2.1%',
    detail: 'Post-earnings move on the two names you flagged.',
    truth: 'observed',
    method: 'Filing-driven move; the relevance to you is inferred and editable.',
    minutesAgo: 9,
    impact: 0.78,
    horizons: ['now', 'today', 'week'],
    source: MARKET_EARNINGS,
    lat: null,
    lon: null,
    axis: { slot: 1, move: '+2.1%', direction: 'up', when: 'after hours' },
    consequence: {
      text: 'Your watched tech names moved after earnings — your alert level is now behind the price.',
      weight: 0.78
    }
  },
  {
    id: 'cpi-release',
    short: 'CPI print',
    layer: 'markets',
    headline: 'CPI print at 5:30 AM tomorrow',
    detail: 'Scheduled release; the tape usually decides direction inside ten minutes.',
    truth: 'observed',
    method: 'Published statistical release calendar.',
    minutesAgo: null,
    impact: 0.6,
    horizons: ['today', 'week'],
    source: BLS_CPI,
    lat: null,
    lon: null,
    axis: { slot: 2, move: 'scheduled', direction: 'flat', when: 'tomorrow 5:30 AM' },
    consequence: { text: 'Tomorrow’s CPI print at 5:30 AM sets the tone before you are up.', weight: 0.6 }
  }
];

const CITY_SOURCES: Record<string, Citation> = {
  bellevue: { label: 'City of Bellevue news', url: 'https://bellevuewa.gov/city-news' },
  redmond: { label: 'City of Redmond news', url: 'https://www.redmond.gov/CivicAlerts.aspx' },
  tacoma: { label: 'City of Tacoma news', url: 'https://www.cityoftacoma.org/news' },
  everett: { label: 'City of Everett news', url: 'https://www.everettwa.gov/CivicAlerts.aspx' }
};

/**
 * Reacquires the local fixture pack for a new centre.
 *
 * These remain labelled SAMPLE data. The refresh changes geographic relevance,
 * not truth status: it swaps in local civic/mobility/weather shapes around the
 * selected coarse place while retaining regional and market context.
 */
export function sampleSignalsForPlace(place: NewsPlace): SampleSignal[] {
  if (place.id === 'seattle') return SAMPLE_SIGNALS.map((signal) => ({ ...signal }));

  const source = CITY_SOURCES[place.id] ?? CITY_SOURCES.bellevue;
  const localPack: SampleSignal[] = [
    {
      id: `${place.id}-mobility`,
      short: `${place.label} corridor`,
      layer: 'mobility',
      headline: `${place.label} approach running slower than usual`,
      detail: 'A local corridor signal rebuilt for the selected centre.',
      truth: 'modeled',
      method: 'Location-scoped sample rebuilt from the selected coarse area.',
      minutesAgo: 12,
      impact: 0.72,
      horizons: ['now', 'today'],
      source: WSDOT,
      lat: place.lat - 0.043,
      lon: place.lon - 0.008,
      consequence: {
        text: `Allow another 10 minutes on trips leaving ${place.label} in this sample.`,
        weight: 0.72
      }
    },
    {
      id: `${place.id}-transit`,
      short: 'Transit adjustment',
      layer: 'mobility',
      headline: `Transit service adjustment near ${place.label}`,
      detail: 'A nearby service-change shape for the refreshed local context.',
      truth: 'observed',
      method: 'Transit agency alert shape, presented as SAMPLE data.',
      minutesAgo: 31,
      impact: 0.48,
      horizons: ['now', 'today'],
      source: SOUND_TRANSIT,
      lat: place.lat + 0.028,
      lon: place.lon - 0.042
    },
    {
      id: `${place.id}-civic`,
      short: 'Civic work window',
      layer: 'local',
      headline: `Public works window in ${place.label}`,
      detail: 'A city notice shape refreshed for the selected centre.',
      truth: 'observed',
      method: 'Municipal notice page, represented by a labelled fixture.',
      minutesAgo: 44,
      impact: 0.4,
      horizons: ['today', 'week'],
      source,
      lat: place.lat + 0.022,
      lon: place.lon + 0.048
    },
    {
      id: `${place.id}-weather`,
      short: 'Local air',
      layer: 'weather',
      headline: `Air and wind projection over ${place.label}`,
      detail: 'A location-scoped model projection, not a station at your address.',
      truth: 'modeled',
      method: 'Air-quality model output rebuilt around the selected coarse centre.',
      minutesAgo: 18,
      impact: 0.34,
      horizons: ['now', 'today'],
      source: OPEN_METEO,
      lat: place.lat - 0.027,
      lon: place.lon + 0.052,
      weatherArea: {
        radiusMiles: 2.6,
        intensity: 0.48,
        windDegrees: 238,
        condition: `${place.label} air and wind projection`
      },
      consequence: { text: `Outdoor plans in ${place.label} are unchanged in this sample.`, weight: 0.34 }
    }
  ];

  const market = SAMPLE_SIGNALS.filter((signal) => signal.axis);
  const regional = SAMPLE_SIGNALS.filter(
    (signal) => !signal.axis && signal.lat !== null && signal.lon !== null
  );
  return [...localPack, ...regional, ...market];
}

export const LAYER_LABELS: Record<LayerId, string> = {
  local: 'Local',
  markets: 'Markets',
  weather: 'Weather/air',
  mobility: 'Roads & transit'
};

/** Local + Markets are the P0 forces and are on by default. */
export const DEFAULT_LAYERS: Record<LayerId, boolean> = {
  local: true,
  markets: true,
  weather: true,
  mobility: true
};

export const DEFAULT_RADIUS_MILES = 25;

export const NEWS_SOURCE_NOTE =
  'Every signal in this field is a labelled fixture. The linked pages are real and public — read them yourself before you rely on anything.';
