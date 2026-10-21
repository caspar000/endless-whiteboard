import { atom, react, transact, type Atom } from '@tldraw/state'
import type { TLShape, TLShapeId } from '@tldraw/tlschema'
import type { Editor } from '../editor/Editor'
import { rasterCanvas } from './atlas'
import { getGpuScene } from './gpuScene'
import { readGpuColor, type GpuColor, type GpuImage, type GpuPrimitive } from './primitives'

/**
 * Shapes drawn from their own page element (docs/gpu-renderer-plan.md, phase 4a): what the browser
 * laid out and styled, read back as GPU primitives, so a node type needs no drawing code of its own
 * and can't drift from its CSS. Its element stays in the page (hidden while the GPU draws it), still
 * laid out, and is read again when it changes.
 *
 * - **Boxes** become rects: a background and flat tints over it, one radius, a solid border, snapped
 *   to whole pixels as Blink paints them. A dashed round border and a glow (`box-shadow`) become
 *   pictures drawn the way Blink draws them.
 * - **Text** becomes a picture of each line, drawn by the browser (canvas `fillText` with the
 *   element's font settings) where its glyphs were laid out, clamped lines with their ellipsis.
 * - **SVG** (a ring, an icon) becomes a picture of itself, drawn by the browser from its own markup
 *   with its computed styles written in: one picture, so fading it fades it as one, as the page does.
 *
 * Anything else, and the shape is the page's (`null`, the reason kept in `reasons`): a transform,
 * filter or blend inside it, a picture, text cut short another way. Until its element has been read,
 * `undefined`: the page draws it meanwhile.
 */

type Snapshot = GpuPrimitive[] | null | undefined

class Unsupported extends Error {}

export class GpuSnapshots {
	private readonly atoms = new Map<TLShapeId, Atom<Snapshot>>()
	/** The props and meta each snapshot was read for: others (a resize, new text) mean reading again. Moving it doesn't. */
	private readonly readFor = new Map<TLShapeId, Pick<TLShape, 'props' | 'meta'>>()
	private readonly queue = new Set<TLShapeId>()
	/** Shapes whose text has the outline that `--tl-zoom` sizes: read again when it changes. */
	private readonly outlined = new Set<TLShapeId>()
	/** The outline's offset at the `--tl-zoom` last seen. */
	private outline = ''
	/** Why each shape the reader left to the page was left there: for finding what to teach it next. */
	readonly reasons = new Map<TLShapeId, string>()
	private frame: number | null = null
	private readonly observer: MutationObserver | null

	constructor(readonly editor: Editor) {
		this.observer =
			typeof MutationObserver === 'undefined'
				? null
				: new MutationObserver((mutations) => {
						for (const m of mutations) {
							const el = (m.target instanceof Element ? m.target : m.target.parentElement)?.closest<HTMLElement>('.tl-shape[data-shape-id]')
							if (!el) continue
							// The canvas moving or hiding a shape's container (its transform, display, visibility) changes nothing inside it.
							if (m.type === 'attributes' && m.target === el && m.attributeName === 'style') continue
							const id = el.dataset.shapeId as TLShapeId
							if (this.atoms.has(id)) this.invalidate(id)
						}
					})
		const stopCamera = react('gpu snapshots camera', () => {
			editor.getCamera()
			this.cameraMovedAt = performance.now()
		})
		// A shape coming back on screen (culled shapes have no layout) is read once it has some.
		const stop = react('gpu snapshots culling', () => {
			const culled = getGpuScene(editor).culled.get()
			for (const id of this.atoms.keys()) if (!culled.has(id) && this.atoms.get(id)!.__unsafe__getWithoutCapture() === undefined) this.enqueue(id)
		})
		// What every element inherits changing (the theme, the accent, a font arriving): read everything again.
		const again = () => {
			for (const id of this.atoms.keys()) this.invalidate(id)
		}
		const page = typeof MutationObserver === 'undefined' ? null : new MutationObserver(again)
		page?.observe(document.documentElement, { attributes: true })
		page?.observe(document.body, { attributes: true })
		// The canvas sets `--tl-zoom` on its container (late, on big boards); the text outline is
		// `min(0.5, 1 / --tl-zoom) * 2px` each way, so it changes only past 200%.
		const zoomWatch =
			typeof MutationObserver === 'undefined'
				? null
				: new MutationObserver(() => {
						const z = Number(editor.getContainer().style.getPropertyValue('--tl-zoom')) || 1
						const outline = String(Math.min(0.5, 1 / z))
						if (outline === this.outline) return
						this.outline = outline
						for (const id of this.outlined) this.invalidate(id)
					})
		zoomWatch?.observe(editor.getContainer(), { attributes: true, attributeFilter: ['style'] })
		const stopTheme = react('gpu snapshots theme', () => {
			editor.user.getIsDarkMode()
			again()
		})
		document.fonts?.addEventListener?.('loadingdone', again)
		editor.disposables.add(() => {
			stop()
			stopCamera()
			stopTheme()
			page?.disconnect()
			zoomWatch?.disconnect()
			document.fonts?.removeEventListener?.('loadingdone', again)
			this.observer?.disconnect()
			if (this.frame !== null) cancelAnimationFrame(this.frame)
		})
	}

	/**
	 * The shape's primitives as read from its element, reactively; asks for it to be read when it hasn't
	 * been for these props, and until then it's the page's. Turned or scaled, it's the page's: the
	 * pictures are drawn upright, at the shape's own size.
	 */
	get(shape: TLShape): Snapshot {
		let a = this.atoms.get(shape.id)
		if (!a) {
			this.atoms.set(shape.id, (a = atom(`gpu snapshot ${shape.id}`, undefined as Snapshot)))
			this.watch()
		}
		const read = a.get()
		const m = this.editor.getShapePageTransform(shape.id)
		if (Math.abs(m.b) > 1e-9 || Math.abs(m.c) > 1e-9 || Math.abs(m.a - 1) > 1e-9 || Math.abs(m.d - 1) > 1e-9) return null
		const was = this.readFor.get(shape.id)
		if (was?.props !== shape.props || was.meta !== shape.meta) {
			this.enqueue(shape.id)
			return undefined
		}
		return read
	}

	private watched = false
	private watch() {
		if (this.watched || !this.observer) return
		const layer = this.editor.getContainer().querySelector('.tl-html-layer.tl-shapes')
		if (!layer) return
		this.watched = true
		this.observer.observe(layer, { subtree: true, childList: true, characterData: true, attributes: true })
	}

	/** Its element changed under it: the page draws it again until it's read again, so nothing out of date shows. */
	private invalidate(id: TLShapeId) {
		this.readFor.delete(id)
		this.atoms.get(id)?.set(undefined)
		this.enqueue(id)
	}

	private enqueue(id: TLShapeId) {
		this.queue.add(id)
		if (this.frame === null && typeof requestAnimationFrame !== 'undefined') this.frame = requestAnimationFrame(() => this.flush())
	}

	/**
	 * Reads what's queued, after the browser has laid it out, a few milliseconds a frame, and hands the
	 * results over together at the end: each one hides its element, and reading between those writes
	 * made the browser lay the page out again for every node.
	 */
	private flush() {
		this.frame = null
		this.watch()
		// Not while the camera moves, nor between the steps of a gesture: the page draws what isn't read
		// yet, and reading (and handing over) takes frames from the move.
		if (performance.now() - this.cameraMovedAt < STILL_MS) {
			this.frame = requestAnimationFrame(() => this.flush())
			return
		}
		const started = performance.now()
		const results = this.results
		for (const id of [...this.queue]) {
			if (performance.now() - started > READ_BUDGET_MS) break
			this.queue.delete(id)
			const shape = this.editor.getShape(id)
			const a = this.atoms.get(id)
			if (!shape || !a) continue
			const el = this.editor.getContainer().querySelector<HTMLElement>(`.tl-shape:not(.tl-shape-background)[data-shape-id="${id}"]`)
			// Off screen it has no layout: read when it comes back.
			if (!el || el.style.display === 'none') continue
			this.readFor.set(id, { props: shape.props, meta: shape.meta })
			let read: Snapshot
			this.reasons.delete(id)
			let pending: Promise<unknown>[] = []
			try {
				const result = readElement(this.editor, shape, el)
				read = result.out
				pending = result.pending
				if (result.outlined) this.outlined.add(id)
				else this.outlined.delete(id)
			} catch (error) {
				this.reasons.set(id, error instanceof Unsupported ? error.message : `error: ${String(error)}`)
				if (!(error instanceof Unsupported)) this.editor.annotateError(error, { origin: 'gpu.snapshot', willCrashApp: false })
				read = null
			}
			if (read && pending.length) {
				// Pictures of its SVG still decoding: read again when they're in.
				Promise.all(pending).then(() => this.invalidate(id))
				continue
			}
			results.push([a, read])
		}
		// Handed over a few times a second, not every frame: each hand-over makes the frame again, and
		// that's the whole board's worth of work.
		if (!this.queue.size || started - this.handedAt > HAND_OVER_MS) {
			this.handedAt = started
			this.results = []
			transact(() => {
				for (const [a, read] of results) a.set(read)
			})
		}
		if ((this.queue.size || this.results.length) && this.frame === null) this.frame = requestAnimationFrame(() => this.flush())
	}

	/** When the camera last moved. */
	private cameraMovedAt = 0
	/** Read and not handed over yet. */
	private results: [Atom<Snapshot>, Snapshot][] = []
	private handedAt = 0
}

/** How long the camera has to have been still before elements are read. */
const STILL_MS = 150
/** Milliseconds a frame spent reading elements. */
const READ_BUDGET_MS = 4
/** How often what's been read is handed over while there's more to read. */
const HAND_OVER_MS = 250

const all = new WeakMap<Editor, GpuSnapshots>()
/** The editor's snapshots, made on first use. */
export function getGpuSnapshots(editor: Editor): GpuSnapshots {
	let s = all.get(editor)
	if (!s) all.set(editor, (s = new GpuSnapshots(editor)))
	return s
}

// ---- Reading an element

interface Reader {
	z: number
	origin: DOMRect
	out: GpuPrimitive[]
	/** The canvas hides the shape's container itself while the GPU draws it: not the element's own `visibility`. */
	hiddenByCanvas: boolean
	/** What an `overflow` other than visible cuts to, in the shape's units: anything reaching past it is the page's. */
	clip: Box | null
	/** Its text has tldraw's outline, whose width follows `--tl-zoom` past 200%. */
	outlined: boolean
	/** What has to arrive (an SVG decoded, a pattern's tile inlined) before what was read can be drawn. */
	pending: Promise<unknown>[]
}

type Box = { x: number; y: number; w: number; h: number }

function inside(r: Reader, b: Box) {
	const c = r.clip
	if (c && (b.x < c.x - 0.5 || b.y < c.y - 0.5 || b.x + b.w > c.x + c.w + 0.5 || b.y + b.h > c.y + c.h + 0.5)) throw new Unsupported('cut by overflow')
}

function readElement(editor: Editor, shape: TLShape, container: HTMLElement): Pick<Reader, 'out' | 'outlined' | 'pending'> {
	const m = editor.getShapePageTransform(shape.id)
	if (Math.abs(m.b) > 1e-9 || Math.abs(m.c) > 1e-9 || Math.abs(m.a - 1) > 1e-9 || Math.abs(m.d - 1) > 1e-9) throw new Unsupported('turned or scaled')
	const r: Reader = { z: editor.getZoomLevel(), origin: container.getBoundingClientRect(), out: [], hiddenByCanvas: container.style.visibility === 'hidden', clip: null, outlined: false, pending: [] }
	for (const child of Array.from(container.children)) visit(r, child, 1)
	return r
}

/**
 * A box as the page paints it: snapped to whole pixels in the shape's own space (Blink's pixel-snapped
 * rects), its edges each rounded, from layout's 1/64ths so float noise can't tip a half either way.
 */
function snapped(b: Box): Box {
	const round = (v: number) => Math.round(Math.round(v * 64) / 64)
	const x = round(b.x)
	const y = round(b.y)
	return { x, y, w: round(b.x + b.w) - x, h: round(b.y + b.h) - y }
}

function local(r: Reader, rect: DOMRect): Box {
	return { x: (rect.left - r.origin.left) / r.z, y: (rect.top - r.origin.top) / r.z, w: rect.width / r.z, h: rect.height / r.z }
}

/** One element and what's in it, in the order the page paints them: its box, what flows in it, then what's positioned in it. */
function visit(r: Reader, el: Element, opacity: number) {
	const cs = getComputedStyle(el)
	if (cs.display === 'none') return
	if (cs.visibility === 'hidden' && !r.hiddenByCanvas) return
	const o = opacity * Number(cs.opacity)
	if (o <= 0) return
	if (cs.filter !== 'none' || cs.backdropFilter !== 'none' || cs.mixBlendMode !== 'normal' || cs.clipPath !== 'none' || (cs.maskImage ?? 'none') !== 'none') throw new Unsupported('effect')
	if (el instanceof SVGSVGElement) return svgPicture(r, el, o)
	if (el instanceof SVGElement) throw new Unsupported('loose svg')
	if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement || el instanceof HTMLCanvasElement || el instanceof HTMLIFrameElement) throw new Unsupported('picture')
	if (cs.transform !== 'none' && cs.transform !== 'matrix(1, 0, 0, 1, 0, 0)') throw new Unsupported('transform')
	// What CSS generates (a list's bullet, `content`) has no node to read.
	if (cs.display === 'list-item' && cs.listStyleType !== 'none') throw new Unsupported('list marker')
	for (const pseudo of ['::before', '::after'] as const) {
		const content = getComputedStyle(el, pseudo).content
		if (content !== 'none' && content !== 'normal') throw new Unsupported(`${pseudo} content`)
	}
	const first = r.out.length
	box(r, el as HTMLElement, cs, o)
	const outer = r.clip
	if (cs.overflow !== 'visible') r.clip = local(r, el.getBoundingClientRect())
	const positioned: { el: Element; z: number }[] = []
	for (const node of Array.from(el.childNodes)) {
		if (node.nodeType === Node.TEXT_NODE) {
			text(r, el as HTMLElement, node as Text, cs, o)
			continue
		}
		if (!(node instanceof Element)) continue
		const ncs = getComputedStyle(node)
		const p = ncs.position
		if (p === 'absolute' || p === 'relative' || p === 'fixed' || p === 'sticky') {
			// Painted after what flows, by z-index, then in order. Below the flow (negative) isn't copied;
			// nor is a z-index lifting something over what comes after its parent, which no shape does.
			const z = ncs.zIndex === 'auto' ? 0 : Number(ncs.zIndex)
			if (!(z >= 0)) throw new Unsupported('z-index')
			positioned.push({ el: node, z })
		} else visit(r, node, o)
	}
	positioned.sort((a, b) => a.z - b.z)
	for (const { el: node } of positioned) visit(r, node, o)
	r.clip = outer
	// The page fades an element as one; here each piece is faded, the same only where none overlaps another.
	if (Number(cs.opacity) < 1 && overlapping(r.out.slice(first))) throw new Unsupported('faded overlapping pieces')
}

/** One computed `text-shadow` (`<colour> <x> <y> <blur>`), sharp ones only. */
function textShadow(css: string): { color: string; x: number; y: number } {
	const m = css.match(/^((?:rgba?|color)\([^)]*\)) (-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px$/)
	if (!m || Number(m[4]) !== 0) throw new Unsupported('text shadow')
	color(m[1]!)
	return { color: m[1]!, x: Number(m[2]), y: Number(m[3]) }
}

/** A text line's own box, without the room its picture leaves round it for overhangs. */
const tight = new WeakMap<GpuImage, Box>()

/** Whether any two of these pieces cover some of the same place. */
function overlapping(pieces: GpuPrimitive[]): boolean {
	const boxes = pieces.flatMap((p) => (p.kind === 'stroke' ? [] : [(p.kind === 'image' && tight.get(p)) || { x: p.x, y: p.y, w: p.w, h: p.h }]))
	if (boxes.length < pieces.length) return pieces.length > 1
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i]!
			const b = boxes[j]!
			if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return true
		}
	return false
}

/** A computed colour; one it can't read leaves the shape to the page. */
function color(css: string): GpuColor {
	const c = readGpuColor(css)
	if (!c) throw new Unsupported(`colour ${css}`)
	return c
}

const TRANSPARENT: GpuColor = [0, 0, 0, 0]
const withAlpha = (c: GpuColor, a: number): GpuColor => [c[0], c[1], c[2], c[3] * a]

/** `c` laid over `under`, both unpremultiplied. */
function over(c: GpuColor, under: GpuColor): GpuColor {
	const a = c[3] + under[3] * (1 - c[3])
	if (a <= 0) return TRANSPARENT
	const mix = (i: number) => (c[i]! * c[3] + under[i]! * under[3] * (1 - c[3])) / a
	return [mix(0), mix(1), mix(2), a]
}

/** A CSS list split at its own commas, not those inside brackets. */
function splitTop(list: string): string[] {
	const out: string[] = []
	let depth = 0
	let from = 0
	for (let i = 0; i < list.length; i++) {
		const c = list[i]
		if (c === '(') depth++
		else if (c === ')') depth--
		else if (c === ',' && depth === 0) {
			out.push(list.slice(from, i).trim())
			from = i + 1
		}
	}
	out.push(list.slice(from).trim())
	return out
}

function box(r: Reader, el: HTMLElement, cs: CSSStyleDeclaration, o: number) {
	let fill = color(cs.backgroundColor)
	if (cs.backgroundImage !== 'none') {
		// Only flat tints, `linear-gradient(c, c)`, each laid over the next and all over the background colour.
		const layers = splitTop(cs.backgroundImage).filter((x) => x !== 'none')
		for (const layer of layers.reverse()) {
			const inner = layer.match(/^linear-gradient\((.+)\)$/)?.[1]
			const stops = inner && splitTop(inner)
			if (!stops || stops.length !== 2 || stops[0] !== stops[1]) throw new Unsupported('background image')
			fill = over(color(stops[0]!), fill)
		}
	}
	const sides = ['Top', 'Right', 'Bottom', 'Left'] as const
	const widths = sides.map((s) => parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) || 0)
	const styles = sides.map((s) => cs.getPropertyValue(`border-${s.toLowerCase()}-style`))
	const colors = sides.map((s) => cs.getPropertyValue(`border-${s.toLowerCase()}-color`))
	const bw = widths[0]!
	const hasBorder = widths.some((w) => w > 0) && styles.some((s) => s !== 'none' && s !== 'hidden')
	const style = styles[0]
	if (hasBorder && (widths.some((w) => w !== bw) || styles.some((s) => s !== style) || (style !== 'solid' && style !== 'dashed') || colors.some((c) => c !== colors[0]))) throw new Unsupported('border')
	const stroke = hasBorder ? color(colors[0]!) : TRANSPARENT
	if (fill[3] <= 0 && stroke[3] <= 0 && cs.boxShadow === 'none') return
	// Laid out at fractions of a pixel, painted snapped; the corners are the layout's, as big as the painted box allows.
	const laid = local(r, el.getBoundingClientRect())
	const b = snapped(laid)
	const radii = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => cs.getPropertyValue(`border-${c}-radius`))
	if (radii.some((x) => x !== radii[0])) throw new Unsupported('corners')
	const raw = radii[0]!
	let radius = 0
	if (raw.endsWith('%')) {
		// A percentage rounds into an ellipse unless the box is square.
		if (Math.abs(laid.w - laid.h) > 0.01) throw new Unsupported('elliptical corners')
		radius = (laid.w * parseFloat(raw)) / 100
	} else if (raw.includes(' ')) throw new Unsupported('elliptical corners')
	else radius = parseFloat(raw) || 0
	radius = Math.min(radius, b.w / 2, b.h / 2)
	inside(r, b)
	if (cs.boxShadow !== 'none') shadow(r, cs.boxShadow, b, radius, o)
	const solid = hasBorder && style === 'solid'
	if (fill[3] > 0 || solid) r.out.push({ kind: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, radius, fill: withAlpha(fill, o), stroke: solid ? withAlpha(stroke, o) : undefined, strokeWidth: solid ? bw : 0 })
	if (hasBorder && style === 'dashed' && stroke[3] > 0) dashedBorder(r, b, radius, bw, colors[0]!, o)
}

/**
 * A dashed border round a rounded box, as a picture of it drawn as Blink draws one
 * (`BoxBorderPainter::DrawCurvedDashedDottedBoxSide`, `StyledStrokeData`): the box's outline brought
 * in by half the width, rounded down to a whole pixel, stroked 2.2 times the width with butt-ended
 * dashes three widths long (two from 3px up), the gaps two widths (one) stretched or shrunk so the
 * dashes go round evenly in the outline's length (as Skia measures it, rounded down), from the top
 * left corner's end clockwise, and cut to the border's ring. A square-cornered dashed border is drawn
 * side by side instead, and is the page's.
 */
function dashedBorder(r: Reader, b: Box, radius: number, bw: number, css: string, o: number) {
	if (radius <= 0) throw new Unsupported('square dashed border')
	const t = Math.trunc(bw)
	if (t < 1) throw new Unsupported('hairline dashed border')
	const inset = Math.trunc(bw * 0.5)
	const cw = b.w - 2 * inset
	const ch = b.h - 2 * inset
	const cr = Math.min(Math.max(0, radius - inset), cw / 2, ch / 2)
	const length = Math.trunc(2 * (cw - 2 * cr) + 2 * (ch - 2 * cr) + 4 * quarterLength(cr))
	const dash = t * (t >= 3 ? 2 : 3)
	let gap = t * (t >= 3 ? 1 : 2)
	// Too short for two dashes and their gaps: Blink draws it solid or shrinks the pattern.
	if (length <= 2 * dash + 2 * gap) throw new Unsupported('short dashed border')
	const n = Math.floor(length / (dash + gap))
	const fewer = (length - n * dash) / n
	const more = (length - (n + 1) * dash) / (n + 1)
	gap = more <= 0 || Math.abs(fewer - gap) < Math.abs(more - gap) ? fewer : more
	const pad = 1
	r.out.push({
		kind: 'image',
		x: b.x - pad,
		y: b.y - pad,
		w: b.w + pad * 2,
		h: b.h + pad * 2,
		key: `dashed|${b.w}|${b.h}|${radius}|${bw}|${css}`,
		opacity: o,
		draw: (ctx) => {
			const ring = new Path2D()
			ring.roundRect(pad, pad, b.w, b.h, radius)
			ring.roundRect(pad + bw, pad + bw, b.w - 2 * bw, b.h - 2 * bw, Math.max(0, radius - bw))
			ctx.clip(ring, 'evenodd')
			ctx.setLineDash([dash, gap])
			ctx.lineWidth = bw * 2.2
			ctx.lineCap = 'butt'
			ctx.strokeStyle = css
			ctx.beginPath()
			ctx.roundRect(pad + inset, pad + inset, cw, ch, cr)
			ctx.stroke()
		},
	})
}

/** A quarter circle's length as Skia measures it: its conic cut into chords until each is within half a pixel. */
function quarterLength(radius: number): number {
	if (radius <= 0) return 0
	const w = Math.SQRT1_2
	const at = (t: number): [number, number] => {
		const a = (1 - t) ** 2
		const c = 2 * w * t * (1 - t)
		const d = t * t
		const sum = a + c + d
		return [(c * radius + d * radius) / sum, (a * -radius + c * -radius) / sum]
	}
	const seg = (t0: number, p0: [number, number], t1: number, p1: [number, number]): number => {
		const th = (t0 + t1) / 2
		const h = at(th)
		const off = Math.max(Math.abs(h[0] - (p0[0] + p1[0]) / 2), Math.abs(h[1] - (p0[1] + p1[1]) / 2))
		if (t1 - t0 > 1e-6 && off > 0.5) return seg(t0, p0, th, h) + seg(th, h, t1, p1)
		return Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
	}
	return seg(0, at(0), 1, at(1))
}

/**
 * An outer `box-shadow` (one; a glow), as a picture laid under the box: drawn by the browser's canvas,
 * whose `shadowBlur` blurs as CSS does (a Gaussian of half the blur radius), and only outside the box,
 * as the page paints it.
 */
function shadow(r: Reader, css: string, b: Box, radius: number, o: number) {
	// Computed: `<colour> <x> <y> <blur> <spread>`, the colour first.
	const m = css.match(/^((?:rgba?|color)\([^)]*\)) (-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px (-?[\d.]+)px$/)
	if (!m) throw new Unsupported('shadow')
	const shade = m[1]!
	const [dx, dy, blur, spread] = [m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number]
	if (color(shade)[3] <= 0) return
	const reach = spread + blur * 1.5 + 1
	const x = b.x + Math.min(0, dx) - reach
	const y = b.y + Math.min(0, dy) - reach
	const w = b.w + Math.abs(dx) + reach * 2
	const h = b.h + Math.abs(dy) + reach * 2
	// The box, in the picture's units.
	const bx = b.x - x
	const by = b.y - y
	// Far enough that the shape casting it is outside the picture, and only its shadow lands in it.
	const far = w + h + blur * 4
	r.out.push({
		kind: 'image',
		x,
		y,
		w,
		h,
		key: `shadow|${b.w}|${b.h}|${radius}|${css}`,
		opacity: o,
		draw: (ctx) => {
			const s = ctx.getTransform().a
			ctx.save()
			const outside = new Path2D()
			outside.rect(-1, -1, w + 2, h + 2)
			outside.roundRect(bx, by, b.w, b.h, radius)
			ctx.clip(outside, 'evenodd')
			// Shadows ignore the transform: the blur and the offset are in the canvas's own pixels.
			ctx.shadowColor = shade
			ctx.shadowBlur = blur * s
			ctx.shadowOffsetX = (dx + far) * s
			ctx.shadowOffsetY = dy * s
			ctx.fillStyle = '#000'
			ctx.beginPath()
			ctx.roundRect(bx - spread - far, by - spread, b.w + spread * 2, b.h + spread * 2, Math.max(0, radius + spread))
			ctx.fill()
			ctx.restore()
		},
	})
}

/**
 * What a canvas draws text with besides `font`: it takes these from its own element's style, so they
 * are copied onto it from the text's element (tabular figures, ligatures, font smoothing...).
 */
const FONT_PROPS = [
	'font-variant-numeric',
	'font-variant-ligatures',
	'font-variant-caps',
	'font-variant-east-asian',
	'font-variant-alternates',
	'font-feature-settings',
	'font-variation-settings',
	'font-kerning',
	'font-optical-sizing',
	'-webkit-font-smoothing',
	'text-rendering',
] as const

interface TextStyle {
	font: string
	/** The `FONT_PROPS` values, in order. */
	props: string[]
	letterSpacing: string
	wordSpacing: string
}

/** The shared raster canvas set up to draw or measure text in `t`. */
function textContext(t: TextStyle): CanvasRenderingContext2D {
	const { canvas, ctx } = rasterCanvas()
	FONT_PROPS.forEach((prop, i) => canvas.style.setProperty(prop, t.props[i]!))
	ctx.font = t.font
	ctx.letterSpacing = t.letterSpacing
	ctx.wordSpacing = t.wordSpacing
	return ctx
}

const widths = new Map<string, number>()
/** How wide `text` is in `t`, as a canvas lays it out. */
function measure(t: TextStyle, text: string): number {
	const key = `${t.font}|${t.props.join('|')}|${t.letterSpacing}|${t.wordSpacing}|${text}`
	let w = widths.get(key)
	if (w === undefined) {
		w = textContext(t).measureText(text).width
		if (widths.size > 20_000) widths.clear()
		widths.set(key, w)
	}
	return w
}

const ascents = new Map<string, number>()
/** Where the baseline sits below the top of a line's glyph boxes, for a font: its ascent. */
function fontAscent(t: TextStyle): number {
	let a = ascents.get(t.font)
	if (a === undefined) {
		a = textContext(t).measureText('Hg').fontBoundingBoxAscent
		ascents.set(t.font, a)
	}
	return a
}

/**
 * Each line of a text node as a picture of it, drawn where the browser laid it out: the line in one
 * `fillText`, which shapes and spaces it as the page did, when it comes out as wide as the page laid
 * it (else glyph by glyph, each at its place).
 */
function text(r: Reader, el: HTMLElement, node: Text, cs: CSSStyleDeclaration, o: number) {
	const str = node.data
	if (!str.trim()) return
	const overflows = el.scrollHeight > el.clientHeight + 0.5 || el.scrollWidth > el.clientWidth + 0.5
	// Clamped to so many lines (`-webkit-line-clamp`, its text right in the clamped element): those lines,
	// the last ended with an ellipsis. Cut short any other way, and what shows isn't the text's own glyphs.
	const clamp = overflows && el.firstChild === node && el.lastChild === node ? parseInt(cs.webkitLineClamp) : NaN
	if (overflows && !(clamp > 0) && (cs.overflow !== 'visible' || cs.textOverflow !== 'clip' || cs.webkitLineClamp !== 'none')) throw new Unsupported('text cut short')
	// Canvas fonts take stretch keywords only, and decorations and transforms aren't drawn here.
	if (cs.fontStretch !== '100%' || cs.textDecorationLine !== 'none' || cs.textTransform !== 'none' || cs.webkitTextStrokeWidth !== '0px') throw new Unsupported('text style')
	const ink = cs.color
	const fill = color(ink)
	if (fill[3] <= 0) return
	// Sharp text shadows (tldraw's text outline: the glyphs again in the paper's colour, a pixel each
	// way), drawn under the text in reverse order, as CSS paints them.
	const shadows = cs.textShadow === 'none' ? [] : splitTop(cs.textShadow).map(textShadow).reverse()
	if (shadows.length) r.outlined = true
	const t: TextStyle = {
		font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
		props: FONT_PROPS.map((p) => cs.getPropertyValue(p)),
		letterSpacing: cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing,
		wordSpacing: cs.wordSpacing === 'normal' ? '0px' : cs.wordSpacing,
	}
	type Glyph = { i: number; end: number; x: number; w: number }
	type Line = { top: number; bottom: number; glyphs: Glyph[]; ellipsis?: number }
	const range = document.createRange()
	const lines: Line[] = []
	for (let i = 0; i < str.length; ) {
		const len = str.codePointAt(i)! > 0xffff ? 2 : 1
		const at = i
		i += len
		if (!str.slice(at, i).trim()) continue
		range.setStart(node, at)
		range.setEnd(node, i)
		const rect = range.getClientRects()[0]
		if (!rect || !rect.width) continue
		const b = local(r, rect)
		let line = lines.find((l) => Math.abs(l.top - b.y) < 0.5)
		if (!line) lines.push((line = { top: b.y, bottom: b.y + b.h, glyphs: [] }))
		line.bottom = Math.max(line.bottom, b.y + b.h)
		line.glyphs.push({ i: at, end: i, x: b.x, w: b.w })
	}
	lines.sort((a, b) => a.top - b.top)
	const ellipsis = measure(t, '…')
	if (clamp > 0 && lines.length > clamp) {
		lines.length = clamp
		// The ellipsis goes after the last glyph that leaves room for it inside the content box.
		const last = lines[clamp - 1]!
		const box = local(r, el.getBoundingClientRect())
		const end = box.x + el.clientLeft + el.clientWidth - parseFloat(cs.paddingRight)
		const right = () => (last.glyphs.length ? last.glyphs[last.glyphs.length - 1]!.x + last.glyphs[last.glyphs.length - 1]!.w : box.x)
		while (last.glyphs.length && right() + ellipsis > end + 0.01) last.glyphs.pop()
		last.ellipsis = right()
	}
	const ascent = fontAscent(t)
	// Room either side for glyphs that reach past their advance (italics, overhangs).
	const pad = parseFloat(cs.fontSize) * 0.3
	for (const line of lines) {
		const first = line.glyphs[0]
		const last = line.glyphs[line.glyphs.length - 1]
		const left = first?.x ?? line.ellipsis ?? 0
		const right = line.ellipsis !== undefined ? line.ellipsis + ellipsis : last ? last.x + last.w : left
		inside(r, { x: left, y: line.top, w: right - left, h: line.bottom - line.top })
		const x = left - pad
		const y = line.top - pad
		// The page puts the baseline on a whole pixel of the shape's space, as it does a box's edges.
		const baseline = Math.round(Math.round((line.top + ascent) * 64) / 64) - y
		const runs: { text: string; x: number }[] = []
		if (first && last) {
			const whole = str.slice(first.i, last.end)
			if (Math.abs(measure(t, whole) - (last.x + last.w - first.x)) < 0.05) runs.push({ text: whole, x: first.x - x })
			else for (const g of line.glyphs) runs.push({ text: str.slice(g.i, g.end), x: g.x - x })
		}
		if (line.ellipsis !== undefined) runs.push({ text: '…', x: line.ellipsis - x })
		const picture: GpuImage = {
			kind: 'image',
			x,
			y,
			w: right - left + pad * 2,
			h: line.bottom - line.top + pad * 2,
			key: `text|${t.font}|${t.props.join('|')}|${t.letterSpacing}|${t.wordSpacing}|${ink}|${cs.textShadow}|${baseline}|${runs.map((g) => `${g.x.toFixed(4)}:${g.text}`).join('\u0000')}`,
			opacity: o,
			draw: (ctx) => {
				textContext(t)
				ctx.fillStyle = ink
				ctx.textBaseline = 'alphabetic'
				ctx.textAlign = 'left'
				for (const sh of shadows) {
					ctx.fillStyle = sh.color
					for (const g of runs) ctx.fillText(g.text, g.x + sh.x, baseline + sh.y)
				}
				ctx.fillStyle = ink
				for (const g of runs) ctx.fillText(g.text, g.x, baseline)
			},
		}
		tight.set(picture, { x: left, y: line.top, w: right - left, h: line.bottom - line.top })
		r.out.push(picture)
	}
}

// ---- SVG as pictures

const decoded = new Map<string, HTMLImageElement>()
const decoding = new Map<string, Promise<void>>()
const failed = new Set<string>()
const SVG_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'stroke-miterlimit', 'opacity', 'color', 'display', 'visibility'] as const

function svgPicture(r: Reader, svg: SVGSVGElement, o: number) {
	// Placed where the page paints it, at a whole pixel of the shape's space, at its own size.
	const at = local(r, svg.getBoundingClientRect())
	const b = { ...at, x: snapped(at).x, y: snapped(at).y }
	if (b.w <= 0 || b.h <= 0) return
	inside(r, b)
	// The markup with every computed presentation property written in: a picture of it has no stylesheet.
	const copy = svg.cloneNode(true) as SVGSVGElement
	const from = [svg, ...Array.from(svg.querySelectorAll('*'))]
	const to = [copy, ...Array.from(copy.querySelectorAll('*'))]
	let widest = 0
	from.forEach((src, i) => {
		const dst = to[i] as SVGElement
		const s = getComputedStyle(src)
		if (s.stroke !== 'none') widest = Math.max(widest, parseFloat(s.strokeWidth) || 0)
		for (const prop of SVG_PROPS) {
			if (src === svg && prop === 'opacity') continue
			const v = s.getPropertyValue(prop)
			if (v) dst.setAttribute(prop, v)
		}
		dst.removeAttribute('class')
		dst.removeAttribute('style')
	})
	// What it fills or strokes with from elsewhere in the page (a hatching pattern), brought in, its
	// tile inlined: a picture can't reach the page's definitions or load a blob.
	const refs = new Set<string>()
	for (const src of from) {
		const cs = getComputedStyle(src)
		for (const v of [cs.fill, cs.stroke]) for (const m of v.matchAll(/url\("?#([^")]+)"?\)/g)) refs.add(m[1]!)
	}
	if (refs.size) {
		const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
		for (const ref of refs) {
			const def = document.getElementById(ref)
			if (!def) throw new Unsupported(`missing ${ref}`)
			const clone = def.cloneNode(true) as Element
			for (const image of [clone, ...Array.from(clone.querySelectorAll('*'))].filter((e) => e.localName === 'image')) {
				const href = image.getAttribute('href') ?? image.getAttribute('xlink:href') ?? ''
				if (href.startsWith('data:')) continue
				const data = inlined.get(href)
				if (data === '') throw new Unsupported('pattern tile')
				if (data) image.setAttribute('href', data)
				else r.pending.push(inline(href))
			}
			defs.appendChild(clone)
		}
		copy.prepend(defs)
	}
	// The page draws the svg's overflow; a picture is clipped to its box. Without a viewBox (a shape's own
	// SVG, in its units) the picture takes in the widest stroke's reach past the edge; rings and icons,
	// scaled by theirs, sit inside their boxes.
	const m = svg.hasAttribute('viewBox') ? 0 : Math.ceil(widest / 2) + 2
	if (m) copy.setAttribute('viewBox', `${-m} ${-m} ${b.w + 2 * m} ${b.h + 2 * m}`)
	copy.setAttribute('width', String(b.w + 2 * m))
	copy.setAttribute('height', String(b.h + 2 * m))
	copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
	copy.removeAttribute('opacity')
	const markup = new XMLSerializer().serializeToString(copy)
	const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
	if (failed.has(url)) throw new Unsupported('svg the browser cannot picture')
	if (r.pending.length) return
	if (!decoded.has(url) && !decoding.has(url)) {
		const img = new Image()
		img.src = url
		decoding.set(
			url,
			img
				.decode()
				.then(() => {
					decoded.set(url, img)
				})
				.catch(() => {
					failed.add(url)
				})
				.finally(() => decoding.delete(url))
		)
	}
	const picture: GpuImage = {
		kind: 'image',
		x: b.x - m,
		y: b.y - m,
		w: b.w + 2 * m,
		h: b.h + 2 * m,
		key: `svg|${url.length}|${hash(url)}`,
		opacity: o,
		draw: (ctx) => {
			const img = decoded.get(url)
			if (img) ctx.drawImage(img, 0, 0, b.w + 2 * m, b.h + 2 * m)
		},
	}
	const waiting = decoding.get(url)
	if (waiting) r.pending.push(waiting)
	r.out.push(picture)
}

const inlined = new Map<string, string>()
const inlining = new Map<string, Promise<void>>()
/** A blob (or other) URL's contents as a data URL, kept: a picture of an SVG loads nothing from outside. */
function inline(href: string): Promise<void> {
	let p = inlining.get(href)
	if (!p) {
		p = fetch(href)
			.then((res) => res.blob())
			.then(
				(blob) =>
					new Promise<void>((resolve, reject) => {
						const reader = new FileReader()
						reader.onload = () => {
							inlined.set(href, String(reader.result))
							resolve()
						}
						reader.onerror = () => reject(reader.error)
						reader.readAsDataURL(blob)
					})
			)
			.catch(() => {
				// Read again, and found missing again: the page's then.
				inlined.set(href, '')
			})
		inlining.set(href, p)
	}
	return p
}

function hash(s: string): string {
	let h = 2166136261
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
	return (h >>> 0).toString(36)
}
