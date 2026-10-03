import { parseAppleHealthDate } from './sleep';
import type { SupportedTypeKey } from './appleHealthTypes';

export type VitalTypeKey = Extract<SupportedTypeKey, 'heartRateVariability' | 'restingHeartRate'>;

export interface VitalSample { typeKey: VitalTypeKey; startDate: string; value: string; }
export interface VitalPoint extends VitalSample { timestamp: number; numericValue: number; }

export function toVitalPoint(sample: VitalSample): VitalPoint | undefined {
  const timestamp = parseAppleHealthDate(sample.startDate);
  const numericValue = Number(sample.value);
  return timestamp === undefined || !Number.isFinite(numericValue) ? undefined : { ...sample, timestamp, numericValue };
}

export function vitalPointsInWindow(points: VitalPoint[], start: number, end: number): VitalPoint[] {
  return points.filter((point) => point.timestamp >= start && point.timestamp <= end);
}

export function closestVitalPoint(points: VitalPoint[], typeKey: VitalTypeKey, timestamp: number): VitalPoint | undefined {
  return points.filter((point) => point.typeKey === typeKey).reduce<VitalPoint | undefined>((closest, point) => !closest || Math.abs(point.timestamp - timestamp) < Math.abs(closest.timestamp - timestamp) ? point : closest, undefined);
}
