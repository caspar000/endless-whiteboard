# Apple Health on your local Mac

The first version follows **iPhone → Health Auto Export → iCloud Drive → local SQLite service → Lifeboard**. It includes twelve metric cards, a weekly overview, chart choices, corrections, offline history, and separate health backups. Hevy and direct Zepp imports are outside this version.

## 1. Configure the iPhone export

In Health Auto Export, create an iCloud Drive automation named **Lifeboard**. Use these settings:

| Setting | Value |
|---|---|
| Data type | Health Metrics |
| Format / version | JSON / version 2 |
| Date range (file organization) | Day |
| Time grouping (within files) | Days |
| Summarize Data | On |
| Sleep aggregation | On |
| Preferred Sources | Choose a consistent source for each metric |
| Sync cadence | Daily to start |

Run a manual export covering seven completed days from the automation screen. Find its files under **iCloud Drive → AutoExport → Lifeboard** on your Mac and ensure they are downloaded. iOS background scheduling and a locked phone can delay export; daily sync is a target, not a guaranteed delivery time. See the [exporter's iCloud guide](https://help.healthyapps.dev/en/health-auto-export/automations/icloud-drive/).

Automatic export requires the exporter's Premium entitlement; no purchase or account configuration was performed for this implementation. See [Health Auto Export](https://healthyapps.dev/).

Select Steps, Active Energy, Basal Energy Burned, Sleep Analysis, Weight & Body Mass, Heart Rate Variability, Resting Heart Rate, Heart Rate, Apple Sleeping Wrist Temperature, Body Temperature, Blood Oxygen Saturation, and Respiratory Rate as available. Only fields readable from Apple Health can appear. PAI, HybridCharge, training status, Zepp exertion/load, and Zepp risk scores are not implemented or inferred from other readings.

This importer expects one daily row per metric and source. Multiple rows for the same identity are rejected instead of summed. Raw sleep segments and hourly exports need different processing and are unsupported. Sleep uses `totalSleep` (or `asleep`) once; in-bed time and stages are not added to the total. The parser follows the [documented JSON metric format](https://help.healthyapps.dev/en/health-auto-export/export-format/health-metrics/).

## 2. Start the local service and whiteboard

Use Node **24 or later** and the repository's pnpm version. Run commands from the repository root. First install dependencies:

```sh
pnpm install --frozen-lockfile
```

In one terminal, start the importer with the **actual absolute Finder path** to your automation folder. You can drag the folder into Terminal to obtain its escaped path; the Finder label “iCloud Drive” is not itself a filesystem path.

```sh
pnpm health --folder "/actual/absolute/path/to/AutoExport/Lifeboard" --timezone Asia/Tbilisi
```

In a second terminal:

```sh
pnpm dev
```

Open the local URL printed by Vite. In **Settings → Extensions → Apple Health**, choose **Connect / refresh**. The development server supplies the service key internally; leave the key field blank.

The service checks for files every five seconds and requires two stable scans before importing a changed file. The visible whiteboard refreshes once a minute, on focus/reconnection, or when explicitly refreshed. Allow time for iCloud delivery first. The settings page shows folder checks, errors, available dates, and sources.

On a board, open the command palette (⌘K), search for **Create Apple Health dashboard**, and run it. The overview and its six starter cards all show the previous Monday–Sunday. The node picker also offers twelve individual metric cards. Double-click a card to change its period, source, and visualization. Individually added metric cards default to the last 30 completed days.

Keep the importer terminal running to collect files while the board is closed. Closing the terminal stops it. When the Mac wakes or the importer restarts, it rescans existing exports. Automatic launch at login has not been installed.

### Optional configuration

The default service port is `8790`; data lives in `~/.lifeboard/health`. For another data directory or port, pass `--data-dir` / `--port` to the service and set matching `LIFEBOARD_HEALTH_DATA_DIR` / `LIFEBOARD_HEALTH_PORT` variables when starting `pnpm dev`.

The timezone sets rolling calendar boundaries and is retained with the dataset. Exported day labels remain exactly as exported; historical daily totals cannot be rebucketed into a different timezone without raw samples.

### Serving the built app locally

To run without Vite, build once and serve the output from the health process:

```sh
pnpm build
pnpm health --folder "/actual/absolute/path/to/AutoExport/Lifeboard" --web "$PWD/apps/web/dist"
```

Open `http://127.0.0.1:8790`. In Apple Health settings, enter the key from `~/.lifeboard/health/token` and connect. The key remains in browser memory; a reload requires entering it again to resume live reads. Cached history remains available. The service binds only to loopback.

Browser storage is specific to the URL origin. Moving from Vite to this URL requires restoring board and health backups if you want existing layouts and cached history there.

## 3. Check the data, then backfill

Compare one completed day's steps, active calories, sleep total, and any available weight/HRV/RHR with Apple Health using the same sources. Check the **Available history** table for absent metrics. Lack of records alone cannot distinguish missing data from denied read access.

If multiple named sources exist in a period, a metric card asks you to select one. The overview leaves ambiguous metrics blank. When the exporter omits source metadata, records are labelled **Export selection**; source deduplication then depends on your exporter's Preferred Sources setting. Use one authoritative automation and avoid mixing configurations into its folder.

After the first comparison, manually export the previous 30–90 days with the same settings into the same watched folder. History is retained in SQLite; the 7/30/90-day options only filter the view. There is no rolling deletion at 90 days. The first version caps history at 100,000 daily records, each input at 20 MiB, and scanning at 10,000 JSON files within five nested folder levels.

Step and energy cards total observed days. Sleep, HRV, heart rate, temperature, oxygen, and respiratory rate average observed daily values; these are means of daily summaries, not sample-weighted averages. Weight shows the latest available daily exported value, which may already be an exporter average. Coverage is displayed; missing days stay blank. Period comparisons appear only when both periods have complete daily coverage. Fixed dates continue to reflect corrected imports; they are not frozen reports.

## 4. Corrections, deletion, and backups

Re-export overlapping recent days after late device sync or an edit. Changed daily records replace the matching `(metric, date, source)` entry. Identical files and repeated records do not add duplicate totals. A newer file modification time takes precedence over an older one. This is a practical ordering heuristic: copying stale exports with a new modification time can still overwrite newer values. Keep one authoritative export configuration.

**Upstream deletion is not synchronized.** Removing a JSON file, omitting a row, or deleting a sample in Apple Health does not delete stored history. Daily exports do not contain reliable sample tombstones. To rebuild corrected history, export a fresh authoritative history into a clean folder, stop the old service, start a new data directory, clear the browser's old cache, connect, and explicitly reconnect existing cards to the new dataset. Keep the old data until the replacement has been reviewed.

Use **Export health backup** in the extension's settings to save normalized history. Ordinary board backups contain layout/configuration/dataset references and exclude health readings. A board can therefore show “another dataset” until its matching health backup is restored. Agent image requests containing health cards or their containing frames/groups are blocked; health values are not put in the node property system. Screenshots you share yourself still contain their visible readings.

**Restore health backup** loads a backup into this browser and pauses refresh until explicitly resumed, including across reloads. It preserves the dataset identity so existing cards work. Restoring another dataset requires clearing the existing browser cache first. Clearing the cache pauses refresh and does not remove service history or iCloud files.

To recover the local service, restore into a new, empty data directory:

```sh
pnpm health --folder "/actual/path/to/current/exports" --data-dir "/absolute/path/to/new-health-data" --restore "/absolute/path/to/lifeboard-health-backup.json"
```

Point the Vite proxy at that directory as described above. Service restore preserves dataset identity and advances its revision. Use current authoritative export files: subsequent scans can replace the restored daily values. The browser refuses an older service revision instead of silently replacing newer cached history.

The service stores SQLite and its access key under its data directory, outside the repository. Health JSON backups and exported files contain personal readings. No service key is included in a health or board backup.

## 5. Future self-hosting handoff

The daily model and node queries are independent of transport. Before hosting remotely, implement either an authenticated Mac-to-server uploader or an authenticated HTTPS receiver for the iPhone exporter. Retain the same dataset identity and revision rules. Deploy the API behind the whiteboard's authenticated origin and store SQLite on persistent storage; a Linux server cannot read this Mac's iCloud folder by itself.

The current service is a local read-only API, not a public ingestion endpoint. Hosted authentication, reverse-proxy policy, encrypted transport, retention/deletion controls, and deployment remain future work. See the selected-scope status and follow-up tasks in [the implementation handoff](health-integration-plan.md) and [validation audit](health-data-audit.md).
