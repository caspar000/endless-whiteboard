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
export const AGENT_PROTOCOL_VERSION = 8

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
 * The reasoning levels the Claude Agent SDK accepts.
 *
 * Spelled out here as well as in `agent/models.ts` so the wire has its own vocabulary: the catalog is
 * the app's opinion about which levels are worth offering, this is what the far side will accept.
 */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type EffortLevel = (typeof EFFORT_LEVELS)[number]

/**
 * A turn the user typed into the agent panel.
 *
 * Only a host that runs an agent answers this — see `chat` on the welcome below. Sending one to the
 * plain relay is harmless and does nothing, which is why the panel checks the capability first
 * rather than discovering it from a reply that never comes.
 */
/**
 * What the app already knows, sent with the turn so the agent does not have to ask.
 *
 * Mirrors `TurnContext` in `agent/boardContext.ts`, which is where it is built and documented. The
 * duplication is the same one the rest of this file lives with: the wire's vocabulary is written out
 * on both sides rather than shared through a package the browser cannot load.
 */
export interface TurnContext {
	boardId: string | null
	boardName: string | null
	selection: { id: string; type: string; label: string }[]
	selectionTotal?: number
}

export interface PromptMessage {
	type: 'prompt'
	text: string
	/** Pasted into the composer. Absent for an ordinary text turn. */
	images?: PromptImage[]
	/**
	 * The board and selection the composer had when this was sent, so the agent starts a turn already
	 * knowing what the user is looking at and pointing at.
	 */
	context?: TurnContext
	/**
	 * The model to answer with, chosen in the composer.
	 *
	 * Sent per turn rather than agreed once at connection, because it changes per turn — and because
	 * that is what lets the host steer a conversation already in flight onto a different model
	 * instead of abandoning its context. Absent leaves whatever the host was launched with.
	 */
	model?: string
	/**
	 * How hard it thinks. Absent means the model has no reasoning control, or the panel is older than
	 * this field — either way the host leaves the level alone.
	 */
	effort?: EffortLevel
}

/** Stop the turn in flight. */
export interface InterruptMessage {
	type: 'interrupt'
}

/**
 * Chat management, from the panel.
 *
 * `open` with no id starts a fresh conversation; with one, resumes that conversation. The host owns
 * the list because the transcripts are Claude Code's own, stored on disk beside the agent rather
 * than by the app — asking is the only way the app can know what exists.
 */
export interface ChatsMessage {
	type: 'chats'
	action: 'list' | 'open' | 'delete'
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

/** The server accepted the token. Until this arrives the app treats itself as unauthenticated. */
export interface WelcomeMessage {
	type: 'welcome'
	version: number
	/**
	 * Whether the process on the other end runs an agent, rather than relaying for one elsewhere.
	 *
	 * Both kinds answer the same handshake on the same port, so this is the only thing that tells them
	 * apart — and it decides whether the panel offers a text box or explains how to start a host.
	 */
	chat: boolean
}

/** The server rejected us — a bad token, or a version it cannot speak. */
export interface RejectedMessage {
	type: 'rejected'
	reason: string
}

/**
 * One thing that happened during a turn.
 *
 * `delta` is a live preview and `text` is the record: every delta is a prefix of the block's final
 * `text`, and deltas may be dropped under load, so the panel renders deltas as they arrive and then
 * replaces the draft when the authoritative `text` lands. Building a transcript from deltas alone
 * would silently lose words.
 */
export type ChatEvent =
	/** The user's own turn. Only ever replayed — a live one is recorded by the panel that sent it. */
	| { kind: 'user'; text: string; images?: PromptImage[] }
	| { kind: 'delta'; text: string }
	| { kind: 'text'; text: string }
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

export interface ChatsListMessage {
	type: 'chats.list'
	chats: ChatSummary[]
	/** The conversation on screen, or `null` for a new one not yet saved. */
	activeId: string | null
}

/**
 * A conversation's transcript, replayed as the same events a live turn produces — so the panel
 * renders history and live output through one path rather than two that can disagree.
 */
export interface ChatHistoryMessage {
	type: 'chat.history'
	sessionId: string | null
	events: ChatEvent[]
}

/**
 * Whether the agent can reach Claude.
 *
 * `signed-out` is the normal first run rather than a failure: the panel shows sign-in instructions
 * instead of a turn that errored.
 */
export interface AuthMessage {
	type: 'auth'
	state: 'ok' | 'signed-out' | 'checking'
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

/** Reads a replayed image list, or `null` when present but malformed. */
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

/**
 * Reads one turn event, or `null`.
 *
 * Every field is checked even though the only thing that legitimately sends these is a host on
 * loopback — this socket is reachable by any page the browser has open, and a `kind` that typechecks
 * halfway would put a half-built row in the transcript.
 */
function parseChatEvent(raw: unknown): ChatEvent | null {
	if (!isRecord(raw)) return null

	switch (raw.kind) {
		case 'user': {
			if (typeof raw.text !== 'string') return null
			const images = parseImages(raw.images)
			return images === null
				? null
				: { kind: 'user', text: raw.text, ...(images.length ? { images } : {}) }
		}
		case 'delta':
		case 'text':
		case 'status':
			return typeof raw.text === 'string' ? ({ kind: raw.kind, text: raw.text } as ChatEvent) : null
		case 'tool':
			if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
			return { kind: 'tool', id: raw.id, name: raw.name, input: raw.input }
		case 'tool-result':
			if (typeof raw.id !== 'string' || typeof raw.summary !== 'string') return null
			return { kind: 'tool-result', id: raw.id, ok: raw.ok === true, summary: raw.summary }
		case 'usage': {
			// A non-finite `used` would render the ring as `NaN%`, so it is refused rather than clamped:
			// there is nothing useful to show for a figure that is not a number.
			if (typeof raw.used !== 'number' || !Number.isFinite(raw.used)) return null
			const max = typeof raw.max === 'number' && Number.isFinite(raw.max) ? raw.max : null
			return { kind: 'usage', used: raw.used, max }
		}
		case 'done':
			return { kind: 'done', ...(typeof raw.error === 'string' ? { error: raw.error } : {}) }
		default:
			return null
	}
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
			return {
				type: 'welcome',
				version: typeof parsed.version === 'number' ? parsed.version : 0,
				// Absent means no: a host that runs an agent says so, and anything that does not is
				// treated as the plain relay.
				chat: parsed.chat === true,
			}
		case 'chat': {
			const event = parseChatEvent(parsed.event)
			return event ? { type: 'chat', event } : null
		}
		case 'chats.list': {
			if (!Array.isArray(parsed.chats)) return null
			const chats: ChatSummary[] = []
			for (const raw of parsed.chats) {
				if (!isRecord(raw)) return null
				if (typeof raw.sessionId !== 'string' || typeof raw.title !== 'string') return null
				chats.push({
					sessionId: raw.sessionId,
					title: raw.title,
					updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
				})
			}
			return {
				type: 'chats.list',
				chats,
				activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
			}
		}
		case 'chat.history': {
			if (!Array.isArray(parsed.events)) return null
			const events: ChatEvent[] = []
			for (const raw of parsed.events) {
				const event = parseChatEvent(raw)
				// A transcript with one unreadable row is not worth rendering partially — the gap would
				// be invisible and the user would read the remainder as complete.
				if (!event) return null
				events.push(event)
			}
			return {
				type: 'chat.history',
				sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
				events,
			}
		}
		case 'auth': {
			const state = parsed.state
			if (state !== 'ok' && state !== 'signed-out' && state !== 'checking') return null
			return {
				type: 'auth',
				state,
				...(typeof parsed.detail === 'string' ? { detail: parsed.detail } : {}),
			}
		}
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
