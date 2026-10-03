import { Unzip, UnzipInflate } from 'fflate';
import { summaryRowToCsv } from '../health/csv';
import { addRecordToDailySummary, createDailySummary, createDailySummaryRows } from '../health/dailySummary';
import { intervalOverlapsDateRange, typeAndDateMatches } from '../health/filters';
import type { ProcessingOptions, ProgressUpdate } from '../health/models';
import { AppleHealthXmlRecordParser } from '../health/xmlRecordParser';

type StartMessage = { kind: 'start'; file: File; options: ProcessingOptions };
type WorkerMessage = StartMessage | { kind: 'cancel' };

let cancelled = false;

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  if (event.data.kind === 'cancel') {
    cancelled = true;
    return;
  }
  cancelled = false;
  void processFile(event.data.file, event.data.options).catch((error: unknown) => {
    postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'Onbekende verwerkingsfout.' });
  });
};

async function processFile(file: File, options: ProcessingOptions): Promise<void> {
  const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip';
  if (isZip) {
    await processZip(file, options);
  } else {
    await processXmlStream(file.stream(), file.size, options);
  }
  if (!cancelled) postMessage({ kind: 'complete' });
}

async function processXmlStream(stream: ReadableStream<Uint8Array>, totalBytes: number, options: ProcessingOptions): Promise<void> {
  const decoder = new TextDecoder('utf-8');
  const parser = new AppleHealthXmlRecordParser();
  const reader = stream.getReader();
  let bytesRead = 0;
  let recordsMatched = 0;
  const summary = createDailySummary();
  const selector = (typeKey: import('../health/appleHealthTypes').SupportedTypeKey, startDate: string, endDate: string) => {
    if (!options.selectedTypes.includes(typeKey)) return false;
    if (typeKey === 'stepCount') return intervalOverlapsDateRange(startDate, endDate, options);
    return typeAndDateMatches(typeKey, typeKey === 'sleepAnalysis' ? endDate : startDate, options);
  };
  const report = (phase: ProgressUpdate['phase']) => {
    postMessage({ kind: 'progress', progress: { phase, bytesRead, totalBytes, recordsMatched } satisfies ProgressUpdate });
  };

  while (!cancelled) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    parser.push(decoder.decode(value, { stream: true }), (record) => {
      addRecordToDailySummary(summary, record);
      recordsMatched += 1;
    }, selector);
    report('parsing');
  }
  if (!cancelled) {
    parser.push(decoder.decode(), (record) => {
      addRecordToDailySummary(summary, record);
      recordsMatched += 1;
    }, selector);
    parser.finish();
    const rows = createDailySummaryRows(summary, options.selectedTypes, options.startDate ?? '', options.endDate ?? '');
    postMessage({ kind: 'csv-chunk', text: `${rows.map(summaryRowToCsv).join('\r\n')}\r\n` });
    report('parsing');
  }
}

async function processZip(file: File, options: ProcessingOptions): Promise<void> {
  const reader = file.stream().getReader();
  let archiveBytesRead = 0;
  let exportFound = false;
  let xmlProcessing: Promise<void> | undefined;
  let xmlController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const xmlStream = new ReadableStream<Uint8Array>({ start(controller) { xmlController = controller; } });
  const unzip = new Unzip((entry) => {
    const normalizedName = entry.name.replaceAll('\\', '/').toLowerCase();
    if (!normalizedName.endsWith('export.xml') || exportFound) return;
    exportFound = true;
    xmlProcessing = processXmlStream(xmlStream, entry.originalSize ?? 0, options);
    entry.ondata = (error, data, final) => {
      if (error) {
        xmlController?.error(error);
        return;
      }
      if (cancelled) {
        entry.terminate();
        xmlController?.close();
        return;
      }
      xmlController?.enqueue(data);
      if (final) xmlController?.close();
    };
    entry.start();
  });
  unzip.register(UnzipInflate);

  while (!cancelled) {
    const { done, value } = await reader.read();
    if (done) break;
    archiveBytesRead += value.byteLength;
    postMessage({ kind: 'progress', progress: { phase: 'reading', bytesRead: archiveBytesRead, totalBytes: file.size, recordsMatched: 0 } satisfies ProgressUpdate });
    unzip.push(value, false);
  }
  unzip.push(new Uint8Array(), true);
  if (!exportFound) throw new Error('Dit ZIP-bestand bevat geen export.xml. Kies een standaard Apple Health-export of selecteer export.xml handmatig.');
  await xmlProcessing;
}
