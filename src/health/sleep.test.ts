import { describe, expect, it } from 'vitest';
import { getSleepDayKey, getSleepStage, getTotalSleepMs, parseAppleHealthDate } from './sleep';

describe('sleep helpers', () => {
  it('maps Apple sleep values to visual stages', () => {
    expect(getSleepStage('HKCategoryValueSleepAnalysisAsleepDeep')).toBe('deep');
    expect(getSleepStage('HKCategoryValueSleepAnalysisAsleepREM')).toBe('rem');
    expect(getSleepStage('HKCategoryValueSleepAnalysisAwake')).toBe('awake');
  });

  it('uses a segment end date as its sleep-day label', () => {
    expect(getSleepDayKey({ startDate: '2026-09-20 23:00:00 +0200', endDate: '2026-09-21 07:00:00 +0200', value: 'HKCategoryValueSleepAnalysisAsleepCore' })).toBe('2026-09-21');
  });

  it('counts overlap between duplicate asleep records only once', () => {
    const segments = [
      { startDate: '2026-09-20 23:00:00 +0200', endDate: '2026-09-21 03:00:00 +0200', value: 'HKCategoryValueSleepAnalysisAsleepCore' },
      { startDate: '2026-09-21 02:00:00 +0200', endDate: '2026-09-21 06:00:00 +0200', value: 'HKCategoryValueSleepAnalysisAsleepREM' },
      { startDate: '2026-09-21 04:00:00 +0200', endDate: '2026-09-21 04:15:00 +0200', value: 'HKCategoryValueSleepAnalysisAwake' }
    ];
    expect(getTotalSleepMs(segments)).toBe(7 * 60 * 60 * 1000);
    expect(parseAppleHealthDate('bad date')).toBeUndefined();
  });
});
