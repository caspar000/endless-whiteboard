import type { Page } from '@playwright/test'

/**
 * The gallery board (docs/gpu-renderer-plan.md): one of every shape the editor knows, and the looks
 * each can take, laid out on a grid, for the parity checks to render both ways.
 *
 * Every registered shape type is placed with its default props, so a type added later shows up here
 * without anyone remembering to. The built-in shapes with many looks (geo, text, notes, lines,
 * arrows, frames, images) get their variants on top. Freehand strokes are drawn with the mouse, as
 * their points are stored encoded.
 */
export interface GalleryResult {
	/** Every type placed, by section. */
	placed: Record<string, number>
	/** Types that couldn't be created with their defaults, and why. */
	failed: Record<string, string>
	/** The board's bounds in page space, to frame it. */
	bounds: { x: number; y: number; w: number; h: number }
}

export async function insertGallery(page: Page): Promise<GalleryResult> {
	const result = await page.evaluate(buildGallery)
	await drawStrokes(page)
	return result
}

/** Runs in the page: everything but the freehand strokes. */
function buildGallery(): GalleryResult {
	interface ShapeLike {
		id: string
		type: string
		x: number
		y: number
		props: Record<string, unknown>
	}
	interface EditorLike {
		shapeUtils: Record<string, unknown>
		createShape(shape: Record<string, unknown>): void
		createShapes(shapes: Record<string, unknown>[]): void
		createBindings(bindings: Record<string, unknown>[]): void
		createAssets(assets: Record<string, unknown>[]): void
		getCurrentPageShapes(): ShapeLike[]
		getCurrentPageBounds(): { x: number; y: number; w: number; h: number } | undefined
		run(fn: () => void): void
		selectNone(): void
	}
	const editor = (window as unknown as { editor: EditorLike }).editor
	const placed: Record<string, number> = {}
	const failed: Record<string, string> = {}
	let n = 0
	const id = () => `shape:gallery-${n++}`
	const count = (section: string) => (placed[section] = (placed[section] ?? 0) + 1)
	const text = (s: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }] })
	const CELL = 360
	const COLS = 10
	let slot = 0
	/** The next free cell's top-left corner. */
	const next = () => {
		const at = { x: (slot % COLS) * CELL, y: Math.floor(slot / COLS) * CELL }
		slot++
		return at
	}
	/** The next row of the grid starts here. */
	const newRow = () => {
		slot = Math.ceil(slot / COLS) * COLS
	}
	const add = (section: string, shape: Record<string, unknown>) => {
		try {
			editor.createShape(shape)
			count(section)
			return true
		} catch (e) {
			failed[`${section}:${String(shape.type)}`] = String(e).slice(0, 200)
			return false
		}
	}

	editor.run(() => {
		// Every registered type, with its defaults (arrows and groups need ends or children: below).
		for (const type of Object.keys(editor.shapeUtils).sort()) {
			if (type === 'arrow' || type === 'group' || type === 'draw' || type === 'highlight') continue
			// The GPU renderer's test shape has a scene of its own (parity.spec.ts).
			if (type.startsWith('gpu-test')) continue
			const at = next()
			add('defaults', { id: id(), type, x: at.x + 20, y: at.y + 20 })
		}
		newRow()

		// Geo: every geo, then fills × dashes on a rectangle, sizes and colours on an ellipse, labels.
		const geos = ['cloud', 'rectangle', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'octagon', 'star', 'rhombus', 'rhombus-2', 'oval', 'trapezoid', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'x-box', 'check-box', 'heart']
		for (const geo of geos) {
			const at = next()
			add('geo', { id: id(), type: 'geo', x: at.x + 20, y: at.y + 20, props: { geo, w: 280, h: 200, richText: text(geo) } })
		}
		newRow()
		for (const fill of ['none', 'semi', 'solid', 'pattern', 'fill', 'lined-fill'])
			for (const dash of ['draw', 'solid', 'dashed', 'dotted']) {
				const at = next()
				add('geo', { id: id(), type: 'geo', x: at.x + 20, y: at.y + 20, props: { geo: 'rectangle', w: 280, h: 200, fill, dash, color: 'blue' } })
			}
		newRow()
		const colors = ['black', 'grey', 'light-violet', 'violet', 'blue', 'light-blue', 'yellow', 'orange', 'green', 'light-green', 'light-red', 'red', 'white']
		for (const color of colors) {
			const at = next()
			add('geo', { id: id(), type: 'geo', x: at.x + 20, y: at.y + 20, props: { geo: 'ellipse', w: 260, h: 260, fill: 'solid', color, richText: text(color), labelColor: color } })
		}
		newRow()
		for (const size of ['s', 'm', 'l', 'xl'])
			for (const font of ['draw', 'sans', 'serif', 'mono']) {
				const at = next()
				add('geo', { id: id(), type: 'geo', x: at.x + 20, y: at.y + 20, props: { geo: 'rectangle', w: 300, h: 220, size, font, richText: text(`${size} ${font} a label that wraps onto a second line`) } })
			}
		newRow()

		// Text: sizes, alignments, a fixed width that wraps.
		for (const size of ['s', 'm', 'l', 'xl'])
			for (const textAlign of ['start', 'middle', 'end']) {
				const at = next()
				add('text', { id: id(), type: 'text', x: at.x + 20, y: at.y + 20, props: { size, textAlign, w: 300, autoSize: false, richText: text(`Text ${size} ${textAlign}, long enough to wrap`) } })
			}
		newRow()

		// Notes: colours and sizes.
		for (const color of colors) {
			const at = next()
			add('note', { id: id(), type: 'note', x: at.x + 20, y: at.y + 20, props: { color, richText: text(`A ${color} note`) } })
		}
		newRow()

		// Lines: every spline, dashed and not.
		for (const spline of ['line', 'cubic'])
			for (const dash of ['draw', 'solid', 'dashed', 'dotted']) {
				const at = next()
				add('line', {
					id: id(),
					type: 'line',
					x: at.x + 20,
					y: at.y + 40,
					props: {
						spline,
						dash,
						points: {
							a1: { id: 'a1', index: 'a1', x: 0, y: 0 },
							a2: { id: 'a2', index: 'a2', x: 140, y: 220 },
							a3: { id: 'a3', index: 'a3', x: 300, y: 60 },
						},
					},
				})
			}
		newRow()

		// Frames: named, one holding a child.
		{
			const at = next()
			const frame = id()
			add('frame', { id: frame, type: 'frame', x: at.x, y: at.y, props: { w: 340, h: 340, name: 'A frame' } })
			add('frame', { id: id(), type: 'geo', parentId: frame, x: 40, y: 60, props: { geo: 'star', w: 200, h: 200, fill: 'solid', color: 'yellow' } })
			const at2 = next()
			add('frame', { id: id(), type: 'frame', x: at2.x, y: at2.y, props: { w: 340, h: 200, name: 'A frame with a long name that is cut off' } })
		}

		// An image from a drawn bitmap (no network).
		{
			const c = document.createElement('canvas')
			c.width = 200
			c.height = 140
			const g = c.getContext('2d')!
			const grad = g.createLinearGradient(0, 0, 200, 140)
			grad.addColorStop(0, '#4f72fc')
			grad.addColorStop(1, '#ffc034')
			g.fillStyle = grad
			g.fillRect(0, 0, 200, 140)
			g.fillStyle = '#fff'
			g.font = 'bold 28px sans-serif'
			g.fillText('image', 50, 80)
			const assetId = 'asset:gallery-image'
			editor.createAssets([{ id: assetId, typeName: 'asset', type: 'image', props: { name: 'gallery.png', src: c.toDataURL('image/png'), w: 200, h: 140, mimeType: 'image/png', isAnimated: false }, meta: {} }])
			for (const [flipX, crop] of [
				[false, null],
				[true, null],
				[false, { topLeft: { x: 0.2, y: 0.1 }, bottomRight: { x: 0.8, y: 0.9 } }],
			] as const) {
				const at = next()
				add('image', { id: id(), type: 'image', x: at.x + 20, y: at.y + 20, props: { assetId, w: 300, h: 210, flipX, crop } })
			}
		}
		newRow()

		// Arrows between pairs of boxes: every head, every dash, bent, labelled, routed, kept behind.
		const heads = ['arrow', 'triangle', 'square', 'dot', 'pipe', 'diamond', 'inverted', 'bar', 'none']
		const arrow = (section: string, props: Record<string, unknown>, meta: Record<string, unknown> = {}, bound = true) => {
			const at = next()
			const a = id()
			const b = id()
			const arr = id()
			add(section, { id: a, type: 'geo', x: at.x + 10, y: at.y + 10, props: { geo: 'rectangle', w: 90, h: 70 } })
			add(section, { id: b, type: 'geo', x: at.x + 240, y: at.y + 260, props: { geo: 'ellipse', w: 90, h: 70 } })
			if (!add(section, { id: arr, type: 'arrow', x: at.x + 100, y: at.y + 80, props: { start: { x: 0, y: 0 }, end: { x: 150, y: 190 }, ...props }, meta })) return
			if (!bound) return
			editor.createBindings([
				{ type: 'arrow', fromId: arr, toId: a, props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
				{ type: 'arrow', fromId: arr, toId: b, props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
			])
		}
		for (const head of heads) arrow('arrows', { arrowheadEnd: head, arrowheadStart: head === 'arrow' ? 'none' : 'dot' })
		for (const dash of ['draw', 'solid', 'dashed', 'dotted']) arrow('arrows', { dash, size: 'l' })
		for (const bend of [-80, 40, 120]) arrow('arrows', { bend })
		arrow('arrows', { richText: text('a label') })
		arrow('arrows', { richText: text('a label in the middle of a bent arrow'), bend: 60 })
		arrow('arrows', { kind: 'elbow' })
		arrow('arrows', { scale: 2 })
		arrow('arrows', {}, {}, false)
		arrow('arrows', { color: 'blue', arrowheadEnd: 'none', size: 'l' }, { 'lifeboard:waypoints': [{ x: 150, y: 0 }, { x: 0, y: 190 }] })
		arrow('arrows', { color: 'grey', arrowheadEnd: 'none', size: 's' }, { 'lifeboard:arrowStaysBehind': true })
		newRow()
	})
	editor.selectNone()
	const bounds = editor.getCurrentPageBounds() ?? { x: 0, y: 0, w: 1, h: 1 }
	return { placed, failed, bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h } }
}

/** Freehand strokes with the draw and highlight tools, in a strip below everything else. */
async function drawStrokes(page: Page): Promise<void> {
	type Cam = { setCamera(c: { x: number; y: number; z: number }): void; setCurrentTool(t: string): void; selectNone(): void; getCurrentPageBounds(): { maxY: number } | undefined }
	const below = await page.evaluate(() => ((window as unknown as { editor: Cam }).editor.getCurrentPageBounds()?.maxY ?? 0) + 80)
	for (const [tool, row] of [
		['draw', 0],
		['highlight', 1],
	] as const) {
		// The strip in view at 100%: screen y 200 is page y `below + row * 300`.
		await page.evaluate(
			({ y, tool }) => {
				const e = (window as unknown as { editor: Cam }).editor
				e.setCamera({ x: 0, y: -y + 200, z: 1 })
				e.setCurrentTool(tool)
			},
			{ y: below + row * 300, tool }
		)
		for (let s = 0; s < 3; s++) {
			const x0 = 120 + s * 380
			await page.mouse.move(x0, 200)
			await page.mouse.down()
			for (let i = 1; i <= 24; i++) await page.mouse.move(x0 + i * 12, 200 + Math.sin(i / 3 + s) * 60 + (s === 2 ? i * 4 : 0))
			await page.mouse.up()
		}
	}
	await page.evaluate(() => {
		const e = (window as unknown as { editor: Cam }).editor
		e.setCurrentTool('select')
		e.selectNone()
	})
}
