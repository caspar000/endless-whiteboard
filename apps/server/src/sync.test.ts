import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROTOCOL_VERSION, SyncClient, type ClientSocket } from '@lifeboard/canvas-sync'
import { createBoardSchema } from '@lifeboard/schema'
import { unzipSync } from 'fflate'
import { AssetRecordType, createShapeId, createTLStore, PageRecordType, type TLShape, type TLStore } from '@lifeboard/canvas'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './app.ts'
import { AssetFiles } from './assets.ts'
import { collectGarbage } from './gc.ts'
import { Rooms } from './rooms.ts'
import { Vault } from './vault.ts'
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
		payload: new URLSearchParams({ username: 'owner', password: PASSWORD, next: '/' }).toString(),
	})
	const session = login.cookies.find((c) => c.name === SESSION_COOKIE)!.value
	return { app, port, cookie: `${SESSION_COOKIE}=${encodeURIComponent(session)}` }
}

/** Node's WebSocket with the session cookie a browser would send by itself. */
const openSocket = (url: string, cookie: string) => new WebSocket(url, { headers: { cookie } } as unknown as string[])

/** The smallest `ClientSocket`: one WebSocket, no reconnecting. */
class NodeSocket implements ClientSocket {
	private ws: WebSocket | undefined
	constructor(
		private readonly url: string,
		private readonly cookie: string
	) {}
	start(handlers: Parameters<ClientSocket['start']>[0]) {
		this.ws = openSocket(this.url, this.cookie)
		this.ws.addEventListener('open', () => handlers.open())
		this.ws.addEventListener('message', (event) => handlers.message(String(event.data)))
		this.ws.addEventListener('close', () => handlers.close())
	}
	send(data: string) {
		if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data)
	}
	reconnect() {}
	stop() {
		this.ws?.close()
	}
}

/** A browser tab, minus the browser: a store kept in sync with one board through the real socket. */
function connect(port: number, cookie: string, boardId: string): Promise<TLStore> {
	const store = createTLStore({ schema: createBoardSchema() })
	const client = new SyncClient({ store, socket: new NodeSocket(`ws://127.0.0.1:${port}/api/sync/${boardId}`, cookie) })
	cleanups.push(() => client.dispose())
	return new Promise((resolve, reject) => {
		client.onStatusChange((status) => {
			if (status.status === 'synced') resolve(store)
			if (status.status === 'error') reject(status.error)
		})
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

	it('keeps the dates of a board moving in, so it keeps its place in the list', async () => {
		const { app, cookie } = await startServer()
		const id = crypto.randomUUID()
		const createdAt = Date.now() - 10 * 24 * 60 * 60 * 1000
		const updatedAt = Date.now() - 2 * 24 * 60 * 60 * 1000
		const created = await app.inject({ method: 'POST', url: '/api/boards', headers: { cookie }, payload: { id, name: 'Old', createdAt, updatedAt } })
		expect(created.json()).toMatchObject({ id, createdAt, updatedAt })
		const future = await app.inject({ method: 'POST', url: '/api/boards', headers: { cookie }, payload: { name: 'Bad', updatedAt: Date.now() + 1e10 } })
		expect(future.statusCode).toBe(400)
	})

	it('keeps a board’s preview, refuses anything but WebP, and drops it with the board', async () => {
		const { app, cookie } = await startServer()
		const board = await createBoard(app, cookie, 'Pictured')
		const url = `/api/boards/${board.id}/thumbnail/light`
		expect((await app.inject({ url, headers: { cookie } })).statusCode).toBe(404)

		const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.from('pixels')])
		const put = (body: Buffer, to = url) =>
			app.inject({ method: 'PUT', url: to, headers: { cookie, 'content-type': 'image/webp' }, payload: body })
		expect((await put(Buffer.from('not an image at all'))).statusCode).toBe(400)
		expect((await put(webp, `/api/boards/${board.id}/thumbnail/sepia`)).statusCode).toBe(404)
		const before = Date.now()
		expect((await put(webp)).statusCode).toBe(204)
		const got = await app.inject({ url, headers: { cookie } })
		expect(got.headers['content-type']).toBe('image/webp')
		expect(Number(got.headers['x-drawn-at'])).toBeGreaterThanOrEqual(before - 1000)
		expect(got.rawPayload.equals(webp)).toBe(true)
		// Each theme has its own.
		expect((await app.inject({ url: `/api/boards/${board.id}/thumbnail/dark`, headers: { cookie } })).statusCode).toBe(404)

		await app.inject({ method: 'DELETE', url: `/api/boards/${board.id}`, headers: { cookie } })
		expect((await app.inject({ url, headers: { cookie } })).statusCode).toBe(404)
	})

	it('keeps vault settings, and refuses ones it does not know or values of the wrong shape', async () => {
		const { app, cookie } = await startServer()
		const put = (key: string, value: unknown) =>
			app.inject({ method: 'PUT', url: `/api/vault/settings/${key}`, headers: { cookie }, payload: { value } })
		expect((await put('disabledExtensions', ['lifeboard.dice'])).statusCode).toBe(204)
		expect((await put('savedQueries', [{ name: 'spend', body: 'sum Price' }])).statusCode).toBe(204)
		expect((await put('theme', 'dark')).statusCode).toBe(404)
		expect((await put('constructor', {})).statusCode).toBe(404)
		expect((await put('savedQueries', [{ name: 1 }])).statusCode).toBe(400)
		expect((await app.inject({ url: '/api/vault/settings', headers: { cookie } })).json()).toEqual({
			disabledExtensions: ['lifeboard.dice'],
			savedQueries: [{ name: 'spend', body: 'sum Price' }],
		})
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

		const a = await connect(port, cookie, board.id)
		const b = await connect(port, cookie, board.id)
		const page = PageRecordType.create({ name: 'Synced', index: 'a2' as never })
		a.put([page])
		await until(() => b.get(page.id) !== undefined)
		expect(b.get(page.id)).toMatchObject({ name: 'Synced' })

		// Everyone leaves and the server restarts: what the next client sees can only come from disk.
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
		const restarted = await startServer()
		const c = await connect(restarted.port, restarted.cookie, board.id)
		expect(c.get(page.id)).toMatchObject({ name: 'Synced' })
	})

	it('opens a board that arrived with content, and hands that content back', async () => {
		const { app, port, cookie } = await startServer()
		const source = createTLStore({ schema: createBoardSchema() })
		const page = PageRecordType.create({ name: 'Brought along', index: 'a2' as never })
		source.put([page])
		const id = crypto.randomUUID()
		const created = await app.inject({
			method: 'POST',
			url: '/api/boards',
			headers: { cookie },
			payload: { id, name: 'Moved', favorite: true, snapshot: source.getStoreSnapshot('document') },
		})
		expect(created.json()).toMatchObject({ id, favorite: true })

		const client = await connect(port, cookie, id)
		expect(client.get(page.id)).toMatchObject({ name: 'Brought along' })

		const back = await app.inject({ url: `/api/boards/${id}/snapshot`, headers: { cookie } })
		expect(back.json().store[page.id]).toMatchObject({ name: 'Brought along' })
		expect(back.json().schema).toBeTruthy()
	})

	it('closes the socket on a board that does not exist', async () => {
		const { port, cookie } = await startServer()
		const ws = openSocket(`ws://127.0.0.1:${port}/api/sync/${crypto.randomUUID()}`, cookie)
		const code = await new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)))
		expect(code).toBe(4404)
	})

	it('refuses an invalid push and a malformed message, and keeps the board as it was', async () => {
		const { app, port, cookie } = await startServer()
		const board = await createBoard(app, cookie, 'Guarded')
		const ws = openSocket(`ws://127.0.0.1:${port}/api/sync/${board.id}`, cookie)
		const replies: Array<{ type: string; action?: string; reason?: string }> = []
		ws.addEventListener('message', (event) => replies.push(JSON.parse(String(event.data))))
		await new Promise((resolve) => ws.addEventListener('open', resolve))
		ws.send(JSON.stringify({ type: 'connect', protocol: PROTOCOL_VERSION, schema: createBoardSchema().serialize() }))
		const page = PageRecordType.create({ name: 'No index', index: 'a2' as never })
		ws.send(JSON.stringify({ type: 'push', pushId: 1, diff: { [page.id]: { op: 'put', record: { ...page, index: 7 } } } }))
		ws.send('not json')
		const code = await new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)))

		expect(replies.map((reply) => reply.action ?? reply.reason ?? reply.type)).toEqual(['connected', 'discard', 'bad-request'])
		expect(code).toBe(4400)
		const snapshot = await app.inject({ url: `/api/boards/${board.id}/snapshot`, headers: { cookie } })
		expect(snapshot.json().store[page.id]).toBeUndefined()
	})

	it('moves a room stored by tldraw sync-core to its own tables, and opens it', async () => {
		const { app, port, cookie } = await startServer()
		// The fixture was written by sync-core 5.5.2 through this server: a geo shape moved to x 30.
		const id = '0f6c1d2e-7a3b-4c5d-9e8f-1a2b3c4d5e6f'
		await app.inject({ method: 'POST', url: '/api/boards', headers: { cookie }, payload: { id, name: 'Old room' } })
		copyFileSync(
			new URL('../../../packages/canvas-sync/src/fixtures/sync-core-room.sqlite', import.meta.url),
			join(config.dataDir, 'rooms', `${id}.sqlite`)
		)
		const client = await connect(port, cookie, id)
		expect(client.get(createShapeId('kept')) as TLShape).toMatchObject({ type: 'geo', x: 30 })
		expect(client.get(createShapeId('gone'))).toBeUndefined()
	})
})

describe('assets', () => {
	const bytes = Buffer.from('a picture, notionally')
	const hash = createHash('sha256').update(bytes).digest('hex')
	const put = (app: Awaited<ReturnType<typeof startServer>>['app'], cookie: string, h: string, body: Buffer) =>
		app.inject({ method: 'PUT', url: `/api/assets/${h}`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: body })

	it('stores bytes under their hash, refuses bytes that do not match it, and serves them back inert', async () => {
		const { app, cookie } = await startServer()
		const missing = () => app.inject({ method: 'POST', url: '/api/assets/missing', headers: { cookie }, payload: { hashes: [hash] } })
		expect((await missing()).json()).toEqual({ missing: [hash] })

		expect((await put(app, cookie, hash, Buffer.from('something else'))).statusCode).toBe(422)
		expect((await put(app, cookie, hash, bytes)).statusCode).toBe(204)
		expect((await missing()).json()).toEqual({ missing: [] })

		const res = await app.inject({ url: `/api/assets/${hash}`, headers: { cookie } })
		expect(res.rawPayload.equals(bytes)).toBe(true)
		expect(res.headers['content-type']).toBe('application/octet-stream')
		expect(res.headers['cache-control']).toContain('immutable')
		expect((await app.inject({ url: '/api/assets/../vault.sqlite', headers: { cookie } })).statusCode).toBe(404)
	})

	it('exports the vault in the app’s backup format', async () => {
		const { app, port, cookie } = await startServer()
		const board = await createBoard(app, cookie, 'Exported')
		await put(app, cookie, hash, bytes)
		const client = await connect(port, cookie, board.id)
		client.put([AssetRecordType.create({ type: 'image', props: { name: 'p', src: `asset:${hash}`, w: 1, h: 1, mimeType: 'image/png', isAnimated: false } })])
		await new Promise((r) => setTimeout(r, 300))

		const zip = unzipSync(new Uint8Array((await app.inject({ url: '/api/export', headers: { cookie } })).rawPayload))
		const manifest = JSON.parse(new TextDecoder().decode(zip['manifest.json']))
		expect(manifest).toMatchObject({ formatVersion: 1, boards: expect.arrayContaining([expect.objectContaining({ id: board.id })]) })
		expect(JSON.parse(new TextDecoder().decode(zip[`boards/${board.id}.json`]))).toHaveProperty('schema')
		expect(Buffer.from(zip[`assets/${hash}`]!).equals(bytes)).toBe(true)
	})
})

describe('asset GC', () => {
	it('sweeps only files that are unreferenced and older than a day', () => {
		const dir = mkdtempSync(join(tmpdir(), 'lb-gc-'))
		const vault = new Vault(join(dir, 'vault.sqlite'))
		const rooms = new Rooms({ dir: join(dir, 'rooms'), schema: createBoardSchema(), onChange: () => {} })
		const assets = new AssetFiles(join(dir, 'assets'))
		const file = (text: string) => {
			const b = Buffer.from(text)
			const h = createHash('sha256').update(b).digest('hex')
			assets.put(h, b)
			return h
		}
		const kept = file('referenced')
		const old = file('orphaned, old')
		const young = file('orphaned, just uploaded')
		const twoDaysAgo = (Date.now() - 2 * 86_400_000) / 1000
		for (const h of [kept, old]) utimesSync(join(dir, 'assets', h), twoDaysAgo, twoDaysAgo)

		const board = vault.create({ vaultId: 'default', name: 'Has a picture' })
		const fakeRooms = { readSnapshot: (id: string) => (id === board.id ? { store: { a: { typeName: 'asset', props: { src: `asset:${kept}` } } }, schema: {} } : null) }
		expect(collectGarbage(vault, fakeRooms as unknown as Rooms, assets)).toEqual({ deleted: 1 })
		expect(assets.has(kept) && assets.has(young) && !assets.has(old)).toBe(true)

		// An image still uploading means nothing can be said about what is referenced.
		const pending = { readSnapshot: () => ({ store: { a: { typeName: 'asset', props: { src: '' } } }, schema: {} }) }
		expect(collectGarbage(vault, pending as unknown as Rooms, assets)).toHaveProperty('skipped')
		rooms.closeAll()
		vault.close()
	})
})

describe('accounts', () => {
	type App = Awaited<ReturnType<typeof startServer>>['app']
	const form = (fields: Record<string, string>) => ({
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		payload: new URLSearchParams(fields).toString(),
	})
	const cookieOf = (res: { cookies: { name: string; value: string }[] }) => {
		const session = res.cookies.find((c) => c.name === SESSION_COOKIE)
		return session ? `${SESSION_COOKIE}=${encodeURIComponent(session.value)}` : ''
	}
	let names = 0
	/** Someone new, through an invite made by `inviter`: into the inviter's vault, or one of their own. */
	async function invited(app: App, inviter: string, kind: 'join' | 'new-vault' = 'join') {
		const invite = await app.inject({ method: 'POST', url: '/api/invites', headers: { cookie: inviter }, payload: { kind } })
		expect(invite.statusCode).toBe(201)
		const { token } = invite.json<{ token: string }>()
		expect((await app.inject({ url: `/invite/${token}`, headers: { accept: 'text/html' } })).statusCode).toBe(200)
		const username = `person${++names}`
		const res = await app.inject({
			method: 'POST',
			url: `/invite/${token}`,
			...form({ username, displayName: `Person ${names}`, password: 'a long enough password', vault: `${username}'s vault` }),
		})
		expect(res.statusCode).toBe(303)
		return { cookie: cookieOf(res), token, username }
	}
	const boardsOf = async (app: App, cookie: string) =>
		(await app.inject({ url: '/api/boards', headers: { cookie } })).json<Array<{ id: string; role: string; sharedBy?: string; favorite: boolean }>>()

	it('begin, on a server from before them, with the owner, their boards and their stars', async () => {
		const dataDir = mkdtempSync(join(tmpdir(), 'lb-upgrade-'))
		const old = new Vault(join(dataDir, 'vault.sqlite'))
		old.db
			.prepare("INSERT INTO boards (vault_id, id, name, created_at, updated_at, favorite) VALUES ('default', 'starred', 'Starred', 1, 2, 1), ('default', 'plain', 'Plain', 1, 3, 0)")
			.run()
		old.close()

		const app = await buildApp({ ...config, dataDir })
		cleanups.push(() => app.close())
		const login = await app.inject({ method: 'POST', url: '/login', ...form({ username: 'owner', password: PASSWORD, next: '/' }) })
		const boards = await boardsOf(app, cookieOf(login))
		expect(boards.map(({ id, favorite, role }) => ({ id, favorite, role }))).toEqual([
			{ id: 'plain', favorite: false, role: 'member' },
			{ id: 'starred', favorite: true, role: 'member' },
		])
	})

	it('keep a session from before accounts, as the owner’s', async () => {
		const { app } = await startServer()
		const legacy = `${SESSION_COOKIE}=${encodeURIComponent(app.signCookie(String(Date.now())))}`
		const me = await app.inject({ url: '/api/me', headers: { cookie: legacy } })
		expect(me.json()).toMatchObject({ username: 'owner', isAdmin: true })
	})

	it('a joining invite brings someone into the vault, once; a new-vault invite is an admin’s, and keeps them apart', async () => {
		const { app, cookie: owner } = await startServer()
		const board = await createBoard(app, owner, 'The vault’s')

		const ann = await invited(app, owner)
		expect((await boardsOf(app, ann.cookie)).find((b) => b.id === board.id)).toMatchObject({ role: 'member' })
		// Used: it doesn't work twice.
		expect((await app.inject({ url: `/invite/${ann.token}`, headers: { accept: 'text/html' } })).statusCode).toBe(404)
		// A member, not an admin: no vaults of their own to hand out.
		expect((await app.inject({ method: 'POST', url: '/api/invites', headers: { cookie: ann.cookie }, payload: { kind: 'new-vault' } })).statusCode).toBe(403)

		const bob = await invited(app, owner, 'new-vault')
		expect((await boardsOf(app, bob.cookie)).some((b) => b.id === board.id)).toBe(false)
		expect((await app.inject({ url: `/api/boards/${board.id}/snapshot`, headers: { cookie: bob.cookie } })).statusCode).toBe(404)
		const bobs = await createBoard(app, bob.cookie, 'Bob’s')
		expect((await boardsOf(app, owner)).some((b) => b.id === bobs.id)).toBe(false)
		expect((await app.inject({ url: '/api/me', headers: { cookie: bob.cookie } })).json()).toMatchObject({ vault: { name: `${bob.username}'s vault` } })
	})

	it('a view link lets someone outside the vault follow a board, and change nothing', async () => {
		const { app, port, cookie: owner } = await startServer()
		const board = await createBoard(app, owner, 'Shared to view')
		const bob = await invited(app, owner, 'new-vault')

		const link = (await app.inject({ method: 'POST', url: `/api/boards/${board.id}/shares`, headers: { cookie: owner }, payload: { role: 'view' } })).json<{ id: string; token: string }>()
		const follow = await app.inject({ url: `/share/${link.token}`, headers: { cookie: bob.cookie, accept: 'text/html' } })
		expect(follow.headers.location).toBe(`/#/board/${board.id}`)
		expect((await boardsOf(app, bob.cookie)).find((b) => b.id === board.id)).toMatchObject({ role: 'view', sharedBy: 'My vault' })

		// The board's vault decides its name; a star is anyone's own.
		expect((await app.inject({ method: 'PATCH', url: `/api/boards/${board.id}`, headers: { cookie: bob.cookie }, payload: { name: 'Mine now' } })).statusCode).toBe(403)
		expect((await app.inject({ method: 'PATCH', url: `/api/boards/${board.id}`, headers: { cookie: bob.cookie }, payload: { favorite: true } })).json()).toMatchObject({ favorite: true })
		expect((await boardsOf(app, owner)).find((b) => b.id === board.id)).toMatchObject({ favorite: false })
		expect((await app.inject({ method: 'DELETE', url: `/api/boards/${board.id}`, headers: { cookie: bob.cookie } })).statusCode).toBe(403)

		// Live: the owner's change arrives; the viewer's own is refused.
		const ownerStore = await connect(port, owner, board.id)
		const bobStore = await connect(port, bob.cookie, board.id)
		const page = PageRecordType.create({ name: 'From the owner', index: 'a5' as never })
		ownerStore.put([page])
		await until(() => bobStore.get(page.id) !== undefined)
		const bobsPage = PageRecordType.create({ name: 'From the viewer', index: 'a6' as never })
		bobStore.put([bobsPage])
		await new Promise((r) => setTimeout(r, 300))
		expect(ownerStore.get(bobsPage.id)).toBeUndefined()

		// The vault sees who has it, and can take the link back.
		const shares = (await app.inject({ url: `/api/boards/${board.id}/shares`, headers: { cookie: owner } })).json<{ people: Array<{ username: string; role: string }> }>()
		expect(shares.people).toEqual([expect.objectContaining({ username: bob.username, role: 'view' })])
		expect((await app.inject({ method: 'DELETE', url: `/api/shares/${link.id}`, headers: { cookie: owner } })).statusCode).toBe(204)
		expect((await boardsOf(app, bob.cookie)).some((b) => b.id === board.id)).toBe(false)
		expect((await app.inject({ url: `/share/${link.token}`, headers: { cookie: bob.cookie, accept: 'text/html' } })).statusCode).toBe(404)
	})

	it('an edit link lets someone outside the vault change the board, and leave it', async () => {
		const { app, port, cookie: owner } = await startServer()
		const board = await createBoard(app, owner, 'Shared to edit')
		const bob = await invited(app, owner, 'new-vault')
		const link = (await app.inject({ method: 'POST', url: `/api/boards/${board.id}/shares`, headers: { cookie: owner }, payload: { role: 'edit' } })).json<{ token: string }>()
		await app.inject({ url: `/share/${link.token}`, headers: { cookie: bob.cookie, accept: 'text/html' } })

		const ownerStore = await connect(port, owner, board.id)
		const bobStore = await connect(port, bob.cookie, board.id)
		const page = PageRecordType.create({ name: 'From the editor', index: 'a7' as never })
		bobStore.put([page])
		await until(() => ownerStore.get(page.id) !== undefined)

		expect((await app.inject({ method: 'DELETE', url: `/api/boards/${board.id}/access/me`, headers: { cookie: bob.cookie } })).statusCode).toBe(204)
		expect((await boardsOf(app, bob.cookie)).some((b) => b.id === board.id)).toBe(false)
	})

	it('a new password ends other sessions and keeps this one', async () => {
		const { app, cookie: owner } = await startServer()
		const ann = await invited(app, owner)
		const other = await app.inject({ method: 'POST', url: '/login', ...form({ username: ann.username.toUpperCase(), password: 'a long enough password', next: '/' }) })
		const otherCookie = cookieOf(other)
		expect(otherCookie).not.toBe('')

		const changed = await app.inject({ method: 'POST', url: '/api/me/password', headers: { cookie: ann.cookie }, payload: { current: 'a long enough password', next: 'an even longer password' } })
		expect(changed.statusCode).toBe(204)
		expect((await app.inject({ url: '/api/me', headers: { cookie: otherCookie } })).statusCode).toBe(401)
		expect((await app.inject({ url: '/api/me', headers: { cookie: cookieOf(changed) } })).statusCode).toBe(200)
	})
})
