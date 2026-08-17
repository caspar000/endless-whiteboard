/**
 * Agent-bridge preferences: whether to connect at all, where, and with what secret.
 *
 * localStorage, like every other app-wide preference (see `canvasPrefs.tsx` for the pattern and the
 * rationale). **Off by default, and that is a security property, not a default someone picked**: the
 * bridge lets a process outside the browser drive your boards, so it has to be something you switch
 * on deliberately after starting the server, never something that is quietly already running.
 */

const ENABLED_KEY = 'lifeboard:agentEnabled'
const PORT_KEY = 'lifeboard:agentPort'
const TOKEN_KEY = 'lifeboard:agentToken'
const READ_ONLY_KEY = 'lifeboard:agentReadOnly'
const PRESENCE_KEY = 'lifeboard:agentPresence'

/** Matches the MCP server's own default. Nothing depends on the number beyond both ends agreeing. */
export const DEFAULT_AGENT_PORT = 8787

export interface AgentPrefs {
	enabled: boolean
	port: number
	/** The secret the server prints at startup. Empty means the bridge cannot connect. */
	token: string
	/**
	 * Offer only the operations that read.
	 *
	 * Free to implement because every operation already declares `readOnly` — which is exactly why
	 * that field defaults to "this mutates": a new operation that forgot to say is excluded here
	 * rather than quietly allowed through.
	 */
	readOnly: boolean
	/**
	 * Draw the agent's cursor on the board as it works.
	 *
	 * **On** by default, unlike everything else here — the others govern what an agent is allowed to
	 * do and default to the cautious answer; this one governs whether you can *see* it doing it, and
	 * the cautious answer there is to show it. Off is for demos and screen recordings.
	 */
	showPresence: boolean
}

function read(key: string): string | null {
	try {
		return localStorage.getItem(key)
	} catch {
		return null
	}
}

function write(key: string, value: string): void {
	try {
		localStorage.setItem(key, value)
	} catch {
		// Private-mode Safari can throw on write; losing the preference across reloads is fine.
	}
}

export function loadAgentPrefs(): AgentPrefs {
	const port = Number(read(PORT_KEY))
	return {
		enabled: read(ENABLED_KEY) === 'true',
		port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_AGENT_PORT,
		token: read(TOKEN_KEY) ?? '',
		readOnly: read(READ_ONLY_KEY) === 'true',
		// Absent means on: the default is "show me", and a user who has never opened Settings has not
		// asked to be kept in the dark.
		showPresence: read(PRESENCE_KEY) !== 'false',
	}
}

/**
 * A store rather than component state, because two places need these and only one of them is on
 * screen.
 *
 * The Settings panel *edits* them, but the bridge's lifecycle belongs to App — a connection that
 * only existed while you were looking at Settings would drop the moment you went back to a board,
 * which is exactly when an agent wants to work. So the panel writes here and App reads here.
 */
let prefs: AgentPrefs | null = null
const listeners = new Set<() => void>()

export function getAgentPrefs(): AgentPrefs {
	// Stable between changes: `useSyncExternalStore` re-renders forever if the snapshot is rebuilt.
	prefs ??= loadAgentPrefs()
	return prefs
}

export function subscribeToAgentPrefs(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function setAgentPrefs(next: AgentPrefs): void {
	prefs = next
	write(ENABLED_KEY, String(next.enabled))
	write(PORT_KEY, String(next.port))
	write(TOKEN_KEY, next.token)
	write(READ_ONLY_KEY, String(next.readOnly))
	write(PRESENCE_KEY, String(next.showPresence))
	for (const listener of listeners) listener()
}

/**
 * Always loopback. The bridge exists to talk to a server on this machine, and an address field would
 * turn "let my agent edit my boards" into "let anything on the network edit my boards" the first time
 * somebody pasted a hostname in to see what happened.
 */
export function agentUrl(prefs: AgentPrefs): string {
	return `ws://127.0.0.1:${prefs.port}`
}
