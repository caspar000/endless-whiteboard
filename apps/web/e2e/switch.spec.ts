import { expect, test, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { createBoard, gotoFresh, openBoard, skipFirstRunDemo } from './helpers'

/**
 * The renderer switching under `auto` (docs/gpu-renderer-plan.md, phase 2): with more of the GPU's
 * shapes on screen than the budget the GPU layer takes them over, and with fewer it hands them back,
 * and no frame on the way may lose a shape, show one twice or jump. A board of half-transparent test
 * rectangles (a doubled one shows darker) with the budget set low, zoomed out across it and back in,
 * each step shot several times as the switch settles and compared with the page drawing it alone.
 */

const CHROME = ['.lb-debug-badge', '.tlui-layout', '.lb-tabs', '.lb-sidebar', '.lb-sidebar-reopen', '.lb-agent-fab', '.lb-dice-tray']
/** Missing or doubled shapes differ by percents; antialiasing and the compositing beside the GPU layer by tenths of one at most. */
const MAX_RATIO = 0.004
const BUDGET = 40

type Renderer = {
	set(m: string): void
	get(): string
	scene(e: unknown): { autoOn: { get(): boolean }; layerUp: { get(): boolean }; onScreen: { get(): number }; starts: number; autoSwitches: number }
}

const state = (page: Page) =>
	page.evaluate(() => {
		const r = (window as unknown as { lifeboardRenderer: Renderer; editor: unknown }).lifeboardRenderer
		const s = r.scene((window as unknown as { editor: unknown }).editor)
		return { autoOn: s.autoOn.get(), up: s.layerUp.get(), onScreen: s.onScreen.get(), switches: s.autoSwitches }
	})

const setMode = (page: Page, mode: string) => page.evaluate((m) => (window as unknown as { lifeboardRenderer: Renderer }).lifeboardRenderer.set(m), mode)

const camera = (page: Page, z: number) =>
	page.evaluate((z) => {
		const e = (window as unknown as { editor: { setCamera(c: { x: number; y: number; z: number }): void } }).editor
		// The grid's middle in the middle of the screen.
		e.setCamera({ x: innerWidth / 2 / z - 1500, y: innerHeight / 2 / z - 1100, z })
	}, z)

function ratio(a: Buffer, b: Buffer): number {
	const pa = PNG.sync.read(a)
	const pb = PNG.sync.read(b)
	return pixelmatch(pa.data, pb.data, null, pa.width, pa.height, { threshold: 0.1 }) / (pa.width * pa.height)
}

test('auto switches to the GPU and back with nothing lost, doubled or moved on the way', async ({ page }) => {
	test.setTimeout(10 * 60_000)
	await page.addInitScript((budget) => localStorage.setItem('lifeboard:gpu-budget', String(budget)), BUDGET)
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Switch')
	await openBoard(page, 'Switch')
	await page.evaluate(() => {
		const editor = (window as unknown as { editor: { createShapes(s: unknown[]): void; selectNone(): void } }).editor
		const shapes = []
		for (let i = 0; i < 300; i++)
			shapes.push({ id: `shape:sw-${i}`, type: 'gpu-test-rect', x: (i % 20) * 150, y: Math.floor(i / 20) * 150, opacity: 0.5, rotation: (i % 7) * 0.2, props: { w: 110, h: 80, radius: 12, strokeWidth: 3, fill: '#4c6ef5', stroke: '#e03131' } })
		editor.createShapes(shapes)
		editor.selectNone()
	})
	await page.addStyleTag({ content: CHROME.map((c) => `${c} { visibility: hidden !important }`).join('\n') })
	await setMode(page, 'auto')

	const failures: string[] = []
	let sawOn = false
	// In, out across the budget, and back in.
	for (const z of [2, 1, 0.6, 0.4, 0.3, 0.2, 0.15, 0.3, 0.6, 1, 2]) {
		await setMode(page, 'dom')
		await camera(page, z)
		await page.waitForTimeout(500)
		const reference = await page.screenshot({ animations: 'disabled' })
		await setMode(page, 'auto')
		// Shot as it settles: culling updates 250 ms after the camera stops, and the switch follows it.
		for (let shot = 0; shot < 5; shot++) {
			const now = await page.screenshot({ animations: 'disabled' })
			const r = ratio(reference, now)
			const s = await state(page)
			sawOn ||= s.up
			if (r > MAX_RATIO) failures.push(`z${z} shot ${shot}: ${(r * 100).toFixed(3)}% differ (gpu ${s.up ? 'up' : 'down'}, ${s.onScreen} on screen)`)
			await page.waitForTimeout(80)
		}
	}
	expect(sawOn, 'the GPU layer came up when the rects on screen passed the budget').toBe(true)
	expect(failures).toEqual([])

	// Back where few are on screen, it's off; and hovering about the budget doesn't switch to and fro.
	await camera(page, 2)
	await page.waitForTimeout(600)
	expect((await state(page)).up).toBe(false)
	const before = (await state(page)).switches
	for (const z of [0.9, 1.1, 0.9, 1.1, 0.9, 1.1]) {
		await camera(page, z)
		await page.waitForTimeout(400)
	}
	expect((await state(page)).switches - before, 'one switch on, at most, for a count wobbling about the budget').toBeLessThanOrEqual(1)
})
