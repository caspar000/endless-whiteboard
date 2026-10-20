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
 * - `LB_PARITY_A`, `LB_PARITY_B`: the renderers compared, `idle` against `gpu` by default: the GPU
 *   layer present in both (a WebGL layer under the shapes makes the browser composite the page's own
 *   shapes apart, which changes their antialiasing a little), drawing nothing in one and its shapes in
 *   the other, so the difference is the GPU's drawing alone. `dom` against `dom` measures the page's
 *   own run-to-run noise (none, in phase 0).
 * - Each view is also rendered with `dom`: for the baseline, and to report what the GPU layer's
 *   compositing does to the page's own shapes (`COMPOSITING` lines; recorded, not asserted).
 * - `LB_PARITY_MAX`: the share of pixels allowed to differ per screenshot (0.0005, 0.05%).
 * - `LB_PARITY_BASELINE=save|compare`: keeps the `dom` screenshots in `.parity-baseline/`, or
 *   compares against them: the page path unchanged by a phase.
 * - `LB_PARITY=0` skips the spec (it takes a few minutes); `LB_PARITY_TRACE=1` prints each view as it goes.
 */
test.skip(process.env.LB_PARITY === '0', 'LB_PARITY=0')

type Mode = 'dom' | 'gpu' | 'auto' | 'idle'
const A = (process.env.LB_PARITY_A ?? 'idle') as Mode
const B = (process.env.LB_PARITY_B ?? 'gpu') as Mode
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
	{ name: 'gpu-rects', insert: insertGpuRects },
	{ name: 'four-trees', insert: insertFourTrees },
	{
		name: 'synthetic',
		insert: async (page) => {
			await insertSynthetic(page, 3000)
		},
	},
]

/** The GPU renderer's test rectangles (`gpu-test-rect`, registered under automation): their looks. */
async function insertGpuRects(page: Page): Promise<void> {
	await page.evaluate(() => {
		const editor = (window as unknown as { editor: { createShapes(s: unknown[]): void; selectNone(): void } }).editor
		const looks = [
			{},
			{ radius: 0, strokeWidth: 1, fill: '#ffffff', stroke: '#000000' },
			{ radius: 0, strokeWidth: 0 },
			{ radius: 60, strokeWidth: 0, w: 220, h: 120 },
			{ radius: 4, strokeWidth: 12, fill: '#2f9e44', stroke: '#e03131' },
			{ strokeWidth: 3, fill: 'rgba(76, 110, 245, 0.4)', stroke: 'rgba(0, 0, 0, 0.6)' },
			{ w: 24, h: 18, radius: 3, strokeWidth: 2 },
			{ w: 420, h: 30, radius: 15, strokeWidth: 0, fill: '#f08c00' },
		]
		const shapes = []
		for (const [i, props] of looks.entries())
			for (const [j, extra] of [{}, { rotation: 0.35 }, { opacity: 0.5 }, { rotation: -1.1, opacity: 0.8 }].entries())
				shapes.push({ id: `shape:gpu-rect-${i}-${j}`, type: 'gpu-test-rect', x: j * 520, y: i * 300, ...extra, props })
		editor.createShapes(shapes)
		editor.selectNone()
	})
}

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

		// A test per scene and theme: one page through hundreds of large screenshots wore WebKit out
		// (its page crashed partway through the four-tree board in both themes).
		for (const scene of SCENES) for (const theme of THEMES) {
			test(`${scene.name}, ${theme}: ${A} and ${B} draw the same`, async ({ page, browserName }, info) => {
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
				let compositing = 0

				{
					await page.emulateMedia({ colorScheme: theme })
					await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
					for (const z of ZOOMS) {
						const list = views(bounds, z, viewport.width, viewport.height)
						const look = (centre: { x: number; y: number }) =>
							page.evaluate(
								({ centre, z }) => {
									const e = (window as unknown as { editor: { setCamera(c: { x: number; y: number; z: number }): void } }).editor
									e.setCamera({ x: innerWidth / 2 / z - centre.x, y: innerHeight / 2 / z - centre.y, z })
								},
								{ centre, z }
							)
						// Each renderer through every view of this zoom in turn, not each view through the
						// renderers: leaving the GPU renderer removes its canvas and context, and making one
						// for every view wore WebKit out (its page closed partway through the four-tree board).
						const shots: Record<string, Buffer[]> = {}
						for (const mode of [...new Set<Mode>(['dom', A, B])]) {
							shots[mode] = []
							for (const [i, centre] of list.entries()) {
								if (process.env.LB_PARITY_TRACE) console.log(`TRACE z${z} ${mode} v${i}`)
								await look(centre)
								shots[mode]!.push(await render(page, mode))
							}
						}
						for (const i of list.keys()) {
							const name = `${scene.name}-dpr${dpr}-${theme}-z${z}-v${i}`
							const page0 = shots.dom![i]!
							const a = shots[A]![i]!
							const b = shots[B]![i]!
							if (A !== 'dom') compositing = Math.max(compositing, compare(page0, a).ratio)
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
									fs.writeFileSync(file, page0)
								} else if (fs.existsSync(file)) {
									const base = fs.readFileSync(file)
									const r = compare(base, page0)
									if (r.ratio > MAX_RATIO) {
										failures.push(`${name}: ${(r.ratio * 100).toFixed(3)}% differ from the baseline`)
										await attach(info, `${name}-baseline`, { baseline: base, now: page0, diff: PNG.sync.write(r.diff) })
									}
								} else if (fs.existsSync(path.join(BASELINE_DIR, browserName, scene.name))) failures.push(`${name}: no baseline saved`)
								// A scene newer than the baseline has none to compare with: nothing to check yet.
							}
						}
					}
				}
				await page.emulateMedia({ colorScheme: null })
				info.annotations.push({ type: 'parity', description: `${compared} views, worst ${(worst * 100).toFixed(4)}% differing` })
				console.log(`PARITY ${scene.name} ${theme} dpr${dpr}: ${compared} views, worst ${(worst * 100).toFixed(4)}%`)
				if (A !== 'dom') console.log(`COMPOSITING ${scene.name} ${theme} dpr${dpr}: the page beside the GPU layer differs from the page alone by at most ${(compositing * 100).toFixed(4)}%`)
				expect(failures).toEqual([])
			})
		}
	})
}
