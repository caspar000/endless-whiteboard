import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { AgentBridge, isOriginAllowed } from './bridge.js'
import {
	AGENT_PROTOCOL_VERSION,
	parseClientMessage,
	type OperationManifestEntry,
	type ServerMessage,
} from './protocol.js'

const TOKEN = 'test-token'

const OPERATION: OperationManifestEntry = {
	id: 'board.list',
	title: 'List boards',
	description: 'Every board in this workspace.',
	readOnly: true,
	inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
}

let open: AgentBridge[] = []

afterEach(async () => {
	await Promise.all(open.map((bridge) => bridge.close()))
	open = []
})

/** A bridge on an ephemeral port, so tests never collide with a real server or each other. */
async function bridge(options: Partial<ConstructorParameters<typeof AgentBridge>[0]> = {}) {
	const instance = new AgentBridge({ port: 0, token: TOKEN, handshakeTimeoutMs: 200, ...options })
	open.push(instance)
	const port = await instance.ready()
	return { bridge: instance, port }
}

/** A stand-in for the app: connects, and lets a test drive the handshake by hand. */
function client(port: number, origin = 'http://localhost:5173') {
	const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin })
	const received: ServerMessage[] = []
	const waiters: ((message: ServerMessage) => void)[] = []

	socket.on('message', (raw) => {
		const message = JSON.parse(raw.toString()) as ServerMessage
		// Hand straight to a waiting `next()`, or queue it — never both, or one message satisfies
		// two awaits and every later assertion is off by one.
		const waiter = waiters.shift()
		if (waiter) waiter(message)
		else received.push(message)
	})

	return {
		socket,
		received,
		opened: new Promise<void>((resolve, reject) => {
			socket.once('open', () => resolve())
			socket.once('error', reject)
		}),
		next: () =>
			new Promise<ServerMessage>((resolve) => {
				const pending = received.shift()
				if (pending) resolve(pending)
				else waiters.push(resolve)
			}),
		hello: (over: Record<string, unknown> = {}) =>
			socket.send(
				JSON.stringify({
					type: 'hello',
					version: AGENT_PROTOCOL_VERSION,
					token: TOKEN,
					operations: [OPERATION],
					...over,
				})
			),
		closed: new Promise<void>((resolve) => socket.once('close', () => resolve())),
	}
}

describe('isOriginAllowed', () => {
	it('accepts loopback origins on any port — the app can be served from anywhere local', () => {
		for (const origin of [
			'http://localhost:5173',
			'http://localhost:4173',
			'https://127.0.0.1:8080',
			'http://[::1]:3000',
			'http://localhost',
		]) {
			expect(isOriginAllowed(origin), origin).toBe(true)
		}
	})

	it('refuses a remote origin — this is the drive-by web page it exists to stop', () => {
		for (const origin of [
			'https://evil.example.com',
			'http://localhost.evil.com',
			'https://notlocalhost',
			'http://127.0.0.1.evil.com',
		]) {
			expect(isOriginAllowed(origin), origin).toBe(false)
		}
	})

	it('allows a request with no Origin at all, where the token is the only gate', () => {
		// Non-browser clients send none. They can forge one anyway, so refusing here would buy
		// nothing and break legitimate tooling.
		expect(isOriginAllowed(undefined)).toBe(true)
	})

	it('an explicit allow-list replaces the loopback default entirely', () => {
		const allowed = ['https://boards.example.com']
		expect(isOriginAllowed('https://boards.example.com', allowed)).toBe(true)
		expect(isOriginAllowed('http://localhost:5173', allowed)).toBe(false)
		expect(isOriginAllowed(undefined, allowed)).toBe(false)
	})
})

describe('the handshake', () => {
	it('welcomes a good token and takes the manifest', async () => {
		const { bridge: b, port } = await bridge()
		const app = client(port)
		await app.opened
		app.hello()

		// `chat: false` is the default and is stated rather than omitted: the app reads an absent flag as
	// "no agent here", so the relay saying so explicitly is what keeps that inference honest.
	expect(await app.next()).toEqual({
		type: 'welcome',
		version: AGENT_PROTOCOL_VERSION,
		chat: false,
	})
		expect(b.getManifest()).toEqual([OPERATION])
		expect(b.isConnected()).toBe(true)
	})

	it('rejects a bad token and closes', async () => {
		const { bridge: b, port } = await bridge()
		const app = client(port)
		await app.opened
		app.hello({ token: 'wrong' })

		expect(await app.next()).toMatchObject({ type: 'rejected' })
		await app.closed
		expect(b.isConnected()).toBe(false)
	})

	it('rejects a protocol version it cannot speak, naming both sides', async () => {
		const { port } = await bridge()
		const app = client(port)
		await app.opened
		app.hello({ version: 99 })

		const message = await app.next()
		expect(message.type).toBe('rejected')
		if (message.type !== 'rejected') return
		expect(message.reason).toContain('99')
	})

	it('refuses a remote origin before any handshake', async () => {
		const { port } = await bridge()
		const app = client(port, 'https://evil.example.com')
		await app.opened
		expect(await app.next()).toMatchObject({ type: 'rejected' })
		await app.closed
	})

	it('drops a socket that never says hello', async () => {
		const { bridge: b, port } = await bridge()
		const app = client(port)
		await app.opened
		// Says nothing at all — the handshake timeout has to reclaim it.
		await app.closed
		expect(b.isConnected()).toBe(false)
	})

	it('ignores anything but hello until authenticated', async () => {
		const { bridge: b, port } = await bridge()
		const app = client(port)
		await app.opened
		app.socket.send(JSON.stringify({ type: 'manifest', operations: [] }))
		app.hello()

		expect(await app.next()).toMatchObject({ type: 'welcome' })
		// The pre-auth manifest was discarded, not applied.
		expect(b.getManifest()).toEqual([OPERATION])
	})

	it('replaces an existing client, so a reload cannot lock the user out', async () => {
		const { bridge: b, port } = await bridge()
		const first = client(port)
		await first.opened
		first.hello()
		await first.next()

		const second = client(port)
		await second.opened
		second.hello({ operations: [{ ...OPERATION, id: 'board.create' }] })
		expect(await second.next()).toMatchObject({ type: 'welcome' })

		await first.closed
		expect(b.getManifest()).toMatchObject([{ id: 'board.create' }])
		expect(b.isConnected()).toBe(true)
	})
})

describe('invoke', () => {
	async function connected() {
		const { bridge: b, port } = await bridge()
		const app = client(port)
		await app.opened
		app.hello()
		await app.next()
		return { bridge: b, app }
	}

	it('round-trips a call and its result', async () => {
		const { bridge: b, app } = await connected()

		const pending = b.invoke('board.list', { limit: 5 })
		const request = await app.next()
		expect(request).toMatchObject({ type: 'invoke', operation: 'board.list', args: { limit: 5 } })
		if (request.type !== 'invoke') return

		app.socket.send(
			JSON.stringify({ type: 'result', id: request.id, result: { ok: true, data: ['a'] } })
		)
		await expect(pending).resolves.toEqual({ ok: true, data: ['a'] })
	})

	it('matches results to calls by id, not by arrival order', async () => {
		const { bridge: b, app } = await connected()

		const first = b.invoke('board.list', {})
		const second = b.invoke('node.find', {})
		const one = await app.next()
		const two = await app.next()
		if (one.type !== 'invoke' || two.type !== 'invoke') throw new Error('expected invokes')

		// Answered out of order, as a real app would when one operation is slower.
		app.socket.send(JSON.stringify({ type: 'result', id: two.id, result: { ok: true, data: 2 } }))
		app.socket.send(JSON.stringify({ type: 'result', id: one.id, result: { ok: true, data: 1 } }))

		await expect(first).resolves.toEqual({ ok: true, data: 1 })
		await expect(second).resolves.toEqual({ ok: true, data: 2 })
	})

	it('tells the agent what to do when no tab is connected', async () => {
		const { bridge: b } = await bridge()
		const result = await b.invoke('board.list', {})
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('Settings → Agents')
	})

	it('answers rather than hanging when the tab disappears mid-call', async () => {
		const { bridge: b, app } = await connected()
		const pending = b.invoke('board.list', {})
		await app.next()
		app.socket.close()

		const result = await pending
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('disconnected')
	})

	it('times out rather than leaving a tool call open forever', async () => {
		const { bridge: b, port } = await bridge({ invokeTimeoutMs: 60 })
		const app = client(port)
		await app.opened
		app.hello()
		await app.next()

		// The app receives the invoke and simply never answers.
		const result = await b.invoke('board.list', {})
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('did not finish')
	})

	it('ignores a result for an id nobody is waiting on', async () => {
		const { bridge: b, app } = await connected()
		app.socket.send(JSON.stringify({ type: 'result', id: 999, result: { ok: true, data: null } }))
		// Still healthy afterwards.
		const pending = b.invoke('board.list', {})
		const request = await app.next()
		if (request.type !== 'invoke') return
		app.socket.send(
			JSON.stringify({ type: 'result', id: request.id, result: { ok: true, data: 'fine' } })
		)
		await expect(pending).resolves.toEqual({ ok: true, data: 'fine' })
	})
})

describe('manifest updates', () => {
	it('notifies when the offered set changes mid-session', async () => {
		const { bridge: b, port } = await bridge()
		const app = client(port)
		await app.opened

		let changes = 0
		b.onManifestChange(() => changes++)

		app.hello()
		await app.next()
		expect(changes).toBe(1)

		app.socket.send(JSON.stringify({ type: 'manifest', operations: [] }))
		await new Promise((resolve) => setTimeout(resolve, 30))
		expect(changes).toBe(2)
		expect(b.getManifest()).toEqual([])
	})

	it('clears the manifest on disconnect, so a stale list is never served', async () => {
		const { bridge: b, port } = await bridge()
		const app = client(port)
		await app.opened
		app.hello()
		await app.next()

		app.socket.close()
		await new Promise((resolve) => setTimeout(resolve, 30))
		expect(b.getManifest()).toBeNull()
	})
})

describe('parseClientMessage', () => {
	it('reads the three client messages', () => {
		expect(
			parseClientMessage(
				JSON.stringify({ type: 'hello', version: 1, token: 't', operations: [OPERATION] })
			)
		).toMatchObject({ type: 'hello', token: 't' })
		expect(
			parseClientMessage(JSON.stringify({ type: 'result', id: 1, result: { ok: true, data: 5 } }))
		).toEqual({ type: 'result', id: 1, result: { ok: true, data: 5 } })
		expect(parseClientMessage(JSON.stringify({ type: 'manifest', operations: [] }))).toEqual({
			type: 'manifest',
			operations: [],
		})
	})

	it('accepts a Buffer, which is what ws actually delivers', () => {
		const raw = Buffer.from(JSON.stringify({ type: 'manifest', operations: [] }))
		expect(parseClientMessage(raw)).toEqual({ type: 'manifest', operations: [] })
	})

	it('rejects malformed frames — anything on the machine can open this port', () => {
		for (const raw of [
			'not json',
			'[]',
			JSON.stringify({ type: 'hello', version: 1, token: 5, operations: [] }),
			JSON.stringify({ type: 'hello', version: 1, token: 't', operations: [{ id: 'x' }] }),
			JSON.stringify({ type: 'hello', version: 1, token: 't' }),
			JSON.stringify({ type: 'result', id: 'one', result: { ok: true } }),
			JSON.stringify({ type: 'result', id: 1, result: { ok: false } }),
			JSON.stringify({ type: 'manifest' }),
			JSON.stringify({ type: 'unknown' }),
			// An empty prompt is a stray Enter on an empty box, not a turn to run.
			JSON.stringify({ type: 'prompt', text: '   ' }),
			JSON.stringify({ type: 'prompt' }),
		]) {
			expect(parseClientMessage(raw), raw).toBeNull()
		}
	})

	it('reads the chat frames', () => {
		expect(parseClientMessage(JSON.stringify({ type: 'prompt', text: 'add a note' }))).toEqual({
			type: 'prompt',
			text: 'add a note',
		})
		expect(parseClientMessage(JSON.stringify({ type: 'interrupt' }))).toEqual({ type: 'interrupt' })
	})

	it('carries the model and reasoning level the composer picked', () => {
		expect(
			parseClientMessage(
				JSON.stringify({ type: 'prompt', text: 'add a note', model: 'claude-sonnet-5', effort: 'low' })
			)
		).toEqual({ type: 'prompt', text: 'add a note', model: 'claude-sonnet-5', effort: 'low' })
	})

	it('carries the board and selection the panel had', () => {
		expect(
			parseClientMessage(
				JSON.stringify({
					type: 'prompt',
					text: 'name these',
					context: {
						boardId: 'b1',
						boardName: 'Trip',
						selection: [{ id: 'shape:a', type: 'text', label: 'Reykjavik' }],
					},
				})
			)
		).toEqual({
			type: 'prompt',
			text: 'name these',
			context: {
				boardId: 'b1',
				boardName: 'Trip',
				selection: [{ id: 'shape:a', type: 'text', label: 'Reykjavik' }],
			},
		})
	})

	it('bounds the context, which is app-authored but still comes off a socket', () => {
		const message = parseClientMessage(
			JSON.stringify({
				type: 'prompt',
				text: 'go',
				context: {
					boardId: 'b1',
					// Over the cap, and with two entries that are not shapes at all.
					selection: [
						...Array.from({ length: 40 }, (_, index) => ({ id: `shape:${index}`, type: 'text' })),
						{ id: 'shape:no-type' },
						'not an object',
					],
					selectionTotal: 42,
				},
			})
		)

		expect(message?.type).toBe('prompt')
		if (message?.type !== 'prompt') return
		expect(message.context?.selection).toHaveLength(32)
		// A missing label is empty rather than absent, so the host has one shape to format.
		expect(message.context?.selection[0]).toEqual({ id: 'shape:0', type: 'text', label: '' })
		expect(message.context?.selectionTotal).toBe(42)
	})

	it('drops a context that says nothing, keeping the turn', () => {
		for (const context of [{}, { selection: [] }, 'nonsense', null]) {
			const message = parseClientMessage(JSON.stringify({ type: 'prompt', text: 'go', context }))
			expect(message, JSON.stringify(context)).toEqual({ type: 'prompt', text: 'go' })
		}
	})

	/**
	 * A bad selection drops the *field*, not the turn.
	 *
	 * The message is a person's request and the selection only says how to answer it — so an unknown
	 * effort level falls back to the host's own default rather than swallowing what they typed. The
	 * validation still matters: an arbitrary string reaching the SDK's `effort` option is a failed turn,
	 * and an unbounded one is a payload rather than a name.
	 */
	it('drops a selection it does not recognise, keeping the turn', () => {
		for (const selection of [
			{ effort: 'ludicrous' },
			{ effort: 42 },
			{ model: '   ' },
			{ model: 7 },
			{ model: 'x'.repeat(129) },
		]) {
			expect(
				parseClientMessage(JSON.stringify({ type: 'prompt', text: 'add a note', ...selection })),
				JSON.stringify(selection)
			).toEqual({ type: 'prompt', text: 'add a note' })
		}
	})
})

describe('the agent channel', () => {
	it('advertises chat and delivers prompts when a host is behind it', async () => {
		const { bridge: b, port } = await bridge({ chat: true })
		const prompts: string[] = []
		const selections: unknown[] = []
		b.onPrompt((text, _images, selection) => {
			prompts.push(text)
			selections.push(selection)
		})

		const app = client(port)
		await app.opened
		app.hello()

		expect(await app.next()).toEqual({
			type: 'welcome',
			version: AGENT_PROTOCOL_VERSION,
			chat: true,
		})

		app.socket.send(
			JSON.stringify({ type: 'prompt', text: 'add a note', model: 'claude-sonnet-5', effort: 'low' })
		)
		await vi.waitFor(() => expect(prompts).toEqual(['add a note']))
		// Normalised into one object so the host has a single shape to compare against what it is
		// already running — see `onPrompt`.
		expect(selections).toEqual([{ model: 'claude-sonnet-5', effort: 'low' }])

		// A model with no reasoning control sends no effort, and that is a real selection rather than
		// silence: the host has to clear the previous model's level rather than leave it applied.
		app.socket.send(JSON.stringify({ type: 'prompt', text: 'again', model: 'claude-haiku-4-5' }))
		await vi.waitFor(() => expect(prompts).toEqual(['add a note', 'again']))
		expect(selections[1]).toEqual({ model: 'claude-haiku-4-5', effort: null })

		// No model at all is a panel with no opinion, which leaves the host on its launch default.
		app.socket.send(JSON.stringify({ type: 'prompt', text: 'and again' }))
		await vi.waitFor(() => expect(prompts.length).toBe(3))
		expect(selections[2]).toBeNull()

		b.sendChat({ kind: 'text', text: 'Done.' })
		expect(await app.next()).toEqual({ type: 'chat', event: { kind: 'text', text: 'Done.' } })
	})

	/**
	 * The relay and the host share a port and a handshake, so the only thing separating them is this
	 * flag. A prompt reaching a process with no model behind it must go nowhere rather than be
	 * queued for an agent that will never arrive.
	 */
	it('ignores prompts when no agent is behind it', async () => {
		const { bridge: b, port } = await bridge()
		const prompts: string[] = []
		const interrupts: number[] = []
		b.onPrompt((text) => prompts.push(text))
		b.onInterrupt(() => interrupts.push(1))

		const app = client(port)
		await app.opened
		app.hello()
		await app.next()

		app.socket.send(JSON.stringify({ type: 'prompt', text: 'add a note' }))
		app.socket.send(JSON.stringify({ type: 'interrupt' }))
		// Round-tripped through an invoke, so the assertion runs after the frames were processed
		// rather than merely after they were sent.
		void b.invoke('board.list', {})
		await app.next()

		expect(prompts).toEqual([])
		expect(interrupts).toEqual([])
	})
})

describe('images on a prompt', () => {
	const image = { mediaType: 'image/png', data: 'aGVsbG8=' }

	it('carries them to the host', () => {
		expect(
			parseClientMessage(JSON.stringify({ type: 'prompt', text: 'what is this?', images: [image] }))
		).toEqual({ type: 'prompt', text: 'what is this?', images: [image] })
	})

	/** A screenshot with no words is a real question, so it must not be dropped as an empty prompt. */
	it('accepts images with no text at all', () => {
		const parsed = parseClientMessage(JSON.stringify({ type: 'prompt', text: '', images: [image] }))
		expect(parsed).toMatchObject({ type: 'prompt', images: [image] })
	})

	it('still refuses an empty prompt with no images', () => {
		expect(parseClientMessage(JSON.stringify({ type: 'prompt', text: '  ' }))).toBeNull()
	})

	it('leaves a text-only prompt without an images field', () => {
		expect(parseClientMessage(JSON.stringify({ type: 'prompt', text: 'hello' }))).toEqual({
			type: 'prompt',
			text: 'hello',
		})
	})

	/**
	 * Dropped whole rather than sent with the pictures missing: a turn that silently lost its
	 * screenshot gets answered confidently about nothing.
	 */
	it('drops the frame when an image is malformed', () => {
		for (const images of [
			'not-an-array',
			[{ mediaType: 'image/png' }],
			[{ mediaType: 'text/plain', data: 'x' }],
			[{ mediaType: 'image/png', data: '' }],
			[null],
		]) {
			expect(
				parseClientMessage(JSON.stringify({ type: 'prompt', text: 'hi', images })),
				JSON.stringify(images)
			).toBeNull()
		}
	})
})
