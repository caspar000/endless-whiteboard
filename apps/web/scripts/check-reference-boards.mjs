/**
 * Opens the reference boards (packages/canvas/fixtures, captured on tldraw 5.5 in phase 0 of
 * docs/canvas-fork-plan.md) in the app as it is now, and saves what it shows next to what tldraw 5.5
 * showed, for a person to compare:
 *
 *   <out>/<board>.then.png  <out>/<board>.now.png                  the board exported as an image
 *   <out>/<board>.then.screen.png  <out>/<board>.now.screen.png    the viewport
 *
 * The boards go in through the app's own backup import, as a user's would.
 *
 *   pnpm exec vite --port 5181 &        (in apps/web)
 *   node scripts/check-reference-boards.mjs http://localhost:5181 /tmp/reference-boards
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { zipSync } from 'fflate'

const BASE = process.argv[2] ?? 'http://localhost:5181'
const OUT = process.argv[3] ?? '/tmp/reference-boards'
const FIXTURES = new URL('../../../packages/canvas/fixtures/', import.meta.url).pathname
const BOARDS = ['lifeboard', 'default-shapes']
mkdirSync(OUT, { recursive: true })

// A backup, as the app writes one: a manifest, a snapshot per board, and the assets they use.
const encoder = new TextEncoder()
const files = {}
const manifest = { formatVersion: 1, appVersion: 'reference', exportedAt: Date.now(), boards: [] }
for (const name of BOARDS) {
	files[`boards/${name}.json`] = readFileSync(join(FIXTURES, `${name}.json`))
	manifest.boards.push({ id: name, name: `Reference: ${name}`, createdAt: 0, updatedAt: 0 })
}
for (const hash of readdirSync(join(FIXTURES, 'assets'))) {
	files[`assets/${hash}`] = readFileSync(join(FIXTURES, 'assets', hash))
}
files['manifest.json'] = encoder.encode(JSON.stringify(manifest))
const zipPath = join(OUT, 'reference-boards.zip')
writeFileSync(zipPath, zipSync(files))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

await page.goto(`${BASE}/`)
await page.locator('.tl-canvas, .lb-list__boards, .lb-list__empty').first().waitFor()
await page.getByRole('button', { name: 'Settings' }).click()
await page.getByRole('button', { name: 'Storage', exact: true }).click()
const chooser = page.waitForEvent('filechooser')
await page.getByRole('button', { name: /^Import/ }).first().click()
await (await chooser).setFiles(zipPath)
// A finished import lands on the board list by itself.
for (const name of BOARDS) {
	await page.locator('.lb-list__board', { hasText: `Reference: ${name}` }).first().waitFor({ timeout: 30_000 })
}

for (const name of BOARDS) {
	await page.goto(`${BASE}/#/`)
	await page.locator('.lb-list__board', { hasText: `Reference: ${name}` }).first().click()
	await page.waitForFunction(() => location.hash.includes('/board/') && window.editor, null, { timeout: 30_000 })
	await page.waitForTimeout(1500)
	const png = await page.evaluate(async () => {
		const editor = window.editor
		editor.selectNone()
		editor.zoomToFit({ animation: { duration: 0 } })
		await new Promise((resolve) => setTimeout(resolve, 800))
		const ids = [...editor.getCurrentPageShapeIds()]
		const { blob } = await editor.toImage(ids, { format: 'png', background: true, padding: 32 })
		return [...new Uint8Array(await blob.arrayBuffer())]
	})
	writeFileSync(join(OUT, `${name}.now.png`), Buffer.from(png))
	await page.locator('.tl-canvas:visible').first().screenshot({ path: join(OUT, `${name}.now.screen.png`) })
	copyFileSync(join(FIXTURES, `${name}.png`), join(OUT, `${name}.then.png`))
	copyFileSync(join(FIXTURES, `${name}.screen.png`), join(OUT, `${name}.then.screen.png`))
	console.log(`${name}: saved`)
}

if (errors.length) console.log(`Page errors:\n  ${errors.join('\n  ')}`)
await browser.close()
