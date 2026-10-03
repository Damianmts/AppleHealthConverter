import { describe, expect, it } from 'vitest';
import { getStepPointsInWindow, getStepsAtTime, getTotalSteps, toStepPoint } from './steps';

describe('step helpers', () => {
  it('keeps valid Apple Health step intervals', () => {
    expect(toStepPoint({ startDate: '2026-09-20 23:00:00 +0200', endDate: '2026-09-20 23:01:00 +0200', value: '12' })).toMatchObject({ count: 12 });
    expect(toStepPoint({ startDate: 'bad', endDate: 'bad', value: '12' })).toBeUndefined();
  });

  it('finds overlapping intervals and counts movement at an inspected time', () => {
    const points = [
      { startDate: '', endDate: '', value: '4', start: 10, end: 20, count: 4 },
      { startDate: '', endDate: '', value: '6', start: 18, end: 30, count: 6 }
    ];
    expect(getStepPointsInWindow(points, 15, 25)).toHaveLength(2);
    expect(getStepsAtTime(points, 19)).toBe(10);
    expect(getTotalSteps(points)).toBe(10);
  });
});
