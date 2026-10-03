import '../app/styles.css';
import { APPLE_HEALTH_TYPES, type SupportedTypeKey } from '../health/appleHealthTypes';
import { csvPreamble } from '../health/csv';
import { getStartDateFor28DayWindow, toDateInputValue } from '../health/dateRange';
import { validateDateRange } from '../health/filters';
import type { ProcessingOptions, ProgressUpdate } from '../health/models';
import HealthProcessorWorker from '../workers/healthProcessor.worker.ts?worker&inline';

const form = document.querySelector<HTMLFormElement>('#converter-form')!;
const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const typeOptions = document.querySelector<HTMLDivElement>('#type-options')!;
const dataTypesFieldset = document.querySelector<HTMLFieldSetElement>('#data-types-fieldset')!;
const typeLockLabel = document.querySelector<HTMLSpanElement>('#type-lock-label')!;
const startDateInput = document.querySelector<HTMLInputElement>('#start-date')!;
const endDateInput = document.querySelector<HTMLInputElement>('#end-date')!;
const processButton = document.querySelector<HTMLButtonElement>('#process')!;
const downloadButton = document.querySelector<HTMLButtonElement>('#download')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const progress = document.querySelector<HTMLProgressElement>('#progress')!;

let csvParts: BlobPart[] = [];
let outputUrl: string | undefined;
let currentWorker: Worker | undefined;
const EXCLUSIVE_LONG_PRESS_MS = 600;
const DATA_TYPES_UNLOCK_PRESS_MS = 5_000;

for (const [key, type] of Object.entries(APPLE_HEALTH_TYPES) as [SupportedTypeKey, (typeof APPLE_HEALTH_TYPES)[SupportedTypeKey]][]) {
  const label = document.createElement('label');
  label.className = 'checkbox';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.name = 'types';
  checkbox.value = key;
  checkbox.checked = true;
  enableExclusiveLongPress(checkbox);
  label.append(checkbox, document.createTextNode(` ${type.label}`));
  typeOptions.append(label);
}
lockDataTypes();
enableDataTypesUnlock();

endDateInput.value = toDateInputValue(new Date());
syncStartDate();
endDateInput.addEventListener('input', syncStartDate);
startDateInput.addEventListener('keydown', (event) => event.preventDefault());
startDateInput.addEventListener('pointerdown', (event) => event.preventDefault());

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const file = fileInput.files?.[0];
  if (!file) return setStatus('Kies eerst een ZIP-bestand of export.xml.', true);

  const options: ProcessingOptions = {
    selectedTypes: Array.from(form.querySelectorAll<HTMLInputElement>('input[name="types"]:checked')).map((item) => item.value as SupportedTypeKey),
    startDate: startDateInput.value || undefined,
    endDate: endDateInput.value || undefined
  };
  const validation = validateDateRange(options);
  if (validation) return setStatus(validation, true);
  if (!options.selectedTypes.length) return setStatus('Selecteer minimaal één datatype.', true);
  startProcessing(file, options);
});

downloadButton.addEventListener('click', () => {
  downloadFile(outputUrl, 'apple-health-28-dagen.csv');
});

window.addEventListener('pagehide', clearOutput);

function startProcessing(file: File, options: ProcessingOptions): void {
  currentWorker?.terminate();
  clearOutput();
  csvParts = [csvPreamble()];
  processButton.disabled = true;
  fileInput.disabled = true;
  downloadButton.disabled = true;
  progress.hidden = false;
  progress.value = 0;
  setStatus('Bestand wordt lokaal gelezen…');

  const worker = new HealthProcessorWorker();
  currentWorker = worker;
  worker.onmessage = (event: MessageEvent) => handleWorkerMessage(event.data, worker);
  worker.onerror = () => finishWithError('De lokale verwerker kon niet worden gestart.');
  worker.postMessage({ kind: 'start', file, options });
}

function handleWorkerMessage(message: { kind: string; [key: string]: unknown }, worker: Worker): void {
  if (worker !== currentWorker) return;
  if (message.kind === 'csv-chunk') {
    csvParts.push(message.text as string);
  } else if (message.kind === 'progress') {
    renderProgress(message.progress as ProgressUpdate);
  } else if (message.kind === 'complete') {
    outputUrl = URL.createObjectURL(new Blob(csvParts, { type: 'text/csv;charset=utf-8' }));
    csvParts = [];
    worker.terminate();
    currentWorker = undefined;
    processButton.disabled = false;
    fileInput.disabled = false;
    fileInput.value = '';
    downloadButton.disabled = false;
    progress.value = 100;
    setStatus('Klaar. De CSV kan nu worden opgeslagen.');
  } else if (message.kind === 'error') {
    finishWithError(message.message as string);
  }
}

function renderProgress(update: ProgressUpdate): void {
  const percent = update.totalBytes > 0 ? Math.min(99, Math.round((update.bytesRead / update.totalBytes) * 100)) : 0;
  progress.value = percent;
  const phase = update.phase === 'reading' ? 'ZIP-bestand lezen' : 'XML-records verwerken';
  setStatus(`${phase}: ${percent}% — ${update.recordsMatched.toLocaleString('nl-NL')} geselecteerde records.`);
}

function finishWithError(message: string): void {
  currentWorker?.terminate();
  currentWorker = undefined;
  csvParts = [];
  processButton.disabled = false;
  fileInput.disabled = false;
  fileInput.value = '';
  progress.hidden = true;
  setStatus(message, true);
}

function clearOutput(): void {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = undefined;
  downloadButton.disabled = true;
  csvParts = [];
}

function downloadFile(url: string | undefined, name: string): void {
  if (!url) return;
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
}

function setStatus(message: string, isError = false): void {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function enableExclusiveLongPress(checkbox: HTMLInputElement): void {
  let timer: number | undefined;
  let longPressTriggered = false;
  const clearTimer = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };
  checkbox.addEventListener('pointerdown', () => {
    longPressTriggered = false;
    timer = window.setTimeout(() => {
      longPressTriggered = true;
      checkbox.closest('label')?.classList.add('long-press-active');
      selectOnlyType(checkbox);
    }, EXCLUSIVE_LONG_PRESS_MS);
  });
  checkbox.addEventListener('pointerup', clearTimer);
  checkbox.addEventListener('pointercancel', clearTimer);
  checkbox.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') clearTimer();
  });
  checkbox.addEventListener('contextmenu', (event) => {
    if (longPressTriggered) event.preventDefault();
  });
  checkbox.addEventListener('click', (event) => {
    checkbox.closest('label')?.classList.remove('long-press-active');
    if (!longPressTriggered) return;
    event.preventDefault();
    selectOnlyType(checkbox);
    longPressTriggered = false;
  });
}

function selectOnlyType(selected: HTMLInputElement): void {
  for (const checkbox of form.querySelectorAll<HTMLInputElement>('input[name="types"]')) {
    checkbox.checked = checkbox === selected;
  }
}

function lockDataTypes(): void {
  for (const checkbox of form.querySelectorAll<HTMLInputElement>('input[name="types"]')) {
    checkbox.disabled = true;
  }
  dataTypesFieldset.classList.add('data-types-locked');
  dataTypesFieldset.classList.remove('data-types-unlocked');
  typeLockLabel.textContent = '(vergrendeld)';
}

function enableDataTypesUnlock(): void {
  let timer: number | undefined;
  let unlocked = false;
  const cancel = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    dataTypesFieldset.classList.remove('data-types-unlocking');
  };
  const unlock = () => {
    unlocked = true;
    cancel();
    for (const checkbox of form.querySelectorAll<HTMLInputElement>('input[name="types"]')) {
      checkbox.disabled = false;
    }
    dataTypesFieldset.classList.remove('data-types-locked');
    dataTypesFieldset.classList.add('data-types-unlocked');
    typeLockLabel.textContent = '(aanpasbaar)';
  };
  dataTypesFieldset.addEventListener('pointerdown', () => {
    if (unlocked) return;
    dataTypesFieldset.classList.add('data-types-unlocking');
    timer = window.setTimeout(unlock, DATA_TYPES_UNLOCK_PRESS_MS);
  });
  dataTypesFieldset.addEventListener('pointerup', cancel);
  dataTypesFieldset.addEventListener('pointercancel', cancel);
  dataTypesFieldset.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') cancel();
  });
}

function syncStartDate(): void {
  startDateInput.value = getStartDateFor28DayWindow(endDateInput.value) ?? '';
}
