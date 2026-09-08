import { useSyncExternalStore } from 'react'
import { isExtensionEnabled } from '@lifeboard/node-kit'
import { parseSnapshot, type HealthSnapshot } from '@lifeboard/health-core'

export interface HealthHost {
  load(): Promise<HealthSnapshot | null>
  loadPaused(): Promise<boolean>
  savePaused(paused: boolean): Promise<void>
  save(snapshot: HealthSnapshot): Promise<void>
  clear(): Promise<void>
  read(token: string): Promise<HealthServiceResult>
  configure(token: string, folder: string): Promise<HealthServiceResult>
  pickFolder(token: string): Promise<HealthServiceResult | null>
  export(snapshot: HealthSnapshot): Promise<void>
  restore(): Promise<HealthSnapshot | null>
}
export interface HealthServiceStatus { folder: string | null; checkedAt: string | null; files: number; incompatible: number; errors: string[]; ignored: string[] }
export interface HealthServiceResult { snapshot: unknown; status: HealthServiceStatus }
interface State {
  snapshot: HealthSnapshot | null
  busy: boolean
  connected: boolean
  error: string | null
  checkedAt: string | null
  files: number
  folder: string | null
  warnings: string[]
  paused: boolean
}
let host: HealthHost | null = null
let state: State = { snapshot: null, busy: false, connected: false, error: null, checkedAt: null, files: 0, folder: null, warnings: [], paused: false }
let token = ''
let generation = 0
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const getHealthState = () => state
export const useHealth = () => useSyncExternalStore(subscribe, getHealthState, getHealthState)
function publish(patch: Partial<State>) { state = { ...state, ...patch }; for (const fn of listeners) fn() }
export async function setHealthHost(next: HealthHost) {
  host = next
  const version = ++generation
  try {
    const [snapshot, paused] = await Promise.all([next.load(), next.loadPaused()])
    if (version === generation) publish({ snapshot: snapshot ? parseSnapshot(snapshot) : null, paused, busy: false, connected: false, error: null })
  } catch { if (version === generation) publish({ error: 'The offline health cache could not be read.' }) }
}
export function setHealthToken(value: string) { token = value.trim() }
export function setHealthPaused(paused: boolean) {
  ++generation
  publish({ paused, busy: false })
  void host?.savePaused(paused).catch(() => publish({ error: 'Refresh preference could not be saved.' }))
}
async function acceptResult(result: HealthServiceResult, version: number) {
  const snapshot = parseSnapshot(result.snapshot)
  if (version !== generation || state.paused || !isExtensionEnabled('lifeboard.health')) return
  const sameDataset = !state.snapshot || state.snapshot.datasetId === snapshot.datasetId
  if (!sameDataset && state.snapshot!.records.length > 0) {
    throw new Error('This service has a different health dataset. Clear the offline cache before connecting to it; existing cards keep their dataset references.')
  }
  if (sameDataset && state.snapshot && snapshot.revision < state.snapshot.revision) {
    throw new Error('The service has an older revision than your offline history. Restore the newer health backup into the service before reconnecting.')
  }
  if (!state.snapshot || !sameDataset || state.snapshot.revision !== snapshot.revision) {
    await host!.save(snapshot)
    if (version !== generation) return
    publish({ snapshot })
  }
  publish({ connected: true, error: null, checkedAt: result.status.checkedAt, files: result.status.files, folder: result.status.folder, warnings: [...result.status.errors, ...(result.status.incompatible ? [`Skipped ${result.status.incompatible} JSON ${result.status.incompatible === 1 ? 'file' : 'files'} that were not grouped by day.`] : []), ...result.status.ignored.map(name => `Skipped unsupported metric: ${name}`)] })
}
export async function refreshHealth(): Promise<void> {
  if (!host || state.busy || state.paused || !isExtensionEnabled('lifeboard.health')) return
  const version = ++generation
  publish({ busy: true })
  try {
    const result = await host.read(token)
    await acceptResult(result, version)
  } catch (error) {
    if (version === generation) publish({ connected: false, error: error instanceof Error ? error.message : 'Health service unavailable. Showing the offline cache.' })
  } finally { if (version === generation) publish({ busy: false }) }
}
async function configure(action: (current: HealthHost) => Promise<HealthServiceResult | null>) {
  if (!host || state.busy) return false
  await host.savePaused(false)
  const version = ++generation
  publish({ busy: true, paused: false, error: null })
  try {
    const result = await action(host)
    if (!result) return false
    await acceptResult(result, version)
    return true
  } catch (error) {
    if (version === generation) publish({ connected: false, error: error instanceof Error ? error.message : 'Could not configure the export folder.' })
    return false
  } finally { if (version === generation) publish({ busy: false }) }
}
export const configureHealthFolder = (folder: string) => configure(current => current.configure(token, folder))
export const chooseHealthFolder = () => configure(current => current.pickFolder(token))
export async function exportHealth() {
  if (host && state.snapshot) await host.export(state.snapshot)
}
export async function restoreHealth() {
  if (!host) return
  const snapshot = await host.restore()
  if (!snapshot) return
  const validated = parseSnapshot(snapshot)
  if (state.snapshot && state.snapshot.datasetId !== validated.datasetId) throw new Error('Clear the offline cache before restoring a different dataset.')
  setHealthPaused(true)
  await host.save(validated)
  publish({ snapshot: validated, paused: true, connected: false, busy: false, error: null, warnings: [] })
}
export async function clearHealth() {
  if (!host) return
  setHealthPaused(true)
  await host.clear()
  token = ''
  publish({ snapshot: null, connected: false, error: null, checkedAt: null, files: 0, warnings: [] })
}
