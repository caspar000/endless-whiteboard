#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { AgentBridge } from '@lifeboard/mcp-server/bridge'
import { AgentSession } from './session.js'

/**
 * The entry point for the in-app agent.
 *
 * This is the sibling of `mcp-server`'s `index.ts`, and the difference between them is the whole
 * point of the package: that one is a **relay** an external agent launches over stdio, this one is a
 * **host** the user launches, and it runs the agent itself. Both answer the same WebSocket handshake
 * on the same port, so the app's end of the bridge is identical for either — it learns which it
 * reached from the `chat` flag in the welcome.
 *
 * Only one of the two can hold the port at a time, which is the correct constraint rather than a
 * limitation to engineer around: the tab drives one conversation, and two processes both claiming to
 * be that conversation is not a state worth supporting.
 *
 * Unlike the relay, stdout here is free — nothing is speaking JSON-RPC over it — but everything still
 * goes to stderr so the two behave the same way when piped.
 */
function say(message: string): void {
	process.stderr.write(`${message}\n`)
}

const DEFAULT_PORT = 8787

/** Marks the machine-readable startup line. Parsed by the dev-server plugin; see `main` below. */
export const READY_PREFIX = 'lifeboard-agent-ready '

interface Args {
	port: number
	token: string
	origins: string[]
	model: string | undefined
}

function parseArgs(argv: readonly string[]): Args {
	const origins: string[] = []
	let port = Number(process.env.LIFEBOARD_AGENT_PORT) || DEFAULT_PORT
	let token = process.env.LIFEBOARD_AGENT_TOKEN ?? ''
	let model = process.env.LIFEBOARD_AGENT_MODEL || undefined

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		const value = argv[i + 1]
		if (arg === '--port' && value) {
			port = Number(value)
			i++
		} else if (arg === '--token' && value) {
			token = value
			i++
		} else if (arg === '--origin' && value) {
			origins.push(value)
			i++
		} else if (arg === '--model' && value) {
			model = value
			i++
		}
	}

	// 0 is allowed and meaningful: bind an ephemeral port and report it on the ready line. That is how
	// the dev server starts a host without having to guess a free port or fight the stdio relay.
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		say(`Invalid port "${port}"; using ${DEFAULT_PORT}.`)
		port = DEFAULT_PORT
	}

	return { port, token, origins, model }
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2))
	const generated = !args.token
	const token = args.token || randomBytes(24).toString('base64url')

	const bridge = new AgentBridge({
		port: args.port,
		token,
		chat: true,
		...(args.origins.length ? { allowedOrigins: args.origins } : {}),
		log: say,
	})

	/** Pushes the chat list, so the panel's sidebar reflects whatever just changed. */
	const sendChats = async () => {
		bridge.send({ type: 'chats.list', chats: await session.chats(), activeId: session.activeId })
	}

	const session = new AgentSession({
		bridge,
		model: args.model,
		log: say,
		// The list is refreshed when the agent goes idle rather than when a message is queued: a
		// brand-new conversation has no entry on disk until it has been written to.
		onIdle: () => void sendChats(),
	})

	bridge.onPrompt((text, images) => {
		say(`› ${text}${images.length ? `  [${images.length} image${images.length > 1 ? 's' : ''}]` : ''}`)
		// Returns once queued, not once answered — which is exactly what lets a second message arrive
		// mid-turn and steer the work already running.
		void session.run(text, images)
	})

	bridge.onInterrupt(() => {
		say('Stopped by the user.')
		session.interrupt()
	})

	bridge.onChats((message) => {
		void (async () => {
			switch (message.action) {
				case 'list':
					await sendChats()
					return
				case 'open': {
					const events = await session.openChat(message.sessionId ?? null)
					bridge.send({
						type: 'chat.history',
						sessionId: message.sessionId ?? null,
						events,
					})
					await sendChats()
					return
				}
				case 'delete': {
					if (!message.sessionId) return
					await session.removeChat(message.sessionId)
					// Deleting the open chat leaves nothing on screen, so clear the panel too rather than
					// showing a transcript whose conversation no longer exists.
					if (session.activeId === null) {
						bridge.send({ type: 'chat.history', sessionId: null, events: [] })
					}
					await sendChats()
					return
				}
			}
		})()
	})

	bridge.onAuthToken((token) => {
		session.setToken(token)
		bridge.send({ type: 'auth', state: 'ok' })
		say('Token accepted.')
	})

	// A tab that just connected has an empty panel and no way to know what exists. Push rather than
	// wait to be asked — including across a reload mid-conversation.
	bridge.onAttach(() => {
		void sendChats()
	})

	const port = await bridge.ready()

	/**
	 * A machine-readable line for whoever spawned us.
	 *
	 * The dev server starts this process and then has to tell the app where to connect and with what
	 * secret — that is the entire reason the panel needs no setup. It reports the port the bridge
	 * *bound*, not the one that was asked for, so `--port 0` works: the dev server can hand out an
	 * ephemeral port and never collide with a stdio relay the user is already running on 8787.
	 */
	process.stderr.write(`${READY_PREFIX}${JSON.stringify({ port, token })}\n`)

	say(`Lifeboard agent host listening on 127.0.0.1:${port}`)
	say('')
	say('  In Lifeboard, open Settings → Agents, paste this token, and switch it on:')
	say('')
	say(`      ${token}`)
	say('')
	if (generated) {
		say('  This token is new on every start. Set LIFEBOARD_AGENT_TOKEN to keep it stable.')
		say('')
	}
	say('  Then open the agent panel in the app and type. Uses your existing Claude Code login.')
	say('')

	const shutdown = () => {
		session.interrupt()
		void bridge.close().then(() => process.exit(0))
	}
	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
}

main().catch((error: unknown) => {
	say(`Lifeboard agent host failed to start: ${error instanceof Error ? error.message : String(error)}`)
	process.exit(1)
})
