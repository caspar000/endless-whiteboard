import { atom, computed, react, transact, type Atom, type Computed } from '@tldraw/state'
import type { TLShape, TLShapeId, TLUnknownShape } from '@tldraw/tlschema'
import { getShapeElement, onShapeMounted, pinShapeElement } from '../components/shapeElements'
import type { Editor } from '../editor/Editor'
import { getGpuScene } from './gpuScene'
import { readGpuColor, type GpuColor, type GpuImage, type GpuPrimitive } from './primitives'
import { decodePicture, drawRecipe, FONT_PROPS, keepPicture, pictureFailed, textContext, type Recipe, type TextStyle } from './recipes'
import { gpuSnapshotCacheVersion, loadSnapshots, restored, saveSnapshots, storable, type CachedSnapshot } from './snapshotCache'

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
	/**
	 * What each snapshot was read for: other props or meta (a resize, new text), geometry (an arrow's
	 * bound shape moving) or render key (`ShapeUtil.getRenderKey`) mean reading again. Moving it doesn't.
	 */
	private readonly readFor = new Map<TLShapeId, ReadFor>()
	/**
	 * The zoom render keys are worked out at: the camera's, once it has been still for `STILL_MS`. Read
	 * straight from the camera, every snapshot would be a dependent of it, and a pan would wake them all.
	 */
	private readonly zoom = atom('gpu snapshots zoom', 1)
	private readonly queue = new Set<TLShapeId>()
	/** Shapes whose text has the outline that `--tl-zoom` sizes: read again when it changes. */
	private readonly outlined = new Set<TLShapeId>()
	/** The outline's offset at the `--tl-zoom` last seen. */
	private outline = ''
	/** How many elements have been read this session (the rest came from the cache): for the checks. */
	readCount = 0
	/** Why each shape the reader left to the page was left there: for finding what to teach it next. */
	readonly reasons = new Map<TLShapeId, string>()
	private frame: number | null = null
	private readonly observer: MutationObserver | null
	/**
	 * How far the shapes around the screen (the GPU scene's `near`) are read, while the GPU layer draws:
	 * how many are drawn from their element, and how many of those the page still draws because they
	 * aren't read yet. Null while the layer is off. For the app to say the board is still being prepared.
	 */
	readonly readiness: Computed<{ total: number; waiting: number } | null>

	constructor(readonly editor: Editor) {
		this.readiness = computed(
			'gpu snapshots readiness',
			() => {
				const scene = getGpuScene(editor)
				if (!scene.active.get()) return null
				let total = 0
				let waiting = 0
				for (const { id } of scene.near.get()) {
					const a = this.atoms.get(id)
					if (!a) continue
					total++
					if (a.get() !== undefined || this.reasons.has(id)) continue
					// Turned or scaled, it's never read: the page's for good (see `get`).
					const m = editor.getShapePageTransform(id)
					if (Math.abs(m.b) > 1e-9 || Math.abs(m.c) > 1e-9 || Math.abs(m.a - 1) > 1e-9 || Math.abs(m.d - 1) > 1e-9) continue
					waiting++
				}
				return { total, waiting }
			},
			{ isEqual: (a, b) => a?.total === b?.total && a?.waiting === b?.waiting }
		)
		this.observer =
			typeof MutationObserver === 'undefined'
				? null
				: new MutationObserver((mutations) => {
						const changed = new Set<TLShapeId>()
						for (const m of mutations) {
							const el = (m.target instanceof Element ? m.target : m.target.parentElement)?.closest<HTMLElement>('.tl-shape[data-shape-id]')
							if (!el) continue
							// The canvas moving or hiding a shape's container (its transform, display, visibility) changes nothing inside it.
							if (m.type === 'attributes' && m.target === el && m.attributeName === 'style') continue
							const id = el.dataset.shapeId as TLShapeId
							if (this.atoms.has(id)) changed.add(id)
						}
						// Together: each alone had the GPU's scene go through every shape near the screen again,
						// and shapes mounting in a pan change dozens at a time.
						if (changed.size) transact(() => changed.forEach((id) => this.invalidate(id)))
					})
		let zoomTimer: ReturnType<typeof setTimeout> | null = null
		const settleZoom = () => {
			zoomTimer = null
			if (performance.now() - this.cameraMovedAt < STILL_MS) zoomTimer = setTimeout(settleZoom, STILL_MS)
			else if (this.zoom.__unsafe__getWithoutCapture() !== editor.getZoomLevel()) this.zoom.set(editor.getZoomLevel())
		}
		const stopCamera = react('gpu snapshots camera', () => {
			editor.getCamera()
			this.cameraMovedAt = performance.now()
			zoomTimer ??= setTimeout(settleZoom, STILL_MS)
		})
		// The board back on screen: what was asked for while it was out of sight is read now (see `flush`).
		const stopShown = react('gpu snapshots shown', () => {
			if (getGpuScene(editor).shown.get() && this.queue.size && this.frame === null) this.frame = requestAnimationFrame(() => this.flush())
		})
		// A shape mounting again: read it if it isn't, for what it is now.
		const stopMounts = onShapeMounted(editor, (id) => {
			if (this.atoms.has(id) && !this.readFor.has(id)) this.enqueue(id)
		})
		// A shape coming back on screen (culled shapes have no layout) is read once it has some.
		const stop = react('gpu snapshots culling', () => {
			const culled = getGpuScene(editor).culled.get()
			for (const id of this.atoms.keys()) if (!culled.has(id) && this.atoms.get(id)!.__unsafe__getWithoutCapture() === undefined) this.enqueue(id)
		})
		// What every element inherits changing (the theme, the accent, a font arriving): read everything again.
		const again = () => {
			transact(() => {
				for (const id of this.atoms.keys()) this.invalidate(id, false)
			})
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
						transact(() => {
							for (const id of this.outlined) this.invalidate(id)
						})
					})
		zoomWatch?.observe(editor.getContainer(), { attributes: true, attributeFilter: ['style'] })
		const stopTheme = react('gpu snapshots theme', () => {
			editor.user.getIsDarkMode()
			again()
		})
		document.fonts?.addEventListener?.('loadingdone', again)
		// What the cache has for each page, as it's opened.
		const stopPage = react('gpu snapshots page', () => {
			editor.getCurrentPageId()
			this.loadCache()
		})
		editor.disposables.add(() => {
			stopPage()
			if (this.keepTimer) {
				clearTimeout(this.keepTimer)
				void saveSnapshots([...this.toKeep])
			}
			this.disposed = true
			if (this.aheadTimer) clearTimeout(this.aheadTimer)
			for (const release of this.ahead.values()) release()
			stop()
			stopCamera()
			stopShown()
			stopMounts()
			if (zoomTimer) clearTimeout(zoomTimer)
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
	get<S extends TLUnknownShape>(shape: S): Snapshot {
		let a = this.atoms.get(shape.id)
		if (!a) {
			this.atoms.set(shape.id, (a = atom(`gpu snapshot ${shape.id}`, undefined as Snapshot)))
			this.watch()
		}
		const read = a.get()
		const m = this.editor.getShapePageTransform(shape.id)
		if (Math.abs(m.b) > 1e-9 || Math.abs(m.c) > 1e-9 || Math.abs(m.a - 1) > 1e-9 || Math.abs(m.d - 1) > 1e-9) return null
		const was = this.readFor.get(shape.id)
		const key = this.editor.getShapeUtil(shape).getRenderKey(shape, this.zoom.get())
		if (!was || was.props !== shape.props || was.meta !== shape.meta || was.geometry !== this.editor.getShapeGeometry(shape.id) || was.key !== key) {
			const kept = this.fromCache(shape as unknown as TLShape, key)
			if (kept) return kept
			this.enqueue(shape.id)
			return undefined
		}
		return read
	}

	/** For the checks: every shape read again from its element, the cache passed over. */
	readAgain() {
		transact(() => {
			for (const id of this.atoms.keys()) {
				this.uncached.add(id)
				this.invalidate(id, false)
			}
		})
	}

	// ---- Kept between sessions (`snapshotCache.ts`)

	/** What the cache has for this page's shapes, once loaded. */
	private cached = new Map<TLShapeId, CachedSnapshot>()
	/** Changes when the cache has loaded, for `get` to look again. */
	private readonly cacheLoaded = atom('gpu snapshot cache loaded', 0)
	/** Shapes whose element changed under them this session: read again, not taken from the cache. */
	private readonly uncached = new Set<TLShapeId>()
	private readonly toKeep = new Map<TLShapeId, CachedSnapshot>()
	private keepTimer: ReturnType<typeof setTimeout> | null = null

	/** A shape's snapshot from the cache, if it has one read for what the shape is now. */
	private fromCache(shape: TLShape, renderKey: string): Snapshot {
		this.cacheLoaded.get()
		if (this.uncached.has(shape.id)) return undefined
		const kept = this.cached.get(shape.id)
		if (!kept || !this.editor.getShapeUtil(shape).canLeavePage(shape)) return undefined
		if (kept.key !== this.cacheKey(shape, renderKey)) return undefined
		const prims = restored(kept.prims)
		// Asked for before the cache was in: not to be read now.
		this.queue.delete(shape.id)
		this.readFor.set(shape.id, { props: shape.props, meta: shape.meta, geometry: this.editor.getShapeGeometry(shape.id), key: renderKey })
		// Not set from inside this computed: once it has run, all of them together. Set one at a time, each
		// woke every shape near the screen again: half a minute on a board of 20,000.
		const a = this.atoms.get(shape.id)
		if (a) {
			if (!this.fromCacheSets.length) queueMicrotask(() => this.setFromCache())
			this.fromCacheSets.push([a, prims])
		}
		return prims
	}

	private fromCacheSets: [Atom<Snapshot>, Snapshot][] = []
	private setFromCache() {
		const sets = this.fromCacheSets
		this.fromCacheSets = []
		transact(() => {
			for (const [a, prims] of sets) a.set(prims)
		})
	}

	/** What a shape's picture depends on, hashed: change any of it and the kept one isn't used. */
	private cacheKey(shape: TLShape, renderKey: string): string {
		// The text outline's width, from the zoom the way the page works it out (see `outline`).
		const outline = Math.min(0.5, 1 / this.zoom.__unsafe__getWithoutCapture())
		const text = [gpuSnapshotCacheVersion(), READER_VERSION, this.editor.user.getIsDarkMode(), renderKey, outline, shape.type, JSON.stringify(shape.props), JSON.stringify(shape.meta)].join('\u0001')
		return hash(text) + hash2(text) + text.length.toString(36)
	}

	/** Keeps a shape's snapshot, if it can be kept, with the others read about now. */
	private keep(shape: TLShape, prims: GpuPrimitive[]) {
		if (!gpuSnapshotCacheVersion() || !this.editor.getShapeUtil(shape).canLeavePage(shape)) return
		const stored = storable(prims)
		if (!stored) return
		const renderKey = this.editor.getShapeUtil(shape).getRenderKey(shape, this.zoom.__unsafe__getWithoutCapture())
		const entry = { key: this.cacheKey(shape, renderKey), prims: stored, at: Date.now() }
		this.toKeep.set(shape.id, entry)
		this.cached.set(shape.id, entry)
		this.keepTimer ??= setTimeout(() => {
			this.keepTimer = null
			const entries = [...this.toKeep]
			this.toKeep.clear()
			void saveSnapshots(entries)
		}, KEEP_MS)
	}

	/** Loads what the cache has for the current page's shapes, once fonts are in (text was read with them). */
	private loadCache() {
		if (!gpuSnapshotCacheVersion() || typeof document === 'undefined') return
		const page = this.editor.getCurrentPageId()
		// Reading waits for it (a little): what it reads now, the cache might have had.
		this.cacheWaitUntil = performance.now() + CACHE_WAIT_MS
		void (document.fonts?.ready ?? Promise.resolve())
			.then(() => loadSnapshots(this.editor.getCurrentPageShapeIds()))
			.then((found) => {
				this.cacheWaitUntil = 0
				if (this.disposed || this.editor.getCurrentPageId() !== page) return
				for (const [id, entry] of found) if (!this.cached.has(id)) this.cached.set(id, entry)
				this.cacheLoaded.set(this.cacheLoaded.__unsafe__getWithoutCapture() + 1)
			})
	}

	/** Until when reading waits for the cache to load. */
	private cacheWaitUntil = 0

	private watched = false
	private watch() {
		if (this.watched || !this.observer) return
		const layer = this.editor.getContainer().querySelector('.tl-html-layer.tl-shapes')
		if (!layer) return
		this.watched = true
		this.observer.observe(layer, { subtree: true, childList: true, characterData: true, attributes: true })
	}

	/** Its element changed under it: the page draws it again until it's read again, so nothing out of date shows. */
	private invalidate(id: TLShapeId, fromElement = true) {
		// The element of a shape with a snapshot changed: what the cache kept may be out of date too.
		// (Before it had one, the changes are the element settling as it mounts.)
		if (fromElement && this.atoms.get(id)?.__unsafe__getWithoutCapture()) this.uncached.add(id)
		this.readFor.delete(id)
		this.atoms.get(id)?.set(undefined)
		this.enqueue(id)
	}

	/** `invalidate`, together with the others asked for in this task. */
	private invalidateSoon(id: TLShapeId) {
		if (!this.toInvalidate.size)
			queueMicrotask(() => {
				const ids = this.toInvalidate
				this.toInvalidate = new Set()
				transact(() => ids.forEach((id) => this.invalidate(id)))
			})
		this.toInvalidate.add(id)
	}
	private toInvalidate = new Set<TLShapeId>()

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
		// Still for a whole frame too: a frame slower than `STILL_MS` in the middle of a pan isn't a stop.
		const camera = this.editor.getCamera()
		const moved = camera !== this.cameraAtFlush
		this.cameraAtFlush = camera
		if (moved || performance.now() - this.cameraMovedAt < STILL_MS || performance.now() < this.cacheWaitUntil) {
			this.frame = requestAnimationFrame(() => this.flush())
			return
		}
		// Not while the board is out of sight (a tab behind the one on screen, or behind Settings): its
		// host hides it with `visibility`, which every shape inherits, and each would be read as empty,
		// the GPU then hiding its element and drawing nothing for it. Read once it's shown again.
		if (!getGpuScene(this.editor).shown.__unsafe__getWithoutCapture()) return
		if (getComputedStyle(this.editor.getContainer()).visibility === 'hidden') {
			this.frame = requestAnimationFrame(() => this.flush())
			return
		}
		const started = performance.now()
		const results = this.results
		// Let go together at the end: each one changes the list of mounted shapes.
		const released: (() => void)[] = []
		const ids = [...this.queue]
		// Off screen (`display: none`) a shape has no layout, and drawn by the GPU (`visibility: hidden`)
		// what it inherits says hidden, which an SVG's picture would copy and come out blank. The next
		// few are shown for the read, all together, and put back together after it: in the same task,
		// so the page never paints them so, and laid out once for all of them rather than once each.
		const shown: [HTMLElement, string, string][] = []
		for (const id of ids.slice(0, SHOW_AT_ONCE)) {
			const el = getShapeElement(this.editor, id)
			if (!el || (el.style.display !== 'none' && el.style.visibility !== 'hidden')) continue
			shown.push([el, el.style.display, el.style.visibility])
			if (el.style.display === 'none') el.style.display = 'block'
			el.style.visibility = ''
		}
		try {
		for (const id of ids) {
			if (performance.now() - started > READ_BUDGET_MS) break
			const el = getShapeElement(this.editor, id)
			// One for a later turn.
			if (el && (el.style.display === 'none' || el.style.visibility === 'hidden')) continue
			this.queue.delete(id)
			const shape = this.editor.getShape(id)
			const a = this.atoms.get(id)
			if (!shape || !a || !el) continue
			this.readFor.set(id, {
				props: shape.props,
				meta: shape.meta,
				geometry: this.editor.getShapeGeometry(id),
				key: this.editor.getShapeUtil(shape).getRenderKey(shape, this.zoom.__unsafe__getWithoutCapture()),
			})
			let read: Snapshot
			this.reasons.delete(id)
			let pending: Promise<unknown>[] = []
			try {
				this.readCount++
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
				// Pictures of its SVG still decoding: read again when they're in, still mounted if it was
				// mounted to be read ahead (let go, it had to be mounted all over again).
				Promise.all(pending).then(() => this.invalidateSoon(id))
				continue
			}
			const release = this.ahead.get(id)
			if (release) {
				released.push(release)
				this.ahead.delete(id)
			}
			if (read) this.keep(shape, read)
			results.push([a, read])
		}
		} finally {
			for (const [el, display, visibility] of shown) {
				el.style.display = display
				el.style.visibility = visibility
			}
		}
		// Handed over a few times a second, not every frame: each hand-over makes the frame again, and
		// that's the whole board's worth of work. The bigger the board, the longer that takes, so the
		// longer between hand-overs: at most an eighth of the time goes on them.
		const every = Math.max(HAND_OVER_MS, this.handOverCost * 8)
		const cheap = this.handOverCost < HAND_OVER_CHEAP_MS
		if (results.length && ((!this.queue.size && cheap) || started - this.handedAt > every)) {
			this.handedAt = started
			this.results = []
			const t = performance.now()
			transact(() => {
				for (const [a, read] of results) a.set(read)
			})
			this.handOverCost = performance.now() - t
		}
		if (released.length) transact(() => released.forEach((release) => release()))
		if ((this.queue.size || this.results.length) && this.frame === null) this.frame = requestAnimationFrame(() => this.flush())
		else if (!this.queue.size) this.readAheadSoon()
	}

	/**
	 * Shapes being read ahead, each with what lets it leave the page again. While the GPU layer is on
	 * and nothing else is waiting, the shapes never read yet (off screen, mostly, on a big board that
	 * has unmounted them) are mounted a batch at a time, read and let go, so a pan or zoom later finds
	 * them read and has nothing to mount. Mounting them as they came on screen made a pan across a big
	 * board mount hundreds of shapes a frame.
	 */
	private readonly ahead = new Map<TLShapeId, () => void>()
	private aheadTimer: ReturnType<typeof setTimeout> | null = null
	private aheadAt = 0

	private readAheadSoon() {
		if (this.aheadTimer || typeof setTimeout === 'undefined') return
		this.aheadTimer = setTimeout(() => {
			this.aheadTimer = null
			this.readAhead()
		}, READ_AHEAD_MS)
	}

	private readAhead() {
		if (this.disposed) return
		// One batch at a time. Shapes of one that haven't mounted in a while (deleted meanwhile, or the
		// board hidden) are let go.
		if (this.ahead.size) {
			if (performance.now() - this.aheadAt < READ_AHEAD_GIVE_UP_MS) return this.readAheadSoon()
			transact(() => {
				for (const release of this.ahead.values()) release()
			})
			this.ahead.clear()
		}
		if (!getGpuScene(this.editor).active.__unsafe__getWithoutCapture()) return
		// Reading ahead is for later: only once the camera has been still a while.
		if (this.queue.size || performance.now() - this.cameraMovedAt < READ_AHEAD_STILL_MS) return this.readAheadSoon()
		// Around the screen only, a screen each way: what the next pan or zoom out shows. Reading the
		// whole of a big board put all of it in the GPU's frame, which on 20,000 shapes was more than a
		// frame could draw.
		const near = this.editor.getViewportPageBounds().clone()
		near.expandBy(Math.max(near.w, near.h))
		let n = 0
		transact(() => {
			for (const id of this.atoms.keys()) {
				if (this.readFor.has(id) || this.reasons.has(id)) continue
				const bounds = this.editor.getShapePageBounds(id)
				if (!bounds || !near.collides(bounds)) continue
				if (getShapeElement(this.editor, id)) this.enqueue(id)
				else this.ahead.set(id, pinShapeElement(this.editor, id))
				if (++n >= READ_AHEAD_BATCH) break
			}
		})
		this.aheadAt = performance.now()
		if (n) this.readAheadSoon()
	}

	private disposed = false
	/** How long the last hand-over took, with all it set off. */
	private handOverCost = 0
	/** The camera at the last turn of reading. */
	private cameraAtFlush: unknown = null
	/** When the camera last moved. */
	private cameraMovedAt = 0
	/** Read and not handed over yet. */
	private results: [Atom<Snapshot>, Snapshot][] = []
	private handedAt = 0
}

interface ReadFor {
	props: unknown
	meta: unknown
	geometry: unknown
	key: string
}

/** The reader's own version: bump it when what it reads from an element changes, and the cache starts again. */
// 2: snapshots read while their board was hidden came out empty (PLAN-22); version 1's may be those.
const READER_VERSION = 2
/** How long new snapshots wait to be kept, with the others read meanwhile. */
const KEEP_MS = 2000
/** How long reading waits for the cache to load, at most. */
const CACHE_WAIT_MS = 5000

/** How many shapes a batch of reading ahead mounts, and how long it waits before the next. */
const READ_AHEAD_BATCH = 200
const READ_AHEAD_MS = 50
const READ_AHEAD_GIVE_UP_MS = 2000
const READ_AHEAD_STILL_MS = 1000
/** How many shapes off screen a turn of reading shows at once. */
const SHOW_AT_ONCE = 64

/** How long the camera has to have been still before elements are read. */
const STILL_MS = 150
/** Milliseconds a frame spent reading elements. */
const READ_BUDGET_MS = 4
/** How often what's been read is handed over while there's more to read. */
const HAND_OVER_MS = 250
/** A hand-over quicker than this is made as soon as there's nothing left to read. */
const HAND_OVER_CHEAP_MS = 16

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
	clip: Clip | null
	/** Its text has tldraw's outline, whose width follows `--tl-zoom` past 200%. */
	outlined: boolean
	/** What has to arrive (an SVG decoded, a pattern's tile inlined) before what was read can be drawn. */
	pending: Promise<unknown>[]
}

type Box = { x: number; y: number; w: number; h: number }

/** An `overflow` cut: its box and its corners. */
type Corner = { x: number; y: number }
/** Its corners top left, top right, bottom right, bottom left, as `roundRect` takes them. */
type Clip = Box & { corners: Corner[] }

function inside(r: Reader, b: Box) {
	const c = r.clip
	if (!c) return
	if (b.x < c.x - 0.5 || b.y < c.y - 0.5 || b.x + b.w > c.x + c.w + 0.5 || b.y + b.h > c.y + c.h + 0.5) throw new Unsupported('cut by overflow')
}

/** Whether a piece reaches into one of a rounded cut's corners, where the page takes its corner off. */
function inCorners(c: Clip, b: Box): boolean {
	const [tl, tr, br, bl] = c.corners as [Corner, Corner, Corner, Corner]
	const overlaps = (x0: number, y0: number, x1: number, y1: number) => x1 > x0 && y1 > y0 && b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0
	return (
		overlaps(c.x, c.y, c.x + tl.x, c.y + tl.y) ||
		overlaps(c.x + c.w - tr.x, c.y, c.x + c.w, c.y + tr.y) ||
		overlaps(c.x + c.w - br.x, c.y + c.h - br.y, c.x + c.w, c.y + c.h) ||
		overlaps(c.x, c.y + c.h - bl.y, c.x + bl.x, c.y + c.h)
	)
}

const rounded = (c: Clip) => c.corners.some((k) => k.x > 0 && k.y > 0)

/**
 * The pieces read inside an element whose overflow is cut to rounded corners, each that reaches into
 * a corner made a picture cut the same way (a card's header colour, a cover filling a rounded card).
 */
function cutToCorners(pieces: GpuPrimitive[], c: Clip): GpuPrimitive[] {
	return pieces.map((p) => {
		if (p.kind === 'stroke' || !inCorners(c, p)) return p
		const at = { x: p.x, y: p.y }
		const cut = { x: c.x, y: c.y, w: c.w, h: c.h, corners: c.corners }
		const key = `|cut ${c.x},${c.y},${c.w},${c.h},${JSON.stringify(c.corners)}`
		if (p.kind === 'image') {
			if (!p.recipe) {
				// A picture made outside the reader, without a recipe: cut as it draws.
				const draw = p.draw
				return {
					...p,
					key: p.key + key,
					draw: (ctx) => {
						ctx.beginPath()
						ctx.roundRect(c.x - at.x, c.y - at.y, c.w, c.h, c.corners)
						ctx.clip()
						return draw(ctx)
					},
				}
			}
			return picture({ ...p, key: p.key + key }, { t: 'cut', cut, at, inner: p.recipe })
		}
		const rect = p
		const sw = rect.stroke && rect.strokeWidth ? rect.strokeWidth : 0
		return picture(
			{ kind: 'image', x: rect.x, y: rect.y, w: rect.w, h: rect.h, key: `rect|${JSON.stringify(rect)}${key}` },
			{ t: 'rect', w: rect.w, h: rect.h, radius: rect.radius ?? 0, fill: rect.fill ?? null, stroke: rect.stroke ?? null, strokeWidth: sw, cut, at }
		)
	})
}

/** A picture drawn from its recipe (see `recipes.ts`), so the same one can be kept between sessions. */
function picture(p: Omit<GpuImage, 'draw' | 'recipe'>, recipe: Recipe): GpuImage {
	return { ...p, recipe, draw: (ctx) => drawRecipe(ctx, recipe) }
}

/** The corners an element rounds its overflow to, in the shape's units, each its own (a percentage an ellipse's). */
function clipCorners(cs: CSSStyleDeclaration, b: Box): { corners: Corner[] } {
	const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((name) => {
		const raw = cs.getPropertyValue(`border-${name}-radius`)
		const [h, v = h] = raw.split(' ')
		const size = (part: string | undefined, of: number) => (part?.endsWith('%') ? (of * parseFloat(part)) / 100 : parseFloat(part ?? '0') || 0)
		return { x: Math.min(size(h, b.w), b.w / 2), y: Math.min(size(v, b.h), b.h / 2) }
	})
	return { corners }
}

function readElement(editor: Editor, shape: TLShape, container: HTMLElement): Pick<Reader, 'out' | 'outlined' | 'pending'> {
	const m = editor.getShapePageTransform(shape.id)
	if (Math.abs(m.b) > 1e-9 || Math.abs(m.c) > 1e-9 || Math.abs(m.a - 1) > 1e-9 || Math.abs(m.d - 1) > 1e-9) throw new Unsupported('turned or scaled')
	const r: Reader = { z: editor.getZoomLevel(), origin: container.getBoundingClientRect(), out: [], hiddenByCanvas: container.style.visibility === 'hidden', clip: null, outlined: false, pending: [] }
	// Moving: a picture now would be of a moment of it. Finite animations are waited for; one that
	// never ends (a spinner) leaves the shape to the page.
	const running = container.getAnimations({ subtree: true }).filter((a) => a.playState === 'running')
	if (running.some((a) => a.effect?.getComputedTiming().endTime === Infinity)) throw new Unsupported('animated')
	if (running.length) {
		r.pending.push(...running.map((a) => a.finished.catch(() => undefined)))
		return r
	}
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
	// A path cut (a note's crease) is drawn, on an element with nothing in it; any other cut isn't.
	const leafPath = cs.clipPath.startsWith('path(') && !el.childNodes.length
	if (cs.filter !== 'none' || cs.backdropFilter !== 'none' || cs.mixBlendMode !== 'normal' || (cs.clipPath !== 'none' && !leafPath) || (cs.maskImage ?? 'none') !== 'none') throw new Unsupported('effect')
	if (el instanceof SVGSVGElement) return svgPicture(r, el, o)
	if (el instanceof SVGElement) throw new Unsupported('loose svg')
	if (el instanceof HTMLImageElement) return imagePicture(r, el, cs, o)
	if (el instanceof HTMLVideoElement || el instanceof HTMLCanvasElement || el instanceof HTMLIFrameElement) throw new Unsupported('picture')
	// A form control the browser draws itself (a slider, a select, a checkbox): nothing in it to read.
	// (`appearance` alone says nothing: tldraw sets `auto` on its text's divs, which have no look of their own.)
	const widget = el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el instanceof HTMLMeterElement || el instanceof HTMLProgressElement
	if (widget || (el instanceof HTMLButtonElement && cs.appearance !== 'none')) throw new Unsupported(`form control (${el.localName})`)
	// Moved, not turned or scaled (a cropped image's container): where it lands is read from its box.
	if (cs.transform !== 'none' && !/^matrix\(1, 0, 0, 1, -?[\d.e-]+, -?[\d.e-]+\)$/.test(cs.transform)) throw new Unsupported('transform')
	// What CSS generates (a list's bullet, `content`) has no node to read.
	if (cs.display === 'list-item' && cs.listStyleType !== 'none') throw new Unsupported('list marker')
	for (const pseudo of ['::before', '::after'] as const) {
		const content = getComputedStyle(el, pseudo).content
		if (content !== 'none' && content !== 'normal') throw new Unsupported(`${pseudo} content`)
	}
	const first = r.out.length
	box(r, el as HTMLElement, cs, o)
	const ownEnd = r.out.length
	const outer = r.clip
	if (cs.overflow !== 'visible') {
		const at = snapped(local(r, el.getBoundingClientRect()))
		r.clip = { ...at, ...clipCorners(cs, at) }
	}
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
	// What's inside an element cut to rounded corners, cut to them too (its own box has its own corners).
	if (r.clip && r.clip !== outer) r.out.splice(ownEnd, r.out.length - ownEnd, ...cutToCorners(r.out.slice(ownEnd), r.clip))
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

type Radius = number | { x: number; y: number }

function box(r: Reader, el: HTMLElement, cs: CSSStyleDeclaration, o: number) {
	let fill = color(cs.backgroundColor)
	// A gradient that isn't flat: drawn as a picture, by a canvas gradient. Flat tints, `linear-gradient(c, c)`,
	// are laid over each other and over the background colour.
	let gradient: Gradient | null = null
	if (cs.backgroundImage !== 'none') {
		const layers = splitTop(cs.backgroundImage).filter((x) => x !== 'none')
		for (const layer of layers.reverse()) {
			const inner = layer.match(/^linear-gradient\((.+)\)$/)?.[1]
			const stops = inner && splitTop(inner)
			if (!stops) throw new Unsupported('background image')
			if (stops.length === 2 && stops[0] === stops[1]) {
				fill = over(color(stops[0]!), fill)
				continue
			}
			if (gradient || layers.length > 1) throw new Unsupported('background image')
			gradient = gradientOf(stops)
		}
	}
	const sides = ['Top', 'Right', 'Bottom', 'Left'] as const
	const widths = sides.map((s) => parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) || 0)
	const styles = sides.map((s) => cs.getPropertyValue(`border-${s.toLowerCase()}-style`))
	const colors = sides.map((s) => cs.getPropertyValue(`border-${s.toLowerCase()}-color`))
	const bw = widths[0]!
	const hasBorder = widths.some((w) => w > 0) && styles.some((s) => s !== 'none' && s !== 'hidden')
	const style = styles[0]
	const uniform = widths.every((w) => w === bw) && styles.every((s) => s === style) && colors.every((c) => c === colors[0])
	// Uneven (a side of its own colour or width): each side that's there solid, drawn as a picture.
	const uneven = hasBorder && !uniform
	if (uneven && widths.some((w, i) => w > 0 && styles[i] !== 'solid')) throw new Unsupported(`border (${el.className}: ${widths.join('/')} ${styles.join('/')} ${colors.join('/')})`)
	if (hasBorder && !uneven && style !== 'solid' && style !== 'dashed') throw new Unsupported(`border (${el.className}: ${style})`)
	const stroke = hasBorder && !uneven ? color(colors[0]!) : TRANSPARENT
	if (uneven) colors.forEach((c, i) => widths[i]! > 0 && color(c))
	if (fill[3] <= 0 && stroke[3] <= 0 && !uneven && !gradient && cs.boxShadow === 'none') return
	// Laid out at fractions of a pixel, painted snapped; the corners are the layout's, as big as the painted box allows.
	const laid = local(r, el.getBoundingClientRect())
	const b = snapped(laid)
	const radii = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => cs.getPropertyValue(`border-${c}-radius`))
	if (radii.some((x) => x !== radii[0])) throw new Unsupported('corners')
	const raw = radii[0]!
	let radius: Radius = 0
	const paints = fill[3] > 0 || hasBorder || !!gradient
	if (raw.endsWith('%')) {
		const share = parseFloat(raw) / 100
		// A percentage rounds into an ellipse unless the box is square: drawn only when nothing but the
		// box's shadow is (a note's shadow is an ellipse's).
		if (Math.abs(laid.w - laid.h) > 0.01) {
			if (paints) throw new Unsupported('elliptical corners')
			radius = { x: Math.min(laid.w * share, b.w / 2), y: Math.min(laid.h * share, b.h / 2) }
		} else radius = Math.min(laid.w * share, b.w / 2, b.h / 2)
	} else if (raw.includes(' ')) throw new Unsupported('elliptical corners')
	else radius = Math.min(parseFloat(raw) || 0, b.w / 2, b.h / 2)
	inside(r, b)
	if (cs.boxShadow !== 'none') for (const one of splitTop(cs.boxShadow).reverse()) shadow(r, one, b, radius, o)
	const cut = cs.clipPath.startsWith('path(') ? cs.clipPath.match(/^path\((?:[a-z-]+, )?"([^"]+)"\)$/)?.[1] : undefined
	if (cs.clipPath.startsWith('path(') && !cut) throw new Unsupported('clip path')
	if (gradient || cut || uneven) {
		if (hasBorder && !uneven) throw new Unsupported('border on a picture')
		paintedBox(r, b, typeof radius === 'number' ? radius : 0, fill, gradient, cut, o, uneven ? { widths, colors } : undefined)
		return
	}
	const corner = radius as number
	const solid = hasBorder && style === 'solid'
	if (fill[3] > 0 || solid) r.out.push({ kind: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, radius: corner, fill: withAlpha(fill, o), stroke: solid ? withAlpha(stroke, o) : undefined, strokeWidth: solid ? bw : 0 })
	if (hasBorder && style === 'dashed' && stroke[3] > 0) dashedBorder(r, b, corner, bw, colors[0]!, o)
}

type Gradient = { angle: number; stops: { at: number; color: string }[] }

/**
 * A `linear-gradient`: its angle (CSS's: 0 up, 90 right, 180 down, the default) and its stops, each
 * at its share of the gradient line.
 */
function gradientOf(parts: string[]): Gradient {
	let list = parts
	let angle = 180
	const sides: Record<string, number> = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 }
	const first = list[0]!
	if (first in sides) {
		angle = sides[first]!
		list = list.slice(1)
	} else if (/^-?[\d.]+(deg|turn|rad)$/.test(first)) {
		const n = parseFloat(first)
		angle = first.endsWith('turn') ? n * 360 : first.endsWith('rad') ? (n * 180) / Math.PI : n
		list = list.slice(1)
	} else if (!/^(rgba?|color)\(/.test(first)) throw new Unsupported(`gradient direction (${first})`)
	const stops = list.map((part, i) => {
		const m = part.match(/^((?:rgba?|color)\([^)]*\))(?: (-?[\d.]+)%)?$/)
		if (!m) throw new Unsupported('gradient stop')
		color(m[1]!)
		return { at: m[2] !== undefined ? Number(m[2]) / 100 : i / (list.length - 1), color: m[1]! }
	})
	if (stops.length < 2) throw new Unsupported('gradient stop')
	return { angle, stops }
}

/** The ends of a gradient's line across a box `w` by `h`, as CSS lays it: through the middle, long enough that its ends' perpendiculars touch the far corners. */
function gradientLine(g: Gradient, w: number, h: number): [number, number, number, number] {
	const a = (g.angle * Math.PI) / 180
	const dx = Math.sin(a)
	const dy = -Math.cos(a)
	const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2
	return [w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half]
}

/** A border that isn't one colour and width all round (a card's accent side, a table row's rule), each side solid. */
type Sides = { widths: number[]; colors: string[] }

/**
 * A box painted as a picture: its colour or gradient, cut to its corners or its clip path, and a
 * border that differs side to side: the ring between the outer and inner outlines (the inner corners
 * the outer ones less the sides' widths), each side its own colour up to the diagonals from the outer
 * corners to the inner ones, where Blink splits them.
 */
function paintedBox(r: Reader, b: Box, radius: number, fill: GpuColor, gradient: Gradient | null, cut: string | undefined, o: number, sides?: Sides) {
	r.out.push(
		picture(
			{
				kind: 'image',
				x: b.x,
				y: b.y,
				w: b.w,
				h: b.h,
				key: `box|${b.w}|${b.h}|${radius}|${fill.join(',')}|${JSON.stringify(gradient)}|${cut ?? ''}|${JSON.stringify(sides ?? null)}`,
				opacity: o,
			},
			{ t: 'box', w: b.w, h: b.h, radius, fill, gradient, gradientLine: gradient ? gradientLine(gradient, b.w, b.h) : null, path: cut ?? null, sides: sides ?? null }
		)
	)
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
	r.out.push(
		picture(
			{ kind: 'image', x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2, key: `dashed|${b.w}|${b.h}|${radius}|${bw}|${css}`, opacity: o },
			{ t: 'dashed', w: b.w, h: b.h, radius, bw, css, inset, cw, ch, cr, dash, gap, pad }
		)
	)
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
function shadow(r: Reader, css: string, b: Box, radius: Radius, o: number) {
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
	r.out.push(
		picture(
			{ kind: 'image', x, y, w, h, key: `shadow|${b.w}|${b.h}|${JSON.stringify(radius)}|${css}`, opacity: o },
			{ t: 'shadow', w, h, bx, by, bw: b.w, bh: b.h, radius, shade, blur, dx, dy, spread, far }
		)
	)
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
	// Upper or lower case: the page draws the text transformed, laid out as it reads; one for one, so a glyph's place is its own.
	const cased = cs.textTransform === 'uppercase' ? (t: string) => t.toUpperCase() : cs.textTransform === 'lowercase' ? (t: string) => t.toLowerCase() : null
	if (cased && cased(str).length !== str.length) throw new Unsupported('text transform changes its length')
	if (cs.fontStretch !== '100%' || cs.textDecorationLine !== 'none' || (cs.textTransform !== 'none' && !cased) || cs.webkitTextStrokeWidth !== '0px')
		throw new Unsupported(`text style (${el.className}: ${cs.textDecorationLine} ${cs.textTransform} ${cs.fontStretch})`)
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
			const shown = (a: number, z: number) => (cased ? cased(str.slice(a, z)) : str.slice(a, z))
			const whole = shown(first.i, last.end)
			if (Math.abs(measure(t, whole) - (last.x + last.w - first.x)) < 0.05) runs.push({ text: whole, x: first.x - x })
			else for (const g of line.glyphs) runs.push({ text: shown(g.i, g.end), x: g.x - x })
		}
		if (line.ellipsis !== undefined) runs.push({ text: '…', x: line.ellipsis - x })
		const line_ = picture(
			{
				kind: 'image',
				x,
				y,
				w: right - left + pad * 2,
				h: line.bottom - line.top + pad * 2,
				key: `text|${t.font}|${t.props.join('|')}|${t.letterSpacing}|${t.wordSpacing}|${ink}|${cs.textShadow}|${baseline}|${runs.map((g) => `${g.x.toFixed(4)}:${g.text}`).join('\u0000')}`,
				opacity: o,
			},
			{ t: 'text', style: t, ink, shadows, runs, baseline }
		)
		tight.set(line_, { x: left, y: line.top, w: right - left, h: line.bottom - line.top })
		r.out.push(line_)
	}
}

/**
 * An image as a picture, drawn by the canvas from the decoded element itself, where the page shows it:
 * its box snapped (a replaced element's), `object-fit`, a flip (`scale(±1, ±1)`), and cut to what its
 * shape's overflow leaves, rounded corners and all (a cropped or round image). An animated one, or
 * one that hasn't loaded, is the page's.
 */
function imagePicture(r: Reader, img: HTMLImageElement, cs: CSSStyleDeclaration, o: number) {
	if (!img.complete) {
		r.pending.push(img.decode().catch(() => undefined))
		return
	}
	if (!img.naturalWidth || !img.naturalHeight) throw new Unsupported('image not loaded')
	if (/\.gif(\?|$)|^data:image\/gif/i.test(img.currentSrc || img.src)) throw new Unsupported('animated image')
	const fit = cs.objectFit
	if (fit !== 'fill' && fit !== 'cover' && fit !== 'contain') throw new Unsupported('object-fit')
	if (cs.objectPosition !== '50% 50%') throw new Unsupported('object-position')
	const flip = cs.transform === 'none' ? [1, 1] : cs.transform.match(/^matrix\((-?1), 0, 0, (-?1), 0, 0\)$/)?.slice(1).map(Number)
	if (!flip) throw new Unsupported('image transform')
	const b = snapped(local(r, img.getBoundingClientRect()))
	if (b.w <= 0 || b.h <= 0) return
	const c = r.clip
	const view = c ? { x: Math.max(b.x, c.x), y: Math.max(b.y, c.y), maxX: Math.min(b.x + b.w, c.x + c.w), maxY: Math.min(b.y + b.h, c.y + c.h) } : { x: b.x, y: b.y, maxX: b.x + b.w, maxY: b.y + b.h }
	if (view.maxX <= view.x || view.maxY <= view.y) return
	// The part of the image `object-fit` shows, in its own pixels.
	const iw = img.naturalWidth
	const ih = img.naturalHeight
	let src = { x: 0, y: 0, w: iw, h: ih }
	let dst = { x: 0, y: 0, w: b.w, h: b.h }
	if (fit === 'cover') {
		const k = Math.max(b.w / iw, b.h / ih)
		src = { w: b.w / k, h: b.h / k, x: (iw - b.w / k) / 2, y: (ih - b.h / k) / 2 }
	} else if (fit === 'contain') {
		const k = Math.min(b.w / iw, b.h / ih)
		dst = { w: iw * k, h: ih * k, x: (b.w - iw * k) / 2, y: (b.h - ih * k) / 2 }
	}
	const x = view.x
	const y = view.y
	const url = img.currentSrc || img.src
	keepPicture(url, img)
	const w = view.maxX - view.x
	const h = view.maxY - view.y
	const cut = c && rounded(c) ? { x: c.x, y: c.y, w: c.w, h: c.h, corners: c.corners } : null
	r.out.push(
		picture(
			{ kind: 'image', x, y, w, h, key: `img|${hash(url)}|${url.length}|${JSON.stringify([b, c, flip, fit])}`, opacity: o },
			{ t: 'img', url, w, h, cut, at: { x, y }, b, flip, src, dst }
		)
	)
}

// ---- SVG as pictures

const SVG_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'stroke-miterlimit', 'opacity', 'color', 'display', 'visibility'] as const

function svgPicture(r: Reader, svg: SVGSVGElement, o: number) {
	// An arrow's halo is as wide as `--tl-zoom` says past 200%, like the text outline: read again when it changes.
	if (svg.querySelector('.tl-arrow-halo')) r.outlined = true
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
	// SVG, in its units) the picture takes in how far its contents and the widest stroke reach past the
	// edge; rings and icons, scaled by theirs, sit inside their boxes.
	let m = 0
	if (!svg.hasAttribute('viewBox')) {
		// What it draws can reach well past its box (a freehand line's filled outline): its contents' box, too.
		const bb = svg.getBBox()
		const past = Math.max(0, -bb.x, -bb.y, bb.x + bb.width - b.w, bb.y + bb.height - b.h)
		m = Math.ceil(past + widest / 2) + 2
	}
	if (m) copy.setAttribute('viewBox', `${-m} ${-m} ${b.w + 2 * m} ${b.h + 2 * m}`)
	copy.setAttribute('width', String(b.w + 2 * m))
	copy.setAttribute('height', String(b.h + 2 * m))
	copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
	copy.removeAttribute('opacity')
	const markup = new XMLSerializer().serializeToString(copy)
	const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
	if (pictureFailed(url)) throw new Unsupported('svg the browser cannot picture')
	if (r.pending.length) return
	const waiting = decodePicture(url)
	if (waiting) r.pending.push(waiting)
	r.out.push(
		picture(
			{ kind: 'image', x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m, key: `svg|${url.length}|${hash(url)}`, opacity: o },
			{ t: 'svg', url, w: b.w + 2 * m, h: b.h + 2 * m }
		)
	)
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

/** Another hash of `s` (djb2), for a key two can't share by chance. */
function hash2(s: string): string {
	let h = 5381
	for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0
	return (h >>> 0).toString(36)
}
