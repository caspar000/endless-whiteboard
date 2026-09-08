import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseAutoExport } from '@lifeboard/health-core'
import { HealthDatabase } from './database.ts'
import { createScanner } from './scanner.ts'
import { createHealthServer } from './server.ts'

const directories: string[] = []
const databases: HealthDatabase[] = []
afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'lifeboard-health-test-'))
  directories.push(dir)
  const db = new HealthDatabase(join(dir, 'health.sqlite'), 'Asia/Tbilisi')
  databases.push(db)
  return { dir, db }
}
const payload = (qty = 6000, metric = 'step_count') => ({ data: { metrics: [{ name: metric, units: 'count', data: [{ date: '2026-09-01', qty, source: 'Zepp' }] }] } })
describe('local service ingestion', () => {
  it('replays without duplication and replaces corrections without clearing unrelated history', async () => {
    const { db } = await setup()
    expect(db.import('one', 'hash1', 100, parseAutoExport(payload()))).toBe(1)
    expect(db.import('one', 'hash1', 100, parseAutoExport(payload()))).toBe(0)
    expect(db.snapshot().revision).toBe(1)
    db.import('one', 'hash2', 200, parseAutoExport(payload(6500)))
    db.import('older', 'hash3', 150, parseAutoExport(payload(3000)))
    db.import('empty', 'hash4', 300, { records: [], ignored: [] })
    expect(db.snapshot().records).toHaveLength(1)
    expect(db.snapshot().records[0]!.value).toBe(6500)
    expect(db.snapshot().revision).toBe(2)
  })
  it('persists identity/history and restores a backup into an empty service', async () => {
    const { dir, db } = await setup()
    db.import('one', 'hash', 100, parseAutoExport(payload()))
    const snapshot = db.snapshot()
    db.close(); databases.splice(databases.indexOf(db), 1)
    const reopened = new HealthDatabase(join(dir, 'health.sqlite'), 'UTC'); databases.push(reopened)
    expect(reopened.snapshot()).toEqual(snapshot)
    const second = await setup()
    second.db.restore(snapshot)
    expect(second.db.snapshot()).toMatchObject({ datasetId: snapshot.datasetId, records: snapshot.records })
    expect(() => second.db.restore(snapshot)).toThrow('empty')
  })
  it('waits for stable files, discovers nested files, retries partial JSON, and rescans corrections', async () => {
    const { dir, db } = await setup()
    const folder = join(dir, 'exports'); await mkdir(join(folder, '2026'), { recursive: true })
    const path = join(folder, '2026', 'daily.json')
    const scanner = createScanner(folder, db)
    async function save(text: string, age: number) { await writeFile(path, text); const time = new Date(Date.now() - age); await utimes(path, time, time) }
    await save('{', 60000)
    await scanner.scan()
    expect(db.snapshot().records).toHaveLength(0)
    expect((await scanner.scan()).errors).toHaveLength(1)
    await save(JSON.stringify(payload()), 40000)
    await scanner.scan(); await scanner.scan()
    expect(db.snapshot().records[0]!.value).toBe(6000)
    await save(JSON.stringify(payload(7200)), 20000)
    await scanner.scan(); await scanner.scan()
    expect(db.snapshot().records[0]!.value).toBe(7200)
    expect((await scanner.scan()).changed).toBe(0)
  })
  it('requires credentials and same-origin requests for health reads', async () => {
    const { dir, db } = await setup()
    const scanner = createScanner(dir, db)
    const server = createHealthServer({ database: db, scanner, token: 'secret-test-token' })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const url = `http://127.0.0.1:${address.port}/health/v1/snapshot`
    try {
      expect((await fetch(url)).status).toBe(401)
      expect((await fetch(url, { headers: { authorization: 'Bearer secret-test-token', origin: 'https://unrelated.example' } })).status).toBe(403)
      const response = await fetch(url, { headers: { authorization: 'Bearer secret-test-token' } })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toMatchObject({ snapshot: { datasetId: db.snapshot().datasetId } })
      expect((await fetch(url, { method: 'POST', headers: { authorization: 'Bearer secret-test-token' } })).status).toBe(405)
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  })
})
