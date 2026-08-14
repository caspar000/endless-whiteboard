#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { randomBytes } from 'node:crypto'
import { AgentBridge } from './bridge.js'
import { createServer } from './server.js'

/**
 * The entry point.
 *
 * **Everything human-readable goes to stderr.** Under the stdio transport, stdout *is* the MCP
 * protocol channel — a single stray `console.log` corrupts the JSON-RPC stream and the client
 * disconnects with a parse error that looks nothing like its cause.
 */
function say(message: string): void {
	process.stderr.write(`${message}\n`)
}

const DEFAULT_PORT = 8787

interface Args {
	port: number
	token: string
	origins: string[]
}

function parseArgs(argv: readonly string[]): Args {
	const origins: string[] = []
	let port = Number(process.env.LIFEBOARD_AGENT_PORT) || DEFAULT_PORT
	/**
	 * A token from the environment is *stable across restarts*, which is the difference between
	 * pasting it into Settings once and pasting it every time the server starts. Generated when
	 * absent so the secure path is also the default path.
	 */
	let token = process.env.LIFEBOARD_AGENT_TOKEN ?? ''

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
		}
	}

	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		say(`Invalid port "${port}"; using ${DEFAULT_PORT}.`)
		port = DEFAULT_PORT
	}

	return { port, token, origins }
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2))
	const generated = !args.token
	const token = args.token || randomBytes(24).toString('base64url')

	const bridge = new AgentBridge({
		port: args.port,
		token,
		...(args.origins.length ? { allowedOrigins: args.origins } : {}),
		log: say,
	})

	say(`Lifeboard MCP server listening on 127.0.0.1:${args.port}`)
	say('')
	say('  In Lifeboard, open Settings → Agents, paste this token, and switch it on:')
	say('')
	say(`      ${token}`)
	say('')
	if (generated) {
		say('  This token is new on every start. Set LIFEBOARD_AGENT_TOKEN to keep it stable.')
		say('')
	}

	const server = createServer(bridge)
	await server.connect(new StdioServerTransport())

	const shutdown = () => {
		void bridge.close().then(() => process.exit(0))
	}
	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
}

main().catch((error: unknown) => {
	say(`Lifeboard MCP server failed to start: ${error instanceof Error ? error.message : String(error)}`)
	process.exit(1)
})
