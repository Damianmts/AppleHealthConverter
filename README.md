# Apple Health Local Converter

Een kleine, statische webtool die geselecteerde gegevens uit een Apple Health-export naar CSV omzet. De applicatie heeft geen backend: het gekozen bestand wordt uitsluitend in de browser gelezen en de CSV wordt uitsluitend lokaal als download aangeboden.

## Starten en bouwen

```bash
npm install
npm test
npm run build
```

`npm run build` maakt één zelfstandig bestand: `dist/index.html`. Hernoem of kopieer dit desgewenst als `Apple-Health-Converter.html`. De ontvanger opent dit bestand rechtstreeks in Safari, Chrome of Edge; er is geen server, installatie, `npm` of internetverbinding nodig. Het bevat de scripts, styles en Worker al ingebed. De runtime doet geen `fetch`, XHR, WebSocket, analytics-, telemetry- of opslag-aanroepen. Er zijn geen CDN's, externe fonts of externe API's.

## Ontwerpkeuzes

- **Vanilla TypeScript + Vite:** licht en zonder framework-runtime.
- **Web Worker:** het lezen, uitpakken en parsen gebeurt buiten de UI-thread. De hoofdthread ontvangt alleen kleine CSV-blokken en voortgang.
- **Streaming XML:** `File.stream()` levert bytes in chunks. De parser bewaart hoogstens een nog niet afgesloten `Record`-element; het leest dus niet via `file.text()` en bouwt geen volledige XML-string op.
- **ZIP:** [`fflate`](https://github.com/101arrowz/fflate) is de enige runtimedependency. Hij wordt lokaal meegebundeld, ondersteunt streaming ZIP-invoer en is nodig omdat browsers geen native ZIP-container-API hebben. Alleen `export.xml` wordt uitgepakt; andere bestanden worden niet gedecomprimeerd.
- **CSV en inzage:** outputregels worden per 500 records naar de hoofdthread gestuurd. De eerste 1.000 geselecteerde records worden bovendien lokaal gepagineerd in een tabel getoond; dit voorkomt dat een telefoon vastloopt op honderdduizenden DOM-rijen. Voor de browserdownload is uiteindelijk wel een lokale `Blob` nodig; die tijdelijke output wordt bij een volgende verwerking of paginaverlaten vrijgegeven, inclusief de object-URL.

Apple Health-exporten bestaan uit XML met zelfsluitende `Record`-elementen met attributen zoals `type`, `sourceName`, `startDate`, `endDate`, `value` en `unit`. Apple documenteert HealthKit-typen als quantity- en category-typen, waaronder rusthartslag, HRV, stappen en slaapanalyse. Zie [Apple HealthKit data types](https://developer.apple.com/documentation/healthkit/data-types).

## Ondersteunde gegevens

| UI-naam | Apple Health identifier | CSV `type` |
| --- | --- | --- |
| HRV (SDNN) | `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` | `heart_rate_variability_sdnn` |
| Rusthartslag | `HKQuantityTypeIdentifierRestingHeartRate` | `resting_heart_rate` |
| Stappen | `HKQuantityTypeIdentifierStepCount` | `step_count` |
| Slaap | `HKCategoryTypeIdentifierSleepAnalysis` | `sleep_analysis` |

De mapping staat centraal in `src/health/appleHealthTypes.ts`. Niet-ondersteunde records worden gelezen noch opgeslagen in de uitvoer. Van geselecteerde records worden alleen `type`, `start_date`, `end_date`, `value`, `unit`, `source_name`, `source_version` en `device` geëxporteerd. Apple Health metadata, gebruiker-/profieldata, workouts en andere recordtypen worden weggegooid.

Datumfilters zijn inclusief en werken op de kalenderdatum van `startDate`. De gebruiker kiest alleen de einddatum; de startdatum is zichtbaar maar automatisch ingesteld op 27 dagen eerder, zodat samen met de einddatum precies 28 kalenderdagen worden meegenomen. Slaapwaarden worden onveranderd geëxporteerd (bijvoorbeeld een Apple `HKCategoryValueSleepAnalysis…`-waarde), zodat er geen interpretatie of aggregatie plaatsvindt.

De gegevenskeuze staat bij openen vergrendeld en grijs, zodat de gebruikelijke selectie niet per ongeluk verandert. Houd het vak **Gegevens** vijf seconden ingedrukt om de keuze te ontgrendelen. Daarna werkt een gewone klik op een vinkje normaal; houd een vinkje circa 0,6 seconde ingedrukt om exclusief dat datatype geselecteerd te laten.

In de browserweergave wordt slaap afzonderlijk per slaapdag getoond. Een slaapdag is de kalenderdatum waarop een slaapsegment eindigt. De tijdlijn gebruikt Apple-categoriewaarden voor de kleuren: wakker, in bed, kernslaap, diepe slaap en REM-slaap. De getoonde totale slaapduur staat in afgeronde minuten en is de unie van alle slaapsegmenten (dus exclusief `Awake` en `InBed`); overlappende records worden niet dubbel geteld. De originele, ongewijzigde waarden blijven in de CSV staan.

Beweeg over een slaapsegment (of tik/focus erop) voor een compacte tooltip bij de aanwijzer met fase, tijd en duur. Datum en tijdzone worden daar bewust weggelaten; de bronwaarden blijven ongewijzigd in de CSV beschikbaar.

Wanneer **Slaap** is geselecteerd, is slaap de leidende tijdas: rusthartslag en HRV staan boven iedere slaapbalk met exact dezelfde begin- en eindtijd. Beweeg, veeg of klik in die gecombineerde weergave om een verticale tijdlijn te plaatsen; de app toont dan het tijdstip en de dichtstbijzijnde oorspronkelijke rusthartslag- en HRV-meting. Zonder geselecteerde slaap loopt de weergave per kalenderdag van 00:00 tot 00:00. De grafiek wordt uitsluitend lokaal uit de geselecteerde export opgebouwd.

Wanneer ook **Stappen** is geselecteerd, verschijnt onder de slaapfasen een groene, op dezelfde tijdas uitgelijnde activiteitsbalk. De hoogte geeft de relatieve stapwaarde van een Apple-stappeninterval weer. De interactieve tijdlijn toont het aantal stappen in het Apple-interval dat het gekozen moment omvat, zodat beweging tijdens een `Awake`-fase zichtbaar is. Zonder geselecteerde slaap verschijnt per kalenderdag een losse stappengrafiek van 00:00 tot 00:00 met het totale aantal stappen uit de geselecteerde Apple-records.

## Privacy- en securitycontrole

- Geen servercode, database, API-client, analytics, telemetry, `localStorage` of IndexedDB.
- Geen codepad gebruikt `fetch`, `XMLHttpRequest` of `WebSocket`; een statische host kan na de initiële paginalaad offline gaan.
- Het bestand wordt door de browser aan de Worker gegeven, niet geüpload.
- Geselecteerde CSV-data bestaat alleen tijdelijk in het werkgeheugen om downloaden mogelijk te maken. Herladen/sluiten wist die tijdelijke staat en object-URLs worden gerevoked.
- De repository bevat uitsluitend synthetische XML-fixtures, nooit echte gezondheidsgegevens.

## Beperkingen

Deze versie is bewust een eerste lokale exporttool. De browser moet voldoende werkgeheugen hebben voor de uiteindelijke CSV-`Blob`; zeer grote selectie-uitvoer kan daarom op een iPhone/iPad mislukken of door Safari worden beëindigd. De browserweergave is daarom begrensd op de eerste 1.000 geselecteerde records; de CSV bevat altijd de volledige geselecteerde set. Houd de pagina open en het scherm actief totdat de download beschikbaar is. ZIP-exports met een niet-standaard compressiemethode of zonder `export.xml` worden afgewezen; kies dan handmatig `export.xml`.

`ReadableStream` is ook in Web Workers beschikbaar, wat chunkverwerking mogelijk maakt ([MDN Streams](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API)). Voor versie 1 is geen offline cache/PWA toegevoegd: een service worker zou cache-opslag introduceren zonder dat dit nodig is voor gegevensverwerking. De build kan wel lokaal of vanaf iedere statische host worden geopend en werkt na het laden zonder internet.

Logische volgende stappen zijn een end-to-end test met een bewust gemaakte ZIP-fixture, eventueel direct naar een gekozen bestand schrijven waar de browser File System Access API biedt, en live-acceptatietests op iOS/Safari met representatieve maar niet-persoonlijke exportgroottes.
