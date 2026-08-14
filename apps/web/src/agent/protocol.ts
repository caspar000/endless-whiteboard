import type { OperationManifestEntry, OperationResult } from '@lifeboard/node-kit'

/**
 * What the app and the MCP server say to each other.
 *
 * Deliberately tiny: the server is a relay, not a participant. It never knows what an operation
 * *means* — it forwards a name and a bag of arguments, and passes back whatever came out. Everything
 * that understands boards stays in the app, which is where the live editor is.
 *
 * Nothing off a socket is trusted. `parseServerMessage` below is the only way a message becomes a
 * typed value, and it returns `null` for anything it does not recognise — a local WebSocket is
 * reachable by any page the browser has open, so a malformed frame is an expected input rather than
 * an impossible one.
 */

/** The protocol revision. Bumped when a message shape changes incompatibly. */
export const AGENT_PROTOCOL_VERSION = 1

// --- app → server ---------------------------------------------------------

export interface HelloMessage {
	type: 'hello'
	version: number
	/** The shared secret the server printed at startup and the user pasted into Settings. */
	token: string
	operations: OperationManifestEntry[]
}

export interface ResultMessage {
	type: 'result'
	/** Echoes the `invoke` this answers. */
	id: number
	result: OperationResult
}

/** Sent when the offered set changes — an extension toggled on or off mid-session. */
export interface ManifestMessage {
	type: 'manifest'
	operations: OperationManifestEntry[]
}

export type ClientMessage = HelloMessage | ResultMessage | ManifestMessage

// --- server → app ---------------------------------------------------------

export interface InvokeMessage {
	type: 'invoke'
	id: number
	operation: string
	args: unknown
}

/** The server accepted the token. Until this arrives the app treats itself as unauthenticated. */
export interface WelcomeMessage {
	type: 'welcome'
	version: number
}

/** The server rejected us — a bad token, or a version it cannot speak. */
export interface RejectedMessage {
	type: 'rejected'
	reason: string
}

export type ServerMessage = InvokeMessage | WelcomeMessage | RejectedMessage

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Turns a raw frame into a message, or `null`.
 *
 * `null` covers every failure the same way — unparseable JSON, an unknown type, a field of the wrong
 * type — because the caller's response to all of them is identical: ignore the frame. Distinguishing
 * them would only invite handling them differently, and there is nothing useful to do differently.
 */
export function parseServerMessage(raw: unknown): ServerMessage | null {
	if (typeof raw !== 'string') return null

	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (!isRecord(parsed)) return null

	switch (parsed.type) {
		case 'invoke':
			if (typeof parsed.id !== 'number' || !Number.isFinite(parsed.id)) return null
			if (typeof parsed.operation !== 'string' || !parsed.operation) return null
			// `args` is deliberately unvalidated here: `runOperation` validates it against the
			// operation's declared params, which is the only place that knows what "valid" means.
			return { type: 'invoke', id: parsed.id, operation: parsed.operation, args: parsed.args }
		case 'welcome':
			return { type: 'welcome', version: typeof parsed.version === 'number' ? parsed.version : 0 }
		case 'rejected':
			return {
				type: 'rejected',
				reason: typeof parsed.reason === 'string' ? parsed.reason : 'The server refused the connection.',
			}
		default:
			return null
	}
}

export function encode(message: ClientMessage): string {
	return JSON.stringify(message)
}
