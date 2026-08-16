import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin, ViteDevServer } from 'vite'

/**
 * Runs the agent host alongside the dev server, so the in-app agent panel needs no setup at all.
 *
 * The panel talks to a Node process, and a browser tab cannot start one. Something has to, and the
 * dev server is the only thing already running that can — so it owns the host's lifecycle: started
 * with `pnpm dev`, killed when the dev server stops, its port and token handed to the app over an
 * endpoint on this same origin. That is the whole difference between "open the panel and type" and
 * "run a command, copy a token, paste it into Settings".
 *
 * **Dev only, by construction** (`apply: 'serve'`). A built PWA has no dev server, so there is
 * nothing to spawn the host and the panel says so instead. That is an honest limit rather than an
 * omission: shipping a web app cannot mean shipping a process on the user's machine.
 *
 * The host binds an **ephemeral port** rather than 8787. That is what lets it coexist with a stdio
 * relay the user is already running for an external agent — the two processes no longer fight for
 * the port. They do still contend for the *tab*, which holds one bridge connection; Settings says
 * which one won.
 */

const READY_PREFIX = 'lifeboard-agent-ready '

/** Where the built host lives, relative to this file. */
const HOST_ENTRY = fileURLToPath(new URL('../../../packages/agent-host/dist/index.js', import.meta.url))

interface HostDetails {
	port: number
	token: string
}

type HostState =
	| { status: 'starting' }
	| { status: 'ready'; details: HostDetails }
	| { status: 'failed'; reason: string }

export function agentHostPlugin(): Plugin {
	let child: ChildProcess | null = null
	let state: HostState = { status: 'starting' }

	const stop = () => {
		child?.kill()
		child = null
	}

	return {
		name: 'lifeboard:agent-host',
		// Never in a build: there is no dev server in a built app to own the process.
		apply: 'serve',

		configureServer(server: ViteDevServer) {
			const log = (message: string) => server.config.logger.info(`  ➜  Agent:  ${message}`)

			/**
			 * The app asks here for somewhere to connect.
			 *
			 * Same-origin only in practice: no CORS headers are set, so another site can issue the
			 * request but cannot read the reply. The token is no more exposed than it would be sitting
			 * in this origin's localStorage, which is where it used to have to be pasted by hand.
			 */
			server.middlewares.use('/__lifeboard/agent-host', (_req, res) => {
				res.setHeader('Content-Type', 'application/json')
				// Never cached: the port changes on every dev-server restart.
				res.setHeader('Cache-Control', 'no-store')
				// 503 while starting tells the app to try again; anything else is terminal for this
				// dev-server run, so the panel can stop polling and explain itself.
				res.statusCode = state.status === 'ready' ? 200 : state.status === 'starting' ? 503 : 410
				res.end(JSON.stringify(state.status === 'ready' ? state.details : { status: state.status, ...(state.status === 'failed' ? { reason: state.reason } : {}) }))
			})

			if (process.env.LIFEBOARD_NO_AGENT) {
				state = { status: 'failed', reason: 'Disabled by LIFEBOARD_NO_AGENT.' }
				return
			}

			if (!existsSync(HOST_ENTRY)) {
				state = {
					status: 'failed',
					reason: 'The agent host is not built. Run `pnpm agent:build`, then restart the dev server.',
				}
				log('not built — run `pnpm agent:build` and restart to enable the agent panel')
				return
			}

			// `--port 0` and no token: the host picks a free port, generates a secret, and reports both
			// on the ready line. Nothing here has to guess, and nothing is written to disk.
			child = spawn(process.execPath, [HOST_ENTRY, '--port', '0'], {
				stdio: ['ignore', 'ignore', 'pipe'],
				env: { ...process.env, LIFEBOARD_AGENT_TOKEN: '' },
			})

			let buffered = ''
			child.stderr?.setEncoding('utf8')
			child.stderr?.on('data', (chunk: string) => {
				// Line-buffered: a ready line split across two chunks would otherwise never match.
				buffered += chunk
				const lines = buffered.split('\n')
				buffered = lines.pop() ?? ''
				for (const line of lines) {
					if (line.startsWith(READY_PREFIX)) {
						try {
							const details = JSON.parse(line.slice(READY_PREFIX.length)) as HostDetails
							state = { status: 'ready', details }
							log(`ready on 127.0.0.1:${details.port} — open the panel with ⌘⇧A`)
						} catch {
							state = { status: 'failed', reason: 'The agent host reported an unreadable port.' }
						}
					}
				}
			})

			child.on('error', (error) => {
				state = { status: 'failed', reason: error.message }
				log(`failed to start — ${error.message}`)
			})

			child.on('exit', (code) => {
				child = null
				// A clean exit during shutdown is not a failure worth reporting to the panel.
				if (state.status === 'starting' || code) {
					state = { status: 'failed', reason: `The agent host exited (code ${code ?? 0}).` }
				}
			})

			// Both hooks: `close` covers a graceful restart, the signals cover Ctrl-C, and leaving the
			// host running after its dev server is gone would hold the tab's bridge for nobody.
			server.httpServer?.once('close', stop)
			process.once('SIGINT', stop)
			process.once('SIGTERM', stop)
		},

		closeBundle: stop,
	}
}
