import type { Editor, TLShapeId } from '@lifeboard/canvas'
import { isEntry, isSkill, type TreeShape } from '../board'
import { getTreePrefs } from '../treePrefs'
import { contentsOf, viewHeaderFor } from './view'
import { viewEdges, viewShapes } from './viewSync'

/**
 * Dragging a tree node (docs/skill-tree-plan.md, "Rebuild"). While you drag, its branch follows on
 * springs and the nodes it runs into make room; when you let go, everything eases to rest within a
 * second or so, then stays put like any shape on a board. With live physics on (Settings, or the
 * tree's header), the whole view takes part, Obsidian-style: every node repels the others and every
 * line pulls its two ends together, cooling once you let go.
 *
 * The moves are ordinary shape updates made while the drag's own undo step is open, so one ⌘Z puts
 * the dragged node and everything it pulled back where they were.
 */

interface Body {
	id: TLShapeId
	key: string
	x: number
	y: number
	w: number
	h: number
	vx: number
	vy: number
	/** Dragged by the pointer: physics reads it, never moves it. */
	held: boolean
	/** Follows a held node at this offset from it. */
	follows?: { key: string; dx: number; dy: number }
}

interface Run {
	live: boolean
	bodies: Map<string, Body>
	edges: { a: string; b: string }[]
	/** When the pointer let go; the run eases to rest from then. */
	released: number | null
	heat: number
}

const SETTLE_MS = 1400
const PAD = 16

const runs = new WeakMap<Editor, Run>()

/** Starts listening to an editor's frames. Called once per board, from `watchTrees`. */
export function watchPhysics(editor: Editor): () => void {
	const onTick = (elapsed: number) => tick(editor, elapsed)
	editor.on('tick', onTick)
	return () => editor.off('tick', onTick)
}

const isLive = (header: TreeShape) => (header.props.live === 'on' ? true : header.props.live === 'off' ? false : getTreePrefs().live)

function begin(editor: Editor): Run | null {
	const held = editor.getSelectedShapes().filter((s) => isSkill(s) || isEntry(s))
	if (!held.length) return null
	const first = held[0]!
	const header = viewHeaderFor(editor, isSkill(first) ? first.props.nodeId : isEntry(first) ? first.props.itemId : '')
	if (!header) return null
	const view = contentsOf(editor, header)
	const shapes = viewShapes(editor, view)
	const edges = viewEdges(editor, view)
	const live = isLive(header)
	const heldIds = new Set<string>(held.map((s) => s.id))
	const children = new Map<string, string[]>()
	for (const e of edges) children.set(e.from, [...(children.get(e.from) ?? []), e.to])

	const bodies = new Map<string, Body>()
	const add = (key: string, follows?: Body['follows']) => {
		const shape = shapes.get(key)
		const b = shape && editor.getShapePageBounds(shape.id)
		if (!shape || !b || bodies.has(key)) return
		bodies.set(key, { id: shape.id, key, x: b.x, y: b.y, w: b.w, h: b.h, vx: 0, vy: 0, held: heldIds.has(shape.id), follows })
	}
	// What is held, then each held node's branch, following it at the offset it has now.
	for (const [key, shape] of shapes) if (heldIds.has(shape.id)) add(key)
	for (const root of [...bodies.values()]) {
		const queue = [root.key]
		for (let i = 0; i < queue.length; i++) {
			for (const child of children.get(queue[i]!) ?? []) {
				if (bodies.has(child)) continue
				const b = shapes.get(child) && editor.getShapePageBounds(shapes.get(child)!.id)
				if (!b) continue
				add(child, { key: root.key, dx: b.x - root.x, dy: b.y - root.y })
				queue.push(child)
			}
		}
	}
	// Everything else in the view can be pushed aside (or, live, takes part in full).
	for (const key of shapes.keys()) add(key)
	return { live, bodies, edges: edges.map((e) => ({ a: e.from, b: e.to })), released: null, heat: 1 }
}

function tick(editor: Editor, elapsed: number): void {
	const dragging = editor.isIn('select.translating')
	let run = runs.get(editor)
	if (!run) {
		if (!dragging) return
		run = begin(editor) ?? undefined
		if (!run) return
		runs.set(editor, run)
	}
	const now = performance.now()
	if (!dragging && run.released === null) run.released = now
	if (dragging) run.released = null

	// Held nodes are where the pointer has put them.
	for (const b of run.bodies.values()) {
		if (!b.held) continue
		const at = editor.getShapePageBounds(b.id)
		if (at) {
			b.x = at.x
			b.y = at.y
		}
	}
	const dt = Math.min(2, elapsed / 16)
	if (run.live) live(run, dt)
	else springy(run, dt)

	const moves: { id: TLShapeId; type: string; x: number; y: number }[] = []
	let energy = 0
	for (const b of run.bodies.values()) {
		if (b.held) continue
		const shape = editor.getShape(b.id)
		if (!shape) continue
		energy += Math.abs(b.vx) + Math.abs(b.vy)
		if (Math.abs(shape.x - b.x) > 0.3 || Math.abs(shape.y - b.y) > 0.3) moves.push({ id: b.id, type: shape.type, x: b.x, y: b.y })
	}
	if (moves.length) editor.updateShapes(moves as never)
	if (run.released !== null && (now - run.released > SETTLE_MS || energy < 0.5)) {
		runs.delete(editor)
		// Coming to rest, nothing is left covering anything: the springs ease, this guarantees.
		const rest = separate(run)
		if (rest.length) editor.updateShapes(rest as never)
	}
}

/** A last pass that pushes apart any two bodies still overlapping. The held ones stay put. */
function separate(run: Run): { id: TLShapeId; type: string; x: number; y: number }[] {
	const list = [...run.bodies.values()]
	const moved = new Set<Body>()
	for (let round = 0; round < 40; round++) {
		let any = false
		for (let i = 0; i < list.length; i++) {
			for (let j = i + 1; j < list.length; j++) {
				const a = list[i]!
				const b = list[j]!
				const dx = b.x + b.w / 2 - (a.x + a.w / 2)
				const dy = b.y + b.h / 2 - (a.y + a.h / 2)
				const ox = (a.w + b.w) / 2 + PAD / 2 - Math.abs(dx)
				const oy = (a.h + b.h) / 2 + PAD / 2 - Math.abs(dy)
				if (ox <= 0 || oy <= 0 || (a.held && b.held)) continue
				any = true
				const share = a.held || b.held ? 1 : 0.5
				const [sx, sy] = ox < oy ? [Math.sign(dx || 1) * ox * share, 0] : [0, Math.sign(dy || 1) * oy * share]
				if (!a.held) {
					a.x -= sx
					a.y -= sy
					moved.add(a)
				}
				if (!b.held) {
					b.x += sx
					b.y += sy
					moved.add(b)
				}
			}
		}
		if (!any) break
	}
	return [...moved].map((b) => ({ id: b.id, type: b.key.startsWith('item:') ? 'node.skillEntry' : 'node.skill', x: b.x, y: b.y }))
}

/** The branch springs after what holds it; anything a moving node runs into is pushed aside. */
function springy(run: Run, dt: number): void {
	const moving: Body[] = []
	for (const b of run.bodies.values()) {
		if (b.held) moving.push(b)
		if (!b.follows || b.held) continue
		const anchor = run.bodies.get(b.follows.key)
		if (!anchor) continue
		const ax = (anchor.x + b.follows.dx - b.x) * 0.12
		const ay = (anchor.y + b.follows.dy - b.y) * 0.12
		b.vx = (b.vx + ax * dt) * 0.78
		b.vy = (b.vy + ay * dt) * 0.78
		b.x += b.vx * dt
		b.y += b.vy * dt
		moving.push(b)
	}
	for (const b of run.bodies.values()) {
		if (b.held || b.follows) continue
		for (const m of moving) push(b, m, dt)
		b.vx *= 0.8
		b.vy *= 0.8
		b.x += b.vx * dt
		b.y += b.vy * dt
	}
}

/** Pushes `b` out of `m`'s way along the shorter axis, as velocity, so it eases rather than jumps. */
function push(b: Body, m: Body, dt: number): void {
	const dx = b.x + b.w / 2 - (m.x + m.w / 2)
	const dy = b.y + b.h / 2 - (m.y + m.h / 2)
	const ox = (b.w + m.w) / 2 + PAD - Math.abs(dx)
	const oy = (b.h + m.h) / 2 + PAD - Math.abs(dy)
	if (ox <= 0 || oy <= 0) return
	if (ox < oy) b.vx += Math.sign(dx || 1) * ox * 0.3 * dt
	else b.vy += Math.sign(dy || 1) * oy * 0.3 * dt
}

/** Every node repels the others, every line pulls its ends to a rest length; it cools after release. */
function live(run: Run, dt: number): void {
	if (run.released !== null) run.heat *= 0.94
	const list = [...run.bodies.values()]
	const reach = (b: Body) => Math.hypot(b.w, b.h) * 0.45
	for (let i = 0; i < list.length; i++) {
		const a = list[i]!
		for (let j = i + 1; j < list.length; j++) {
			const b = list[j]!
			const dx = b.x + b.w / 2 - (a.x + a.w / 2)
			const dy = b.y + b.h / 2 - (a.y + a.h / 2)
			const want = reach(a) + reach(b) + 60
			const d2 = Math.max(1, dx * dx + dy * dy)
			if (d2 > want * want * 4) continue
			const d = Math.sqrt(d2)
			const f = ((want * want) / d2) * 0.6
			a.vx -= (f * dx) / d
			a.vy -= (f * dy) / d
			b.vx += (f * dx) / d
			b.vy += (f * dy) / d
		}
	}
	for (const e of run.edges) {
		const a = run.bodies.get(e.a)
		const b = run.bodies.get(e.b)
		if (!a || !b) continue
		const dx = b.x - a.x
		const dy = b.y - a.y
		const d = Math.max(1, Math.hypot(dx, dy))
		const f = (d - (reach(a) + reach(b) + 60)) * 0.02
		a.vx += (f * dx) / d
		a.vy += (f * dy) / d
		b.vx -= (f * dx) / d
		b.vy -= (f * dy) / d
	}
	for (const b of list) {
		if (b.held) {
			b.vx = 0
			b.vy = 0
			continue
		}
		b.vx *= 0.6
		b.vy *= 0.6
		const cap = 40 * run.heat
		b.x += Math.max(-cap, Math.min(cap, b.vx)) * dt * run.heat
		b.y += Math.max(-cap, Math.min(cap, b.vy)) * dt * run.heat
	}
}
