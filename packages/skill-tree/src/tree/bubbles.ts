import { siblingOrder, type BalloonInput } from './balloon'

/**
 * Bubbles (docs/skill-tree-layout-plan.md, "Layout algorithms"), after Grivet, Auber, Domenger and
 * Melançon's Bubble Tree (2004), built from its published idea rather than its text: every subtree is
 * enclosed in a circle, its bubble, and a node's children's bubbles are packed round it.
 *
 * - Bottom-up, a leaf's bubble is its cluster. A node's children's bubbles go round it in order, in a
 *   fan centred straight out (`fanSpread`; all the way round for You), each as close as its bubble
 *   clears the parent's cluster and the child clears it. Each child sits at the edge of its own
 *   bubble nearest the parent, on the line from the parent to the bubble's centre, so an arrow is
 *   short and the bubble opens out behind it. A fan too wide for its spread moves out, all together,
 *   until it fits. The node's own bubble is the smallest circle round its cluster and theirs.
 * - Top-down, each subtree is turned to face away from its parent.
 * - With `balanceSiblings`, each family goes round its parent in organ-pipe order (Lin and Yen): the
 *   biggest bubble in the middle of the fan, the smallest at its ends.
 *
 * Each bubble lies inside its own angle seen from its parent, and siblings' angles don't overlap, so
 * no arrow crosses another and no branch reaches another, by construction.
 */

type Point = { x: number; y: number }
/** A subtree laid out on its own: its node at the origin, its bubble's centre and radius. */
interface Bubble {
	cx: number
	cy: number
	r: number
	/** Each child: where its node is, and the turn its own subtree is given, relative to this node. */
	at: Map<string, { x: number; y: number; turn: number }>
}

const TURN = 2 * Math.PI

export function bubbles({ start, order, kids: given, radius, arrows = [], config: C }: BalloonInput): Map<string, Point> {
	const gap = C.clusterGap
	const parentOf = new Map<string, string>()
	for (const id of order) for (const kid of given(id)) parentOf.set(kid, id)
	const kids = siblingOrder(start, order, given, parentOf, arrows)
	const own = (id: string) => (id === start ? radius(start) + C.hubRoom - gap : radius(id))
	const made = new Map<string, Bubble>()

	for (const id of [...order].reverse()) {
		// The pillars keep their order round You; a family, balanced, has its biggest in the middle.
		const children = C.balanceSiblings && id !== start ? organPipe(kids(id), (k) => made.get(k)!.r) : kids(id)
		const r = own(id)
		if (!children.length) {
			made.set(id, { cx: 0, cy: 0, r, at: new Map() })
			continue
		}
		const fan = id === start ? TURN : (C.fanSpread / 180) * Math.PI
		const subs = children.map((k) => made.get(k)!)
		// Each child's bubble centre at the least distance that clears the parent, the child on the way.
		const least = children.map((k, i) => {
			const b = subs[i]!
			const offset = Math.hypot(b.cx, b.cy)
			return Math.max(r + gap + b.r, r + gap + radius(k) + offset)
		})
		const halfAt = (i: number, d: number) => Math.asin(Math.min(1, (subs[i]!.r + gap / 2) / d))
		let scale = 1
		const spanAt = (s: number) => children.reduce((n, _, i) => n + 2 * halfAt(i, least[i]! * s), 0)
		while (spanAt(scale) > fan && scale < 100) scale *= 1.05
		const dist = least.map((d) => d * scale)
		const span = spanAt(scale)
		/** Child `k` with its bubble's centre `dist` out at `a`, the child on the line to it. */
		const place = (k: string, i: number, a: number, into: Map<string, { x: number; y: number; turn: number }>) => {
			const b = subs[i]!
			const offset = Math.hypot(b.cx, b.cy)
			const d = dist[i]! - offset
			// The child's subtree turned so its bubble's centre lies straight out from the parent.
			const turn = a - (offset > 1e-9 ? Math.atan2(b.cy, b.cx) : 0)
			into.set(k, { x: d * Math.cos(a), y: d * Math.sin(a), turn })
		}
		let angle = id === start ? -Math.PI / 2 - halfAt(0, dist[0]!) : -span / 2
		if (id === start) {
			// The spare room round You shared out between the pillars.
			const spare = (TURN - span) / children.length
			angle -= spare / 2
			const at = new Map<string, { x: number; y: number; turn: number }>()
			children.forEach((k, i) => {
				angle += spare / 2 + halfAt(i, dist[i]!)
				place(k, i, angle, at)
				angle += halfAt(i, dist[i]!) + spare / 2
			})
			made.set(id, { cx: 0, cy: 0, r: Math.max(...children.map((_, i) => dist[i]! + subs[i]!.r)), at })
			continue
		}
		const at = new Map<string, { x: number; y: number; turn: number }>()
		children.forEach((k, i) => {
			angle += halfAt(i, dist[i]!)
			place(k, i, angle, at)
			angle += halfAt(i, dist[i]!)
		})
		// The smallest circle round the node's cluster and its children's bubbles (Bădoiu–Clarkson).
		const circles = [{ x: 0, y: 0, r }, ...children.map((k, i) => ({ ...centreOf(at.get(k)!, subs[i]!), r: subs[i]!.r }))]
		made.set(id, { ...enclose(circles), at })

	}

	// Top-down: each subtree turned and placed in its parent's frame.
	const out = new Map<string, Point>([[start, { x: 0, y: 0 }]])
	const facing = new Map<string, number>([[start, 0]])
	for (const id of order) {
		const b = made.get(id)!
		const from = out.get(id)!
		const f = facing.get(id)!
		const [c, s] = [Math.cos(f), Math.sin(f)]
		for (const [k, p] of b.at) {
			out.set(k, { x: from.x + p.x * c - p.y * s, y: from.y + p.x * s + p.y * c })
			facing.set(k, f + p.turn)
		}
	}
	return out
}

/** Where a child's bubble's centre is, in its parent's frame. */
function centreOf(p: { x: number; y: number; turn: number }, b: Bubble): Point {
	const [c, s] = [Math.cos(p.turn), Math.sin(p.turn)]
	return { x: p.x + b.cx * c - b.cy * s, y: p.y + b.cx * s + b.cy * c }
}

/** A circle round all of `circles`, near the smallest (Bădoiu–Clarkson: step toward the farthest). */
function enclose(circles: readonly { x: number; y: number; r: number }[]): { cx: number; cy: number; r: number } {
	let [cx, cy] = [circles[0]!.x, circles[0]!.y]
	const far = () => {
		let best = circles[0]!
		let reach = -Infinity
		for (const c of circles) {
			const d = Math.hypot(c.x - cx, c.y - cy) + c.r
			if (d > reach) [reach, best] = [d, c]
		}
		return { best, reach }
	}
	for (let k = 1; k <= 200; k++) {
		const { best } = far()
		const d = Math.hypot(best.x - cx, best.y - cy)
		if (d < 1e-9) break
		// Toward the farthest circle's far edge, by less each time.
		const tx = best.x + ((best.x - cx) / d) * best.r
		const ty = best.y + ((best.y - cy) / d) * best.r
		cx += (tx - cx) / (k + 1)
		cy += (ty - cy) / (k + 1)
	}
	return { cx, cy, r: far().reach }
}

/**
 * `items` in organ-pipe order by `size` (after Lin and Yen's balloon drawings): the biggest in the
 * middle, the rest either side of it by turns, smallest at the ends, so a fan round its parent comes
 * out balanced and its bubble round. Ties keep their order.
 */
export function organPipe<T>(items: readonly T[], size: (item: T) => number): T[] {
	const sorted = items.map((item, i) => ({ item, i, s: size(item) })).sort((a, b) => b.s - a.s || a.i - b.i)
	const left: T[] = []
	const right: T[] = []
	sorted.forEach(({ item }, k) => (k % 2 === 0 ? right : left).push(item))
	return [...left.reverse(), ...right]
}
