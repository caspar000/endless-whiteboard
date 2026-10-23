import { atom, unsafe__withoutCapture, type Atom } from '@tldraw/state'
import { isShapeId, type TLShape, type TLShapeId } from '@tldraw/tlschema'
import { Box2d } from '../../primitives/Box2d'
import { Matrix2d } from '../../primitives/Matrix2d'
import type { Editor } from '../Editor'

/**
 * Every shape's box in page space, kept in plain maps rather than a computed per shape
 * (docs/gpu-renderer-plan.md, phase 8, step 2): what culling, the page's bounds and "back to content"
 * ask of every shape on the board. Through the editor's own caches, asking made seven computeds for
 * each shape, which stayed for as long as the shape did, on screen or not: most of what a shape off
 * screen cost.
 *
 * A shape's entry is worked out when it's asked for and nothing has it, and again once it, its
 * parent or (for an arrow) a shape it's bound to has changed. `version` changes with every change,
 * for what reads the index from a computed.
 *
 * The boxes are for deciding what's near the screen, so they may be bigger than the shape, never
 * smaller: a rotated shape's box is its box's corners turned, an arrow's is what it joins widened by
 * its bend, and a frame cuts its children's to its own box (undefined: the frame hides it all).
 */
export class ShapeBoundsIndex {
	readonly version: Atom<number> = atom('shape bounds version', 0)
	private readonly entries = new Map<TLShapeId, Entry>()
	private readonly dirty = new Set<TLShapeId>()

	constructor(private readonly editor: Editor) {}

	/** The shape's box in page space, or undefined if there's no such shape. */
	get(id: TLShapeId): Box2d | undefined {
		// Untracked: what working one out reads isn't what the caller depends on. Changes come through
		// `invalidate` and `version`.
		return unsafe__withoutCapture(() => this.entry(id)?.page)
	}

	/** Something about the shape has changed: its box is worked out again when it's next asked for. */
	invalidate(id: TLShapeId) {
		this.dirty.add(id)
		this.version.set(this.version.__unsafe__getWithoutCapture() + 1)
	}

	/** It's gone. */
	remove(id: TLShapeId) {
		this.entries.delete(id)
		this.dirty.delete(id)
		this.version.set(this.version.__unsafe__getWithoutCapture() + 1)
	}

	private entry(id: TLShapeId, depth = 0): Entry | undefined {
		const had = this.entries.get(id)
		const shape = this.editor.store.unsafeGetWithoutCapture(id)
		// Its own record changed without a word (a snapshot loaded with side effects off): again too.
		if (had && !this.dirty.has(id) && had.record === shape) return had
		this.dirty.delete(id)
		if (!shape) {
			this.entries.delete(id)
			return undefined
		}
		const parent = isShapeId(shape.parentId) && depth <= MAX_DEPTH ? this.entry(shape.parentId, depth + 1) : undefined
		const own = Matrix2d.Identity().translate(shape.x, shape.y).rotate(shape.rotation)
		const transform = parent ? Matrix2d.Compose(parent.transform, own) : own
		let local = had?.props === shape.props && had.local ? had.local : undefined
		let page: Box2d | undefined
		if (shape.type === 'arrow') page = this.arrowBox(shape, transform, depth)
		else if (shape.type === 'group') page = this.groupBox(shape, depth)
		else {
			local ??= this.localBox(shape)
			page = Box2d.FromPoints(transform.applyToPoints(local.corners))
		}
		// What its frames leave of it, and what it and they leave of its children.
		const clip = parent?.clip
		if (page && clip) page = intersection(page, clip)
		const clipsChildren = shape.type === 'frame' && page ? (clip ? intersection(page, clip) : page) : clip
		const entry: Entry = { record: shape, props: shape.props, local, page, transform, clip: clipsChildren }
		this.entries.set(id, entry)
		return entry
	}

	/** The shape's geometry's box. A shape whose geometry can't be worked out (yet) is a point. */
	private localBox(shape: TLShape): Box2d {
		try {
			const util = this.editor.getShapeUtil(shape)
			return util.getCullingBounds(shape)?.clone() ?? util.getGeometry(shape).bounds.clone()
		} catch {
			return new Box2d(0, 0, 1, 1)
		}
	}

	/** What an arrow joins: the shapes it's bound to and its free ends, widened by its bend. */
	private arrowBox(shape: TLShape, transform: Matrix2d, depth: number): Box2d {
		const props = shape.props as { start?: { x: number; y: number }; end?: { x: number; y: number }; bend?: number }
		const points: { x: number; y: number }[] = []
		const bound = new Set<string>()
		for (const binding of this.editor.getBindingsFromShape(shape.id, 'arrow')) {
			const terminal = (binding.props as { terminal?: string }).terminal
			const box = depth > MAX_DEPTH ? undefined : this.entry(binding.toId, depth + 1)?.page
			if (!box || !terminal) continue
			bound.add(terminal)
			points.push({ x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY })
		}
		for (const terminal of ['start', 'end'] as const) {
			const p = props[terminal]
			if (p && !bound.has(terminal)) points.push(transform.applyToPoint(p))
		}
		if (!points.length) points.push(transform.applyToPoint({ x: 0, y: 0 }))
		const box = Box2d.FromPoints(points)
		return box.expandBy(Math.abs(props.bend ?? 0) + ARROW_SLACK)
	}

	/** A group's: its children's. */
	private groupBox(shape: TLShape, depth: number): Box2d | undefined {
		let box: Box2d | undefined
		for (const childId of this.editor.getSortedChildIdsForParent(shape.id)) {
			const child = depth > MAX_DEPTH ? undefined : this.entry(childId, depth + 1)?.page
			if (!child) continue
			box = box ? box.expand(child) : child.clone()
		}
		return box
	}
}

interface Entry {
	/** The record it was worked out from. */
	record: TLShape
	/** The props `local` was worked out from. */
	props: unknown
	/** The shape's geometry's box, in its own space (not kept for arrows and groups). */
	local: Box2d | undefined
	page: Box2d | undefined
	transform: Matrix2d
	/** What its frame ancestors (and itself, if it's one) leave visible of its children. */
	clip: Box2d | undefined
}

/** Where two boxes overlap, or undefined if they don't. */
function intersection(a: Box2d, b: Box2d): Box2d | undefined {
	const x = Math.max(a.minX, b.minX)
	const y = Math.max(a.minY, b.minY)
	const maxX = Math.min(a.maxX, b.maxX)
	const maxY = Math.min(a.maxY, b.maxY)
	return maxX < x || maxY < y ? undefined : new Box2d(x, y, maxX - x, maxY - y)
}

/** How deep a chain of parents or bindings is followed. */
const MAX_DEPTH = 64
/** Page units round an arrow's ends, for its heads and the halo. */
const ARROW_SLACK = 64
