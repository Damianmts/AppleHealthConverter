import { parseAppleHealthDate } from './sleep';

export interface StepSample {
  startDate: string;
  endDate: string;
  value: string;
}

export interface StepPoint extends StepSample {
  start: number;
  end: number;
  count: number;
}

export function toStepPoint(sample: StepSample): StepPoint | undefined {
  const start = parseAppleHealthDate(sample.startDate);
  const end = parseAppleHealthDate(sample.endDate);
  const count = Number(sample.value);
  if (start === undefined || end === undefined || end < start || !Number.isFinite(count)) return undefined;
  return { ...sample, start, end, count };
}

export function getStepPointsInWindow(points: StepPoint[], start: number, end: number): StepPoint[] {
  return points.filter((point) => point.end >= start && point.start <= end);
}

/** Sum source counts for intervals that contain the inspected timestamp. */
export function getStepsAtTime(points: StepPoint[], timestamp: number): number {
  return points.filter((point) => point.start <= timestamp && point.end >= timestamp).reduce((total, point) => total + point.count, 0);
}

export function getTotalSteps(points: StepPoint[]): number {
  return points.reduce((total, point) => total + point.count, 0);
}
