import { expect, test, type Page, type TestInfo } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { insertGallery } from './fixtures/gallery'
import { insertSynthetic } from './fixtures/synthetic'
import { createBoard, gotoFresh, openBoard, skipFirstRunDemo } from './helpers'

/**
 * Visual parity (docs/gpu-renderer-plan.md, *Verification*): each scene rendered twice in the same
 * browser, with renderer A and renderer B, at the same camera, and the two screenshots compared
 * pixel by pixel. Both come from the same machine in the same run, so there are no stored images
 * for fonts or platforms to break.
 *
 * - `LB_PARITY_A`, `LB_PARITY_B`: the renderers (`dom`, `gpu`, `auto`); `dom` against `dom` until the
 *   GPU renderer exists, which measures the page's own run-to-run noise.
 * - `LB_PARITY_MAX`: the share of pixels allowed to differ per screenshot (0.0005, 0.05%).
 * - `LB_PARITY_BASELINE=save|compare`: keeps renderer A's screenshots in `.parity-baseline/`, or
 *   compares against them: the page path unchanged by a phase.
 * - `LB_PARITY=0` skips the spec (it takes a few minutes).
 */
test.skip(process.env.LB_PARITY === '0', 'LB_PARITY=0')

type Mode = 'dom' | 'gpu' | 'auto'
const A = (process.env.LB_PARITY_A ?? 'dom') as Mode
const B = (process.env.LB_PARITY_B ?? 'dom') as Mode
const MAX_RATIO = Number(process.env.LB_PARITY_MAX ?? 0.0005)
const BASELINE = process.env.LB_PARITY_BASELINE as 'save' | 'compare' | undefined
const BASELINE_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.parity-baseline')

const ZOOMS = [0.1, 0.25, 0.5, 1, 2, 4]
const THEMES = ['dark', 'light'] as const
/** Views at most per zoom, spread over the scene. */
const MAX_VIEWS = 6

type Bounds = { x: number; y: number; w: number; h: number }

/** The app's chrome over the board. */
const CHROME = ['.lb-debug-badge', '.tlui-layout', '.lb-tabs', '.lb-sidebar', '.lb-sidebar-reopen', '.lb-agent-fab', '.lb-dice-tray']
type Scene = { name: string; insert: (page: Page) => Promise<void> }

const SCENES: Scene[] = [
	{
		name: 'gallery',
		insert: async (page) => {
			const r = await insertGallery(page)
			expect(r.failed, 'every shape type takes its defaults').toEqual({})
		},
	},
	{ name: 'four-trees', insert: insertFourTrees },
	{
		name: 'synthetic',
		insert: async (page) => {
			await insertSynthetic(page, 3000)
		},
	},
]

async function insertFourTrees(page: Page): Promise<void> {
	await page.keyboard.press('ControlOrMeta+k')
	await page.locator('.lb-palette__input').fill('>whole-life test')
	await expect(page.locator('.lb-palette__row--on')).toContainText('whole-life test')
	await page.keyboard.press('Enter')
	// Inserted, laid out and settled: thousands of shapes, then nothing more for a moment.
	await expect.poll(() => shapeCount(page), { timeout: 120_000 }).toBeGreaterThan(3000)
	let last = -1
	await expect
		.poll(
			async () => {
				const now = await shapeCount(page)
				const settled = now === last
				last = now
				return settled
			},
			{ timeout: 60_000, intervals: [2000] }
		)
		.toBe(true)
}

const shapeCount = (page: Page) => page.evaluate(() => (window as unknown as { editor: { getCurrentPageShapes(): unknown[] } }).editor.getCurrentPageShapes().length)

/** The cameras to look through at zoom `z`: a grid over the scene, thinned to `MAX_VIEWS`. */
function views(bounds: Bounds, z: number, vw: number, vh: number): { x: number; y: number }[] {
	const w = vw / z
	const h = vh / z
	const cols = Math.max(1, Math.ceil(bounds.w / w))
	const rows = Math.max(1, Math.ceil(bounds.h / h))
	const all: { x: number; y: number }[] = []
	for (let r = 0; r < rows; r++)
		for (let c = 0; c < cols; c++) all.push({ x: bounds.x + Math.min(bounds.w, (c + 0.5) * w), y: bounds.y + Math.min(bounds.h, (r + 0.5) * h) })
	if (all.length <= MAX_VIEWS) return all
	return Array.from({ length: MAX_VIEWS }, (_, i) => all[Math.floor(((i + 0.5) * all.length) / MAX_VIEWS)]!)
}

async function settle(page: Page): Promise<void> {
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
	// Culling settles 250 ms after the camera stops.
	await page.waitForTimeout(400)
}

async function render(page: Page, mode: Mode): Promise<Buffer> {
	await page.evaluate((m) => (window as unknown as { lifeboardRenderer: { set(m: string): void } }).lifeboardRenderer.set(m), mode)
	await settle(page)
	return page.screenshot({ animations: 'disabled', caret: 'hide' })
}

/** Differing pixels as a share of all, and the diff image. */
function compare(a: Buffer, b: Buffer): { ratio: number; diff: PNG } {
	const pa = PNG.sync.read(a)
	const pb = PNG.sync.read(b)
	const diff = new PNG({ width: pa.width, height: pa.height })
	if (pa.width !== pb.width || pa.height !== pb.height) return { ratio: 1, diff }
	const differing = pixelmatch(pa.data, pb.data, diff.data, pa.width, pa.height, { threshold: 0.1 })
	return { ratio: differing / (pa.width * pa.height), diff }
}

async function attach(info: TestInfo, name: string, images: Record<string, Buffer>) {
	for (const [kind, body] of Object.entries(images)) {
		const file = info.outputPath(`${name}-${kind}.png`)
		fs.writeFileSync(file, body)
		await info.attach(`${name}-${kind}.png`, { path: file, contentType: 'image/png' })
	}
}

for (const dpr of [1, 2]) {
	test.describe(`parity at pixel ratio ${dpr}`, () => {
		test.use({ deviceScaleFactor: dpr })

		for (const scene of SCENES) {
			test(`${scene.name}: ${A} and ${B} draw the same`, async ({ page, browserName }, info) => {
				test.setTimeout(30 * 60_000)
				if (browserName === 'chromium') await gotoFresh(page)
				else {
					// WebKit has no CDP to wipe storage with; a fresh context starts empty anyway.
					await page.addInitScript(() => localStorage.setItem('lifeboard:sidebar:collapsed', 'true'))
					await page.goto('/')
				}
				await skipFirstRunDemo(page)
				await createBoard(page, 'Parity')
				await openBoard(page, 'Parity')
				await scene.insert(page)
				// Only the board is compared: the app's chrome over it (tabs, sidebar, toolbars, the
				// debug badge) changes on its own and isn't the renderer's.
				await page.addStyleTag({ content: CHROME.map((c) => `${c} { visibility: hidden !important }`).join('\n') })
				const bounds = await page.evaluate(() => {
					const b = (window as unknown as { editor: { getCurrentPageBounds(): Bounds | undefined } }).editor.getCurrentPageBounds()
					return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : { x: 0, y: 0, w: 1, h: 1 }
				})
				const viewport = page.viewportSize()!
				const failures: string[] = []
				let worst = 0
				let compared = 0

				for (const theme of THEMES) {
					await page.emulateMedia({ colorScheme: theme })
					await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
					for (const z of ZOOMS) {
						const list = views(bounds, z, viewport.width, viewport.height)
						for (const [i, centre] of list.entries()) {
							await page.evaluate(
								({ centre, z }) => {
									const e = (window as unknown as { editor: { setCamera(c: { x: number; y: number; z: number }): void } }).editor
									e.setCamera({ x: innerWidth / 2 / z - centre.x, y: innerHeight / 2 / z - centre.y, z })
								},
								{ centre, z }
							)
							const name = `${scene.name}-dpr${dpr}-${theme}-z${z}-v${i}`
							const a = await render(page, A)
							const b = await render(page, B)
							const { ratio, diff } = compare(a, b)
							compared++
							worst = Math.max(worst, ratio)
							if (ratio > MAX_RATIO) {
								failures.push(`${name}: ${(ratio * 100).toFixed(3)}% of pixels differ`)
								await attach(info, name, { a, b, diff: PNG.sync.write(diff) })
							}
							if (BASELINE) {
								const file = path.join(BASELINE_DIR, browserName, scene.name, `dpr${dpr}`, theme, `z${z}-v${i}.png`)
								if (BASELINE === 'save') {
									fs.mkdirSync(path.dirname(file), { recursive: true })
									fs.writeFileSync(file, a)
								} else if (fs.existsSync(file)) {
									const base = fs.readFileSync(file)
									const r = compare(base, a)
									if (r.ratio > MAX_RATIO) {
										failures.push(`${name}: ${(r.ratio * 100).toFixed(3)}% differ from the baseline`)
										await attach(info, `${name}-baseline`, { baseline: base, now: a, diff: PNG.sync.write(r.diff) })
									}
								} else failures.push(`${name}: no baseline saved`)
							}
						}
					}
				}
				await page.emulateMedia({ colorScheme: null })
				info.annotations.push({ type: 'parity', description: `${compared} views, worst ${(worst * 100).toFixed(4)}% differing` })
				console.log(`PARITY ${scene.name} dpr${dpr}: ${compared} views, worst ${(worst * 100).toFixed(4)}%`)
				expect(failures).toEqual([])
			})
		}
	})
}
