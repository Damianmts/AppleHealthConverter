import type { AppleHealthIdentifier, SupportedTypeKey } from './appleHealthTypes';

export interface HealthRecord {
  identifier: AppleHealthIdentifier;
  typeKey: SupportedTypeKey;
  outputType: string;
  startDate: string;
  endDate: string;
  value: string;
  unit: string;
  sourceName: string;
  sourceVersion: string;
  device: string;
}

export interface ProcessingOptions {
  selectedTypes: SupportedTypeKey[];
  startDate?: string;
  endDate?: string;
}

export interface ProgressUpdate {
  phase: 'reading' | 'parsing';
  bytesRead: number;
  totalBytes: number;
  recordsMatched: number;
}
