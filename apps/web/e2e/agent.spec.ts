import { expect, test, type Page } from '@playwright/test'
import { WebSocketServer, type WebSocket } from 'ws'
import { gotoFresh, openSettings, skipFirstRunDemo } from './helpers'

/**
 * The agent bridge, end to end: a real WebSocket server in this process drives the real app through
 * the real protocol, and the operations run against a live tldraw editor.
 *
 * This is the half the MCP server package cannot test. Its own suite covers the server side with a
 * fake app; this covers the app side with a fake server. Between them the wire is exercised from
 * both ends — and here the assertions are about the *board*, which is the only thing that finally
 * matters: did a node actually appear, is the relation one a table could follow, does ⌘Z undo an
 * agent's work the way it undoes a person's.
 */

const TOKEN = 'e2e-token'
const NOTE = 'node.markdown'

interface Manifest {
	id: string
	title: string
	description: string
	readOnly: boolean
	inputSchema: unknown
}

type OperationResult = { ok: true; data: unknown } | { ok: false; error: string }

/** Stands in for `packages/mcp-server`: accepts the handshake and relays operation calls. */
class FakeServer {
	private readonly wss: WebSocketServer
	private client: WebSocket | null = null
	private nextId = 1
	private readonly pending = new Map<number, (result: OperationResult) => void>()
	private connected!: () => void

	manifest: Manifest[] = []
	readonly ready = new Promise<void>((resolve) => {
		this.connected = resolve
	})

	private constructor(wss: WebSocketServer) {
		this.wss = wss
		this.wss.on('connection', (socket) => {
			socket.on('message', (raw) => {
				const message = JSON.parse(raw.toString()) as Record<string, unknown>
				if (message.type === 'hello') {
					if (message.token !== TOKEN) {
						socket.send(JSON.stringify({ type: 'rejected', reason: 'bad token' }))
						socket.close()
						return
					}
					this.client = socket
					this.manifest = message.operations as Manifest[]
					socket.send(JSON.stringify({ type: 'welcome', version: 1 }))
					this.connected()
				} else if (message.type === 'result') {
					const resolve = this.pending.get(message.id as number)
					if (resolve) {
						this.pending.delete(message.id as number)
						resolve(message.result as OperationResult)
					}
				} else if (message.type === 'manifest') {
					this.manifest = message.operations as Manifest[]
				}
			})
		})
	}

	static async start(): Promise<{ server: FakeServer; port: number }> {
		const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
		await new Promise<void>((resolve) => wss.once('listening', () => resolve()))
		const address = wss.address()
		const port = address && typeof address === 'object' ? address.port : 0
		return { server: new FakeServer(wss), port }
	}

	/** Calls an operation and returns its result. Fails the test rather than hanging silently. */
	async invoke(operation: string, args: Record<string, unknown> = {}): Promise<OperationResult> {
		const socket = this.client
		if (!socket) throw new Error('The app has not connected yet')
		const id = this.nextId++
		return new Promise<OperationResult>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`${operation} never answered`)),
				30_000
			)
			this.pending.set(id, (result) => {
				clearTimeout(timer)
				resolve(result)
			})
			socket.send(JSON.stringify({ type: 'invoke', id, operation, args }))
		})
	}

	/** Calls an operation and asserts it succeeded, returning the data. */
	async run(operation: string, args: Record<string, unknown> = {}): Promise<unknown> {
		const result = await this.invoke(operation, args)
		if (!result.ok) throw new Error(`${operation} failed: ${result.error}`)
		return result.data
	}

	async close(): Promise<void> {
		this.client?.close()
		await new Promise<void>((resolve) => this.wss.close(() => resolve()))
	}
}

/**
 * Switches the bridge on for this origin and reloads so it connects.
 *
 * Written straight to localStorage rather than through Settings → Agents: the panel is covered by
 * its own concerns, and driving a form here would make every assertion below depend on that UI.
 */
async function enableBridge(page: Page, port: number): Promise<void> {
	await page.evaluate(
		({ token, agentPort }) => {
			localStorage.setItem('lifeboard:agentEnabled', 'true')
			localStorage.setItem('lifeboard:agentToken', token)
			localStorage.setItem('lifeboard:agentPort', String(agentPort))
		},
		{ token: TOKEN, agentPort: port }
	)
	await page.reload()
}

/** Shapes of a type on the *visible* board, read from the live editor. */
async function countShapes(page: Page, type: string): Promise<number> {
	return page.evaluate((shapeType) => {
		const editor = (window as unknown as { editor?: { getCurrentPageShapes(): { type: string }[] } })
			.editor
		if (!editor) throw new Error('window.editor is not exposed')
		return editor.getCurrentPageShapes().filter((s) => s.type === shapeType).length
	}, type)
}

test.describe('the agent bridge', () => {
	let server: FakeServer
	let port: number

	test.beforeEach(async () => {
		const started = await FakeServer.start()
		server = started.server
		port = started.port
	})

	test.afterEach(async () => {
		await server.close()
	})

	test('connects, announces its operations, and builds a board end to end', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await enableBridge(page, port)

		// --- the handshake ---
		await server.ready
		const ids = server.manifest.map((op) => op.id)
		expect(ids).toContain('board.create')
		expect(ids).toContain('node.insert')
		expect(ids).toContain('relation.connect')
		// Read-only hints survive the wire, which is what an MCP client shows the agent.
		expect(server.manifest.find((op) => op.id === 'board.list')?.readOnly).toBe(true)
		expect(server.manifest.find((op) => op.id === 'node.insert')?.readOnly).toBe(false)

		// --- a board, from nothing ---
		const board = (await server.run('board.create', { name: 'Agent board' })) as { id: string }
		expect(board.id).toBeTruthy()
		await expect(page.locator('.lb-tabs__tab--active .lb-tabs__label')).toHaveText('Agent board')

		// --- two nodes, with text ---
		const desk = (await server.run('node.insert', { type: NOTE, text: '# Standing desk' })) as {
			id: string
			label: string
		}
		const chair = (await server.run('node.insert', { type: NOTE, text: '# Desk chair' })) as {
			id: string
		}
		expect(desk.label).toBe('Standing desk')
		// They are really on the canvas, not merely in a response.
		expect(await countShapes(page, NOTE)).toBe(2)

		// --- a property, and a value on one of them ---
		await server.run('property.create', { name: 'Price', type: 'number' })
		const written = (await server.run('property.set', {
			shapeId: desk.id,
			property: 'Price',
			value: '2399',
		})) as { value: unknown }
		// Sent as text, stored as a number — the agent should see that it was understood.
		expect(written.value).toBe(2399)

		// --- a relation ---
		const relation = (await server.run('relation.connect', {
			from: desk.id,
			to: chair.id,
		})) as { id: string }
		expect(relation.id).toBeTruthy()
		expect(await countShapes(page, 'arrow')).toBe(1)

		// --- reading it back ---
		const found = (await server.run('node.find', { query: 'desk' })) as { matched: number }
		expect(found.matched).toBe(2)

		const listed = (await server.run('relation.list')) as {
			matched: number
			relations: { from: { label: string }; to: { label: string } }[]
		}
		expect(listed.matched).toBe(1)
		expect(listed.relations[0]).toMatchObject({
			from: { label: 'Standing desk' },
			to: { label: 'Desk chair' },
		})

		const summed = (await server.run('board.query', {
			property: 'Price',
			op: 'sum',
		})) as { value: number }
		expect(summed.value).toBe(2399)
	})

	test('an agent’s work is undoable, one operation at a time', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await enableBridge(page, port)
		await server.ready

		await server.run('board.create', { name: 'Undo board' })
		const first = (await server.run('node.insert', { type: NOTE, text: 'One' })) as { id: string }
		const second = (await server.run('node.insert', { type: NOTE, text: 'Two' })) as { id: string }
		await server.run('relation.connect', { from: first.id, to: second.id })

		expect(await countShapes(page, 'arrow')).toBe(1)
		expect(await countShapes(page, NOTE)).toBe(2)

		// The whole point of running agent writes through the live editor: a human watching can take
		// them back the same way they take back their own.
		await page.locator('.lb-board-host:not([data-hidden]) .tl-canvas').click({ position: { x: 5, y: 5 } })
		await page.keyboard.press('ControlOrMeta+z')
		await expect.poll(() => countShapes(page, 'arrow')).toBe(0)
		// One stopping point per operation — the notes are still there.
		expect(await countShapes(page, NOTE)).toBe(2)

		await page.keyboard.press('ControlOrMeta+z')
		await expect.poll(() => countShapes(page, NOTE)).toBe(1)
	})

	test('reports failures the agent can act on, and keeps working afterwards', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await enableBridge(page, port)
		await server.ready

		// No board open yet: the operation must say what to do rather than failing opaquely.
		const noBoard = await server.invoke('node.find')
		expect(noBoard.ok).toBe(false)
		if (!noBoard.ok) expect(noBoard.error).toContain('board.open')

		await server.run('board.create', { name: 'Recovery board' })

		// An unknown node type names the ones that exist.
		const badType = await server.invoke('node.insert', { type: 'node.nonsense' })
		expect(badType.ok).toBe(false)
		if (!badType.ok) expect(badType.error).toContain(NOTE)

		// A required argument that was not sent.
		const missing = await server.invoke('property.set', { shapeId: 'x', property: 'Price' })
		expect(missing.ok).toBe(false)
		if (!missing.ok) expect(missing.error).toContain('value')

		// Deleting a board still refuses without confirmation.
		const boards = (await server.run('board.list')) as { id: string }[]
		const refused = await server.invoke('board.delete', { boardId: boards[0]!.id, confirm: false })
		expect(refused.ok).toBe(false)
		expect(((await server.run('board.list')) as unknown[]).length).toBe(boards.length)

		// And the connection is still healthy after all of that.
		const inserted = await server.invoke('node.insert', { type: NOTE, text: 'Still working' })
		expect(inserted.ok).toBe(true)
		expect(await countShapes(page, NOTE)).toBe(1)
	})

	/**
	 * The consent surface. Everything else here talks to the bridge directly, which is the right way
	 * to test the wire — but the switch in Settings is what a person actually uses to grant this, so
	 * it gets driven the way they drive it.
	 */
	test('is granted from Settings → Agents, and read-only restricts what is offered', async ({
		page,
	}) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		// Off by default: nothing has been granted, so nothing connects.
		await openSettings(page, 'Agents')
		const allow = page.getByLabel('Allow agent access')
		const readOnly = page.getByLabel('Read-only')
		await expect(allow).not.toBeChecked()

		// The port and token have to be right before switching on, or there is nothing to connect to.
		await page.getByLabel('Port').fill(String(port))
		await page.getByLabel('Token').fill(TOKEN)
		await readOnly.check()
		await allow.check()

		await server.ready
		const ids = server.manifest.map((op) => op.id)
		expect(ids).toContain('board.list')
		// Withheld, not merely refused — an agent should not see a tool it cannot use.
		expect(ids).not.toContain('node.insert')
		expect(server.manifest.every((op) => op.readOnly)).toBe(true)

		// And the gate holds even if the server asks for something it was never offered.
		const refused = await server.invoke('node.insert', { type: NOTE, text: 'nope' })
		expect(refused.ok).toBe(false)
		if (!refused.ok) expect(refused.error).toContain('read-only')

		// The grant survives a reload — it is a preference, not a session.
		await page.reload()
		await openSettings(page, 'Agents')
		await expect(page.getByLabel('Allow agent access')).toBeChecked()
		await expect(page.getByLabel('Read-only')).toBeChecked()

		// Turning read-only off widens what is offered, without touching the connection switch.
		await page.getByLabel('Read-only').uncheck()
		await expect
			.poll(() => server.manifest.map((op) => op.id))
			.toContain('node.insert')
	})

	test('refuses a bad token, and the app offers nothing', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		await page.evaluate(
			({ agentPort }) => {
				localStorage.setItem('lifeboard:agentEnabled', 'true')
				localStorage.setItem('lifeboard:agentToken', 'wrong-token')
				localStorage.setItem('lifeboard:agentPort', String(agentPort))
			},
			{ agentPort: port }
		)
		await page.reload()

		// The server never accepts the handshake, so nothing is ever offered.
		await page.waitForTimeout(1_000)
		expect(server.manifest).toEqual([])
	})
})
