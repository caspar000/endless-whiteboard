import { beforeEach, expect, it, vi } from 'vitest'
import type { HealthSnapshot } from '@lifeboard/health-core'
import { clearHealth, getHealthState, refreshHealth, restoreHealth, setHealthHost, setHealthPaused, type HealthHost } from './store'

vi.mock('@lifeboard/node-kit', () => ({ isExtensionEnabled: () => true }))
const snapshot: HealthSnapshot = { version: 1, datasetId: 'test', revision: 2, timezone: 'UTC', importedAt: null, records: [] }
const status = { folder: '/exports', checkedAt: null, files: 1, incompatible: 0, errors: [], ignored: [] }
let cache: HealthSnapshot | null
let paused: boolean
let host: HealthHost
beforeEach(async () => {
  cache = null
  paused = false
  host = {
    load: async () => cache, loadPaused: async () => paused,
    save: vi.fn(async value => { cache = value }), savePaused: async value => { paused = value },
    clear: async () => { cache = null },
    read: vi.fn(async () => ({ snapshot, status })),
    configure: vi.fn(async () => ({ snapshot, status })),
    pickFolder: vi.fn(async () => ({ snapshot, status })),
    export: async () => {}, restore: async () => snapshot,
  }
  await setHealthHost(host)
})
it('restores offline history and preserves pause across reloads until explicitly resumed', async () => {
  await restoreHealth()
  await setHealthHost(host)
  await refreshHealth()
  expect(host.read).not.toHaveBeenCalled()
  expect(getHealthState()).toMatchObject({ paused: true, snapshot })
  setHealthPaused(false)
  await refreshHealth()
  expect(getHealthState().connected).toBe(true)
})
it('refuses another dataset and an older service revision without overwriting cached history', async () => {
  const existing: HealthSnapshot = { ...snapshot, records: [{ metric: 'steps', day: '2026-09-01', value: 1, source: 'Zepp', timestamp: '2026-09-01', stages: null }] }
  cache = existing
  await setHealthHost(host)
  vi.mocked(host.read).mockResolvedValueOnce({ snapshot: { ...snapshot, datasetId: 'other' }, status })
  await refreshHealth()
  expect(getHealthState().error).toContain('different health dataset')
  vi.mocked(host.read).mockResolvedValueOnce({ snapshot: { ...snapshot, revision: 1 }, status })
  await refreshHealth()
  expect(getHealthState().error).toContain('older revision')
  expect(host.save).not.toHaveBeenCalled()
  expect(cache).toEqual(existing)
})
it('replaces an empty cache created before the local service was configured', async () => {
  cache = { ...snapshot, datasetId: 'empty-cache', revision: 20 }
  await setHealthHost(host)
  await refreshHealth()
  expect(getHealthState()).toMatchObject({ connected: true, snapshot })
  expect(cache).toEqual(snapshot)
})
it('does not repopulate cleared history when an earlier request finishes late', async () => {
  let complete!: (value: Awaited<ReturnType<HealthHost['read']>>) => void
  vi.mocked(host.read).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  const pending = refreshHealth()
  await clearHealth()
  complete({ snapshot, status })
  await pending
  expect(host.save).not.toHaveBeenCalled()
  expect(getHealthState()).toMatchObject({ snapshot: null, paused: true, busy: false })
})
