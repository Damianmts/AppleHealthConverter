import { describe, expect, it } from 'vitest';
import { csvPreamble, escapeCsvField, recordToCsv } from './csv';
import type { HealthRecord } from './models';

describe('CSV exporter', () => {
  it('escapes quotes, commas and line breaks correctly', () => {
    expect(escapeCsvField('a,"b"\nnext')).toBe('"a,""b""\nnext"');
  });

  it('creates the documented header and one consistent record row', () => {
    const record: HealthRecord = {
      identifier: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN', typeKey: 'heartRateVariability', outputType: 'heart_rate_variability_sdnn',
      startDate: '2026-01-01 10:00:00 +0100', endDate: '', value: '42', unit: 'ms',
      sourceName: 'Watch, A', sourceVersion: '', device: ''
    };
    expect(csvPreamble()).toContain('type,start_date,end_date,value,unit,source_name,source_version,device');
    expect(recordToCsv(record)).toBe('"heart_rate_variability_sdnn","2026-01-01 10:00:00 +0100","","42","ms","Watch, A","",""');
  });
});
