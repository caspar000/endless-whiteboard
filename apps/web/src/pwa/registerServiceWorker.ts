import { registerSW } from 'virtual:pwa-register'

/**
 * Service-worker registration for the offline shell (§4.4 / milestone 8).
 *
 * `autoUpdate` would swap the app out from under someone mid-edit. Because a board is a document
 * being actively edited, the new version is instead activated on the next load — the canvas is never
 * reloaded underneath unsaved interaction.
 */
export function registerServiceWorker(): void {
	if (import.meta.env.DEV) return
	registerSW({ immediate: true })
}
