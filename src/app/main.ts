import '../app/styles.css';
import { APPLE_HEALTH_TYPES, type SupportedTypeKey } from '../health/appleHealthTypes';
import { csvPreamble } from '../health/csv';
import { getStartDateFor28DayWindow, toDateInputValue } from '../health/dateRange';
import { validateDateRange } from '../health/filters';
import { getStepPointsInWindow, getStepsAtTime, getTotalSteps, toStepPoint, type StepPoint, type StepSample } from '../health/steps';
import { closestVitalPoint, toVitalPoint, vitalPointsInWindow, type VitalPoint, type VitalSample } from '../health/vitals';
import HealthProcessorWorker from '../workers/healthProcessor.worker.ts?worker&inline';
import type { ProcessingOptions, ProgressUpdate } from '../health/models';
import { getSleepStage, getTotalSleepMs, parseAppleHealthDate, type SleepDay } from '../health/sleep';

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
const results = document.querySelector<HTMLElement>('#results')!;
const resultsSummary = document.querySelector<HTMLParagraphElement>('#results-summary')!;
const resultsBody = document.querySelector<HTMLTableSectionElement>('#results-body')!;
const previousPageButton = document.querySelector<HTMLButtonElement>('#previous-page')!;
const nextPageButton = document.querySelector<HTMLButtonElement>('#next-page')!;
const pageStatus = document.querySelector<HTMLSpanElement>('#page-status')!;
const sleepResults = document.querySelector<HTMLElement>('#sleep-results')!;
const sleepHeading = document.querySelector<HTMLHeadingElement>('#sleep-heading')!;
const sleepSummary = document.querySelector<HTMLParagraphElement>('#sleep-summary')!;
const sleepLegend = document.querySelector<HTMLElement>('.sleep-legend')!;
const sleepDaysContainer = document.querySelector<HTMLDivElement>('#sleep-days')!;
const previousSleepPageButton = document.querySelector<HTMLButtonElement>('#previous-sleep-page')!;
const nextSleepPageButton = document.querySelector<HTMLButtonElement>('#next-sleep-page')!;
const sleepPageStatus = document.querySelector<HTMLSpanElement>('#sleep-page-status')!;

let csvParts: BlobPart[] = [];
let outputUrl: string | undefined;
let currentWorker: Worker | undefined;
let previewRows: PreviewRecord[] = [];
let previewPage = 0;
let totalMatchedRecords = 0;
let sleepDays: SleepDay[] = [];
let sleepPage = 0;
let vitalPoints: VitalPoint[] = [];
let stepPoints: StepPoint[] = [];
let activeSelectedTypes: SupportedTypeKey[] = [];
let activeStartDate = '';
let activeEndDate = '';
const PREVIEW_PAGE_SIZE = 100;
const MAX_PREVIEW_RECORDS = 1_000;
const SLEEP_PAGE_SIZE = 14;
const EXCLUSIVE_LONG_PRESS_MS = 600;
const DATA_TYPES_UNLOCK_PRESS_MS = 5_000;

type PreviewRecord = {
  outputType: string;
  startDate: string;
  endDate: string;
  value: string;
  unit: string;
  sourceName: string;
};

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
  if (!outputUrl) return;
  const link = document.createElement('a');
  link.href = outputUrl;
  link.download = 'apple-health-selected-data.csv';
  link.click();
});

previousPageButton.addEventListener('click', () => {
  previewPage -= 1;
  renderPreview();
});

nextPageButton.addEventListener('click', () => {
  previewPage += 1;
  renderPreview();
});

previousSleepPageButton.addEventListener('click', () => {
  sleepPage -= 1;
  renderSleepDays();
});

nextSleepPageButton.addEventListener('click', () => {
  sleepPage += 1;
  renderSleepDays();
});

window.addEventListener('pagehide', clearOutput);
window.addEventListener('resize', () => {
  if (!sleepResults.hidden) renderSleepDays();
});

function startProcessing(file: File, options: ProcessingOptions): void {
  currentWorker?.terminate();
  clearOutput();
  csvParts = [csvPreamble()];
  previewRows = [];
  previewPage = 0;
  totalMatchedRecords = 0;
  sleepDays = [];
  sleepPage = 0;
  vitalPoints = [];
  stepPoints = [];
  activeSelectedTypes = options.selectedTypes;
  activeStartDate = options.startDate ?? '';
  activeEndDate = options.endDate ?? '';
  results.hidden = true;
  sleepResults.hidden = true;
  processButton.disabled = true;
  downloadButton.disabled = true;
  fileInput.disabled = true;
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
  } else if (message.kind === 'preview-chunk') {
    previewRows.push(...(message.records as PreviewRecord[]));
  } else if (message.kind === 'sleep-days') {
    sleepDays = message.days as SleepDay[];
  } else if (message.kind === 'vital-chunk') {
    vitalPoints.push(...(message.samples as VitalSample[]).map(toVitalPoint).filter((point): point is VitalPoint => point !== undefined));
  } else if (message.kind === 'step-chunk') {
    stepPoints.push(...(message.samples as StepSample[]).map(toStepPoint).filter((point): point is StepPoint => point !== undefined));
  } else if (message.kind === 'progress') {
    renderProgress(message.progress as ProgressUpdate);
  } else if (message.kind === 'complete') {
    vitalPoints.sort((left, right) => left.timestamp - right.timestamp);
    stepPoints.sort((left, right) => left.start - right.start);
    outputUrl = URL.createObjectURL(new Blob(csvParts, { type: 'text/csv;charset=utf-8' }));
    csvParts = [];
    worker.terminate();
    currentWorker = undefined;
    processButton.disabled = false;
    fileInput.disabled = false;
    fileInput.value = '';
    downloadButton.disabled = false;
    progress.value = 100;
    setStatus('Klaar. De CSV staat alleen tijdelijk lokaal in het geheugen en kan nu worden opgeslagen.');
    if (previewRows.length) {
      results.hidden = false;
      renderPreview();
    }
    if (sleepDays.length) {
      sleepHeading.textContent = 'Slaap per dag';
      sleepLegend.hidden = false;
      sleepResults.hidden = false;
      renderSleepDays();
    } else if (vitalPoints.length || stepPoints.length) {
      sleepHeading.textContent = 'Gezondheidswaarden en stappen per dag';
      sleepLegend.hidden = true;
      sleepResults.hidden = false;
      renderVitalDays();
    }
  } else if (message.kind === 'error') {
    finishWithError(message.message as string);
  }
}

function renderProgress(update: ProgressUpdate): void {
  totalMatchedRecords = update.recordsMatched;
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
  results.hidden = true;
  sleepResults.hidden = true;
}

function clearOutput(): void {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = undefined;
  downloadButton.disabled = true;
  csvParts = [];
}

function renderPreview(): void {
  const pageCount = Math.max(1, Math.ceil(previewRows.length / PREVIEW_PAGE_SIZE));
  previewPage = Math.min(Math.max(0, previewPage), pageCount - 1);
  resultsBody.replaceChildren();
  for (const row of previewRows.slice(previewPage * PREVIEW_PAGE_SIZE, (previewPage + 1) * PREVIEW_PAGE_SIZE)) {
    const tableRow = document.createElement('tr');
    for (const value of [row.outputType, row.startDate, row.endDate, row.value, row.unit, row.sourceName]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      tableRow.append(cell);
    }
    resultsBody.append(tableRow);
  }
  const visible = previewRows.length.toLocaleString('nl-NL');
  const total = totalMatchedRecords.toLocaleString('nl-NL');
  resultsSummary.textContent = totalMatchedRecords > MAX_PREVIEW_RECORDS
    ? `De eerste ${visible} van ${total} geselecteerde records worden lokaal getoond. De CSV bevat alle records.`
    : `${total} geselecteerde records worden lokaal getoond.`;
  pageStatus.textContent = `Pagina ${previewPage + 1} van ${pageCount}`;
  previousPageButton.disabled = previewPage === 0;
  nextPageButton.disabled = previewPage >= pageCount - 1;
}

function renderSleepDays(): void {
  if (!sleepDays.length) {
    renderVitalDays();
    return;
  }
  const pageCount = Math.max(1, Math.ceil(sleepDays.length / SLEEP_PAGE_SIZE));
  sleepPage = Math.min(Math.max(0, sleepPage), pageCount - 1);
  sleepDaysContainer.replaceChildren();
  const visibleDays = sleepDays.slice(sleepPage * SLEEP_PAGE_SIZE, (sleepPage + 1) * SLEEP_PAGE_SIZE);
  for (const day of visibleDays) sleepDaysContainer.append(createSleepDay(day));
  sleepSummary.textContent = `${sleepDays.length.toLocaleString('nl-NL')} slaapdagen lokaal verwerkt. De totale slaapduur telt overlappende slaaprecords één keer.`;
  sleepPageStatus.textContent = `Pagina ${sleepPage + 1} van ${pageCount}`;
  previousSleepPageButton.disabled = sleepPage === 0;
  nextSleepPageButton.disabled = sleepPage >= pageCount - 1;
}

function renderVitalDays(): void {
  const dates = calendarDates(activeStartDate, activeEndDate);
  const pageCount = Math.max(1, Math.ceil(dates.length / SLEEP_PAGE_SIZE));
  sleepPage = Math.min(Math.max(0, sleepPage), pageCount - 1);
  sleepDaysContainer.replaceChildren();
  for (const date of dates.slice(sleepPage * SLEEP_PAGE_SIZE, (sleepPage + 1) * SLEEP_PAGE_SIZE)) {
    sleepDaysContainer.append(createVitalDay(date));
  }
  sleepSummary.textContent = 'Elke kaart loopt van 00:00 tot 00:00. Rusthartslag en HRV gebruiken elk hun eigen schaal. Stappen hebben een losse grafiek met dagtotaal.';
  sleepPageStatus.textContent = `Pagina ${sleepPage + 1} van ${pageCount}`;
  previousSleepPageButton.disabled = sleepPage === 0;
  nextSleepPageButton.disabled = sleepPage >= pageCount - 1;
}

function createVitalDay(date: string): HTMLElement {
  const start = new Date(`${date}T00:00:00`).getTime();
  const end = new Date(`${date}T23:59:59.999`).getTime();
  const card = document.createElement('article');
  card.className = 'sleep-card';
  const heading = document.createElement('h3');
  heading.textContent = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
  const visual = document.createElement('div');
  visual.className = 'sleep-visual';
  const tooltip = document.createElement('span');
  tooltip.className = 'timeline-tooltip';
  tooltip.hidden = true;
  const dayVitals = vitalPointsInWindow(vitalPoints, start, end);
  const daySteps = getStepPointsInWindow(stepPoints, start, end);
  const chart = dayVitals.length ? createVitalChart(dayVitals, start, end) : undefined;
  const ruler = document.createElement('span');
  ruler.className = 'time-ruler';
  ruler.hidden = true;
  visual.append(tooltip);
  if (chart) visual.append(chart.element);
  if (activeSelectedTypes.includes('stepCount')) visual.append(createStepChart(daySteps, start, end, 'Stappen per dag', true));
  visual.append(ruler);
  enableTimeScrubber(visual, ruler, tooltip, chart, dayVitals, daySteps, start, end);
  card.append(heading, visual);
  return card;
}

function calendarDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  if (!startDate || !endDate) return dates;
  const cursor = new Date(`${startDate}T12:00:00`);
  const last = new Date(`${endDate}T12:00:00`);
  while (cursor <= last) {
    dates.push(toDateInputValue(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates.reverse();
}

function createSleepDay(day: SleepDay): HTMLElement {
  const card = document.createElement('article');
  card.className = 'sleep-card';
  const heading = document.createElement('h3');
  heading.textContent = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${day.date}T12:00:00`));
  const duration = document.createElement('p');
  duration.className = 'sleep-duration';
  duration.textContent = `Slaapduur: ${formatDuration(getTotalSleepMs(day.segments))}`;
  const timeline = document.createElement('div');
  timeline.className = 'sleep-timeline';
  timeline.setAttribute('role', 'img');
  const intervals = day.segments
    .map((segment) => ({ ...segment, start: parseAppleHealthDate(segment.startDate), end: parseAppleHealthDate(segment.endDate) }))
    .filter((segment): segment is typeof segment & { start: number; end: number } => segment.start !== undefined && segment.end !== undefined && segment.end > segment.start);
  if (!intervals.length) {
    timeline.textContent = 'Geen geldige slaaptijden beschikbaar.';
    card.append(heading, duration, timeline);
    return card;
  }

  const start = Math.min(...intervals.map((segment) => segment.start));
  const end = Math.max(...intervals.map((segment) => segment.end));
  const range = end - start;
  timeline.setAttribute('aria-label', `Slaapvenster van ${formatTime(start)} tot ${formatTime(end)}`);
  const visual = document.createElement('div');
  visual.className = 'sleep-visual';
  const tooltip = document.createElement('span');
  tooltip.className = 'timeline-tooltip';
  tooltip.hidden = true;
  visual.append(tooltip);
  for (const segment of intervals) {
    const block = document.createElement('button');
    block.type = 'button';
    block.className = `sleep-block ${getSleepStage(segment.value)}`;
    block.style.left = `${((segment.start - start) / range) * 100}%`;
    block.style.width = `${Math.max(0.7, ((segment.end - segment.start) / range) * 100)}%`;
    const details = sleepSegmentTooltip(segment.value, segment.start, segment.end);
    block.title = details;
    block.setAttribute('aria-label', details);
    block.addEventListener('pointerenter', (event) => showTooltip(tooltip, visual, event.clientX, event.clientY, details));
    block.addEventListener('focus', () => showTooltip(tooltip, visual, visual.getBoundingClientRect().left + visual.clientWidth / 2, visual.getBoundingClientRect().top + 10, details));
    block.addEventListener('click', (event) => showTooltip(tooltip, visual, event.clientX, event.clientY, details));
    timeline.append(block);
  }

  const chartPoints = vitalPointsInWindow(vitalPoints, start, end);
  const steps = activeSelectedTypes.includes('stepCount') ? getStepPointsInWindow(stepPoints, start, end) : [];
  const chart = chartPoints.length ? createVitalChart(chartPoints, start, end) : undefined;
  if (chart) visual.append(chart.element);
  visual.append(timeline);
  if (activeSelectedTypes.includes('stepCount')) visual.append(createStepChart(steps, start, end));
  const ruler = document.createElement('span');
  ruler.className = 'time-ruler';
  ruler.hidden = true;
  visual.append(ruler);
  enableTimeScrubber(visual, ruler, tooltip, chart, chartPoints, steps, start, end);
  const labels = document.createElement('div');
  labels.className = 'sleep-times';
  labels.append(Object.assign(document.createElement('span'), { textContent: formatTime(start) }), Object.assign(document.createElement('span'), { textContent: formatTime(end) }));
  card.append(heading, duration, visual, labels);
  return card;
}

type VitalChart = { element: HTMLElement; draw: (cursorRatio?: number) => void };

function createVitalChart(points: VitalPoint[], start: number, end: number): VitalChart {
  const element = document.createElement('div');
  element.className = 'heart-chart';
  const label = document.createElement('p');
  label.className = 'heart-chart-label';
  label.textContent = 'Rusthartslag (oranje punten) · HRV (paarse lijn)';
  element.append(label);
  if (!points.length) {
    const empty = document.createElement('p');
    empty.className = 'heart-chart-empty';
    empty.textContent = 'Geen geselecteerde metingen in dit tijdvenster.';
    element.append(empty);
    return { element, draw: () => undefined };
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'heart-chart-canvas';
  canvas.setAttribute('aria-label', 'Rusthartslag en HRV tijdens de geselecteerde periode');
  element.append(canvas);

  const draw = (cursorRatio?: number) => {
    const width = Math.max(1, Math.floor(canvas.getBoundingClientRect().width));
    const height = 104;
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    const bpmPoints = points.filter((point) => point.typeKey !== 'heartRateVariability');
    const hrvPoints = points.filter((point) => point.typeKey === 'heartRateVariability');
    const minBpm = bpmPoints.length ? Math.floor(Math.min(...bpmPoints.map((point) => point.numericValue)) / 5) * 5 - 5 : 0;
    const maxBpm = bpmPoints.length ? Math.ceil(Math.max(...bpmPoints.map((point) => point.numericValue)) / 5) * 5 + 5 : 10;
    const bpmRange = Math.max(10, maxBpm - minBpm);
    const minHrv = hrvPoints.length ? Math.floor(Math.min(...hrvPoints.map((point) => point.numericValue)) / 5) * 5 - 5 : 0;
    const maxHrv = hrvPoints.length ? Math.ceil(Math.max(...hrvPoints.map((point) => point.numericValue)) / 5) * 5 + 5 : 10;
    const hrvRange = Math.max(10, maxHrv - minHrv);
    const topPadding = 8;
    const bottomPadding = 8;
    // De slaaptijdlijn gebruikt exact hetzelfde [start,end]-venster, zodat de
    // rusthartslag- en HRV-meetpunten met de slaapsegmenten uitlijnen.
    const chartWidth = width;
    const chartHeight = height - topPadding - bottomPadding;
    const x = (timestamp: number) => ((timestamp - start) / (end - start)) * chartWidth;
    const yBpm = (value: number) => topPadding + ((maxBpm - value) / bpmRange) * chartHeight;
    const yHrv = (value: number) => topPadding + ((maxHrv - value) / hrvRange) * chartHeight;
    context.strokeStyle = '#d9e2ec';
    context.lineWidth = 1;
    for (const ratio of [0, 0.5, 1]) {
      const lineY = topPadding + chartHeight * ratio;
      context.beginPath();
      context.moveTo(0, lineY);
      context.lineTo(width, lineY);
      context.stroke();
    }
    drawVitalSeries(context, points.filter((point) => point.typeKey === 'restingHeartRate'), x, yBpm, '#dc7b1f', [5, 4], false, 4);
    drawVitalSeries(context, hrvPoints, x, yHrv, '#6346c7', [], false, 3);
    if (cursorRatio !== undefined) {
      const cursorX = cursorRatio * chartWidth;
      context.strokeStyle = '#222';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(cursorX, topPadding);
      context.lineTo(cursorX, topPadding + chartHeight);
      context.stroke();
    }
  };
  window.requestAnimationFrame(() => draw());
  return { element, draw };
}

function drawVitalSeries(context: CanvasRenderingContext2D, points: VitalPoint[], x: (timestamp: number) => number, y: (value: number) => number, color: string, dash: number[] = [], smooth = true, markerRadius = 0): void {
  if (!points.length) return;
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.setLineDash(dash);
  context.beginPath();
  context.moveTo(x(points[0].timestamp), y(points[0].numericValue));
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (smooth) {
      context.quadraticCurveTo(x(previous.timestamp), y(previous.numericValue), (x(previous.timestamp) + x(current.timestamp)) / 2, (y(previous.numericValue) + y(current.numericValue)) / 2);
    } else {
      context.lineTo(x(current.timestamp), y(current.numericValue));
    }
  }
  context.lineTo(x(points.at(-1)!.timestamp), y(points.at(-1)!.numericValue));
  context.stroke();
  context.setLineDash([]);
  if (markerRadius) {
    for (const point of points) {
      context.beginPath();
      context.fillStyle = '#fff';
      context.arc(x(point.timestamp), y(point.numericValue), markerRadius + 1, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.fillStyle = color;
      context.arc(x(point.timestamp), y(point.numericValue), markerRadius, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function createStepChart(points: StepPoint[], start: number, end: number, labelText = 'Stappen tijdens slaap', showTotal = false): HTMLElement {
  const element = document.createElement('div');
  element.className = 'step-chart';
  const label = document.createElement('p');
  label.className = 'step-chart-label';
  label.textContent = showTotal ? `${labelText} — totaal: ${Math.round(getTotalSteps(points)).toLocaleString('nl-NL')}` : labelText;
  element.append(label);
  if (!points.length) {
    const empty = document.createElement('p');
    empty.className = 'step-chart-empty';
    empty.textContent = 'Geen geselecteerde stappen in dit slaapvenster.';
    element.append(empty);
    return element;
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'step-chart-canvas';
  canvas.setAttribute('aria-label', 'Stappen tijdens slaap');
  element.append(canvas);
  window.requestAnimationFrame(() => {
    const width = Math.max(1, Math.floor(canvas.getBoundingClientRect().width));
    const height = 52;
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#edf7ef';
    context.fillRect(0, 0, width, height);
    const maxSteps = Math.max(...points.map((point) => point.count), 1);
    for (const point of points) {
      const left = Math.max(0, ((point.start - start) / (end - start)) * width);
      const right = Math.min(width, ((point.end - start) / (end - start)) * width);
      const barWidth = Math.max(1, right - left);
      const barHeight = Math.max(2, (point.count / maxSteps) * (height - 8));
      context.fillStyle = '#248a3d';
      context.fillRect(left, height - barHeight - 3, barWidth, barHeight);
    }
  });
  return element;
}

function enableTimeScrubber(visual: HTMLElement, ruler: HTMLElement, tooltip: HTMLElement, chart: VitalChart | undefined, chartPoints: VitalPoint[], steps: StepPoint[], start: number, end: number): void {
  const inspect = (clientX: number, clientY: number) => {
    const bounds = visual.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    const timestamp = start + ratio * (end - start);
    ruler.hidden = false;
    ruler.style.left = `${ratio * 100}%`;
    chart?.draw(ratio);
    const resting = closestVitalPoint(chartPoints, 'restingHeartRate', timestamp);
    const hrv = closestVitalPoint(chartPoints, 'heartRateVariability', timestamp);
    const stepsAtTime = getStepsAtTime(steps, timestamp);
    const restingText = resting ? `Rust: ${resting.numericValue} bpm` : activeSelectedTypes.includes('restingHeartRate') ? 'Rust: geen meting' : '';
    const hrvText = hrv ? `HRV: ${hrv.numericValue} ms` : activeSelectedTypes.includes('heartRateVariability') ? 'HRV: geen meting' : '';
    const stepText = activeSelectedTypes.includes('stepCount')
      ? `Stappen: ${stepsAtTime.toLocaleString('nl-NL')}`
      : '';
    showTooltip(tooltip, visual, clientX, clientY, [`Tijd: ${formatTime(timestamp)}`, restingText, hrvText, stepText].filter(Boolean).join('\n'));
  };
  visual.addEventListener('pointermove', (event) => inspect(event.clientX, event.clientY));
  visual.addEventListener('pointerdown', (event) => inspect(event.clientX, event.clientY));
  visual.addEventListener('pointerleave', () => {
    ruler.hidden = true;
    tooltip.hidden = true;
    chart?.draw();
  });
}

function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.round(milliseconds / 60_000);
  return `${totalMinutes} min`;
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

function stageLabel(stage: ReturnType<typeof getSleepStage>): string {
  return ({ awake: 'Wakker', inBed: 'In bed', core: 'Kernslaap', deep: 'Diepe slaap', rem: 'REM-slaap', asleep: 'Slaap' })[stage];
}

function sleepSegmentTooltip(value: string, start: number, end: number): string {
  return `${stageLabel(getSleepStage(value))}\n${formatTime(start)}–${formatTime(end)} · ${formatDuration(end - start)}`;
}

function showTooltip(tooltip: HTMLElement, visual: HTMLElement, clientX: number, clientY: number, text: string): void {
  const bounds = visual.getBoundingClientRect();
  tooltip.textContent = text;
  tooltip.style.left = `${Math.min(Math.max(8, clientX - bounds.left + 12), Math.max(8, bounds.width - 180))}px`;
  tooltip.style.top = `${Math.min(Math.max(6, clientY - bounds.top + 12), Math.max(6, bounds.height - 62))}px`;
  tooltip.hidden = false;
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
    // Cancel the native post-long-press toggle and leave only this type checked.
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
