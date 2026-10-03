import type { HealthRecord } from './models';

export type SleepStage = 'awake' | 'inBed' | 'core' | 'deep' | 'rem' | 'asleep';

export interface SleepSegment {
  startDate: string;
  endDate: string;
  value: string;
}

export interface SleepDay {
  date: string;
  segments: SleepSegment[];
}

export function toSleepSegment(record: HealthRecord): SleepSegment {
  return { startDate: record.startDate, endDate: record.endDate, value: record.value };
}

/** A sleep night is labeled by the local calendar date on which its segment ends. */
export function getSleepDayKey(segment: SleepSegment): string | undefined {
  const endDate = segment.endDate.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : undefined;
}

export function getSleepStage(value: string): SleepStage {
  if (value.includes('Awake')) return 'awake';
  if (value.includes('InBed')) return 'inBed';
  if (value.includes('AsleepCore')) return 'core';
  if (value.includes('AsleepDeep')) return 'deep';
  if (value.includes('AsleepREM')) return 'rem';
  return 'asleep';
}

export function parseAppleHealthDate(value: string): number | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+([+-]\d{2})(\d{2})$/.exec(value);
  if (!match) return undefined;
  const timestamp = Date.parse(`${match[1]}T${match[2]}${match[3]}:${match[4]}`);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

/** Returns a union of asleep intervals so duplicate source records do not inflate the total. */
export function getTotalSleepMs(segments: SleepSegment[]): number {
  const intervals = segments
    .filter((segment) => !['awake', 'inBed'].includes(getSleepStage(segment.value)))
    .map((segment) => [parseAppleHealthDate(segment.startDate), parseAppleHealthDate(segment.endDate)] as const)
    .filter((interval): interval is readonly [number, number] => interval[0] !== undefined && interval[1] !== undefined && interval[1] > interval[0])
    .sort((left, right) => left[0] - right[0]);

  let total = 0;
  let activeStart: number | undefined;
  let activeEnd: number | undefined;
  for (const [start, end] of intervals) {
    if (activeStart === undefined || activeEnd === undefined || start > activeEnd) {
      if (activeStart !== undefined && activeEnd !== undefined) total += activeEnd - activeStart;
      activeStart = start;
      activeEnd = end;
    } else {
      activeEnd = Math.max(activeEnd, end);
    }
  }
  return activeStart !== undefined && activeEnd !== undefined ? total + activeEnd - activeStart : total;
}
