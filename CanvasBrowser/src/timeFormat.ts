/** Time formatting shared by the planner and the terrain. Pure. */
import type { MinuteRange, TimeRange } from './types';

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function formatClock(ms: number): string {
  return TIME_FORMAT.format(new Date(ms)).replace(/\u202f/g, ' ');
}

function splitMeridiem(label: string): { time: string; meridiem: string } {
  const match = label.match(/^(.*?)\s*(AM|PM|am|pm)$/);
  return match ? { time: match[1], meridiem: match[2].toUpperCase() } : { time: label, meridiem: '' };
}

/** "7:20–7:35 PM" when the meridiem matches, "11:50 AM–12:10 PM" when it does not. */
export function formatRangeLabel(range: TimeRange): string {
  const start = splitMeridiem(formatClock(range.startMs));
  const end = splitMeridiem(formatClock(range.endMs));
  if (start.meridiem && start.meridiem === end.meridiem) {
    return `${start.time}–${end.time} ${end.meridiem}`;
  }
  return `${formatClock(range.startMs)}–${formatClock(range.endMs)}`;
}

export function formatMinuteRange(range: MinuteRange): string {
  return range.min === range.max ? `${range.min} min` : `${range.min}–${range.max} min`;
}
