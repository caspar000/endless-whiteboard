import { afterEach, describe, expect, it } from 'vitest'
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

		expect(await app.next()).toEqual({ type: 'welcome', version: AGENT_PROTOCOL_VERSION })
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
		]) {
			expect(parseClientMessage(raw), raw).toBeNull()
		}
	})
})
