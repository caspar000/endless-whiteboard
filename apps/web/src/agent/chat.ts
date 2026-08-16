import type { ChatEvent, ChatSummary, PromptImage } from './protocol'

/**
 * The agent panel's transcript.
 *
 * A module-level store rather than component state, for the same reason the bridge's status is one:
 * a turn outlives the panel being open. Closing the sidebar mid-task and coming back to an empty
 * transcript — or worse, to a turn that had been cancelled by an unmount — is not a thing a user
 * should be able to do by accident.
 *
 * The store only ever appends, and the one exception proves the rule: a streaming assistant row is
 * mutated in place while its deltas arrive, then replaced by the authoritative text when the block
 * closes. See `ChatEvent` for why those are two different events.
 */

export type TranscriptRow =
	| { kind: 'user'; id: string; text: string; images?: PromptImage[] }
	| { kind: 'agent'; id: string; text: string; streaming: boolean }
	| { kind: 'status'; id: string; text: string }
	| { kind: 'tool'; id: string; name: string; input: unknown; state: 'running' | 'ok' | 'failed'; summary: string }
	| { kind: 'error'; id: string; text: string }

/**
 * Whether the agent can reach Claude.
 *
 * `unknown` until a host says otherwise, so a freshly connected panel does not flash a sign-in
 * screen at someone who is signed in.
 */
export type AuthState = 'unknown' | 'ok' | 'signed-out'

export interface ChatState {
	rows: TranscriptRow[]
	/** True between sending a prompt and the turn's `done`. Drives the stop button. */
	busy: boolean
	/** Past conversations this host can resume, newest first. */
	chats: ChatSummary[]
	/** The conversation on screen, or `null` for a new one that has not been saved yet. */
	activeId: string | null
	auth: AuthState
	authDetail: string
}

const EMPTY: ChatState = {
	rows: [],
	busy: false,
	chats: [],
	activeId: null,
	auth: 'unknown',
	authDetail: '',
}

let state: ChatState = EMPTY
const listeners = new Set<() => void>()

/**
 * The row deltas are landing in.
 *
 * Held as an id rather than an object reference because every change replaces the row — the store
 * hands React new objects so `useSyncExternalStore` sees a change, and a retained reference would be
 * to a row that is no longer in the list.
 */
let streamingRowId: string | null = null

let counter = 0
function nextId(): string {
	counter += 1
	return `row-${counter}`
}

function publish(next: ChatState): void {
	state = next
	for (const listener of listeners) listener()
}

function append(row: TranscriptRow): void {
	publish({ ...state, rows: [...state.rows, row] })
}

export function subscribeToChat(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function getChatState(): ChatState {
	return state
}

/** Empties the transcript without forgetting the chat list or who is signed in. */
export function clearChat(): void {
	streamingRowId = null
	publish({ ...state, rows: [], busy: false })
}

export function setChats(chats: ChatSummary[], activeId: string | null): void {
	publish({ ...state, chats, activeId })
}

export function setAuth(auth: AuthState, detail = ''): void {
	publish({ ...state, auth, authDetail: detail })
}

/**
 * Replaces the transcript with a replayed one.
 *
 * Fed through `applyChatEvent` rather than a second renderer, so history and live output cannot
 * disagree about how a tool row or a reply looks.
 */
export function loadHistory(sessionId: string | null, events: readonly ChatEvent[]): void {
	streamingRowId = null
	publish({ ...state, rows: [], busy: false, activeId: sessionId })
	for (const event of events) applyChatEvent(event)
}

/** Records the user's own turn. Called by the panel, since only it knows what was typed. */
export function recordPrompt(text: string, images: readonly PromptImage[] = []): void {
	streamingRowId = null
	publish({
		...state,
		rows: [
			...state.rows,
			{ kind: 'user', id: nextId(), text, ...(images.length ? { images: [...images] } : {}) },
		],
		busy: true,
	})
}

/** Called when a turn cannot be sent at all, so the panel is never left spinning. */
export function recordSendFailure(text: string): void {
	streamingRowId = null
	publish({
		...state,
		rows: [...state.rows, { kind: 'error', id: nextId(), text }],
		busy: false,
	})
}

export function applyChatEvent(event: ChatEvent): void {
	switch (event.kind) {
		case 'user': {
			// Only ever from a replay: a live turn's user message is recorded by `recordPrompt`, which
			// runs before the frame reaches the host at all.
			streamingRowId = null
			append({
				kind: 'user',
				id: nextId(),
				text: event.text,
				...(event.images?.length ? { images: event.images } : {}),
			})
			return
		}
		case 'delta': {
			// Opens a row on the first delta of a block and extends it thereafter, so a long answer
			// appears as it is written rather than all at once when the block closes.
			if (streamingRowId === null) {
				const id = nextId()
				streamingRowId = id
				append({ kind: 'agent', id, text: event.text, streaming: true })
				return
			}
			publish({
				...state,
				rows: state.rows.map((row) =>
					row.id === streamingRowId && row.kind === 'agent'
						? { ...row, text: row.text + event.text }
						: row
				),
			})
			return
		}
		case 'text': {
			// The authoritative block. It *replaces* the accumulated draft rather than appending to it,
			// because deltas can be shed under load and the draft may be missing words.
			if (streamingRowId !== null) {
				const id = streamingRowId
				streamingRowId = null
				publish({
					...state,
					rows: state.rows.map((row) =>
						row.id === id && row.kind === 'agent' ? { ...row, text: event.text, streaming: false } : row
					),
				})
				return
			}
			append({ kind: 'agent', id: nextId(), text: event.text, streaming: false })
			return
		}
		case 'status': {
			// Coalesced: "Thinking…" arrives once per delta and would otherwise fill the transcript.
			const last = state.rows[state.rows.length - 1]
			if (last?.kind === 'status' && last.text === event.text) return
			append({ kind: 'status', id: nextId(), text: event.text })
			return
		}
		case 'tool': {
			// A tool block ends whatever text was streaming — the model has stopped writing prose.
			streamingRowId = null
			append({
				kind: 'tool',
				id: event.id,
				name: event.name,
				input: event.input,
				state: 'running',
				summary: '',
			})
			return
		}
		case 'tool-result': {
			publish({
				...state,
				rows: state.rows.map((row) =>
					row.kind === 'tool' && row.id === event.id
						? { ...row, state: event.ok ? 'ok' : 'failed', summary: event.summary }
						: row
				),
			})
			return
		}
		case 'done': {
			streamingRowId = null
			const rows = event.error
				? [...state.rows, { kind: 'error' as const, id: nextId(), text: event.error }]
				: state.rows
			// Any tool still marked running was cut off by a stop or a crash; leaving spinners behind
			// would suggest work is continuing when the turn is over.
			publish({
				...state,
				rows: rows.map((row) =>
					row.kind === 'tool' && row.state === 'running' ? { ...row, state: 'failed' as const } : row
				),
				busy: false,
			})
			return
		}
	}
}
