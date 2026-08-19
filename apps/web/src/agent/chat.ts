import type { ContextUsage } from './context'
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

/**
 * Which turn a row belongs to.
 *
 * Rows are appended in one flat list, but nearly everything the panel wants to *show* is per turn —
 * how long it took, which work to fold away, which assistant block is the first of its turn. A turn
 * id on the row is what lets `transcript.ts` answer those at read time without the store having to
 * hold a tree.
 */
export type TurnId = number

interface RowBase {
	id: string
	turn: TurnId
}

export type TranscriptRow =
	| (RowBase & { kind: 'user'; text: string; images?: PromptImage[]; at: number })
	| (RowBase & { kind: 'agent'; text: string; streaming: boolean })
	| (RowBase & { kind: 'status'; text: string })
	| (RowBase & {
			kind: 'tool'
			name: string
			input: unknown
			state: 'running' | 'ok' | 'failed'
			summary: string
	  })
	| (RowBase & { kind: 'error'; text: string })

/**
 * A turn, as the panel measures it.
 *
 * `startedAt` is stamped when the *user's message* is recorded rather than when the first tool call
 * arrives, and that is the whole point: the first row of a turn only appears once the model starts
 * producing output, so timing from it would report a turn as shorter than it felt. T3 Code makes the
 * same choice for the same reason.
 */
export interface Turn {
	id: TurnId
	startedAt: number
	/** `null` while the turn is still running. */
	endedAt: number | null
	/** The user pressed Stop. Changes "Worked for" into "You stopped after". */
	interrupted: boolean
}

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
	/**
	 * How full the conversation's context window is, or `null` before the first turn has reported.
	 *
	 * Not a row: it is a single current figure that each turn replaces, so appending it to `rows` would
	 * make the transcript grow a line per turn saying the same kind of thing.
	 */
	context: ContextUsage | null
	/**
	 * Every turn on screen, oldest first.
	 *
	 * Kept beside the rows rather than inside them because a turn's *end* is learned after its rows
	 * exist — folding it, and saying how long it took, both need a place to write that after the fact.
	 */
	turns: Turn[]
}

const EMPTY: ChatState = {
	rows: [],
	busy: false,
	chats: [],
	activeId: null,
	auth: 'unknown',
	authDetail: '',
	context: null,
	turns: [],
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

/**
 * The turn rows are being appended to.
 *
 * Starts at 0 for the replay case: a transcript read back from disk has no live turn, and its rows all
 * land in one bucket rather than pretending to reconstruct boundaries the events do not record.
 */
let currentTurn: TurnId = 0

/** Set by the panel's Stop button, read by the next `done`. */
let interruptRequested = false

function openTurn(): TurnId {
	currentTurn += 1
	return currentTurn
}

function closeCurrentTurn(next: ChatState): ChatState {
	return {
		...next,
		turns: next.turns.map((turn) =>
			turn.id === currentTurn && turn.endedAt === null
				? { ...turn, endedAt: Date.now(), interrupted: interruptRequested }
				: turn
		),
	}
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
	interruptRequested = false
	// The context figure belongs to the conversation, not the panel — keeping it across a clear would
	// show a full window for an empty transcript.
	publish({ ...state, rows: [], busy: false, context: null, turns: [] })
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
	interruptRequested = false
	publish({ ...state, rows: [], busy: false, activeId: sessionId, context: null, turns: [] })
	for (const event of events) applyChatEvent(event)
}

/** Records the user's own turn. Called by the panel, since only it knows what was typed. */
export function recordPrompt(text: string, images: readonly PromptImage[] = []): void {
	streamingRowId = null
	// A new message means the previous Stop no longer applies.
	interruptRequested = false
	const at = Date.now()
	const turn = openTurn()
	publish({
		...state,
		rows: [
			...state.rows,
			{
				kind: 'user',
				id: nextId(),
				turn,
				at,
				text,
				...(images.length ? { images: [...images] } : {}),
			},
		],
		turns: [...state.turns, { id: turn, startedAt: at, endedAt: null, interrupted: false }],
		busy: true,
	})
}

/**
 * The user pressed Stop.
 *
 * Recorded here rather than inferred from the turn's outcome because the SDK's `result` does not
 * distinguish "you interrupted this" from "this finished" in a way the panel can rely on — and the
 * panel is the only thing that knows a button was pressed.
 */
export function recordInterrupt(): void {
	interruptRequested = true
}

/** Called when a turn cannot be sent at all, so the panel is never left spinning. */
export function recordSendFailure(text: string): void {
	streamingRowId = null
	publish(
		closeCurrentTurn({
			...state,
			rows: [...state.rows, { kind: 'error', id: nextId(), turn: currentTurn, text }],
			busy: false,
		})
	)
}

export function applyChatEvent(event: ChatEvent): void {
	switch (event.kind) {
		case 'user': {
			// Only ever from a replay: a live turn's user message is recorded by `recordPrompt`, which
			// runs before the frame reaches the host at all.
			streamingRowId = null
			/**
			 * A replayed transcript has no recorded timings, but it does have boundaries: each user
			 * message starts a turn. Recording them — closed, and with no clock — is what lets history
			 * fold its work away too. `foldLabel` reads the missing timestamps and says "Worked" rather
			 * than inventing a duration.
			 */
			const replayed = openTurn()
			publish({
				...state,
				turns: [...state.turns, { id: replayed, startedAt: 0, endedAt: 0, interrupted: false }],
			})
			append({
				kind: 'user',
				id: nextId(),
				turn: currentTurn,
				at: 0,
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
				append({ kind: 'agent', id, turn: currentTurn, text: event.text, streaming: true })
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
			append({ kind: 'agent', id: nextId(), turn: currentTurn, text: event.text, streaming: false })
			return
		}
		case 'status': {
			// Coalesced: "Thinking…" arrives once per delta and would otherwise fill the transcript.
			const last = state.rows[state.rows.length - 1]
			if (last?.kind === 'status' && last.text === event.text) return
			append({ kind: 'status', id: nextId(), turn: currentTurn, text: event.text })
			return
		}
		case 'tool': {
			// A tool block ends whatever text was streaming — the model has stopped writing prose.
			streamingRowId = null
			append({
				kind: 'tool',
				id: event.id,
				turn: currentTurn,
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
		case 'usage': {
			publish({ ...state, context: { used: event.used, max: event.max } })
			return
		}
		case 'done': {
			streamingRowId = null
			const rows = event.error
				? [...state.rows, { kind: 'error' as const, id: nextId(), turn: currentTurn, text: event.error }]
				: state.rows
			// Any tool still marked running was cut off by a stop or a crash; leaving spinners behind
			// would suggest work is continuing when the turn is over.
			publish(
				closeCurrentTurn({
					...state,
					rows: rows.map((row) =>
						row.kind === 'tool' && row.state === 'running' ? { ...row, state: 'failed' as const } : row
					),
					busy: false,
				})
			)
			return
		}
	}
}
