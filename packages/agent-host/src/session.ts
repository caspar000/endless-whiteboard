import {
	deleteSession,
	getSessionMessages,
	listSessions,
	query,
	type Options,
	type PermissionResult,
	type SDKMessage,
	type Query,
	type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentBridge } from '@lifeboard/mcp-server/bridge'
import type {
	ChatEvent,
	ChatSummary,
	OperationManifestEntry,
	PromptImage,
} from '@lifeboard/mcp-server/protocol'
import { toolNameFor } from '@lifeboard/mcp-server/tools'
import { buildToolServer } from './tools.js'

/**
 * One conversation with Claude Code, driven from the app's agent panel.
 *
 * A conversation is **one long-lived streaming-input `query()`**, not a fresh query per turn. The
 * per-turn shape came first and was simpler, but it had no open input channel — so there was nowhere
 * to put a follow-up while the agent was working, and steering a turn mid-flight was impossible. That
 * is the feature this exists to support.
 *
 * The per-turn shape bought two things, and both are recovered rather than given up:
 *
 * - **The tool list tracked the live manifest.** Now the manifest is watched, and a change pushes a
 *   fresh in-process server through `setMcpServers`. More importantly the *gate* reads the manifest
 *   at call time (see `canUseTool`), so a withdrawn operation is refused immediately whatever the
 *   model still believes it can see.
 * - **Stop was a local, certain abort.** Now it is `Query.interrupt()`, which is the SDK's own
 *   mechanism and the only one available in streaming mode. It stops at a safe boundary rather than
 *   severing the process, which is what lets the conversation carry on afterwards.
 */

/**
 * Where this host's conversations live.
 *
 * A directory of its own, not the process's cwd. Claude Code stores sessions per project directory,
 * so sharing a cwd with whatever repository the host was started from would mix board chats into
 * that project's history — and, worse, list the user's unrelated coding sessions in the board
 * panel. The agent has no filesystem tools, so nothing is written here but the session log itself.
 */
const SESSION_DIR = join(homedir(), '.lifeboard', 'agent')

/**
 * Tools the model may use beyond the board itself.
 *
 * Both are read-only and reach nothing but the open internet, which is what makes "research it and
 * put it on the board" work without widening the gate below to anything that touches this machine.
 */
const WEB_TOOLS = ['WebSearch', 'WebFetch'] as const

/**
 * The permitted tool names for a given manifest.
 *
 * Exported and pure so the security boundary can be asserted directly in a test rather than
 * inferred from a model's behaviour — a model declining to read a file proves it was well behaved,
 * not that it was prevented, and those are very different properties.
 */
export function allowedToolNames(manifest: readonly OperationManifestEntry[]): Set<string> {
	// Fully qualified MCP names: the SDK namespaces an in-process server's tools as
	// `mcp__<server>__<tool>`, and the gate matches on that exact string.
	return new Set<string>([
		...manifest.map((entry) => `mcp__lifeboard__${toolNameFor(entry.id)}`),
		...WEB_TOOLS,
	])
}

/** The gate itself: allow what is in the set, refuse everything else with a reason. */
export function decidePermission(allowed: ReadonlySet<string>, toolName: string): PermissionResult {
	if (allowed.has(toolName)) return { behavior: 'allow', updatedInput: {} }
	return {
		behavior: 'deny',
		message: `${toolName} is not available in Lifeboard's agent panel, which can only use the board tools and web search.`,
	}
}

const SYSTEM_PROMPT = `You are the agent built into Lifeboard, an infinite-canvas whiteboard app where the user keeps notes, books, tables and the relations between them.

You act on the user's boards through the Lifeboard tools. They run inside the user's open tab, against the board they are looking at, so the user watches every change happen and can undo it — one undo step per operation.

Working rules:
- Prefer looking before writing. \`board.list\`, \`node.find\` and \`node.types\` cost nothing and stop you from inventing structure that already exists.
- Most operations need an open board. If nothing is open, open one with \`board.open\` or make one with \`board.create\`.
- \`node.types\` tells you what kinds of node this board actually supports; it varies with which extensions the user has enabled. Do not assume a type exists.
- You can research on the web. When you do, put what you found on the board as nodes rather than only summarising it in chat — that is usually the point of the request.
- Say what you did in a sentence or two. The user can see the board, so do not narrate every operation back to them.

You cannot read or write files and you have no shell. If a request needs either, say so plainly.`


/**
 * The open input channel a running conversation reads from.
 *
 * This is the whole reason mid-turn steering works. `query()` takes either a string or an async
 * iterable of user messages; a string — or a generator that yields once and finishes — closes the
 * input the moment the turn starts, so there is nowhere to put a follow-up. Holding the iterable
 * open means a second message can be pushed while the agent is still working, and Claude Code picks
 * it up the way it does in the CLI.
 *
 * It also unlocks the SDK's control requests (`interrupt`, `setMcpServers`), which the type
 * declarations note are "only supported when streaming input/output is used".
 */
export class PromptQueue {
	private readonly pending: SDKUserMessage[] = []
	private waiting: ((message: SDKUserMessage | null) => void) | null = null
	private closed = false

	/** Nothing waiting to be read — which is how the host knows a `result` means genuinely idle. */
	isEmpty(): boolean {
		return this.pending.length === 0
	}

	push(message: SDKUserMessage): void {
		if (this.closed) return
		// Handed straight to a waiting reader when there is one; queued otherwise. Doing both would
		// deliver the message twice.
		const waiter = this.waiting
		if (waiter) {
			this.waiting = null
			waiter(message)
			return
		}
		this.pending.push(message)
	}

	close(): void {
		if (this.closed) return
		this.closed = true
		const waiter = this.waiting
		this.waiting = null
		waiter?.(null)
	}

	async *stream(): AsyncIterable<SDKUserMessage> {
		while (true) {
			const queued = this.pending.shift()
			if (queued) {
				yield queued
				continue
			}
			if (this.closed) return
			const next = await new Promise<SDKUserMessage | null>((resolve) => {
				this.waiting = resolve
			})
			if (next === null) return
			yield next
		}
	}
}

export interface SessionOptions {
	bridge: AgentBridge
	/** Overrides the model Claude Code would otherwise pick. */
	model?: string
	log?: (message: string) => void
	/**
	 * Called when the agent finishes everything queued.
	 *
	 * The host refreshes the chat list here rather than after `run`, which now returns as soon as a
	 * message is queued rather than when the work is done.
	 */
	onIdle?: () => void
}

export class AgentSession {
	private readonly bridge: AgentBridge
	private readonly model: string | undefined
	private readonly log: (message: string) => void

	/** Set from any message that carries it, so a resumed chat picks up where it stopped. */
	private resumeId: string | undefined
	/** The live conversation, or `null` when none has been started yet. */
	private live: Query | null = null
	/** The open input channel feeding `live`. Non-null exactly when `live` is. */
	private queue: PromptQueue | null = null
	/** Drops the manifest watcher when the conversation ends. */
	private unwatchManifest: (() => void) | null = null
	private readonly onIdle: () => void
	/**
	 * A token the user pasted, if they did.
	 *
	 * Held in memory only. Writing it anywhere would be this process inventing its own credential
	 * store beside the one Claude Code already owns — and the normal path is that there is no token
	 * here at all, because the user is signed in through the CLI.
	 */
	private token: string | undefined

	constructor(options: SessionOptions) {
		this.bridge = options.bridge
		this.model = options.model
		this.log = options.log ?? (() => {})
		this.onIdle = options.onIdle ?? (() => {})
		// Claude Code creates the session log itself, but only if the directory it is told to use
		// exists.
		mkdirSync(SESSION_DIR, { recursive: true })
	}

	/** The conversation on screen, or `null` for a new one that has not been saved yet. */
	get activeId(): string | null {
		return this.resumeId ?? null
	}

	setToken(token: string): void {
		this.token = token
		this.log('Using a pasted token for this session.')
	}

	/** Starts a fresh conversation. The previous one stays on disk and in the list. */
	newChat(): void {
		this.end()
		this.resumeId = undefined
	}

	/**
	 * The conversations this host can resume, newest first.
	 *
	 * Read from Claude Code's own session store rather than a list this process keeps: the transcripts
	 * are already there, and a second index would be one more thing to fall out of step with them.
	 */
	async chats(): Promise<ChatSummary[]> {
		try {
			const sessions = await listSessions({ dir: SESSION_DIR })
			return sessions
				.map((session) => ({
					sessionId: session.sessionId,
					title: session.customTitle || session.summary || session.firstPrompt || 'New chat',
					updatedAt: session.lastModified,
				}))
				.sort((a, b) => b.updatedAt - a.updatedAt)
		} catch (error) {
			this.log(`Could not list chats: ${error instanceof Error ? error.message : String(error)}`)
			return []
		}
	}

	async removeChat(sessionId: string): Promise<void> {
		try {
			await deleteSession(sessionId, { dir: SESSION_DIR })
		} catch (error) {
			this.log(`Could not delete chat: ${error instanceof Error ? error.message : String(error)}`)
		}
		if (this.resumeId === sessionId) this.resumeId = undefined
	}

	/**
	 * Opens a conversation and returns its transcript as panel events.
	 *
	 * Replayed into the *same* `ChatEvent` vocabulary a live turn produces, so the panel renders
	 * history and live output through one path. Two paths would drift, and the one nobody looks at
	 * while developing is the history one.
	 */
	async openChat(sessionId: string | null): Promise<ChatEvent[]> {
		// Ended rather than interrupted: the next turn has to start against a different transcript, and
		// a query resumed onto one conversation cannot be pointed at another.
		this.end()
		this.resumeId = sessionId ?? undefined
		if (!sessionId) return []

		try {
			const messages = await getSessionMessages(sessionId, { dir: SESSION_DIR })
			return replayEvents(messages)
		} catch (error) {
			this.log(`Could not open chat: ${error instanceof Error ? error.message : String(error)}`)
			return [
				{ kind: 'done', error: 'That conversation could not be read back from disk.' },
			]
		}
	}

	get busy(): boolean {
		return this.live !== null
	}

	/**
	 * Stops the work in flight, leaving the conversation open.
	 *
	 * `interrupt()` rather than tearing the query down: it stops at a safe boundary and the same
	 * conversation carries on taking messages afterwards, which is the point of holding it open.
	 */
	interrupt(): void {
		void this.live?.interrupt().catch(() => {
			// Nothing to interrupt, or the query already ended. Either way there is no work left to
			// stop, which is the outcome the caller wanted.
		})
	}

	/** Ends the conversation entirely. Used when switching chats, not by the stop button. */
	private end(): void {
		this.unwatchManifest?.()
		this.unwatchManifest = null
		this.queue?.close()
		this.queue = null
		this.live?.close()
		this.live = null
	}

	/**
	 * Queues a message for the conversation, starting one if none is running.
	 *
	 * Returns as soon as the message is queued, **not** when the work is done — that is what makes
	 * mid-turn steering possible, and it is why the host refreshes the chat list from `onIdle` rather
	 * than from this promise.
	 *
	 * Never throws. The panel's response to any failure is identical — show the sentence, re-enable
	 * the box — so failures come back as a `done` carrying an error.
	 */
	async run(prompt: string, images: readonly PromptImage[] = []): Promise<void> {
		const manifest = this.bridge.getManifest()
		if (!manifest?.length) {
			this.emit({
				kind: 'done',
				error: 'Lifeboard is not connected, so there is nothing to act on yet.',
			})
			return
		}

		try {
			if (!this.live) this.begin(manifest)
			this.queue?.push(userMessage(prompt, images))
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error)
			this.log(`Could not start a turn: ${detail}`)
			this.emit({ kind: 'done', error: detail })
			this.end()
		}
	}

	/**
	 * Opens a conversation: the input channel, the query reading it, and the loop draining its output.
	 *
	 * The drain loop is deliberately not awaited by the caller — it runs for the life of the
	 * conversation, across every turn, and finishes only when the input closes or the query fails.
	 */
	private begin(manifest: readonly OperationManifestEntry[]): void {
		const queue = new PromptQueue()
		const live = query({ prompt: queue.stream(), options: this.optionsFor(manifest) })

		this.queue = queue
		this.live = live

		/**
		 * Toggling an extension changes what the app offers, so the model's tool list has to follow.
		 * The security gate does not depend on this — it reads the manifest per call — so a failure
		 * here means the model may briefly see a tool that will be refused, never the reverse.
		 */
		this.unwatchManifest = this.bridge.onManifestChange(() => {
			const current = this.bridge.getManifest()
			if (!current || this.live !== live) return
			void live
				.setMcpServers({
					lifeboard: {
						type: 'sdk',
						name: 'lifeboard',
						instance: buildToolServer(this.bridge, current, this.log),
					},
				})
				.catch((error: unknown) => {
					this.log(`Could not refresh tools: ${error instanceof Error ? error.message : String(error)}`)
				})
		})

		void (async () => {
			try {
				for await (const message of live) this.forward(message)
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error)
				this.log(`Conversation ended: ${detail}`)
				this.emit({ kind: 'done', error: detail })
			} finally {
				// Only if this is still the live conversation: `end()` may already have replaced it with
				// another, and clearing that one's handles would strand it.
				if (this.live === live) {
					this.unwatchManifest?.()
					this.unwatchManifest = null
					this.queue = null
					this.live = null
				}
				this.onIdle()
			}
		})()
	}

	private optionsFor(manifest: readonly OperationManifestEntry[]): Options {
		return {
			model: this.model,
			resume: this.resumeId,
			systemPrompt: SYSTEM_PROMPT,
			// Conversations live here rather than in whatever directory the host was started from —
			// see SESSION_DIR.
			cwd: SESSION_DIR,
			// Only set when the user pasted a token. Otherwise the SDK resolves the existing Claude
			// Code login, which is the normal path and the one that needs no configuration.
			...(this.token ? { env: { ...process.env, ANTHROPIC_API_KEY: this.token } } : {}),
			mcpServers: {
				lifeboard: {
					type: 'sdk',
					name: 'lifeboard',
					instance: buildToolServer(this.bridge, manifest, this.log),
				},
			},
			/**
			 * Deliberately no `allowedTools`.
			 *
			 * A bare name there auto-approves the tool *before* `canUseTool` is consulted — the SDK warns
			 * about exactly this — which would leave two places deciding what may run and only one of
			 * them auditable. With the list empty, every call reaches the callback below and there is a
			 * single gate to read.
			 */
			includePartialMessages: true,
			/**
			 * The user's own Claude Code configuration is deliberately not loaded.
			 *
			 * Their `CLAUDE.md` and settings describe whatever repository they last worked in, which has
			 * nothing to do with a board — and their permission rules could re-enable the very tools the
			 * gate below exists to withhold. This session gets its instructions from `SYSTEM_PROMPT` and
			 * nowhere else.
			 */
			settingSources: [],
			/**
			 * The only gate, and the reason this panel is safe to leave switched on.
			 *
			 * Every tool outside the allow-set is refused here rather than escalated to a prompt, because
			 * there is no prompt to escalate to — the panel has no approval UI, so an unanswered question
			 * would simply hang the turn. Filesystem and shell tools are not in the set, so the answer
			 * for `Bash`, `Read` and `Write` is always no.
			 */
			/**
			 * Read from the *live* manifest on every call, not captured when the conversation opened.
			 *
			 * A conversation now outlives any single turn, so a captured allow-set would go stale the
			 * moment an extension was switched off — and a stale security gate fails open. This way an
			 * operation the app has stopped offering is refused from that instant.
			 */
			canUseTool: async (toolName: string): Promise<PermissionResult> =>
				decidePermission(allowedToolNames(this.bridge.getManifest() ?? []), toolName),
		}
	}

	/**
	 * Projects one SDK message onto the panel's much smaller event vocabulary.
	 *
	 * Most of what the SDK emits is machinery the panel has no use for — hook lifecycles, retries,
	 * background-task levels — so anything unrecognised is dropped rather than surfaced. Adding an
	 * event type is the deliberate act of deciding a user should see something.
	 */
	private forward(message: SDKMessage): void {
		// Captured from anything that carries one — including the system init, so a conversation
		// stopped before its first result can still be resumed rather than silently starting over.
		if ('session_id' in message && typeof message.session_id === 'string') {
			this.resumeId = message.session_id
		}

		switch (message.type) {
			case 'assistant': {
				/**
				 * Not signed in.
				 *
				 * Reported as an auth state rather than a failed turn: it is the ordinary first run, and
				 * the panel's answer is a sign-in screen, not an error message the user can only stare
				 * at. Everything else in `SDKAssistantMessageError` is a genuine fault and falls through
				 * to the turn's own error handling.
				 */
				if (message.error === 'authentication_failed' || message.error === 'oauth_org_not_allowed') {
					this.bridge.send({
						type: 'auth',
						state: 'signed-out',
						detail:
							message.error === 'oauth_org_not_allowed'
								? 'That account is not allowed to use Claude Code in this organization.'
								: undefined,
					})
					return
				}
				for (const block of message.message.content) {
					if (block.type === 'text') this.emit({ kind: 'text', text: block.text })
					else if (block.type === 'tool_use') {
						this.emit({
							kind: 'tool',
							id: block.id,
							name: block.name,
							input: block.input,
						})
					}
				}
				return
			}
			case 'stream_event': {
				// The live preview. Deltas may be shed under load, so they are never what the transcript
				// is built from — the `text` block above is. See `ChatEvent`.
				const event = message.event
				if (event.type !== 'content_block_delta') return
				if (event.delta.type === 'text_delta') this.emit({ kind: 'delta', text: event.delta.text })
				else if (event.delta.type === 'thinking_delta') this.emit({ kind: 'status', text: 'Thinking…' })
				return
			}
			case 'user': {
				// Tool results come back as a synthetic user turn.
				const content = message.message.content
				if (typeof content === 'string') return
				for (const block of content) {
					if (block.type !== 'tool_result') continue
					this.emit({
						kind: 'tool-result',
						id: block.tool_use_id,
						ok: block.is_error !== true,
						summary: summarise(block.content),
					})
				}
				return
			}
			case 'result': {
				if (message.subtype !== 'success') {
					this.emit({ kind: 'status', text: `Turn ended: ${message.subtype.replace(/_/g, ' ')}` })
				}
				/**
				 * Idle means the agent has nothing left, not merely that a turn ended.
				 *
				 * With messages queueing mid-turn, a `result` can arrive with more work still waiting —
				 * and Claude Code may also fold several queued messages into one turn, so counting turns
				 * would drift either way. Asking the queue is exact under both.
				 */
				if (this.queue?.isEmpty() ?? true) {
					this.emit({ kind: 'done' })
					this.onIdle()
				}
				return
			}
			default:
				return
		}
	}

	private emit(event: ChatEvent): void {
		this.bridge.sendChat(event)
	}
}

/**
 * A stored transcript, as panel events.
 *
 * `SessionMessage.message` is typed `unknown` by the SDK — it is whatever the API turn was — so every
 * step here narrows rather than casts. A malformed row is skipped, not thrown on: a conversation that
 * is 95% readable is worth showing, and the alternative is an empty panel for a chat the user can
 * plainly remember having.
 */
function replayEvents(messages: readonly { type: string; message: unknown }[]): ChatEvent[] {
	const events: ChatEvent[] = []

	for (const entry of messages) {
		if (!isRecord(entry.message)) continue
		const content = entry.message.content
		// A plain string body is a user turn typed as text rather than blocks.
		if (typeof content === 'string') {
			if (entry.type === 'user' && content.trim()) events.push({ kind: 'user', text: content })
			continue
		}
		if (!Array.isArray(content)) continue

		// Images belong to the user turn they arrived with, so they are gathered for the whole entry
		// and attached to its text block rather than emitted as rows of their own.
		const images: PromptImage[] = []
		if (entry.type === 'user') {
			for (const block of content) {
				if (!isRecord(block) || block.type !== 'image') continue
				const source = block.source
				if (!isRecord(source)) continue
				const { media_type: mediaType, data } = source
				if (typeof mediaType === 'string' && typeof data === 'string') {
					images.push({ mediaType, data })
				}
			}
		}
		let imagesAttached = false

		for (const block of content) {
			if (!isRecord(block)) continue
			switch (block.type) {
				case 'text': {
					if (typeof block.text !== 'string' || !block.text.trim()) break
					if (entry.type === 'user') {
						// Only the first text block carries them: a turn with two paragraphs and one
						// screenshot should not replay the screenshot twice.
						const attach = images.length && !imagesAttached
						if (attach) imagesAttached = true
						events.push({ kind: 'user', text: block.text, ...(attach ? { images } : {}) })
					} else {
						events.push({ kind: 'text', text: block.text })
					}
					break
				}
				case 'tool_use': {
					if (typeof block.id !== 'string' || typeof block.name !== 'string') break
					events.push({ kind: 'tool', id: block.id, name: block.name, input: block.input })
					break
				}
				case 'tool_result': {
					if (typeof block.tool_use_id !== 'string') break
					events.push({
						kind: 'tool-result',
						id: block.tool_use_id,
						ok: block.is_error !== true,
						summary: summarise(block.content),
					})
					break
				}
			}
		}

		// A paste with no words at all still has to replay as something the panel can show.
		if (images.length && !imagesAttached) events.push({ kind: 'user', text: '', images })
	}

	return events
}

/**
 * One user turn as a message for the queue.
 *
 * Text goes last, after the pictures, because that is the order the Anthropic docs recommend for
 * vision — the question reads better once the images are in context.
 */
function userMessage(text: string, images: readonly PromptImage[]): SDKUserMessage {
	return {
		type: 'user',
		parent_tool_use_id: null,
		message: {
			role: 'user',
			content: [
				...images.map((image) => ({
					type: 'image' as const,
					source: {
						type: 'base64' as const,
						media_type: image.mediaType as 'image/png',
						data: image.data,
					},
				})),
				...(text.trim() ? [{ type: 'text' as const, text }] : []),
			],
		},
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A tool result as one short line. The panel shows the shape of what came back, not the payload. */
function summarise(content: unknown): string {
	const text =
		typeof content === 'string'
			? content
			: Array.isArray(content)
				? content
						.map((block) =>
							typeof block === 'object' && block !== null && 'text' in block
								? String((block as { text: unknown }).text)
								: ''
						)
						.join('')
				: ''

	const collapsed = text.replace(/\s+/g, ' ').trim()
	return collapsed.length > 200 ? `${collapsed.slice(0, 200)}…` : collapsed
}
