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
 * - `LB_PARITY_A`, `LB_PARITY_B`: the renderers compared, `dom` (the page alone) against `gpu` by
 *   default. `dom` against `dom` measures the page's own run-to-run noise (none, in phase 0).
 *   `LB_PARITY_A=idle` (the GPU layer there, drawing nothing) also reports what the layer does to the
 *   page's own shapes (`COMPOSITING` lines): nothing, since phase 3 put the layer over them.
 * - `LB_PARITY_MAX`: the share of pixels allowed to differ per screenshot (0.0007, 0.07%).
 * - `LB_PARITY_BASELINE=save|compare`: keeps the `dom` screenshots in `.parity-baseline/`, or
 *   compares against them: the page path unchanged by a phase.
 * - `LB_PARITY=0` skips the spec (it takes a few minutes); `LB_PARITY_TRACE=1` prints each view as it goes.
 */
test.skip(process.env.LB_PARITY === '0', 'LB_PARITY=0')

type Mode = 'dom' | 'gpu' | 'auto' | 'idle'
const A = (process.env.LB_PARITY_A ?? 'dom') as Mode
const B = (process.env.LB_PARITY_B ?? 'gpu') as Mode
/**
 * The share of pixels allowed to differ per view: 0.07%. Agreed at 0.05%, raised on 2026-10-21 for
 * sub-pixel differences in where Skia's rasteriser puts an edge (thin borders, haloed lines; they show
 * in dark mode, where a near-white halo meets dark paper), which the user accepted as invisible
 * (docs/gpu-renderer-plan.md, phases 2 and 3). A lost, doubled or moved shape differs by percents.
 */
const MAX_RATIO = Number(process.env.LB_PARITY_MAX ?? 0.0007)
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
	{ name: 'gpu-strokes', insert: insertStrokes },
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
		// Stacking: three overlapping rects (drawn in z-order, not id order), and a page-drawn shape with
		// one rect under it and one over it (the one over it is left to the page).
		shapes.push(
			{ id: 'shape:gpu-rect-stack-c', type: 'gpu-test-rect', x: 0, y: 2500, props: { fill: '#e03131', strokeWidth: 0 } },
			{ id: 'shape:gpu-rect-stack-a', type: 'gpu-test-rect', x: 60, y: 2540, opacity: 0.7, props: { fill: '#2f9e44', strokeWidth: 0 } },
			{ id: 'shape:gpu-rect-stack-b', type: 'gpu-test-rect', x: 120, y: 2580, props: { fill: '#4c6ef5', stroke: '#000000', strokeWidth: 2 } },
			{ id: 'shape:gpu-rect-under', type: 'gpu-test-rect', x: 600, y: 2500, props: { fill: '#f08c00', strokeWidth: 0 } },
			{ id: 'shape:gpu-rect-page', type: 'geo', x: 640, y: 2530, props: { geo: 'ellipse', w: 180, h: 140, fill: 'solid', color: 'violet' } },
			{ id: 'shape:gpu-rect-over', type: 'gpu-test-rect', x: 720, y: 2580, opacity: 0.6, props: { fill: '#1098ad', strokeWidth: 3 } }
		)
		editor.createShapes(shapes)
		editor.selectNone()
	})
}

/** Arrows and lines in every form the GPU draws (phase 3), crossing, kept behind and not. */
async function insertStrokes(page: Page): Promise<void> {
	await page.evaluate(() => {
		const editor = (window as unknown as { editor: { createShapes(s: unknown[]): void; selectNone(): void } }).editor
		const shapes: unknown[] = []
		let n = 0
		const arrow = (props: Record<string, unknown>, meta: Record<string, unknown> = {}, opacity = 1) => {
			const i = n++
			shapes.push({ id: `shape:st-${i}`, type: 'arrow', x: (i % 5) * 300, y: Math.floor(i / 5) * 260, opacity, props: { start: { x: 0, y: 0 }, end: { x: 220, y: 160 }, ...props }, meta })
		}
		for (const arrowheadEnd of ['none', 'arrow']) for (const dash of ['draw', 'solid', 'dashed', 'dotted']) arrow({ arrowheadEnd, dash })
		for (const size of ['s', 'm', 'l', 'xl']) arrow({ size, bend: 60, color: 'blue' })
		for (const bend of [-120, -30, 30, 120]) arrow({ bend, dash: 'dashed', color: 'red' })
		arrow({ kind: 'elbow' })
		arrow({ kind: 'elbow', dash: 'dotted', size: 'l' })
		arrow({ scale: 2.5, arrowheadStart: 'arrow' })
		arrow({ color: 'blue', arrowheadEnd: 'none', size: 'l' }, { 'lifeboard:waypoints': [{ x: 220, y: 0 }, { x: 0, y: 160 }] })
		arrow({ color: 'grey', arrowheadEnd: 'none', size: 's' }, { 'lifeboard:arrowStaysBehind': true })
		arrow({ color: 'violet', size: 'l' }, {}, 0.5)
		// Crossing pairs: the upper one's halo cuts the lower one; kept behind, no halo.
		for (const [y, meta] of [[1600, {}], [1800, { 'lifeboard:arrowStaysBehind': true }]] as const) {
			shapes.push({ id: `shape:st-x${y}a`, type: 'arrow', x: 0, y, props: { start: { x: 0, y: 0 }, end: { x: 600, y: 140 }, color: 'violet', size: 'l', arrowheadEnd: 'none' }, meta })
			shapes.push({ id: `shape:st-x${y}b`, type: 'arrow', x: 0, y, props: { start: { x: 0, y: 140 }, end: { x: 600, y: 0 }, color: 'orange', size: 'l', arrowheadEnd: 'none' }, meta })
		}
		// Lines: both splines, three dashes.
		let l = 0
		for (const spline of ['line', 'cubic'])
			for (const dash of ['solid', 'dashed', 'dotted'])
				shapes.push({
					id: `shape:st-line${l}`,
					type: 'line',
					x: 800 + (l % 3) * 300,
					y: 1600 + Math.floor(l++ / 3) * 260,
					props: { spline, dash, size: 'm', points: { a1: { id: 'a1', index: 'a1', x: 0, y: 0 }, a2: { id: 'a2', index: 'a2', x: 120, y: 180 }, a3: { id: 'a3', index: 'a3', x: 240, y: 40 } } },
				})
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
		// In WebKit only what real Safari runs the GPU layer at: retina, and not the four-tree board,
		// which crashes Playwright's WebKit build (not Safari) with any WebGL canvas under it.
		test.skip(({ browserName }) => browserName === 'webkit' && dpr < 2, 'WebKit below pixel ratio 2 keeps the page')

		// A test per scene and theme: one page through hundreds of large screenshots wore WebKit out
		// (its page crashed partway through the four-tree board in both themes).
		for (const scene of SCENES) for (const theme of THEMES) {
			test(`${scene.name}, ${theme}: ${A} and ${B} draw the same`, async ({ page, browserName }, info) => {
				test.skip(browserName === 'webkit' && scene.name === 'four-trees', "the four-tree board crashes Playwright's WebKit with a WebGL canvas under it")
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
