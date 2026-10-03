import { describe, expect, it } from 'vitest';
import { addRecordToDailySummary, createDailySummary, createDailySummaryRows } from './dailySummary';
import type { HealthRecord } from './models';

function record(typeKey: HealthRecord['typeKey'], startDate: string, endDate: string, value: string, sourceName = '', device = ''): HealthRecord {
  const definitions = {
    heartRateVariability: ['HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'heart_rate_variability_sdnn'],
    restingHeartRate: ['HKQuantityTypeIdentifierRestingHeartRate', 'resting_heart_rate'],
    stepCount: ['HKQuantityTypeIdentifierStepCount', 'step_count'],
    sleepAnalysis: ['HKCategoryTypeIdentifierSleepAnalysis', 'sleep_analysis']
  } as const;
  const [identifier, outputType] = definitions[typeKey];
  return { identifier, typeKey, outputType, startDate, endDate, value, unit: '', sourceName, sourceVersion: '', device };
}

describe('daily summary', () => {
  it('creates one daily row per selected category and keeps days without a measurement', () => {
    const summary = createDailySummary();
    addRecordToDailySummary(summary, record('stepCount', '2026-09-01 09:00:00 +0200', '2026-09-01 09:01:00 +0200', '120'));
    addRecordToDailySummary(summary, record('stepCount', '2026-09-01 12:00:00 +0200', '2026-09-01 12:01:00 +0200', '80'));
    addRecordToDailySummary(summary, record('heartRateVariability', '2026-09-02 09:00:00 +0200', '', '40'));
    addRecordToDailySummary(summary, record('heartRateVariability', '2026-09-02 12:00:00 +0200', '', '45'));

    expect(createDailySummaryRows(summary, ['stepCount', 'heartRateVariability'], '2026-09-01', '2026-09-02')).toEqual([
      { category: 'Stappen', date: '2026-09-01', value: '200', unit: 'stappen' },
      { category: 'Stappen', date: '2026-09-02', value: '', unit: 'stappen' },
      { category: 'HRV gemiddeld', date: '2026-09-01', value: '', unit: 'ms' },
      { category: 'HRV gemiddeld', date: '2026-09-02', value: '42.5', unit: 'ms' }
    ]);
  });

  it('uses an Apple Watch record first and rejects iPhone records in its six-minute protection zone', () => {
    const summary = createDailySummary();
    addRecordToDailySummary(summary, record('stepCount', '2026-09-01 09:00:00 +0200', '2026-09-01 10:00:00 +0200', '120', 'iPhone'));
    addRecordToDailySummary(summary, record('stepCount', '2026-09-01 09:30:00 +0200', '2026-09-01 10:00:00 +0200', '60', 'Apple Watch'));
    addRecordToDailySummary(summary, record('stepCount', '2026-09-01 10:00:00 +0200', '2026-09-01 10:30:00 +0200', '30', '', '<HKDevice: name:iPhone>'));
    addRecordToDailySummary(summary, record('stepCount', '2026-09-01 10:07:00 +0200', '2026-09-01 10:17:00 +0200', '40', 'iPhone'));

    expect(createDailySummaryRows(summary, ['stepCount'], '2026-09-01', '2026-09-01')).toEqual([
      { category: 'Stappen', date: '2026-09-01', value: '100', unit: 'stappen' }
    ]);
  });

  it('splits a step interval that crosses midnight across the two day totals', () => {
    const summary = createDailySummary();
    addRecordToDailySummary(summary, record('stepCount', '2026-09-01 23:30:00 +0200', '2026-09-02 00:30:00 +0200', '120', 'iPhone'));

    expect(createDailySummaryRows(summary, ['stepCount'], '2026-09-01', '2026-09-02')).toEqual([
      { category: 'Stappen', date: '2026-09-01', value: '60', unit: 'stappen' },
      { category: 'Stappen', date: '2026-09-02', value: '60', unit: 'stappen' }
    ]);
  });

  it('groups an entire sleep night by its end date and does not double-count overlapping stages', () => {
    const summary = createDailySummary();
    addRecordToDailySummary(summary, record('sleepAnalysis', '2026-09-01 23:00:00 +0200', '2026-09-02 03:00:00 +0200', 'HKCategoryValueSleepAnalysisAsleepCore'));
    addRecordToDailySummary(summary, record('sleepAnalysis', '2026-09-02 02:00:00 +0200', '2026-09-02 07:00:00 +0200', 'HKCategoryValueSleepAnalysisAsleepREM'));
    addRecordToDailySummary(summary, record('sleepAnalysis', '2026-09-02 07:00:00 +0200', '2026-09-02 07:30:00 +0200', 'HKCategoryValueSleepAnalysisAwake'));

    expect(createDailySummaryRows(summary, ['sleepAnalysis'], '2026-09-01', '2026-09-02')).toEqual([
      { category: 'Slaapduur', date: '2026-09-01', value: '', unit: 'min' },
      { category: 'Slaapduur', date: '2026-09-02', value: '480', unit: 'min' }
    ]);
  });
});
