# Apple Health setup

Lifeboard reads daily JSON files created by **Health Auto Export**. The importer starts automatically with Lifeboard during local development.

## On your iPhone

In Health Auto Export, create an **iCloud Drive** automation:

- Data: **Health Metrics**
- Format: **JSON, Version 2**
- Date Range: **Day**
- Time Grouping: **Days**
- Summarize Data: **On**
- Choose the metrics and Preferred Sources you want

Run a manual seven-day export once, then enable its automatic schedule.

## In Lifeboard

1. Start Lifeboard with `pnpm dev`.
2. Open **Settings → Extensions → Apple Health**.
3. Select **Choose folder…** and choose the folder Health Auto Export created in iCloud Drive.
4. Select **Scan now** whenever you want an immediate refresh.
5. On a board, run **Create Apple Health dashboard** from the command palette.

Lifeboard accepts any JSON filename and searches dated subfolders. Files with raw/hourly samples are skipped; day-grouped files are imported. Automatic iPhone exports can be delayed while the phone is locked.

Health readings are stored locally in SQLite and cached in the browser for offline viewing. Board backups contain card layouts but no readings, so use **Export health backup** in Apple Health settings when you want a data backup too.
