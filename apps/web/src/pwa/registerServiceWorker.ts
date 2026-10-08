import { registerSW } from 'virtual:pwa-register'

/**
 * Service-worker registration for the offline shell (§4.4 / milestone 8).
 *
 * `autoUpdate` would swap the app out from under someone mid-edit, so a new version waits instead.
 * Left to the browser, it waits until every Lifeboard tab is closed: a reload keeps the old one. So
 * the app says when a new version is ready (`isUpdateReady`), and moving to it is one click
 * (`reloadToUpdate`).
 */
let update: ((reloadPage?: boolean) => Promise<void>) | null = null
let ready = false
const listeners = new Set<() => void>()

export function registerServiceWorker(): void {
	if (import.meta.env.DEV) return
	update = registerSW({
		immediate: true,
		onNeedRefresh() {
			ready = true
			for (const listener of listeners) listener()
		},
	})
}

export const isUpdateReady = (): boolean => ready

export function subscribeToUpdate(listener: () => void): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/** Moves to the waiting version, which reloads the page; with none waiting, just reloads. */
export function reloadToUpdate(): void {
	if (update && ready) void update(true)
	else location.reload()
}
