import { MAX_FILE_BYTES, parseSnapshot } from '@lifeboard/health-core'
import type { HealthHost } from '@lifeboard/health'
import type { PlatformAdapter } from '../platform/PlatformAdapter'

/** Deliberately outside tldraw documents and the ordinary board backup. */
export const HEALTH_CACHE_KEY = 'lifeboard:health:daily:v1'
const HEALTH_PAUSED_KEY = 'lifeboard:health:paused:v1'
export function createHealthHost(platform: PlatformAdapter): HealthHost {
	// A clear requested during an in-flight refresh must finish after that refresh's cache write.
	let writes: Promise<void> = Promise.resolve()
	const enqueue = (run: () => Promise<void>) => { const pending = writes.then(run, run); writes = pending.catch(() => {}); return pending }
  return {
    async load() {
      const value = await platform.kv.get<unknown>(HEALTH_CACHE_KEY)
      return value ? parseSnapshot(value) : null
    },
    loadPaused: async () => (await platform.kv.get<boolean>(HEALTH_PAUSED_KEY)) === true,
    savePaused: paused => enqueue(() => platform.kv.set(HEALTH_PAUSED_KEY, paused)),
    save: snapshot => enqueue(() => platform.kv.set(HEALTH_CACHE_KEY, snapshot)),
    clear: () => enqueue(() => platform.kv.delete(HEALTH_CACHE_KEY)),
    read: token => platform.fetchHealthSnapshot(token),
    configure: (token, folder) => platform.configureHealthFolder(token, folder),
    pickFolder: token => platform.pickHealthFolder(token),
    export: snapshot => platform.saveFile(`lifeboard-health-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(snapshot)], { type: 'application/json' })),
    async restore() {
      const file = await platform.openFile(['.json'])
      if (!file) return null
      if (file.size > MAX_FILE_BYTES) throw new Error('Health backup exceeds 20 MiB.')
      return parseSnapshot(JSON.parse(await file.text()))
    },
  }
}
