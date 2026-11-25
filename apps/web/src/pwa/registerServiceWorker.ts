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

/** How often an app left open (an installed one can be, for days) asks whether there is a new version. */
const CHECK_EVERY = 60 * 60 * 1000

export function registerServiceWorker(): void {
	if (import.meta.env.DEV) return
	update = registerSW({
		immediate: true,
		onNeedRefresh() {
			ready = true
			for (const listener of listeners) listener()
		},
		// The browser looks for a new version when the app is opened, not while it stays open: an
		// installed app is mostly brought back from the background, so it also looks then, and hourly.
		onRegisteredSW(_url, registration) {
			if (!registration) return
			const check = () => {
				if (!ready && navigator.onLine && registration.installing === null) void registration.update().catch(() => {})
			}
			setInterval(check, CHECK_EVERY)
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'visible') check()
			})
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
	const move = update
	if (!move || !ready) return location.reload()
	// The new version only waits while a page is running the old one; with none waiting it is already
	// in charge, and `update` would wait for a hand-over that never comes.
	void navigator.serviceWorker.getRegistration().then((r) => (r?.waiting ? move(true) : location.reload()), () => location.reload())
}
