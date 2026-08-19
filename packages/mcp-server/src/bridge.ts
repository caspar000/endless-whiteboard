import { WebSocketServer, type WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import {
	AGENT_PROTOCOL_VERSION,
	encode,
	parseClientMessage,
	type ChatEvent,
	type ChatsMessage,
	type PromptImage,
	type OperationManifestEntry,
	type OperationResult,
	type ServerMessage,
	type TurnContext,
	type TurnSelection,
} from './protocol.js'

/**
 * The WebSocket host the Lifeboard tab connects to.
 *
 * The inversion is worth restating: the *app* is the client and this Node process is the server,
 * because a browser tab cannot listen on a port. So the thing being driven dials out, and this
 * process waits.
 */

/**
 * Origins allowed by default.
 *
 * The threat this defends against is a **web page** — any site the user has open can reach a
 * localhost WebSocket. `Origin` is browser-enforced and trivially forged by a non-browser client,
 * so it is not the real gate (the token is); it is the cheap check that stops a drive-by page
 * before the handshake. Any loopback origin passes because the app can legitimately be served from
 * a dev server, a preview server or an installed PWA on an arbitrary port.
 */
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

export function isOriginAllowed(origin: string | undefined, allowed?: readonly string[]): boolean {
	// An explicit allow-list replaces the default entirely, so a caller can lock this down.
	if (allowed?.length) return origin !== undefined && allowed.includes(origin)
	// No Origin header at all is a non-browser client — the token is the gate for those.
	if (origin === undefined) return true
	return LOOPBACK_ORIGIN.test(origin)
}

export interface BridgeOptions {
	port: number
	token: string
	/** Overrides the loopback default. Anything not listed is refused. */
	allowedOrigins?: readonly string[]
	/** How long an operation may take before the caller is told it timed out. */
	invokeTimeoutMs?: number
	/** How long a connected socket has to say `hello` before it is dropped. */
	handshakeTimeoutMs?: number
	/**
	 * Whether to tell the app this host runs an agent, so the panel offers a text box.
	 *
	 * Off by default: the stdio relay is the common case and has no model behind it, and a panel that
	 * accepted prompts nothing would ever read is worse than no panel at all.
	 */
	chat?: boolean
	/** Human-readable log line. Never stdout — see `index.ts`. */
	log?: (message: string) => void
}

/**
 * Generous: an operation may have to open a board, which waits for tldraw to mount and restore
 * from IndexedDB. A timeout shorter than that turns a slow cold start into a spurious failure.
 */
const DEFAULT_INVOKE_TIMEOUT_MS = 60_000
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000

interface Pending {
	resolve: (result: OperationResult) => void
	timer: ReturnType<typeof setTimeout>
}

export class AgentBridge {
	private readonly wss: WebSocketServer
	private readonly options: Required<Pick<BridgeOptions, 'token' | 'invokeTimeoutMs' | 'handshakeTimeoutMs'>>
	private readonly allowedOrigins: readonly string[] | undefined
	private readonly log: (message: string) => void

	/** The one authenticated tab. A second replaces the first — a reload must not lock the user out. */
	private client: WebSocket | null = null
	private manifest: OperationManifestEntry[] | null = null
	private readonly pending = new Map<number, Pending>()
	private nextId = 1
	private readonly manifestListeners = new Set<() => void>()
	private readonly promptListeners = new Set<
		(
			text: string,
			images: PromptImage[],
			selection: TurnSelection | null,
			context: TurnContext | null
		) => void
	>()
	private readonly interruptListeners = new Set<() => void>()
	private readonly chatsListeners = new Set<(message: ChatsMessage) => void>()
	private readonly authTokenListeners = new Set<(token: string) => void>()
	/** Called when a tab connects, so the host can send it the current chat list and auth state. */
	private readonly attachListeners = new Set<() => void>()
	private readonly chat: boolean

	constructor(options: BridgeOptions) {
		this.options = {
			token: options.token,
			invokeTimeoutMs: options.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS,
			handshakeTimeoutMs: options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
		}
		this.chat = options.chat ?? false
		this.allowedOrigins = options.allowedOrigins
		this.log = options.log ?? (() => {})

		// `host: '127.0.0.1'` is load-bearing, not a default: binding 0.0.0.0 would put a
		// board-editing socket on every interface the machine has.
		this.wss = new WebSocketServer({ port: options.port, host: '127.0.0.1' })
		this.wss.on('connection', (socket, request) => this.onConnection(socket, request))
	}

	/**
	 * Resolves with the port actually bound, once listening.
	 *
	 * Not the port that was *asked* for: passing 0 binds an ephemeral one, which is how the tests
	 * avoid colliding with a real server (or each other) on a developer's machine.
	 */
	ready(): Promise<number> {
		const address = this.wss.address()
		if (address && typeof address === 'object') return Promise.resolve(address.port)
		return new Promise((resolve, reject) => {
			this.wss.once('listening', () => {
				const bound = this.wss.address()
				resolve(bound && typeof bound === 'object' ? bound.port : 0)
			})
			this.wss.once('error', reject)
		})
	}

	/** The operations the connected tab offers, or `null` when nothing is connected. */
	getManifest(): OperationManifestEntry[] | null {
		return this.manifest
	}

	isConnected(): boolean {
		return this.client !== null
	}

	onManifestChange(listener: () => void): () => void {
		this.manifestListeners.add(listener)
		return () => {
			this.manifestListeners.delete(listener)
		}
	}

	/**
	 * A turn the user typed into the app's agent panel. Only the agent host subscribes.
	 *
	 * `selection` is the model and reasoning level the composer had set, or `null` from a panel that
	 * does not send one — which the host reads as "keep using what you were launched with".
	 */
	onPrompt(
		listener: (
			text: string,
			images: PromptImage[],
			selection: TurnSelection | null,
			context: TurnContext | null
		) => void
	): () => void {
		this.promptListeners.add(listener)
		return () => {
			this.promptListeners.delete(listener)
		}
	}

	onInterrupt(listener: () => void): () => void {
		this.interruptListeners.add(listener)
		return () => {
			this.interruptListeners.delete(listener)
		}
	}

	/**
	 * Pushes one turn event to the panel.
	 *
	 * Silently dropped when nothing is connected, which is the right thing rather than an error: a
	 * turn keeps running across a tab reload, and the transcript the user comes back to is rebuilt
	 * from what arrives after they reconnect.
	 */
	sendChat(event: ChatEvent): void {
		this.client?.send(encode({ type: 'chat', event }))
	}

	/** Pushes any server frame to the panel — the chat list, a replayed transcript, auth state. */
	send(message: ServerMessage): void {
		this.client?.send(encode(message))
	}

	/** Chat management asked for by the panel: list, open, delete. */
	onChats(listener: (message: ChatsMessage) => void): () => void {
		this.chatsListeners.add(listener)
		return () => {
			this.chatsListeners.delete(listener)
		}
	}

	onAuthToken(listener: (token: string) => void): () => void {
		this.authTokenListeners.add(listener)
		return () => {
			this.authTokenListeners.delete(listener)
		}
	}

	/**
	 * A tab finished the handshake.
	 *
	 * The host pushes state rather than waiting to be asked, because a reloaded tab has an empty
	 * panel and no way to know a conversation is mid-flight until something arrives.
	 */
	onAttach(listener: () => void): () => void {
		this.attachListeners.add(listener)
		return () => {
			this.attachListeners.delete(listener)
		}
	}

	private notifyManifest(): void {
		for (const listener of this.manifestListeners) listener()
	}

	private onConnection(socket: WebSocket, request: IncomingMessage): void {
		if (!isOriginAllowed(request.headers.origin, this.allowedOrigins)) {
			this.log(`Refused a connection from origin ${request.headers.origin ?? '(none)'}`)
			socket.send(encode({ type: 'rejected', reason: 'Origin not allowed.' }))
			socket.close()
			return
		}

		let authenticated = false
		// An unauthenticated socket must not linger: it costs a file descriptor and is exactly what a
		// probe would leave behind.
		const handshake = setTimeout(() => {
			if (!authenticated) {
				socket.send(encode({ type: 'rejected', reason: 'No handshake.' }))
				socket.close()
			}
		}, this.options.handshakeTimeoutMs)

		socket.on('message', (raw) => {
			const message = parseClientMessage(raw)
			if (!message) return

			if (!authenticated) {
				if (message.type !== 'hello') return
				if (message.version !== AGENT_PROTOCOL_VERSION) {
					socket.send(
						encode({
							type: 'rejected',
							reason: `Protocol version ${message.version} is not supported (server speaks ${AGENT_PROTOCOL_VERSION}). Update Lifeboard or the MCP server so both match.`,
						})
					)
					socket.close()
					return
				}
				// Length-independent comparison is not worth it here: the token is compared once per
				// connection over a loopback socket, and the handshake timeout bounds guessing far more
				// effectively than constant-time equality would.
				if (message.token !== this.options.token) {
					this.log('Refused a connection with a bad token')
					socket.send(encode({ type: 'rejected', reason: 'Token rejected.' }))
					socket.close()
					return
				}

				authenticated = true
				clearTimeout(handshake)
				// Replace, don't reject: a reloaded tab is the normal case, and refusing the new one
				// would leave the user connected to a socket that no longer has an app behind it.
				if (this.client && this.client !== socket) this.client.close()
				this.client = socket
				this.manifest = message.operations
				socket.send(encode({ type: 'welcome', version: AGENT_PROTOCOL_VERSION, chat: this.chat }))
				this.log(`Lifeboard connected — ${message.operations.length} operations offered`)
				this.notifyManifest()
				for (const listener of this.attachListeners) listener()
				return
			}

			switch (message.type) {
				case 'result': {
					const pending = this.pending.get(message.id)
					if (!pending) return
					clearTimeout(pending.timer)
					this.pending.delete(message.id)
					pending.resolve(message.result)
					return
				}
				case 'manifest': {
					this.manifest = message.operations
					this.log(`Offered operations changed — now ${message.operations.length}`)
					this.notifyManifest()
					return
				}
				case 'prompt': {
					// Dropped rather than queued when this host has no agent: a plain relay advertised
					// `chat: false`, so a prompt arriving here is a panel that ignored the answer.
					if (!this.chat) return
					// Normalised here so every listener has one shape to handle rather than re-deciding
					// what an absent field means. A model with no effort field is a real selection (the
					// model has no reasoning control); no model at all is no selection.
					const selection: TurnSelection | null = message.model
						? { model: message.model, effort: message.effort ?? null }
						: null
					for (const listener of this.promptListeners) {
						listener(message.text, message.images ?? [], selection, message.context ?? null)
					}
					return
				}
				case 'interrupt': {
					if (!this.chat) return
					for (const listener of this.interruptListeners) listener()
					return
				}
				case 'chats': {
					if (!this.chat) return
					for (const listener of this.chatsListeners) listener(message)
					return
				}
				case 'auth.token': {
					if (!this.chat) return
					for (const listener of this.authTokenListeners) listener(message.token)
					return
				}
				case 'hello':
					// A second hello on an authenticated socket is noise; the handshake already happened.
					return
			}
		})

		socket.on('close', () => {
			clearTimeout(handshake)
			if (this.client !== socket) return
			this.client = null
			this.manifest = null
			// Nothing will ever answer these now — resolve rather than leave callers hanging.
			this.failAllPending('Lifeboard disconnected before the operation finished.')
			this.log('Lifeboard disconnected')
			this.notifyManifest()
		})

		socket.on('error', () => {
			// `close` always follows; nothing to do but avoid an unhandled 'error' event.
		})
	}

	private failAllPending(error: string): void {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer)
			pending.resolve({ ok: false, error })
			this.pending.delete(id)
		}
	}

	/**
	 * Runs an operation in the connected tab.
	 *
	 * Never rejects. Every failure — no tab, a timeout, a disconnect mid-flight — comes back as an
	 * `ok: false` result, because the caller is an MCP tool handler answering an agent, and an agent
	 * can act on a sentence but not on a thrown error.
	 */
	invoke(operation: string, args: unknown): Promise<OperationResult> {
		const socket = this.client
		if (!socket) {
			return Promise.resolve({
				ok: false,
				error:
					'Lifeboard is not connected. Open the app, then switch on Settings → Agents and paste the token this server printed at startup.',
			})
		}

		const id = this.nextId++
		return new Promise<OperationResult>((resolve) => {
			const timer = setTimeout(() => {
				this.pending.delete(id)
				resolve({
					ok: false,
					error: `"${operation}" did not finish within ${Math.round(this.options.invokeTimeoutMs / 1000)}s. It may still be running in the app.`,
				})
			}, this.options.invokeTimeoutMs)

			this.pending.set(id, { resolve, timer })
			socket.send(JSON.stringify({ type: 'invoke', id, operation, args }))
		})
	}

	async close(): Promise<void> {
		this.failAllPending('The MCP server is shutting down.')
		this.client?.close()
		this.client = null
		await new Promise<void>((resolve) => this.wss.close(() => resolve()))
	}
}
