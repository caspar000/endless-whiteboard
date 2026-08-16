/**
 * Finding the agent host the dev server started for us.
 *
 * The panel's setup used to be: run a command, read a token off its banner, paste it into Settings.
 * All three steps existed only because the app had no way to learn where the host was — so the dev
 * server now starts it and answers that question directly (`vite/agentHost.ts`), and this asks.
 *
 * Nothing here is a fallback for the manual path; it *replaces* it in dev. The manual fields in
 * Settings remain for the case this cannot cover — a built app, where there is no dev server to own
 * a process — and for pointing the app at a stdio relay on purpose.
 */

const ENDPOINT = '/__lifeboard/agent-host'

export interface DevHost {
	port: number
	token: string
}

/**
 * How long to keep asking.
 *
 * The host is spawned when the dev server boots and the app usually loads after it is ready, but a
 * cold `node` start can lose that race. Polling briefly is the difference between the panel working
 * on first paint and the user having to reload for no reason they could name.
 */
const ATTEMPTS = 20
const INTERVAL_MS = 250

function isDevHost(value: unknown): value is DevHost {
	if (typeof value !== 'object' || value === null) return false
	const { port, token } = value as Record<string, unknown>
	return typeof port === 'number' && Number.isInteger(port) && port > 0 && typeof token === 'string' && token.length > 0
}

/**
 * Resolves with the host's details, or `null` if there is not going to be one.
 *
 * Never rejects: every caller's response to every failure is the same — leave the panel explaining
 * itself — so a thrown error would only be caught and discarded at the one call site.
 */
export async function discoverDevHost(signal?: AbortSignal): Promise<DevHost | null> {
	// `import.meta.env.DEV` is compiled to a constant, so this whole path — and the fetch below —
	// drops out of a production bundle rather than shipping a request that would always 404.
	if (!import.meta.env.DEV) return null

	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		if (signal?.aborted) return null

		try {
			const response = await fetch(ENDPOINT, { signal })

			if (response.ok) {
				const body: unknown = await response.json()
				return isDevHost(body) ? body : null
			}
			// 503 is "still starting"; anything else is terminal for this dev-server run, so stop
			// asking rather than poll a plugin that has already given up.
			if (response.status !== 503) return null
		} catch {
			// A network error here is the dev server restarting under us. Worth another go.
			if (signal?.aborted) return null
		}

		await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS))
	}

	return null
}

/**
 * What discovery found, as a store.
 *
 * Two places need it and only one of them looks for it: App runs the discovery and owns the bridge,
 * while Settings and the panel need to *say* that the connection is managed rather than configured.
 * Passing it down would mean threading a prop through the shell to explain a sentence.
 */
let current: DevHost | null = null
const listeners = new Set<() => void>()

export function getDevHost(): DevHost | null {
	return current
}

export function subscribeToDevHost(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function setDevHost(next: DevHost | null): void {
	current = next
	for (const listener of listeners) listener()
}
