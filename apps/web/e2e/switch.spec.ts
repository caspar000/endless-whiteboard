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
	test.skip(!!process.env.LB_GPU_BUDGET, 'sets a budget of its own: LB_GPU_BUDGET overrides it')
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

test('a node the GPU draws still exports as it shows', async ({ page }) => {
	// Its element is hidden (`visibility: hidden`), which the export's style copy would carry into
	// every child: board previews and the agent's look at the board came out blank.
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Export')
	await openBoard(page, 'Export')
	const id = await page.evaluate(() => {
		const w = window as unknown as { lifeboardRenderer: { set(m: string): void }; editor: { createShapes(s: unknown[]): void; getCurrentPageShapes(): { id: string; type: string }[] } }
		w.editor.createShapes([{ type: 'node.markdown', x: 100, y: 100, props: { w: 220, h: 120, md: '# Exported heading', autoHeight: false } }])
		w.lifeboardRenderer.set('gpu')
		return w.editor.getCurrentPageShapes().find((s) => s.type === 'node.markdown')!.id
	})
	const element = page.locator(`.tl-shape:not(.tl-shape-background)[data-shape-id="${id}"]`)
	await expect.poll(() => element.evaluate((el) => (el as HTMLElement).style.visibility), { timeout: 10_000 }).toBe('hidden')
	const svg = await page.evaluate(async (id) => {
		const e = (window as unknown as { editor: { getSvg(ids: string[], o: unknown): Promise<SVGSVGElement | undefined> } }).editor
		const out = await e.getSvg([id], { padding: 0, background: false })
		return out ? new XMLSerializer().serializeToString(out) : ''
	}, id)
	expect(svg).toContain('Exported heading')
	expect(svg).not.toMatch(/visibility:\s*hidden/)
	// And the element is hidden again afterwards: the GPU still draws it.
	await expect(element).toHaveCSS('visibility', 'hidden')
})

test('the shapes the GPU draws stay in the accessibility tree, named in a list', async ({ page }) => {
	// Their elements are hidden (`visibility: hidden`), which takes them out of it (phase 6).
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Named')
	await openBoard(page, 'Named')
	await page.evaluate(() => {
		const w = window as unknown as { lifeboardRenderer: { set(m: string): void }; editor: { createShapes(s: unknown[]): void } }
		const text = (v: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: v }] }] })
		w.editor.createShapes([{ type: 'geo', x: 100, y: 100, props: { w: 200, h: 120, richText: text('A box the GPU draws') } }])
		w.lifeboardRenderer.set('gpu')
	})
	const list = page.getByRole('list', { name: 'Shapes on the canvas' })
	await expect(list.getByRole('listitem').filter({ hasText: 'A box the GPU draws' })).toHaveCount(1)
	// Back on the page, the shape's own element is there to read, and the list goes.
	await page.evaluate(() => (window as unknown as { lifeboardRenderer: { set(m: string): void } }).lifeboardRenderer.set('dom'))
	await expect(list).toHaveCount(0)
	await expect(page.locator('.tl-shape').getByText('A box the GPU draws').first()).toBeVisible()
})
