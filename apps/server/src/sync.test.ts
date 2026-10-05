import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBoardSchema } from '@lifeboard/schema'
import {
	JsonChunkAssembler,
	TLSyncClient,
	type TLPersistentClientSocket,
	type TLSocketStatusChangeEvent,
} from '@tldraw/sync-core'
import { atom, createTLStore, PageRecordType, type TLStore } from 'tldraw'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './app.ts'
import { SESSION_COOKIE } from './auth.ts'
import { loadConfig, type ServerConfig } from './config.ts'
import { hashPassword } from './password.ts'

const PASSWORD = 'correct horse battery staple'

let config: ServerConfig
const cleanups: (() => void | Promise<void>)[] = []

beforeAll(async () => {
	config = loadConfig({
		LIFEBOARD_PASSWORD_HASH: await hashPassword(PASSWORD),
		LIFEBOARD_SESSION_SECRET: 'x'.repeat(32),
		LIFEBOARD_WEB_DIR: '/nonexistent',
		LIFEBOARD_DATA_DIR: mkdtempSync(join(tmpdir(), 'lb-sync-')),
		LIFEBOARD_INSECURE_COOKIES: '1',
	})
})

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function startServer() {
	const app = await buildApp(config)
	await app.listen({ port: 0, host: '127.0.0.1' })
	cleanups.push(() => app.close())
	const { port } = app.server.address() as { port: number }
	const login = await app.inject({
		method: 'POST',
		url: '/login',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		payload: new URLSearchParams({ password: PASSWORD, next: '/' }).toString(),
	})
	const session = login.cookies.find((c) => c.name === SESSION_COOKIE)!.value
	return { app, port, cookie: `${SESSION_COOKIE}=${encodeURIComponent(session)}` }
}

/**
 * tldraw's own client socket is browser-only (it listens to `window` for online/offline), so this is
 * the smallest stand-in: one WebSocket, carrying the session cookie a browser would send by itself.
 */
class NodeSocket implements TLPersistentClientSocket {
	connectionStatus: 'online' | 'offline' | 'error' = 'offline'
	private readonly ws: WebSocket
	private readonly assembler = new JsonChunkAssembler()
	private readonly messageListeners = new Set<(msg: object) => void>()
	private readonly statusListeners = new Set<(event: TLSocketStatusChangeEvent) => void>()

	constructor(url: string, cookie: string) {
		this.ws = new WebSocket(url, { headers: { cookie } } as unknown as string[])
		this.ws.addEventListener('open', () => this.setStatus('online'))
		this.ws.addEventListener('close', () => this.setStatus('offline'))
		this.ws.addEventListener('message', (event) => {
			const result = this.assembler.handleMessage(String(event.data))
			if (result && 'data' in result) for (const listener of this.messageListeners) listener(result.data)
		})
	}

	private setStatus(status: 'online' | 'offline') {
		this.connectionStatus = status
		for (const listener of this.statusListeners) listener({ status })
	}

	sendMessage(msg: object) {
		this.ws.send(JSON.stringify(msg))
	}
	onReceiveMessage(cb: (msg: object) => void) {
		this.messageListeners.add(cb)
		return () => this.messageListeners.delete(cb)
	}
	onStatusChange(cb: (event: TLSocketStatusChangeEvent) => void) {
		this.statusListeners.add(cb)
		return () => this.statusListeners.delete(cb)
	}
	restart() {}
	close() {
		this.ws.close()
	}
}

/** A browser tab, minus the browser: a store kept in sync with one board through the real socket. */
function connect(port: number, cookie: string, boardId: string, sessionId: string): Promise<TLStore> {
	const store = createTLStore({ schema: createBoardSchema() })
	return new Promise((resolve, reject) => {
		const socket = new NodeSocket(`ws://127.0.0.1:${port}/api/sync/${boardId}?sessionId=${sessionId}`, cookie)
		const client = new TLSyncClient({
			store,
			socket,
			presence: atom('presence', null),
			onLoad: () => resolve(store),
			onSyncError: (reason) => reject(new Error(reason)),
		})
		cleanups.push(() => client.close())
	})
}

async function createBoard(app: Awaited<ReturnType<typeof startServer>>['app'], cookie: string, name: string) {
	const res = await app.inject({ method: 'POST', url: '/api/boards', headers: { cookie }, payload: { name } })
	expect(res.statusCode).toBe(201)
	return res.json<{ id: string; name: string }>()
}

const until = async (check: () => boolean, ms = 5000) => {
	const end = Date.now() + ms
	while (!check()) {
		if (Date.now() > end) throw new Error('Timed out waiting for sync')
		await new Promise((r) => setTimeout(r, 20))
	}
}

describe('board index', () => {
	it('creates, renames, favourites, lists and deletes boards', async () => {
		const { app, cookie } = await startServer()
		const board = await createBoard(app, cookie, 'Plans')

		const renamed = await app.inject({ method: 'PATCH', url: `/api/boards/${board.id}`, headers: { cookie }, payload: { name: 'Plans 2', favorite: true } })
		expect(renamed.json()).toMatchObject({ id: board.id, name: 'Plans 2', favorite: true })

		const list = await app.inject({ url: '/api/boards', headers: { cookie } })
		expect(list.json()).toContainEqual(expect.objectContaining({ id: board.id, name: 'Plans 2' }))

		expect((await app.inject({ method: 'DELETE', url: `/api/boards/${board.id}`, headers: { cookie } })).statusCode).toBe(204)
		expect((await app.inject({ method: 'DELETE', url: `/api/boards/${board.id}`, headers: { cookie } })).statusCode).toBe(404)
	})

	it('keeps an id it is given, refuses a duplicate, and refuses ids that are not file-safe', async () => {
		const { app, cookie } = await startServer()
		const id = crypto.randomUUID()
		expect((await app.inject({ method: 'POST', url: '/api/boards', headers: { cookie }, payload: { id, name: 'Moved' } })).json()).toMatchObject({ id })
		expect((await app.inject({ method: 'POST', url: '/api/boards', headers: { cookie }, payload: { id, name: 'Again' } })).statusCode).toBe(409)
		expect((await app.inject({ method: 'POST', url: '/api/boards', headers: { cookie }, payload: { id: '../x', name: 'Bad' } })).statusCode).toBe(400)
	})

	it('is closed to anyone without a session', async () => {
		const { app } = await startServer()
		expect((await app.inject({ url: '/api/boards' })).statusCode).toBe(401)
	})
})

describe('sync', () => {
	it('carries a change from one client to another, and keeps it across a restart', async () => {
		const { app, port, cookie } = await startServer()
		const board = await createBoard(app, cookie, 'Shared')

		const a = await connect(port, cookie, board.id, 'a')
		const b = await connect(port, cookie, board.id, 'b')
		const page = PageRecordType.create({ name: 'Synced', index: 'a2' as never })
		a.put([page])
		await until(() => b.get(page.id) !== undefined)
		expect(b.get(page.id)).toMatchObject({ name: 'Synced' })

		// Everyone leaves and the server restarts: what the next client sees can only come from disk.
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
		const restarted = await startServer()
		const c = await connect(restarted.port, restarted.cookie, board.id, 'c')
		expect(c.get(page.id)).toMatchObject({ name: 'Synced' })
	})

	it('closes the socket on a board that does not exist', async () => {
		const { port, cookie } = await startServer()
		const ws = new WebSocket(`ws://127.0.0.1:${port}/api/sync/${crypto.randomUUID()}?sessionId=a`, {
			headers: { cookie },
		} as unknown as string[])
		const code = await new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)))
		expect(code).toBe(4404)
	})
})
