import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { MAX_RECORDS, parseSnapshot, recordKey, type HealthSnapshot, type ImportResult } from '@lifeboard/health-core'

export class HealthDatabase {
  private db: DatabaseSync
  constructor(path: string, timezone: string) {
    new Intl.DateTimeFormat('en', { timeZone: timezone })
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, body TEXT NOT NULL, modified REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, hash TEXT NOT NULL);
    `)
    const version = this.get('version')
    if (version && version !== '1') { this.db.close(); throw new Error('Unsupported health database version.') }
    if (!version) {
      for (const [key, value] of Object.entries({ version: '1', datasetId: randomUUID(), revision: '0', timezone })) this.set(key, value)
    }
  }
  private get(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value
  }
  private set(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
  }
  hasFile(path: string, hash: string): boolean {
    return (this.db.prepare('SELECT hash FROM files WHERE path = ?').get(path) as { hash: string } | undefined)?.hash === hash
  }
  import(path: string, hash: string, modified: number, input: ImportResult): number {
    if (this.hasFile(path, hash)) return 0
    this.db.exec('BEGIN IMMEDIATE')
    let changes = 0
    try {
      const read = this.db.prepare('SELECT body, modified FROM records WHERE key = ?')
      const write = this.db.prepare('INSERT INTO records VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body=excluded.body, modified=excluded.modified')
      for (const row of input.records) {
        const key = recordKey(row)
        const body = JSON.stringify(row)
        const existing = read.get(key) as { body: string; modified: number } | undefined
        // A rescan of an older file must not roll back a newer file's confirmed bucket.
        if (existing && existing.modified > modified) continue
        if (!existing || existing.body !== body) changes++
        write.run(key, body, modified)
      }
      this.db.prepare('INSERT INTO files VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET hash=excluded.hash').run(path, hash)
      if ((this.db.prepare('SELECT count(*) AS n FROM records').get() as { n: number }).n > MAX_RECORDS) throw new Error('Health history exceeds the daily-record limit. Export a backup before starting a new dataset.')
      if (changes) {
        this.set('revision', String(Number(this.get('revision')) + 1))
        this.set('importedAt', new Date().toISOString())
      }
      this.db.exec('COMMIT')
      return changes
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  snapshot(): HealthSnapshot {
    const records = this.db.prepare('SELECT body FROM records ORDER BY key').all() as { body: string }[]
    return {
      version: 1, datasetId: this.get('datasetId')!, revision: Number(this.get('revision')),
      timezone: this.get('timezone')!, importedAt: this.get('importedAt') ?? null,
      records: records.map(row => JSON.parse(row.body)),
    }
  }
  /** Restore only into an empty dataset. Identity is retained so existing board references work. */
  restore(input: unknown): void {
    const snapshot = parseSnapshot(input)
    if ((this.db.prepare('SELECT count(*) AS n FROM records').get() as { n: number }).n !== 0) throw new Error('Restore requires an empty health data directory.')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of snapshot.records) this.db.prepare('INSERT INTO records VALUES (?, ?, 0)').run(recordKey(row), JSON.stringify(row))
      this.set('datasetId', snapshot.datasetId)
      this.set('timezone', snapshot.timezone)
      this.set('revision', String(snapshot.revision + 1))
      if (snapshot.importedAt) this.set('importedAt', snapshot.importedAt)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  close(): void { this.db.close() }
}
