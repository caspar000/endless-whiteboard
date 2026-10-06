/**
 * Checks the self-hosted server end to end, as two people would use it: a server board edited in two
 * browsers at once, moved to one browser, and moved back to the server. Starts the built server
 * (apps/server/dist) on an empty data folder, serving the built app (apps/web/dist).
 *
 *   pnpm --filter @lifeboard/web build && pnpm --filter @lifeboard/server build
 *   node scripts/check-server.mjs
 *
 * Prints one line per step, and exits 1 if any step fails.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const repo = new URL('../../../', import.meta.url).pathname
const PORT = 8797
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'correct horse battery staple'
// The first-run demo, renamed so it can't be confused with the other browser's own copy of it.
const DEMO = 'Home office shopping'
const BOARD = 'Shared board'

const { hashPassword } = await import(join(repo, 'apps/server/src/password.ts'))
const server = spawn('node', [join(repo, 'apps/server/dist/main.js')], {
	env: {
		...process.env,
		PORT: String(PORT),
		LIFEBOARD_PORT: String(PORT),
		LIFEBOARD_PASSWORD_HASH: await hashPassword(PASSWORD),
		LIFEBOARD_SESSION_SECRET: 'x'.repeat(32),
		LIFEBOARD_DATA_DIR: mkdtempSync(join(tmpdir(), 'lb-check-server-')),
		LIFEBOARD_WEB_DIR: join(repo, 'apps/web/dist'),
		LIFEBOARD_INSECURE_COOKIES: '1',
	},
	stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((resolve, reject) => {
	server.stdout.on('data', (chunk) => String(chunk).includes('listening') && resolve())
	server.on('exit', (code) => reject(new Error(`The server exited with ${code}`)))
})

let failed = false
const step = async (name, run) => {
	const started = Date.now()
	try {
		const detail = await run()
		console.log(`ok    ${name} (${Date.now() - started} ms)${detail ? ` — ${detail}` : ''}`)
	} catch (error) {
		failed = true
		console.log(`FAIL  ${name}: ${error instanceof Error ? error.message.split('\n')[0] : error}`)
		throw error
	}
}

const browser = await chromium.launch()
async function person() {
	const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
	const page = await context.newPage()
	await page.goto(`${BASE}/login`)
	await page.locator('input[name=password]').fill(PASSWORD)
	await page.locator('button[type=submit]').click()
	await page.locator('.tl-canvas, .lb-list__boards, .lb-list__empty').first().waitFor({ timeout: 30_000 })
	return page
}
const card = (page) => page.locator('.lb-list__board', { hasText: BOARD }).first()
async function openBoard(page) {
	await page.goto(`${BASE}/#/`)
	await card(page).getByRole('button', { name: `Open ${BOARD}` }).click()
	await page.waitForFunction(() => location.hash.includes('/board/') && window.editor, null, { timeout: 30_000 })
	await page.waitForTimeout(500)
}
const shapeX = (page, id) => page.evaluate((shapeId) => window.editor.getShape(shapeId)?.x ?? null, id)
const shapeCount = (page) => page.evaluate(() => window.editor.getCurrentPageShapeIds().size)

try {
	const a = await person()
	const b = await person()

	await step('A renames the first-run demo, which a connected app makes on the server', async () => {
		await a.goto(`${BASE}/#/`)
		const demo = a.locator('.lb-list__board', { hasText: DEMO }).first()
		await demo.hover()
		await demo.getByRole('button', { name: 'Rename' }).click()
		await a.keyboard.press('ControlOrMeta+a')
		await a.keyboard.type(BOARD)
		await a.keyboard.press('Enter')
		await card(a).getByRole('button', { name: 'Move to this device' }).waitFor({ timeout: 15_000 })
	})

	await step('B sees it under its new name and opens it; A opens it too', async () => {
		await b.goto(`${BASE}/#/`)
		await b.reload()
		await card(b).waitFor({ timeout: 15_000 })
		await openBoard(b)
		await openBoard(a)
		const counts = [await shapeCount(a), await shapeCount(b)]
		if (counts[0] !== counts[1] || counts[0] === 0) throw new Error(`shape counts differ: ${counts}`)
		return `${counts[0]} shapes in each`
	})

	const id = 'shape:checkServer'
	await step('A draws a shape; B has it within a second', async () => {
		const started = Date.now()
		await a.evaluate((shapeId) => {
			window.editor.createShapes([{ id: shapeId, type: 'geo', x: -400, y: -300, props: { w: 120, h: 80 } }])
		}, id)
		await b.waitForFunction((shapeId) => !!window.editor.getShape(shapeId), id, { timeout: 5000, polling: 20 })
		const ms = Date.now() - started
		if (ms > 1000) throw new Error(`took ${ms} ms`)
		return `${ms} ms`
	})

	await step('B moves it; A follows', async () => {
		await b.evaluate((shapeId) => window.editor.updateShapes([{ id: shapeId, type: 'geo', x: -200 }]), id)
		await a.waitForFunction((shapeId) => window.editor.getShape(shapeId)?.x === -200, id, { timeout: 5000 })
	})

	const move = async (label, next) => {
		await a.goto(`${BASE}/#/`)
		await card(a).hover()
		await card(a).getByRole('button', { name: label }).click()
		await card(a).getByRole('button', { name: next }).waitFor({ timeout: 30_000 })
	}
	const listedInB = async () => {
		await b.goto(`${BASE}/#/`)
		await b.reload()
		await b.locator('.lb-list__boards, .lb-list__empty').first().waitFor()
		await b.waitForTimeout(1000)
		return (await card(b).count()) > 0
	}

	await step('A moves the board to this device, with the new shape; B no longer lists it', async () => {
		await move('Move to this device', 'Move to server')
		await openBoard(a)
		const x = await shapeX(a, id)
		if (x !== -200) throw new Error(`the shape is at ${x}`)
		if (await listedInB()) throw new Error('B still lists it')
	})

	await step('A moves it back to the server; B opens it with the shape', async () => {
		await move('Move to server', 'Move to this device')
		if (!(await listedInB())) throw new Error('B does not list it')
		await openBoard(b)
		const x = await shapeX(b, id)
		if (x !== -200) throw new Error(`the shape is at ${x}`)
	})
} catch {
	// Reported by `step`; what each browser showed is saved for a look.
	for (const [i, page] of browser.contexts().flatMap((context) => context.pages()).entries()) {
		await page.screenshot({ path: join(tmpdir(), `check-server-${i}.png`) }).catch(() => {})
	}
	console.log(`Screenshots: ${join(tmpdir(), 'check-server-*.png')}`)
} finally {
	await browser.close()
	server.kill()
}
process.exit(failed ? 1 : 0)
