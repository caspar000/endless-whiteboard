# Apple Health integration audit

Updated 2026-09-08. Implementation uses daily Health Auto Export JSON summaries. The user's iCloud files were inspected for filenames and JSON structure without copying readings into the repository or test fixtures.

## Real export check

The Health Auto Export iCloud container contains a `Daily Health Backup` folder with custom names including `Aut-2026-09-07.json`, `AutoEx-2026-09-08.json`, and `AutoExport-YYYY-MM-DD.json`. Filenames are therefore treated as opaque. Seven `AutoExport` files passed the importer as daily summaries. The two shortened-prefix files contain intraday samples and are now reported as incompatible rather than blocking the folder. The daily files confirm the documented Version 2 envelope and field names for active energy, blood oxygen, heart rate, HRV, respiratory rate, resting heart rate, sleep, and steps. No health values are recorded here.

The same iCloud container also has an `AutoSync/HealthMetrics` tree of per-metric `.hae` files used by Health Auto Export's separate Mac-sync mechanism. `.hae` is a private binary format and is not imported. Choosing `Daily Health Backup`, or a parent folder containing it, imports the JSON automation output and ignores `.hae` files.

## Contract and coverage

The parser supports the documented metric envelope, optional source, general `qty` rows, special heart-rate `Avg` summaries, and aggregated sleep. It normalizes supported units and validates caches/backups before rendering. Official references: [JSON metric format](https://help.healthyapps.dev/en/health-auto-export/export-format/health-metrics/) and [iCloud automation configuration](https://help.healthyapps.dev/en/health-auto-export/automations/icloud-drive/).

| Card | Import support | User's Zepp → Apple Health coverage |
|---|---|---|
| Steps | Daily count | JSON structure verified |
| Active energy | kcal or kJ | JSON structure verified |
| Resting energy | kcal or kJ | Not yet verified |
| Sleep | Daily total; optional core/deep/REM | JSON structure verified |
| Weight | kg, lb/lbs, g; including `weight_&_body_mass` | Not yet verified |
| HRV | Apple Health SDNN field, ms/s | JSON structure verified |
| Resting heart rate | bpm or count/min | JSON structure verified |
| Heart rate | Daily Avg/qty | JSON structure verified |
| Sleeping wrist temperature | °C/°F variants | Not yet verified |
| Body temperature | Separate from wrist temperature | Not yet verified |
| Blood oxygen | Percent/fraction | JSON structure verified |
| Respiratory rate | breaths/min or count/min | JSON structure verified |

PAI, HybridCharge/BioCharge, exertion/load, training status, sleep-apnea risk, and an overall “heart health” score are not implemented. Apple Health type availability does not establish that this device pair writes it. Unsupported groups are skipped; absent data is never converted to zero or a fabricated risk score.

## Automated verification

- Core tests: daily identities, date offsets/calendar weeks/DST, competing sources, unit normalization, malformed input, sleep total/stage consistency, missing values, backup validation.
- Service tests: repeated import, corrections, older-file ordering, empty exports, SQLite reopen, backup restore, stable nested file scans, invalid-file retry, HTTP authorization and origin restrictions.
- Extension tests: thirteen registered types and scalar props/migrations, image restrictions for health cards and containing frames, persisted refresh pause, wrong-dataset/older-revision rejection, and stale request completion after clearing cache.
- Production-browser test: synthetic export files → real scanner → SQLite → authenticated HTTP → settings → dashboard → change visualization → corrected export → offline browser reload. The production preview test relays the service through Playwright in place of Vite's development proxy. It does not simulate iCloud or an iPhone.
- The final full workspace unit suite passed: 114 test files and 1,366 tests. Workspace typecheck, the production build, and the health browser test also passed.
- A separate synthetic smoke test started the real CLI with a temporary export/data directory, read the imported record through the actual Vite proxy, loaded the built app from the service, and verified that an unauthenticated API request received HTTP 401. Temporary processes/data were removed afterward.

Final relevant commands: `pnpm test` (1,366 pass), `pnpm typecheck` (pass), and `LB_E2E_PORT=4279 pnpm --filter @lifeboard/web exec playwright test e2e/health.spec.ts` (pass, including production build). The final health schema fixture covers all thirteen types. `pnpm health --help` and `git diff --check` pass. Production build output retains the repository's existing foliate glob/chunk-size warnings.

The implementation does not claim that the displayed readings have been compared against Apple Health, or validated for deletion synchronization, native HealthKit authorization, unattended delivery, or hosted deployment. Those are outside what the schema check proves.

## Remaining live accuracy check

Record these after opening the first dashboard:

- iPhone/iOS, Health Auto Export version and settings, Zepp version, strap/watch firmware.
- Compare a completed day with Apple Health using the same source selection.
- Confirm date boundaries, sleep stages, and whether any later weight export is a daily average.
- Observe a late sleep export, a corrected prior day, and Mac sleep/wake catching up.
- Backfill 30–90 days and confirm no duplicates or totals added across competing sources.

Do not copy original health payloads into this file. Add only coverage/configuration findings and synthetic contract fixtures to the repository.
