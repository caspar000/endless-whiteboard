import { beforeEach, expect, it, vi } from 'vitest'
import type { HealthSnapshot } from '@lifeboard/health-core'
import { clearHealth, getHealthState, refreshHealth, restoreHealth, setHealthHost, setHealthPaused, type HealthHost } from './store'

vi.mock('@lifeboard/node-kit', () => ({ isExtensionEnabled: () => true }))
const snapshot: HealthSnapshot = { version: 1, datasetId: 'test', revision: 2, timezone: 'UTC', importedAt: null, records: [] }
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
    read: vi.fn(async () => ({ snapshot, status: { checkedAt: null, files: 1, errors: [], ignored: [] } })),
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
  cache = snapshot
  await setHealthHost(host)
  vi.mocked(host.read).mockResolvedValueOnce({ snapshot: { ...snapshot, datasetId: 'other' }, status: { checkedAt: null, files: 1, errors: [], ignored: [] } })
  await refreshHealth()
  expect(getHealthState().error).toContain('different health dataset')
  vi.mocked(host.read).mockResolvedValueOnce({ snapshot: { ...snapshot, revision: 1 }, status: { checkedAt: null, files: 1, errors: [], ignored: [] } })
  await refreshHealth()
  expect(getHealthState().error).toContain('older revision')
  expect(host.save).not.toHaveBeenCalled()
  expect(cache).toEqual(snapshot)
})
it('does not repopulate cleared history when an earlier request finishes late', async () => {
  let complete!: (value: Awaited<ReturnType<HealthHost['read']>>) => void
  vi.mocked(host.read).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  const pending = refreshHealth()
  await clearHealth()
  complete({ snapshot, status: { checkedAt: null, files: 1, errors: [], ignored: [] } })
  await pending
  expect(host.save).not.toHaveBeenCalled()
  expect(getHealthState()).toMatchObject({ snapshot: null, paused: true, busy: false })
})
