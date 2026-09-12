/**
 * Offline fixtures for the Time Terrain template.
 *
 * Everything here is a local estimate or a clearly-labelled sample scenario.
 * None of it is live traffic, and none of it is presented as observed truth.
 */
import { formatMinuteRange } from './timeFormat';
import type { Assumptions, Citation, MinuteRange, OriginOption } from './types';

export const FIXTURE_LABEL = 'SAMPLE DATA';

/** Processing ranges for a wide-body international arrival at SEA. */
export const PROCESSING_RANGES: Record<'taxi' | 'deplane' | 'cbp' | 'bags' | 'curb', MinuteRange> = {
  taxi: { min: 5, max: 12 },
  deplane: { min: 8, max: 20 },
  cbp: { min: 20, max: 55 },
  bags: { min: 12, max: 28 },
  curb: { min: 6, max: 14 }
};

/** Each extra passenger widens the assembly tail a little. */
export const PARTY_TAIL_MINUTES_PER_EXTRA_PASSENGER = 4;

export const CELL_PHONE_LOT = {
  name: 'SEA Cell Phone Lot',
  address: '17801 International Blvd, SeaTac, WA',
  /** Lot → arrivals curb, local estimate. */
  driveToCurbMinutes: { min: 5, max: 9 } as MinuteRange,
  /** Buffer kept between arriving in the lot and the earliest possible curb-ready text. */
  stagingBufferMinutes: 5
};

export const ORIGIN_OPTIONS: OriginOption[] = [
  { id: 'downtown-seattle', label: 'Downtown Seattle', driveMinutes: { min: 18, max: 34 }, lat: 47.6062, lon: -122.3321 },
  { id: 'bellevue', label: 'Bellevue', driveMinutes: { min: 26, max: 46 }, lat: 47.6101, lon: -122.2015 },
  { id: 'redmond', label: 'Redmond', driveMinutes: { min: 30, max: 55 }, lat: 47.674, lon: -122.1215 },
  { id: 'tacoma', label: 'Tacoma', driveMinutes: { min: 30, max: 52 }, lat: 47.2529, lon: -122.4443 },
  { id: 'everett', label: 'Everett', driveMinutes: { min: 45, max: 78 }, lat: 47.9789, lon: -122.2021 }
];

/** Fallback used when a typed origin does not match a known place. */
export const TYPED_ORIGIN_DRIVE_MINUTES: MinuteRange = { min: 25, max: 55 };

export const SEA_LINKS: Citation[] = [
  { label: 'SEA Airport Cell Phone Lot — Port of Seattle (official)', url: 'https://www.portseattle.org/places/sea-tac-airport-cell-phone-lot' },
  { label: 'Dropping off / picking up at SEA — Port of Seattle (official)', url: 'https://www.portseattle.org/sea/dropping-off-picking-up' }
];

export const MAP_LINKS: Citation[] = [
  {
    label: 'Google Maps directions to the SEA Cell Phone Lot',
    url: 'https://www.google.com/maps/dir/?api=1&destination=SEA+Cell+Phone+Lot+SeaTac+WA'
  },
  {
    label: 'Bing Maps directions to the SEA Cell Phone Lot',
    url: 'https://www.bing.com/maps?where1=SEA%20Cell%20Phone%20Lot%2C%20SeaTac%2C%20WA'
  }
];

export const SEA_CURB_RULE =
  'SEA terminal curb is active-load only. Wait in the Cell Phone Lot and move to the curb after they text that they are outside.';

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  checkedBag: true,
  passengerCount: 1,
  internationalArrival: true
};

/**
 * Why the checked bag is on screen at all.
 *
 * It is the one assumption in this world that materially moves the decision:
 * it changes curb-ready by the full baggage-claim range, and it can decide
 * whether the car that turns up actually fits the luggage. So it is stated
 * with its consequence and corrected in one click — never asked as a question,
 * and never asked at all unless the person explicitly raises vehicle fit.
 */
export function bagRationale(checkedBag: boolean): string {
  return checkedBag
    ? `Checked bag assumed · adds ${formatMinuteRange(PROCESSING_RANGES.bags)} and may need cargo space`
    : `No checked bag · curb-ready ${formatMinuteRange(PROCESSING_RANGES.bags)} sooner, and no cargo space needed`;
}

/** Why the app is asking where you are, stated before you answer. */
export const ORIGIN_VALUE_COPY =
  'Needed to build your route, traffic exposure and staging window. Coordinates stay local.';

/**
 * The offline BR26 preview scenario. It is anchored to the moment the user
 * asks for it so the terrain is legible at any hour, and it is always shown
 * with a SAMPLE DATA tag — it is never used to answer a live question.
 */
export const SAMPLE_SCENARIO = {
  flightLabel: 'EVA Air BR26 · TPE → SEA',
  minutesSinceLanding: 6,
  note: 'Sample arrival: wheels down six minutes ago, international terminal, one passenger with a checked bag.',
  citations: [] as Citation[]
};
