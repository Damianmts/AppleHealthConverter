import { Unzip, UnzipInflate } from 'fflate';
import { recordToCsv } from '../health/csv';
import { typeAndDateMatches } from '../health/filters';
import type { HealthRecord, ProcessingOptions, ProgressUpdate } from '../health/models';
import { getSleepDayKey, toSleepSegment, type SleepDay } from '../health/sleep';
import { AppleHealthXmlRecordParser } from '../health/xmlRecordParser';

type StartMessage = { kind: 'start'; file: File; options: ProcessingOptions };
type WorkerMessage = StartMessage | { kind: 'cancel' };

let cancelled = false;
const MAX_PREVIEW_RECORDS = 1_000;

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
  let csvRows: string[] = [];
  let previewRows: HealthRecord[] = [];
  let previewCount = 0;
  let vitalSamples: { typeKey: 'heartRateVariability' | 'restingHeartRate'; startDate: string; value: string }[] = [];
  let stepSamples: { startDate: string; endDate: string; value: string }[] = [];
  const sleepDays = new Map<string, SleepDay>();
  const selector = (typeKey: import('../health/appleHealthTypes').SupportedTypeKey, startDate: string) => typeAndDateMatches(typeKey, startDate, options);

  const storeRecord = (record: HealthRecord) => {
    csvRows.push(recordToCsv(record));
    if (record.typeKey === 'heartRateVariability' || record.typeKey === 'restingHeartRate') {
      vitalSamples.push({ typeKey: record.typeKey, startDate: record.startDate, value: record.value });
      return;
    }
    if (record.typeKey === 'stepCount') {
      stepSamples.push({ startDate: record.startDate, endDate: record.endDate, value: record.value });
      return;
    }
    if (record.typeKey === 'sleepAnalysis') {
      const segment = toSleepSegment(record);
      const dayKey = getSleepDayKey(segment);
      if (dayKey) {
        const day = sleepDays.get(dayKey) ?? { date: dayKey, segments: [] };
        day.segments.push(segment);
        sleepDays.set(dayKey, day);
      }
      return;
    }
    if (previewCount < MAX_PREVIEW_RECORDS) {
      previewRows.push(record);
      previewCount += 1;
    }
  };

  const flush = () => {
    if (csvRows.length) {
      postMessage({ kind: 'csv-chunk', text: `${csvRows.join('\r\n')}\r\n` });
      csvRows = [];
    }
    if (previewRows.length) {
      postMessage({ kind: 'preview-chunk', records: previewRows });
      previewRows = [];
    }
    if (vitalSamples.length) {
      postMessage({ kind: 'vital-chunk', samples: vitalSamples });
      vitalSamples = [];
    }
    if (stepSamples.length) {
      postMessage({ kind: 'step-chunk', samples: stepSamples });
      stepSamples = [];
    }
  };
  const report = (phase: ProgressUpdate['phase']) => {
    postMessage({ kind: 'progress', progress: { phase, bytesRead, totalBytes, recordsMatched } satisfies ProgressUpdate });
  };

  while (!cancelled) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    parser.push(decoder.decode(value, { stream: true }), (record) => {
      storeRecord(record);
      recordsMatched += 1;
      if (csvRows.length >= 500) flush();
    }, selector);
    report('parsing');
  }
  if (!cancelled) {
    parser.push(decoder.decode(), (record) => {
      storeRecord(record);
      recordsMatched += 1;
    }, selector);
    parser.finish();
    flush();
    if (sleepDays.size) postMessage({ kind: 'sleep-days', days: [...sleepDays.values()].sort((left, right) => right.date.localeCompare(left.date)) });
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
