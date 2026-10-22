import { atom, computed, type Atom, type Computed } from '@tldraw/state'
import type { TLShapeId } from '@tldraw/tlschema'
import type { Editor } from '../editor/Editor'
import { getGpuScene } from '../gpu/gpuScene'

/**
 * Each mounted shape's container element, by id, kept by `Shape` as it mounts and unmounts. Finding
 * one with `querySelector` walks the whole page; on a big board, doing that for every shape cost more
 * than everything else opening it did.
 *
 * And which shapes are mounted at all (docs/gpu-renderer-plan.md, phase 8): on a big board, a shape
 * whose util says it `canLeavePage` is unmounted while it's off screen or drawn by the GPU layer, as
 * each mounted one costs some fifty kilobytes and eight elements. Whatever needs one of those
 * elements (an export) asks for it with `requestShapeElement`, which mounts it until released.
 */

/** Boards with more shapes than this unmount the ones that can leave the page. */
export const LEAVE_PAGE_ABOVE = 2000
/** For tests: a smaller board that does the same. */
const LEAVE_PAGE_ABOVE_KEY = 'lifeboard:leave-page-above'

interface EditorElements {
	readonly elements: Map<TLShapeId, HTMLElement>
	readonly listeners: Set<(id: TLShapeId) => void>
	readonly waiting: Map<TLShapeId, Set<(el: HTMLElement) => void>>
	/** How many asked for each shape to be mounted. */
	readonly pinCounts: Map<TLShapeId, number>
	readonly pinned: Atom<ReadonlySet<TLShapeId>>
	mounted?: Computed<MountedShapes>
}

type TLRenderingShape = ReturnType<Editor['getRenderingShapeList']>[number]

interface MountedShapes {
	list: TLRenderingShape[]
	/** What has left the page. */
	left: ReadonlySet<TLShapeId>
	/** Whether the board is big enough for shapes to leave the page. */
	big: boolean
}

const byEditor = new WeakMap<Editor, EditorElements>()

function of(editor: Editor): EditorElements {
	let e = byEditor.get(editor)
	if (!e) {
		e = {
			elements: new Map(),
			listeners: new Set(),
			waiting: new Map(),
			pinCounts: new Map(),
			pinned: atom('pinned shape elements', new Set<TLShapeId>()),
		}
		byEditor.set(editor, e)
	}
	return e
}

/** A mounted shape's container (not its background's), or undefined if it isn't mounted. */
export function getShapeElement(editor: Editor, id: TLShapeId): HTMLElement | undefined {
	return byEditor.get(editor)?.elements.get(id)
}

/** @internal */
export function setShapeElement(editor: Editor, id: TLShapeId, el: HTMLElement | null) {
	const e = of(editor)
	if (!el) {
		e.elements.delete(id)
		return
	}
	e.elements.set(id, el)
	for (const listener of e.listeners) listener(id)
	const waiting = e.waiting.get(id)
	if (waiting) {
		e.waiting.delete(id)
		for (const resolve of waiting) resolve(el)
	}
}

/** Calls `listener` with each shape that mounts. Returns the way to stop. @internal */
export function onShapeMounted(editor: Editor, listener: (id: TLShapeId) => void): () => void {
	const e = of(editor)
	e.listeners.add(listener)
	return () => e.listeners.delete(listener)
}

/**
 * A shape's element, mounted for as long as it's needed: `release` lets it leave the page again.
 * `el` is undefined if the shape didn't mount within `timeoutMs` (it was deleted, or the board is
 * hidden and doesn't render).
 *
 * @public
 */
export async function requestShapeElement(
	editor: Editor,
	id: TLShapeId,
	timeoutMs = 3000
): Promise<{ el: HTMLElement | undefined; release(): void }> {
	const e = of(editor)
	// Asked before pinning it, which brings it back. Not mounted, but not because it left the page
	// (the board isn't rendered, as in tests): nothing is coming.
	const left = hasLeftPage(editor, id)
	const release = pinShapeElement(editor, id)
	let el = e.elements.get(id)
	if (!el && !left) return { el: undefined, release }
	if (!el) {
		el = await new Promise<HTMLElement | undefined>((resolve) => {
			let waiting = e.waiting.get(id)
			if (!waiting) e.waiting.set(id, (waiting = new Set()))
			const done = (found: HTMLElement | undefined) => {
				clearTimeout(timer)
				waiting!.delete(done)
				resolve(found)
			}
			const timer = setTimeout(() => done(undefined), timeoutMs)
			waiting.add(done)
		})
		// Mounted in a layout effect: let what it renders after that (its own effects) settle.
		if (el) await new Promise((resolve) => setTimeout(resolve, 0))
	}
	return { el, release }
}

/**
 * Keeps a shape mounted, or mounts it, until the returned function is called. `requestShapeElement`
 * for when the element itself is wanted.
 *
 * @internal
 */
export function pinShapeElement(editor: Editor, id: TLShapeId): () => void {
	const e = of(editor)
	e.pinCounts.set(id, (e.pinCounts.get(id) ?? 0) + 1)
	if (e.pinCounts.get(id) === 1) e.pinned.set(new Set(e.pinCounts.keys()))
	let released = false
	return () => {
		if (released) return
		released = true
		const n = (e.pinCounts.get(id) ?? 1) - 1
		if (n > 0) e.pinCounts.set(id, n)
		else {
			e.pinCounts.delete(id)
			e.pinned.set(new Set(e.pinCounts.keys()))
		}
	}
}

/** Whether a shape has left the page (see `getMountedShapeList`). @internal */
export function hasLeftPage(editor: Editor, id: TLShapeId): boolean {
	return mountedShapes(editor).left.has(id)
}

function leavePageAbove(): number {
	try {
		const raw = globalThis.localStorage?.getItem(LEAVE_PAGE_ABOVE_KEY)
		if (raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw))) return Number(raw)
	} catch {
		// No storage: the default.
	}
	return LEAVE_PAGE_ABOVE
}

/**
 * The shapes to mount, in the order to mount them: the rendering list, less the shapes that have
 * left the page. Changes when a shape goes off screen or comes back, or the GPU layer starts or stops
 * drawing it, not when the camera moves.
 *
 * @public
 */
export function getMountedShapeList(editor: Editor): TLRenderingShape[] {
	return mountedShapes(editor).list
}

const sameList = (a: TLRenderingShape[], b: TLRenderingShape[]) => a.length === b.length && a.every((x, i) => x === b[i])

function mountedShapes(editor: Editor) {
	const e = of(editor)
	e.mounted ??= computed(
		'mounted shapes',
		() => {
			// The scene's latched copies, set only when they change: the editor's own computeds have a
			// parent for every shape, which each change here (a pin, a release) made them all check again.
			const scene = getGpuScene(editor)
			const list = scene.renderingList.get()
			const left = new Set<TLShapeId>()
			if (list.length <= leavePageAbove()) return { list, left, big: false }
			const culled = scene.culled.get()
			const drawn = scene.hiddenNow.get()
			const pinned = e.pinned.get()
			const out: TLRenderingShape[] = []
			for (const entry of list) {
				if ((culled.has(entry.id) || drawn.has(entry.id)) && !pinned.has(entry.id)) {
					// Untracked: a change that could make it stay (new text with an expression) changes its
					// props, which the GPU layer reads it again for, or brings it back on screen.
					const shape = editor.store.unsafeGetWithoutCapture(entry.id)
					if (shape && entry.util.canLeavePage(shape)) {
						left.add(entry.id)
						continue
					}
				}
				out.push(entry)
			}
			return { list: out, left, big: true }
		},
		{
			isEqual: (a: MountedShapes, b: MountedShapes) => a.big === b.big && a.left.size === b.left.size && sameList(a.list, b.list),
		}
	)
	return e.mounted.get()
}
