# Apple Health integration audit

Updated 2026-09-08. Implementation uses daily Health Auto Export JSON summaries. All automated input is synthetic; no personal exports, access keys, or device accounts have been accessed.

## Contract and coverage

The parser supports the documented metric envelope, optional source, general `qty` rows, special heart-rate `Avg` summaries, and aggregated sleep. It normalizes supported units and validates caches/backups before rendering. Official references: [JSON metric format](https://help.healthyapps.dev/en/health-auto-export/export-format/health-metrics/) and [iCloud automation configuration](https://help.healthyapps.dev/en/health-auto-export/automations/icloud-drive/).

| Card | Import support | User's Zepp → Apple Health coverage |
|---|---|---|
| Steps | Daily count | Not yet verified |
| Active energy | kcal or kJ | Not yet verified |
| Resting energy | kcal or kJ | Not yet verified |
| Sleep | Daily total; optional core/deep/REM | Not yet verified |
| Weight | kg, lb/lbs, g; including `weight_&_body_mass` | Not yet verified |
| HRV | Apple Health SDNN field, ms/s | Not yet verified |
| Resting heart rate | bpm or count/min | Not yet verified |
| Heart rate | Daily Avg/qty | Not yet verified |
| Sleeping wrist temperature | °C/°F variants | Not yet verified |
| Body temperature | Separate from wrist temperature | Not yet verified |
| Blood oxygen | Percent/fraction | Not yet verified |
| Respiratory rate | breaths/min or count/min | Not yet verified |

PAI, HybridCharge/BioCharge, exertion/load, training status, sleep-apnea risk, and an overall “heart health” score are not implemented. Apple Health type availability does not establish that this device pair writes it. Unsupported groups are skipped; absent data is never converted to zero or a fabricated risk score.

## Automated verification

- Core tests: daily identities, date offsets/calendar weeks/DST, competing sources, unit normalization, malformed input, sleep total/stage consistency, missing values, backup validation.
- Service tests: repeated import, corrections, older-file ordering, empty exports, SQLite reopen, backup restore, stable nested file scans, invalid-file retry, HTTP authorization and origin restrictions.
- Extension tests: thirteen registered types and scalar props/migrations, image restrictions for health cards and containing frames, persisted refresh pause, wrong-dataset/older-revision rejection, and stale request completion after clearing cache.
- Production-browser test: synthetic export files → real scanner → SQLite → authenticated HTTP → settings → dashboard → change visualization → corrected export → offline browser reload. The production preview test relays the service through Playwright in place of Vite's development proxy. It does not simulate iCloud or an iPhone.
- Existing full unit suite passed before the final targeted refinements; workspace typecheck and production builds passed. The three failures in the initial full browser run were the new health test's selectors/save timing and two existing extension-count expectations; targeted reruns passed after correcting them.
- A separate synthetic smoke test started the real CLI with a temporary export/data directory, read the imported record through the actual Vite proxy, loaded the built app from the service, and verified that an unauthenticated API request received HTTP 401. Temporary processes/data were removed afterward.

Final relevant commands: `pnpm typecheck` (pass), `pnpm --filter @lifeboard/health-core test` (8 pass), `pnpm --filter @lifeboard/health test` (5 pass), `pnpm --filter @lifeboard/web exec vitest run src/persistence/health-snapshot.test.ts src/persistence/snapshot-fixtures.test.ts` (6 pass), and `LB_E2E_PORT=4279 pnpm --filter @lifeboard/web exec playwright test e2e/health.spec.ts` (pass, including production build). The final health schema fixture covers all thirteen types. `pnpm health --help` and `git diff --check` pass. Production build output retains the repository's existing foliate glob/chunk-size warnings.

The implementation does not claim validated deletion synchronization, native HealthKit authorization, actual iCloud delivery timing, unattended device export, or hosted deployment. These are outside what synthetic tests prove.

## First live check record (pending)

Record these locally once the exporter folder exists:

- iPhone/iOS, Health Auto Export version and settings, Zepp version, strap/watch firmware.
- Confirm which selected types contain readable records; compare a completed day with Apple Health using the same source selection.
- Confirm daily source metadata, date boundaries, sleep stages, and whether exported weight is a daily average.
- Observe a late sleep export, a corrected prior day, and Mac sleep/wake catching up.
- Backfill 30–90 days and confirm no duplicates or totals added across competing sources.

Do not copy original health payloads into this file. Add only coverage/configuration findings and synthetic contract fixtures to the repository.
