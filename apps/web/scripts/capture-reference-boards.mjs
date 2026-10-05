/**
 * Builds the reference boards for the canvas fork (docs/canvas-fork-plan.md, phase 0) in the app as it
 * is today, on tldraw 5.5, and saves what that app stores and shows:
 *
 *   packages/canvas/fixtures/<board>.json         the store snapshot ({ store, schema })
 *   packages/canvas/fixtures/<board>.png          the board exported as an image
 *   packages/canvas/fixtures/<board>.screen.png   the viewport, as a person sees it
 *   packages/canvas/fixtures/assets/<sha256>      bytes the boards reference
 *
 * Only meaningful before the cutover: afterwards the app no longer runs on tldraw 5.5.
 *
 *   pnpm exec vite --port 5181 &        (in apps/web)
 *   node scripts/capture-reference-boards.mjs http://localhost:5181
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.argv[2] ?? 'http://localhost:5181'
const OUT = new URL('../../../packages/canvas/fixtures/', import.meta.url).pathname
mkdirSync(`${OUT}assets`, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('pageerror', (error) => console.error('page error:', error.message))

/** Waits for the board in the URL to have an editor. */
async function onBoard() {
	await page.waitForFunction(() => location.hash.includes('/board/') && window.editor, null, { timeout: 30_000 })
	await page.waitForTimeout(500)
}

/** A real pointer gesture with the given tool, so the stored format is what a person's stroke makes. */
async function drag(tool, points) {
	// Pointer events outside the viewport are dropped, so frame the board and the gesture first.
	await page.evaluate((pts) => {
		const editor = window.editor
		editor.selectNone()
		const xs = pts.map((p) => p.x)
		const ys = pts.map((p) => p.y)
		const page = editor.getCurrentPageBounds()
		const minX = Math.min(...xs, page?.minX ?? 0)
		const minY = Math.min(...ys, page?.minY ?? 0)
		const maxX = Math.max(...xs, page?.maxX ?? 0)
		const maxY = Math.max(...ys, page?.maxY ?? 0)
		editor.zoomToBounds({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, { inset: 80, animation: { duration: 0 } })
	}, points)
	await page.evaluate((t) => { window.editor.setCurrentTool(t) }, tool)
	const screen = await page.evaluate((pts) => pts.map((p) => window.editor.pageToScreen(p)), points)
	await page.mouse.move(screen[0].x, screen[0].y)
	await page.mouse.down()
	for (const p of screen.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 })
	await page.mouse.up()
	await page.evaluate(() => { window.editor.setCurrentTool('select') })
}

async function save(name) {
	const result = await page.evaluate(async () => {
		const editor = window.editor
		editor.selectNone()
		editor.zoomToFit({ animation: { duration: 0 } })
		await new Promise((r) => setTimeout(r, 800))
		const ids = [...editor.getCurrentPageShapeIds()]
		const { blob } = await editor.toImage(ids, { format: 'png', background: true, padding: 32 })
		const png = [...new Uint8Array(await blob.arrayBuffer())]
		return { snapshot: editor.store.getStoreSnapshot(), png }
	})
	writeFileSync(`${OUT}${name}.json`, `${JSON.stringify(result.snapshot, null, '\t')}\n`)
	writeFileSync(`${OUT}${name}.png`, Buffer.from(result.png))
	await page.locator('.tl-canvas:visible').first().screenshot({ path: `${OUT}${name}.screen.png` })
	const counts = {}
	for (const r of Object.values(result.snapshot.store)) counts[r.typeName === 'shape' ? `shape:${r.type}` : r.typeName] = (counts[r.typeName === 'shape' ? `shape:${r.type}` : r.typeName] ?? 0) + 1
	console.log(name, counts)
	return counts
}

/** A reference board missing one of its shapes is worse than none: it would vouch for a gap. */
function expectTypes(counts, types) {
	const missing = types.filter((type) => !counts[`shape:${type}`])
	if (missing.length) throw new Error(`The reference board is missing: ${missing.join(', ')}`)
}

const doc = (...paragraphs) => ({ type: 'doc', content: paragraphs })
const p = (...content) => ({ type: 'paragraph', content })
const t = (text, ...marks) => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) })

// ── Board 1: Lifeboard. The first-run demo, plus every node type and both kinds of relation. ────────
await page.goto(`${BASE}/`)
await onBoard()
await page.evaluate(async ({ richNote }) => {
	const editor = window.editor
	const notes = editor.getCurrentPageShapes().filter((s) => s.type === 'node.markdown')
	const right = Math.max(...editor.getCurrentPageShapes().map((s) => editor.getShapePageBounds(s.id).maxX)) + 120
	editor.createShapes([
		{ type: 'node.book', x: right, y: 0 },
		{ type: 'node.quote', x: right, y: 420 },
		{ type: 'node.roll', x: right + 360, y: 0 },
		{ type: 'note', x: right + 360, y: 320, props: { richText: richNote } },
	])
	// Kept for the relation drawn below: the two notes it joins, by id.
	window.__relationEnds = [notes[0].id, notes[1].id]
}, { richNote: doc(p(t('A sticky with '), t('bold', 'bold'), t(' text'))) })
// Relations are arrows bound at both ends: draw them the way a person does.
for (const hidden of [false, true]) {
	const [a, b] = await page.evaluate(() => window.__relationEnds.map((id) => window.editor.getShapePageBounds(id).center))
	await drag('arrow', [{ x: a.x, y: a.y + (hidden ? 30 : 0) }, { x: b.x, y: b.y + (hidden ? 30 : 0) }])
	if (hidden) {
		await page.evaluate(() => {
			const editor = window.editor
			const arrow = editor.getCurrentPageShapes().filter((s) => s.type === 'arrow').at(-1)
			editor.updateShape({ id: arrow.id, type: 'arrow', meta: { ...arrow.meta, 'lifeboard:relHidden': true } })
		})
	}
}
expectTypes(await save('lifeboard'), ['node.markdown', 'node.table', 'node.book', 'node.quote', 'node.roll', 'note', 'arrow'])

// ── Board 2: every default shape, and every record format the fork must read (fork-parity.md, D). ───
await page.evaluate(() => document.querySelector('[aria-label="New board"]')?.click())
await page.waitForTimeout(1500)
await onBoard()

const png = await page.evaluate(async () => {
	const c = document.createElement('canvas')
	c.width = 160
	c.height = 120
	const g = c.getContext('2d')
	const grad = g.createLinearGradient(0, 0, 160, 120)
	grad.addColorStop(0, '#3b82f6')
	grad.addColorStop(1, '#f97316')
	g.fillStyle = grad
	g.fillRect(0, 0, 160, 120)
	g.fillStyle = '#fff'
	g.font = 'bold 28px sans-serif'
	g.fillText('IMG', 50, 70)
	const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
	return [...new Uint8Array(await blob.arrayBuffer())]
})

await page.evaluate(async ({ png, rich }) => {
	const editor = window.editor
	const ids = {}
	const geo = (key, x, y, props = {}) => {
		editor.createShape({ type: 'geo', x, y, props: { w: 160, h: 100, ...props } })
		ids[key] = editor.getCurrentPageShapes().at(-1).id
	}
	geo('a', 0, 0, { geo: 'rectangle', color: 'blue', fill: 'solid', richText: rich.label })
	geo('b', 420, 0, { geo: 'ellipse', color: 'green', fill: 'semi' })
	geo('c', 0, 260, { geo: 'star', color: 'red', fill: 'pattern', dash: 'dashed' })
	geo('d', 420, 260, { geo: 'cloud', color: 'violet', fill: 'none', dash: 'dotted' })
	geo('scaled', 820, 0, { geo: 'triangle', color: 'orange', fill: 'fill' })
	editor.updateShape({ id: ids.scaled, type: 'geo', props: { scale: 1.5 } })
	geo('flipped', 820, 260, { geo: 'arrow-right', color: 'light-blue', fill: 'solid' })
	editor.flipShapes([ids.flipped], 'horizontal')

	editor.createShape({ type: 'text', x: 0, y: 480, props: { richText: rich.text, textAlign: 'middle', autoSize: false, w: 300 } })
	editor.createShape({ type: 'note', x: 420, y: 480, props: { color: 'yellow', labelColor: 'red', richText: rich.note } })

	// A frame with two children, and a group.
	editor.createShape({ type: 'frame', x: 1200, y: 0, props: { w: 420, h: 300, name: 'A frame' } })
	const frame = editor.getCurrentPageShapes().at(-1).id
	editor.createShapes([
		{ type: 'geo', parentId: frame, x: 20, y: 60, props: { w: 120, h: 80, geo: 'diamond' } },
		{ type: 'note', parentId: frame, x: 200, y: 60, props: { color: 'green', richText: rich.child } },
	])
	editor.createShapes([
		{ type: 'geo', x: 1200, y: 380, props: { w: 100, h: 100, geo: 'hexagon' } },
		{ type: 'geo', x: 1340, y: 380, props: { w: 100, h: 100, geo: 'oval' } },
	])
	const two = editor.getCurrentPageShapes().slice(-2).map((s) => s.id)
	editor.groupShapes(two)

	// An image: uploaded through the app's own pipeline, then cropped and flipped.
	const file = new File([new Uint8Array(png)], 'reference.png', { type: 'image/png' })
	await editor.putExternalContent({ type: 'files', files: [file], point: { x: 1300, y: 640 } })
	for (let i = 0; i < 50 && !editor.getAssets().some((a) => a.type === 'image' && a.props.src); i++) await new Promise((r) => setTimeout(r, 100))
	const image = editor.getCurrentPageShapes().find((s) => s.type === 'image')
	editor.updateShape({ id: image.id, type: 'image', props: { crop: { topLeft: { x: 0.1, y: 0.1 }, bottomRight: { x: 0.9, y: 0.9 } } } })
	editor.flipShapes([image.id], 'horizontal')

	// Records the fork has to read even with nothing to show them: a video, an embed, a bookmark.
	editor.createAssets([
		{ id: 'asset:reference-video', typeName: 'asset', type: 'video', meta: {}, props: { name: 'clip.mp4', src: 'https://example.com/clip.mp4', w: 320, h: 180, mimeType: 'video/mp4', isAnimated: true, fileSize: 1024 } },
		{ id: 'asset:reference-bookmark', typeName: 'asset', type: 'bookmark', meta: {}, props: { src: 'https://example.com', title: 'Example', description: 'A bookmark', image: '', favicon: '' } },
	])
	editor.createShapes([
		{ type: 'video', x: 0, y: 760, props: { w: 320, h: 180, assetId: 'asset:reference-video' } },
		{ type: 'embed', x: 420, y: 760, props: { w: 480, h: 270, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } },
		{ type: 'bookmark', x: 960, y: 760, props: { w: 300, h: 320, url: 'https://example.com', assetId: 'asset:reference-bookmark' } },
	])
	window.__ids = ids
}, {
	png,
	rich: {
		label: doc(p(t('Rich '), t('label', 'bold'))),
		text: doc(p(t('Formatted '), t('text', 'italic'), t(' with '), t('code', 'code')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('first'))] }, { type: 'listItem', content: [p(t('second'))] }] }),
		note: doc(p(t('Sticky, red label'))),
		child: doc(p(t('In the frame'))),
	},
})

// Strokes and arrows from real gestures.
await drag('draw', [{ x: 60, y: 1100 }, { x: 140, y: 1040 }, { x: 220, y: 1120 }, { x: 300, y: 1050 }, { x: 380, y: 1110 }])
// Well clear of the embed: an iframe under the pointer swallows the gesture.
await drag('highlight', [{ x: 60, y: 1300 }, { x: 240, y: 1300 }, { x: 380, y: 1310 }])
const centre = (key) => page.evaluate((k) => window.editor.getShapePageBounds(window.__ids[k]).center, key)
const [a, b, c] = [await centre('a'), await centre('b'), await centre('c')]
await drag('arrow', [a, b])
// Between offset shapes, so the elbow arrow actually bends.
await drag('arrow', [c, b])
await drag('line', [{ x: 820, y: 560 }, { x: 1000, y: 640 }])
await page.evaluate((label) => {
	const editor = window.editor
	const [straight, elbow] = editor.getCurrentPageShapes().filter((s) => s.type === 'arrow').slice(-2)
	editor.updateShape({ id: straight.id, type: 'arrow', props: { richText: label } })
	editor.updateShape({ id: elbow.id, type: 'arrow', props: { kind: 'elbow' } })
}, doc(p(t('bound, labelled'))))

// A second page, so page records are part of the reference too.
await page.evaluate(() => { window.editor.createPage({ name: 'Second page' }) })
expectTypes(await save('default-shapes'), ['geo', 'text', 'note', 'line', 'frame', 'group', 'image', 'video', 'embed', 'bookmark', 'draw', 'highlight', 'arrow'])

// The image's bytes, so the boards can be shown somewhere other than this browser.
const hash = await page.evaluate(() => window.editor.getAssets().find((a) => a.type === 'image').props.src.slice('asset:'.length))
writeFileSync(`${OUT}assets/${hash}`, Buffer.from(png))

await browser.close()
