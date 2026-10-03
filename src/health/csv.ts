export const CSV_HEADER = ['categorie', 'datum', 'waarde', 'eenheid'];

export interface CsvSummaryRow {
  category: string;
  date: string;
  value: string;
  unit: string;
}

export function escapeCsvField(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function summaryRowToCsv(row: CsvSummaryRow): string {
  return [row.category, row.date, row.value, row.unit].map(escapeCsvField).join(',');
}

export function csvPreamble(): string {
  // BOM makes UTF-8 CSV open correctly in common spreadsheet applications.
  return `\uFEFF${CSV_HEADER.join(',')}\r\n`;
}
