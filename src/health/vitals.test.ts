import { describe, expect, it } from 'vitest';
import { closestVitalPoint, toVitalPoint, vitalPointsInWindow } from './vitals';

describe('vital helpers', () => {
  it('parses all supported vital chart values', () => {
    expect(toVitalPoint({ typeKey: 'heartRateVariability', startDate: '2026-09-20 23:00:00 +0200', value: '42.5' })).toMatchObject({ numericValue: 42.5 });
  });
  it('filters and finds a nearest point per metric', () => {
    const points = [
      { typeKey: 'restingHeartRate' as const, startDate: '', value: '60', timestamp: 10, numericValue: 60 },
      { typeKey: 'restingHeartRate' as const, startDate: '', value: '64', timestamp: 20, numericValue: 64 }
    ];
    expect(vitalPointsInWindow(points, 10, 10)).toHaveLength(1);
    expect(closestVitalPoint(points, 'restingHeartRate', 18)?.numericValue).toBe(64);
  });
});
