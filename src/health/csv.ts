import type { HealthRecord } from './models';

export const CSV_HEADER = ['type', 'start_date', 'end_date', 'value', 'unit', 'source_name', 'source_version', 'device'];

export function escapeCsvField(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function recordToCsv(record: HealthRecord): string {
  return [record.outputType, record.startDate, record.endDate, record.value, record.unit, record.sourceName, record.sourceVersion, record.device]
    .map(escapeCsvField)
    .join(',');
}

export function csvPreamble(): string {
  // BOM makes UTF-8 CSV open correctly in common spreadsheet applications.
  return `\uFEFF${CSV_HEADER.join(',')}\r\n`;
}
