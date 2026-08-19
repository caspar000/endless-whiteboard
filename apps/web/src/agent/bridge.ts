import {
	createOperationContext,
	getOperation,
	operationManifest,
	runOperation,
	subscribeToOperations,
	type OperationResult,
} from '@lifeboard/node-kit'
import type { Editor } from 'tldraw'
import {
	applyChatEvent,
	loadHistory,
	recordInterrupt,
	recordPrompt,
	recordSendFailure,
	setAuth,
	setChats,
} from './chat'
import {
	AGENT_PROTOCOL_VERSION,
	encode,
	parseServerMessage,
	type ClientMessage,
	type PromptImage,
} from './protocol'
import { getSendableContext, restoreSelection } from './boardContext'
import { getAgentModelSelection } from './models'
import { agentUrl, loadAgentPrefs, type AgentPrefs } from './prefs'

/**
 * The app's end of the agent bridge: a WebSocket to a local MCP server, carrying operation calls in
 * and results out.
 *
 * The app is the *client* even though it is the thing being driven, because a browser tab cannot
 * listen on a port. That inversion is the whole reason this file exists rather than the server simply
 * calling in.
 */

export type AgentConnection = 'off' | 'connecting' | 'connected' | 'error'

export interface AgentStatus {
	connection: AgentConnection
	/** Why it is in this state, when there is something worth saying. Shown in Settings. */
	detail: string
	/** How many operations have been run this session — the "something is happening" signal. */
	handled: number
	/** The last operation run, so the panel can say what an agent just did. */
	lastOperation: string
	/**
	 * Whether the connected process runs an agent, so the panel can offer a text box.
	 *
	 * Learned from the welcome rather than configured: the same port serves both the stdio relay and
	 * the agent host, and which one is running is not something the app should have to be told twice.
	 */
	chat: boolean
}

const OFF: AgentStatus = {
	connection: 'off',
	detail: '',
	handled: 0,
	lastOperation: '',
	chat: false,
}

let status: AgentStatus = OFF
const listeners = new Set<() => void>()

function setStatus(next: Partial<AgentStatus>): void {
	// A fresh object each change and a stable one between: `useSyncExternalStore`'s contract.
	status = { ...status, ...next }
	for (const listener of listeners) listener()
}

export function subscribeToAgentStatus(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function getAgentStatus(): AgentStatus {
	return status
}

// ---------------------------------------------------------------------------
// Message handling — split from the socket so it can be tested without one
// ---------------------------------------------------------------------------

export interface BridgeDeps {
	send(message: ClientMessage): void
	/** The board on screen, read at invoke time so an operation never acts on a stale editor. */
	activeEditor(): Editor | null
	/** Called when the server refuses us, so the caller can stop rather than reconnect forever. */
	onRejected(reason: string): void
	/** Read-only mode: mutating operations are neither offered nor allowed. */
	readOnly: boolean
}

/**
 * The operations to announce.
 *
 * In read-only mode the mutating ones are withheld rather than merely refused, so an agent never
 * sees a tool it cannot use. The refusal in `handleServerMessage` stays as well: filtering is the
 * UX, and refusing is the actual gate — a stale manifest on the server must not become a way in.
 */
export function offeredOperations(readOnly: boolean) {
	const all = operationManifest()
	return readOnly ? all.filter((entry) => entry.readOnly) : all
}

function failure(error: string): OperationResult {
	return { ok: false, error }
}

/**
 * Handles one frame from the server.
 *
 * Every path answers an `invoke`, including the failures. A tool call that gets no reply leaves the
 * agent hanging until its own timeout, which is a far worse experience than being told immediately
 * that no board is open.
 */
export async function handleServerMessage(raw: unknown, deps: BridgeDeps): Promise<void> {
	const message = parseServerMessage(raw)
	// Unrecognised frames are dropped in silence: this socket is reachable by any page the browser
	// has open, so noise is an expected input, not an incident.
	if (!message) return

	switch (message.type) {
		case 'welcome':
			setStatus({ chat: message.chat })
			return
		case 'chat':
			applyChatEvent(message.event)
			return
		case 'chats.list':
			setChats(message.chats, message.activeId)
			return
		case 'chat.history':
			loadHistory(message.sessionId, message.events)
			return
		case 'auth':
			// `checking` is not a panel state: it means the host has not decided yet, and the panel's
			// existing state is a better thing to keep showing than a flicker.
			if (message.state !== 'checking') setAuth(message.state, message.detail ?? '')
			return
		case 'rejected':
			deps.onRejected(message.reason)
			return
		case 'invoke': {
			const operation = getOperation(message.operation)
			const ctx = createOperationContext(deps.activeEditor())
			const result =
				deps.readOnly && operation && !operation.readOnly
					? failure(
							`"${message.operation}" changes the board, and Lifeboard is set to read-only for agents. Ask the user to turn that off in Settings → Agents.`
						)
					: ctx
						? await runOperation(message.operation, ctx, message.args)
						: failure('Lifeboard is still starting up — try again in a moment.')

			setStatus({ handled: status.handled + 1, lastOperation: message.operation })
			deps.send({ type: 'result', id: message.id, result })
			return
		}
	}
}

// ---------------------------------------------------------------------------
// The socket
// ---------------------------------------------------------------------------

/** Backoff between reconnects: doubles to a ceiling, so a server that is simply not running is cheap. */
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = RECONNECT_BASE_MS
let unsubscribeOperations: (() => void) | null = null
/** Set when the server refuses us, so a bad token does not become a reconnect loop. */
let refused = false
let current: AgentPrefs | null = null

/** Supplied by App, so the bridge can reach the board on screen without importing app state. */
let activeEditor: () => Editor | null = () => null

export function setAgentEditorSource(source: () => Editor | null): void {
	activeEditor = source
}

function clearReconnect(): void {
	if (reconnectTimer !== null) clearTimeout(reconnectTimer)
	reconnectTimer = null
}

function teardownSocket(): void {
	if (!socket) return
	// Detached before closing so the handlers below cannot fire for a socket we have abandoned and
	// schedule a reconnect the caller did not ask for.
	socket.onopen = null
	socket.onmessage = null
	socket.onerror = null
	socket.onclose = null
	try {
		socket.close()
	} catch {
		// Closing an already-dead socket is not worth reporting.
	}
	socket = null
}

function scheduleReconnect(): void {
	if (!current?.enabled || refused) return
	clearReconnect()
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null
		connect()
	}, reconnectDelay)
	reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS)
}

function send(message: ClientMessage): void {
	if (socket?.readyState === WebSocket.OPEN) socket.send(encode(message))
}

/**
 * Sends a turn from the agent panel, and records it in the transcript.
 *
 * The user's own message is recorded here rather than in the panel so that the failure path is one
 * place: if the socket is gone, what the user typed still appears above the reason it did not go
 * anywhere, instead of vanishing from the box with nothing to show for it.
 */
export function sendPrompt(text: string, images: readonly PromptImage[] = []): void {
	const trimmed = text.trim()
	// Images alone are a turn — "what is this?" with a screenshot and no words is a real question.
	if (!trimmed && images.length === 0) return

	recordPrompt(trimmed, images)

	if (socket?.readyState !== WebSocket.OPEN) {
		recordSendFailure('Not connected to an agent host. Start it, then switch the bridge on in Settings → Agents.')
		return
	}
	if (!status.chat) {
		recordSendFailure(
			'The connected process is the MCP relay, which has no agent behind it. Run the agent host instead to use this panel.'
		)
		return
	}
	// Read at send time rather than passed in by the composer: the picker writes to the store and the
	// wire reads from it, so there is one answer to "which model is this turn on" and no prop to
	// thread through a form. Same for the board context — it is whatever was true when Send was hit.
	const selection = getAgentModelSelection()
	const context = getSendableContext()
	send({
		type: 'prompt',
		text: trimmed,
		// Stripped of the preview URL and id, which are the panel's business and not the wire's.
		...(images.length
			? { images: images.map(({ mediaType, data }) => ({ mediaType, data })) }
			: {}),
		model: selection.model,
		// Omitted when the model has no reasoning control, which is how the host tells "no level" from
		// "a panel too old to have an opinion".
		...(selection.effort ? { effort: selection.effort } : {}),
		// The board and selection, so the agent's first move can be the work rather than two questions.
		...(context
			? {
					context: {
						boardId: context.boardId,
						boardName: context.boardName,
						selection: context.selection.map(({ id, type, label }) => ({ id, type, label })),
						...(context.selectionTotal > context.selection.length
							? { selectionTotal: context.selectionTotal }
							: {}),
					},
				}
			: {}),
	})

	// Dismissing the selection is a decision about *this* turn, so sending ends it — see `dismissed`
	// in `boardContext.ts`.
	restoreSelection()
}

export function interruptAgent(): void {
	// Recorded before the frame goes out: the turn's fold row says "You stopped after" rather than
	// "Worked for", and nothing on the wire tells the panel that a stop was a stop.
	recordInterrupt()
	send({ type: 'interrupt' })
}

/** Asks the host for the conversations it can resume. */
export function listChats(): void {
	send({ type: 'chats', action: 'list' })
}

/** Opens a past conversation, or starts a new one when given `null`. */
export function openChat(sessionId: string | null): void {
	send({ type: 'chats', action: 'open', ...(sessionId ? { sessionId } : {}) })
}

export function deleteChat(sessionId: string): void {
	send({ type: 'chats', action: 'delete', sessionId })
}

export function sendAuthToken(token: string): void {
	const trimmed = token.trim()
	if (trimmed) send({ type: 'auth.token', token: trimmed })
}

function connect(): void {
	const prefs = current
	if (!prefs?.enabled) return

	if (!prefs.token) {
		setStatus({
			connection: 'error',
			detail: 'No token. Paste the one the MCP server printed when it started.',
		})
		return
	}

	teardownSocket()
	setStatus({ connection: 'connecting', detail: '' })

	let opened: WebSocket
	try {
		opened = new WebSocket(agentUrl(prefs))
	} catch {
		setStatus({ connection: 'error', detail: 'Could not open a connection.' })
		scheduleReconnect()
		return
	}
	socket = opened

	const deps: BridgeDeps = {
		send,
		activeEditor: () => activeEditor(),
		readOnly: prefs.readOnly,
		onRejected: (reason) => {
			// Terminal: a wrong token or an unspeakable version will be just as wrong in a second.
			refused = true
			setStatus({ connection: 'error', detail: reason })
			teardownSocket()
		},
	}

	opened.onopen = () => {
		reconnectDelay = RECONNECT_BASE_MS
		setStatus({ connection: 'connected', detail: '' })
		send({
			type: 'hello',
			version: AGENT_PROTOCOL_VERSION,
			token: prefs.token,
			operations: offeredOperations(prefs.readOnly),
		})

		// Re-announce when the offered set changes — toggling an extension in Settings adds or removes
		// its operations, and the server's tool list has to follow or an agent calls something gone.
		unsubscribeOperations?.()
		unsubscribeOperations = subscribeToOperations(() => {
			send({ type: 'manifest', operations: offeredOperations(prefs.readOnly) })
		})
	}

	opened.onmessage = (event: MessageEvent) => {
		void handleServerMessage(event.data, deps)
	}

	opened.onerror = () => {
		// `onclose` always follows, and it is the one that schedules the retry. Setting a message here
		// only so the panel says something better than "connecting" while the close lands.
		if (!refused) setStatus({ connection: 'error', detail: 'Could not reach the MCP server.' })
	}

	opened.onclose = () => {
		unsubscribeOperations?.()
		unsubscribeOperations = null
		socket = null
		if (refused || !current?.enabled) return
		// `chat` is cleared with the connection: whatever reconnects may be the other kind of process,
		// and a panel left offering a text box for an agent that is no longer there is a lie.
		setStatus({
			connection: 'connecting',
			detail: 'Waiting for the MCP server…',
			chat: false,
		})
		scheduleReconnect()
	}
}

/**
 * Starts or restarts the bridge for these preferences. Safe to call on every change — it tears the
 * old connection down first, which is what makes editing the port or token in Settings take effect.
 */
export function startAgentBridge(prefs: AgentPrefs = loadAgentPrefs()): void {
	current = prefs
	refused = false
	reconnectDelay = RECONNECT_BASE_MS
	clearReconnect()

	if (!prefs.enabled) {
		stopAgentBridge()
		return
	}
	connect()
}

export function stopAgentBridge(): void {
	current = current ? { ...current, enabled: false } : null
	clearReconnect()
	unsubscribeOperations?.()
	unsubscribeOperations = null
	teardownSocket()
	status = OFF
	for (const listener of listeners) listener()
}
