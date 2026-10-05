import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 6 of docs/canvas-fork-plan.md: two pages on one board through the lab's sync server
 * (sync-server.ts, our own protocol from packages/canvas-sync). The server runs as a child process,
 * so a test can kill it and start it again on the same files.
 */

type Editor = {
	createShapes(shapes: object[]): void
	updateShapes(shapes: object[]): void
	getShape(id: string): { x: number; y: number; props: Record<string, unknown> } | undefined
}

const SYNC_PORT = 5193
const dir = mkdtempSync(join(tmpdir(), 'canvas-lab-sync-e2e-'))
let server: ChildProcess | undefined

async function startServer() {
	const child = spawn('node', ['sync-server.ts'], {
		cwd: join(import.meta.dirname, '..'),
		env: { ...process.env, LAB_SYNC_PORT: String(SYNC_PORT), LAB_SYNC_DIR: dir },
		stdio: ['ignore', 'pipe', 'inherit'],
	})
	await new Promise<void>((resolve, reject) => {
		child.stdout!.on('data', (chunk: Buffer) => {
			if (chunk.toString().includes('Lab sync server on')) resolve()
		})
		child.on('exit', (code) => reject(new Error(`The sync server exited with ${code}`)))
	})
	server = child
}

async function stopServer() {
	const child = server
	server = undefined
	if (!child || child.exitCode !== null) return
	const exited = new Promise((resolve) => child.on('exit', resolve))
	child.kill('SIGTERM')
	await exited
}

test.beforeEach(startServer)
test.afterEach(stopServer)

async function openBoard(page: Page, room: string) {
	await page.goto(`/?sync=${room}&syncPort=${SYNC_PORT}`)
	await page.waitForFunction(() => 'editor' in window)
}

const shapeIn = (page: Page, id: string) =>
	page.evaluate((shapeId) => (window as unknown as { editor: Editor }).editor.getShape(shapeId) ?? null, id)

test('an edit in one page appears in the other in under a second', async ({ context }) => {
	const room = `live-${Date.now()}`
	const [a, b] = [await context.newPage(), await context.newPage()]
	await openBoard(a, room)
	await openBoard(b, room)

	const id = 'shape:shared'
	const started = Date.now()
	await a.evaluate((shapeId) => {
		;(window as unknown as { editor: Editor }).editor.createShapes([
			{ id: shapeId, type: 'geo', x: 100, y: 100, props: { w: 160, h: 100, geo: 'rectangle' } },
		])
	}, id)
	await b.waitForFunction((shapeId) => !!(window as unknown as { editor: Editor }).editor.getShape(shapeId), id, {
		polling: 20,
	})
	expect(Date.now() - started).toBeLessThan(1000)

	// And back the other way.
	await b.evaluate((shapeId) => {
		;(window as unknown as { editor: Editor }).editor.updateShapes([{ id: shapeId, type: 'geo', x: 240 }])
	}, id)
	await expect.poll(async () => (await shapeIn(a, id))?.x).toBe(240)

	// A page opened later gets the board as it is.
	const c = await context.newPage()
	await openBoard(c, room)
	await expect.poll(async () => (await shapeIn(c, id))?.x).toBe(240)
})

test('an edit made while the server is down arrives once it is back', async ({ context }) => {
	const room = `restart-${Date.now()}`
	const [a, b] = [await context.newPage(), await context.newPage()]
	await openBoard(a, room)
	await openBoard(b, room)
	const id = 'shape:survivor'
	await a.evaluate((shapeId) => {
		;(window as unknown as { editor: Editor }).editor.createShapes([
			{ id: shapeId, type: 'geo', x: 100, y: 100, props: { w: 160, h: 100, geo: 'rectangle' } },
		])
	}, id)
	await expect.poll(async () => (await shapeIn(b, id))?.x).toBe(100)

	await stopServer()
	await a.evaluate((shapeId) => {
		;(window as unknown as { editor: Editor }).editor.updateShapes([{ id: shapeId, type: 'geo', x: 300 }])
	}, id)
	await a.waitForTimeout(500)
	expect((await shapeIn(b, id))?.x).toBe(100)

	await startServer()
	await expect.poll(async () => (await shapeIn(b, id))?.x, { timeout: 20_000 }).toBe(300)
	// The edit is on disk, not only in the two pages.
	const c = await context.newPage()
	await openBoard(c, room)
	await expect.poll(async () => (await shapeIn(c, id))?.x).toBe(300)
})
