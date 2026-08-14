/**
 * The wire format, as the server sees it.
 *
 * Deliberately a **structural duplicate** of `apps/web/src/agent/protocol.ts` rather than a shared
 * import. The app's copy is TypeScript compiled by vite with `moduleResolution: bundler`; this
 * package is compiled by `tsc` for Node under `nodenext`, and importing across that boundary would
 * drag React and tldraw into a Node build to get four interfaces. The types are small, the wire
 * format is versioned, and `AGENT_PROTOCOL_VERSION` is checked on every handshake — so a drift
 * between the two copies is caught at connect time rather than becoming a silent mismatch.
 *
 * If you change anything here, change the app's copy and bump the version.
 */

export const AGENT_PROTOCOL_VERSION = 1

/** One operation, as the app describes it. Mirrors node-kit's `OperationManifestEntry`. */
export interface OperationManifestEntry {
	id: string
	title: string
	description: string
	readOnly: boolean
	inputSchema: {
		type: 'object'
		properties: Record<string, unknown>
		required: string[]
		additionalProperties: false
	}
}

export type OperationResult =
	| { ok: true; data: unknown }
	| { ok: false; error: string }

// --- app → server ---------------------------------------------------------

export interface HelloMessage {
	type: 'hello'
	version: number
	token: string
	operations: OperationManifestEntry[]
}

export interface ResultMessage {
	type: 'result'
	id: number
	result: OperationResult
}

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

export interface WelcomeMessage {
	type: 'welcome'
	version: number
}

export interface RejectedMessage {
	type: 'rejected'
	reason: string
}

export type ServerMessage = InvokeMessage | WelcomeMessage | RejectedMessage

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isManifestEntry(value: unknown): value is OperationManifestEntry {
	if (!isRecord(value)) return false
	const schema = value.inputSchema
	return (
		typeof value.id === 'string' &&
		typeof value.title === 'string' &&
		typeof value.description === 'string' &&
		typeof value.readOnly === 'boolean' &&
		isRecord(schema) &&
		schema.type === 'object' &&
		isRecord(schema.properties)
	)
}

/**
 * Reads a frame from the app, or `null`.
 *
 * The same total-distrust posture as the app's parser, for the mirror-image reason: this socket
 * listens on a port, so anything on the machine can open it and say whatever it likes. A frame is
 * a message only if it fully typechecks at runtime.
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
	const text =
		typeof raw === 'string'
			? raw
			: raw instanceof Buffer
				? raw.toString('utf8')
				: null
	if (text === null) return null

	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		return null
	}
	if (!isRecord(parsed)) return null

	switch (parsed.type) {
		case 'hello': {
			if (typeof parsed.token !== 'string') return null
			if (typeof parsed.version !== 'number') return null
			if (!Array.isArray(parsed.operations) || !parsed.operations.every(isManifestEntry)) return null
			return {
				type: 'hello',
				version: parsed.version,
				token: parsed.token,
				operations: parsed.operations,
			}
		}
		case 'result': {
			if (typeof parsed.id !== 'number' || !Number.isFinite(parsed.id)) return null
			const result = parsed.result
			if (!isRecord(result)) return null
			if (result.ok === true) return { type: 'result', id: parsed.id, result: { ok: true, data: result.data } }
			if (result.ok === false && typeof result.error === 'string') {
				return { type: 'result', id: parsed.id, result: { ok: false, error: result.error } }
			}
			return null
		}
		case 'manifest': {
			if (!Array.isArray(parsed.operations) || !parsed.operations.every(isManifestEntry)) return null
			return { type: 'manifest', operations: parsed.operations }
		}
		default:
			return null
	}
}

export function encode(message: ServerMessage): string {
	return JSON.stringify(message)
}
