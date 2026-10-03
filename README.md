# Apple Health Converter

Een kleine, volledig lokale webapp die gegevens uit een Apple Health-export omzet naar een leesbare CSV. Er is geen server, upload, cloudopslag, analytics of externe script nodig.

## Gebruik

1. Kies een Apple Health `.zip` of `export.xml`.
2. Kies de einddatum; de startdatum wordt automatisch 27 dagen eerder ingesteld.
3. Pas desgewenst de gegevenskeuze aan door het vak **Gegevens** vijf seconden ingedrukt te houden.
4. Kies **Verwerken** en sla daarna de CSV op.

De CSV bevat altijd dezelfde kolommen: categorie, datum, waarde en eenheid. Per geselecteerde categorie staat er voor iedere dag in de 28-daagse periode één regel, dus standaard 112 regels: 28 voor slaapduur, 28 voor stappen, 28 voor HRV en 28 voor rusthartslag. Ontbrekende metingen blijven als een lege waarde zichtbaar.

- **Slaapduur** is de volledige nacht die op die datum eindigt, in minuten. Overlappende slaapfasen worden niet dubbel geteld; `Awake` en `InBed` tellen niet mee.
- **Stappen** zijn dagtotalen. Apple Watch is leidend. Een iPhone-record telt alleen mee wanneer het volledig buiten een beschermingszone van zes minuten rond een Watch-record valt; zo worden vrijwel gelijke metingen van Watch en iPhone niet dubbel geteld. Een interval over middernacht wordt verdeeld over beide dagen.
- **HRV gemiddeld** is het gemiddelde van de HRV-metingen van die dag.
- **Rusthartslag** is de gemiddelde waarde wanneer Apple meer dan één rusthartslagmeting op een dag levert.

Velden zijn gequote en de CSV bevat een UTF-8 BOM, zodat deze goed leesbaar opent in Excel en andere spreadsheetprogramma's.

## Ondersteunde gegevens

| Gegeven | Apple Health identifier | CSV-type |
| --- | --- | --- |
| HRV (SDNN) | `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` | `heart_rate_variability_sdnn` |
| Rusthartslag | `HKQuantityTypeIdentifierRestingHeartRate` | `resting_heart_rate` |
| Stappen | `HKQuantityTypeIdentifierStepCount` | `step_count` |
| Slaap | `HKCategoryTypeIdentifierSleepAnalysis` | `sleep_analysis` |

De applicatie leest XML in stukken in een Web Worker. Zij bewaart alleen kleine dagtotalen, geen grafiek-, tabel- of volledige meetreeksen. Daardoor blijft zij ook bij grote Apple Health-exports zo licht mogelijk.

## Bouwen

```bash
npm install
npm test
npm run build
```

`npm run build` maakt één zelfstandig bestand: `dist/index.html`. Dat bestand kan op een desktop rechtstreeks in een moderne browser worden geopend; een server, installatie, `npm` of internetverbinding is niet nodig.
