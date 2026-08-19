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

export const AGENT_PROTOCOL_VERSION = 8

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

/**
 * `images` is how an operation hands back something JSON cannot describe — a render of the board, so
 * the model can *see* it. The relay does not look inside them beyond checking they are images; it
 * turns each into a content block beside the JSON (see `server.ts`).
 */
export type OperationResult =
	| { ok: true; data: unknown; images?: PromptImage[] }
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

/**
 * An image on its way to the model.
 *
 * Base64 without the `data:` prefix, which is the shape the Anthropic content block wants — carrying
 * the data URL instead would mean stripping it on the far side, and the far side is the process that
 * has the least business knowing how a browser encodes a clipboard.
 */
export interface PromptImage {
	/** `image/png`, `image/webp`, … */
	mediaType: string
	/** Base64 payload, no `data:` prefix. */
	data: string
}

/**
 * A turn for the in-app agent panel, typed by the user.
 *
 * Only a host that actually runs an agent answers this; the plain relay ignores it, which is why the
 * `welcome` below advertises the capability rather than leaving the panel to infer it from silence.
 */
/**
 * The reasoning levels the Claude Agent SDK accepts.
 *
 * Listed here rather than imported from the SDK because this file is the wire's own vocabulary and
 * `mcp-server` does not depend on the SDK — only `agent-host` does. `parseClientMessage` checks
 * against this list, so a level the SDK would reject never reaches it.
 */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type EffortLevel = (typeof EFFORT_LEVELS)[number]

/** The longest model slug this will carry. Generous for a name; short enough to not be a payload. */
const MAX_MODEL_SLUG_LENGTH = 128

/**
 * The model and reasoning level the panel picked for a turn.
 *
 * Present as a unit or not at all: a panel that sends a model always sends its effort decision too
 * (`null` meaning "this model has none"), so the host can tell "leave it alone" — an older panel,
 * which sends neither — apart from "explicitly no reasoning level", which is what Haiku wants.
 */
export interface TurnSelection {
	model: string
	effort: EffortLevel | null
}

/**
 * What the app already knows, sent with the turn so the agent does not have to ask.
 *
 * The board on screen and the user's selection. Both are readable through operations
 * (`board.list`, `view.selection`) and that is the point: an agent whose opening move is always two
 * discovery calls spends the user's tokens learning what the panel could simply have told it.
 *
 * Bounded on the way in — see `parseClientMessage`. It is app-authored data, but it crosses a socket
 * any page on this machine can open.
 */
export interface TurnContextShape {
	id: string
	type: string
	label: string
}

export interface TurnContext {
	/** `null` when the user is on the board list rather than a board. */
	boardId: string | null
	boardName: string | null
	selection: TurnContextShape[]
	/** How many were actually selected, when the list above was truncated. */
	selectionTotal?: number
}

export interface PromptMessage {
	type: 'prompt'
	text: string
	/** Pasted into the composer. Absent or empty for an ordinary text turn. */
	images?: PromptImage[]
	/** The board and selection the panel had when this was sent. Absent from an older panel. */
	context?: TurnContext
	/** The model to answer with. Absent leaves the host's launch default in place. */
	model?: string
	/** How hard it thinks. Absent means the model has no reasoning control. */
	effort?: EffortLevel
}

/** Stop the turn in flight. Sent by the panel's stop button. */
export interface InterruptMessage {
	type: 'interrupt'
}

/**
 * Chat management, from the panel.
 *
 * `open` with no id starts a fresh conversation; with one, resumes that conversation and replays its
 * transcript. The host owns the list because the sessions are the agent's own — stored by Claude
 * Code on disk, not by the app — so the app asking is the only way it can know what exists.
 */
export interface ChatsMessage {
	type: 'chats'
	action: 'list' | 'open' | 'delete'
	/** Required for `delete`; for `open`, omit to start a new chat. */
	sessionId?: string
}

/** A token the user pasted into the sign-in view. */
export interface AuthTokenMessage {
	type: 'auth.token'
	token: string
}

export type ClientMessage =
	| HelloMessage
	| ResultMessage
	| ManifestMessage
	| PromptMessage
	| InterruptMessage
	| ChatsMessage
	| AuthTokenMessage

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
	/**
	 * Whether this host runs an agent, as opposed to relaying for one somewhere else.
	 *
	 * Advertised rather than assumed because both kinds of process answer on the same port with the
	 * same handshake: the stdio relay (`index.ts`) has no model behind it, and the agent host does.
	 * The panel needs to know which it reached before it offers a text box that may never be read.
	 */
	chat?: boolean
}

export interface RejectedMessage {
	type: 'rejected'
	reason: string
}

/**
 * One thing that happened during a turn, on its way to the panel.
 *
 * Modelled as a flat event rather than a transcript diff because the panel only ever appends. Text
 * arrives twice — as `delta` while the model is generating, then as one authoritative `text` when
 * the block closes — so the panel renders progress immediately and reconciles at the end. Every
 * `delta` for a block is a prefix of that block's final `text`, and a turn may drop deltas under
 * load, so `text` is what a transcript is built from and `delta` is only ever a preview.
 */
export type ChatEvent =
	/** The user's own turn. Only ever replayed — a live one is recorded by the panel that sent it. */
	| { kind: 'user'; text: string; images?: PromptImage[] }
	| { kind: 'delta'; text: string }
	| { kind: 'text'; text: string }
	/** The model is between turns — thinking, or waiting on a tool. Purely a progress signal. */
	| { kind: 'status'; text: string }
	| { kind: 'tool'; id: string; name: string; input: unknown }
	| { kind: 'tool-result'; id: string; ok: boolean; summary: string }
	/**
	 * How full the context window is after a turn.
	 *
	 * Not a transcript row — it replaces the previous figure rather than being appended, which is why
	 * it is an event with no id. `max` is `null` when the host could not learn the window size; the
	 * panel then shows a token count and no ring fill rather than inventing a denominator.
	 */
	| { kind: 'usage'; used: number; max: number | null }
	/** The turn ended. `error` is set when it ended badly. */
	| { kind: 'done'; error?: string }

export interface ChatMessage {
	type: 'chat'
	event: ChatEvent
}

/** One past conversation, as the chat list shows it. */
export interface ChatSummary {
	sessionId: string
	title: string
	/** Epoch ms, for grouping the list into Today / Yesterday / Earlier. */
	updatedAt: number
}

/** The conversations this host can resume, newest first. */
export interface ChatsListMessage {
	type: 'chats.list'
	chats: ChatSummary[]
	/** The one on screen, or `null` for an unsaved new chat. */
	activeId: string | null
}

/**
 * A conversation's transcript, replayed.
 *
 * Sent when a chat is opened. `events` are the same `ChatEvent`s a live turn produces, so the panel
 * renders history and live output through one path rather than two that can disagree.
 */
export interface ChatHistoryMessage {
	type: 'chat.history'
	sessionId: string | null
	events: ChatEvent[]
}

/**
 * Whether the agent can talk to Claude at all.
 *
 * `signed-out` is not an error state to recover from — it is the normal first run, and the panel
 * shows sign-in instructions rather than a failed turn.
 */
export interface AuthMessage {
	type: 'auth'
	state: 'ok' | 'signed-out' | 'checking'
	/** Shown under the sign-in prompt when there is something specific to say. */
	detail?: string
}

export type ServerMessage =
	| InvokeMessage
	| WelcomeMessage
	| RejectedMessage
	| ChatMessage
	| ChatsListMessage
	| ChatHistoryMessage
	| AuthMessage

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads an image list, or `null` when the field is present but malformed.
 *
 * `null` and `[]` are deliberately different answers: absent is a text turn, malformed is a frame to
 * drop entirely rather than silently send to the model with the pictures missing.
 */
function parseImages(raw: unknown): PromptImage[] | null {
	if (raw === undefined) return []
	if (!Array.isArray(raw)) return null

	const images: PromptImage[] = []
	for (const entry of raw) {
		if (!isRecord(entry)) return null
		const { mediaType, data } = entry
		if (typeof mediaType !== 'string' || !mediaType.startsWith('image/')) return null
		if (typeof data !== 'string' || !data) return null
		images.push({ mediaType, data })
	}
	return images
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
/** Bounds on the context block. Generous for real use; short enough not to be a payload. */
const MAX_CONTEXT_SHAPES = 32
const MAX_CONTEXT_STRING = 200

function trimmed(value: unknown): string | null {
	return typeof value === 'string' ? value.slice(0, MAX_CONTEXT_STRING) : null
}

/**
 * Reads the turn's context, or `null`.
 *
 * Every field is optional and a malformed one is dropped rather than failing the turn: this is a
 * *hint*, and a person's request is worth answering with less context rather than not at all.
 */
function parseTurnContext(raw: unknown): TurnContext | null {
	if (!isRecord(raw)) return null

	const selection: TurnContextShape[] = []
	if (Array.isArray(raw.selection)) {
		for (const entry of raw.selection.slice(0, MAX_CONTEXT_SHAPES)) {
			if (!isRecord(entry)) continue
			const id = trimmed(entry.id)
			const type = trimmed(entry.type)
			if (!id || !type) continue
			selection.push({ id, type, label: trimmed(entry.label) ?? '' })
		}
	}

	const boardId = trimmed(raw.boardId)
	if (!boardId && selection.length === 0) return null

	const total = typeof raw.selectionTotal === 'number' && Number.isFinite(raw.selectionTotal)
		? Math.max(selection.length, Math.trunc(raw.selectionTotal))
		: undefined

	return {
		boardId,
		boardName: trimmed(raw.boardName),
		selection,
		...(total !== undefined && total > selection.length ? { selectionTotal: total } : {}),
	}
}

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
			if (result.ok === true) {
				// Malformed images lose the pictures, not the answer. Everything else in this file
				// returns `null` for a bad field, but a dropped `result` frame is a tool call that never
				// answers — the agent waits for its own timeout, having been told nothing.
				const images = parseImages(result.images) ?? []
				return {
					type: 'result',
					id: parsed.id,
					result: { ok: true, data: result.data, ...(images.length ? { images } : {}) },
				}
			}
			if (result.ok === false && typeof result.error === 'string') {
				return { type: 'result', id: parsed.id, result: { ok: false, error: result.error } }
			}
			return null
		}
		case 'manifest': {
			if (!Array.isArray(parsed.operations) || !parsed.operations.every(isManifestEntry)) return null
			return { type: 'manifest', operations: parsed.operations }
		}
		case 'prompt': {
			const images = parseImages(parsed.images)
			if (images === null) return null
			// An empty prompt is a stray Enter — unless images came with it, which is a turn ("what is
			// this?") even with nothing typed.
			if (typeof parsed.text !== 'string') return null
			if (!parsed.text.trim() && images.length === 0) return null
			// A bad model or effort drops the *field*, not the turn: the message is a person's request
			// and the selection is only a hint about how to answer it. Falling back to the host's
			// default is a worse answer than they asked for; refusing to answer is not an answer.
			const model =
				typeof parsed.model === 'string' &&
				parsed.model.trim() &&
				parsed.model.length <= MAX_MODEL_SLUG_LENGTH
					? parsed.model.trim()
					: undefined
			const effort = EFFORT_LEVELS.find((level) => level === parsed.effort)
			const context = parseTurnContext(parsed.context)
			return {
				type: 'prompt',
				text: parsed.text,
				...(images.length ? { images } : {}),
				...(model ? { model } : {}),
				...(effort ? { effort } : {}),
				...(context ? { context } : {}),
			}
		}
		case 'interrupt':
			return { type: 'interrupt' }
		case 'chats': {
			const action = parsed.action
			if (action !== 'list' && action !== 'open' && action !== 'delete') return null
			const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined
			// Deleting without saying what would be a no-op at best; refuse rather than guess.
			if (action === 'delete' && !sessionId) return null
			return { type: 'chats', action, ...(sessionId ? { sessionId } : {}) }
		}
		case 'auth.token': {
			if (typeof parsed.token !== 'string' || !parsed.token.trim()) return null
			return { type: 'auth.token', token: parsed.token.trim() }
		}
		default:
			return null
	}
}

export function encode(message: ServerMessage): string {
	return JSON.stringify(message)
}
