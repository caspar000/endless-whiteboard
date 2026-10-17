/**
 * A radial tidy tree: every node at its depth's ring, each subtree given an arc in proportion to its
 * leaves, so families stay together and no two nodes share a spot (docs/skill-tree-plan.md,
 * "Layout"). Pure; the caller turns angle and depth into positions. Step 6 adds force separation on
 * top of this; the tree shape comes from here.
 */
export interface LayoutNode {
	id: string
	/** The node it hangs from: its first prerequisite on this tree, or '' for a root. */
	parent: string
}

export interface Placement {
	depth: number
	/** Radians, 0 pointing right, growing clockwise on screen. */
	angle: number
}

export function radialTree(nodes: readonly LayoutNode[], startAngle = -Math.PI / 2): Map<string, Placement> {
	const ids = new Set(nodes.map((n) => n.id))
	const children = new Map<string, string[]>()
	const roots: string[] = []
	for (const node of nodes) {
		// A parent the tree doesn't have, or itself, makes the node a root.
		const parent = node.parent && ids.has(node.parent) && node.parent !== node.id ? node.parent : ''
		if (!parent) roots.push(node.id)
		else children.set(parent, [...(children.get(parent) ?? []), node.id])
	}
	const leaves = new Map<string, number>()
	const seen = new Set<string>()
	const countLeaves = (id: string): number => {
		if (seen.has(id)) return 0
		seen.add(id)
		const kids = children.get(id) ?? []
		const n = kids.length ? kids.reduce((sum, kid) => sum + countLeaves(kid), 0) : 1
		leaves.set(id, Math.max(1, n))
		return Math.max(1, n)
	}
	for (const root of roots) countLeaves(root)

	const out = new Map<string, Placement>()
	const place = (id: string, depth: number, from: number, to: number) => {
		if (out.has(id)) return
		out.set(id, { depth, angle: (from + to) / 2 })
		let cursor = from
		const kids = children.get(id) ?? []
		const total = kids.reduce((sum, kid) => sum + (leaves.get(kid) ?? 1), 0)
		for (const kid of kids) {
			const span = ((to - from) * (leaves.get(kid) ?? 1)) / Math.max(1, total)
			place(kid, depth + 1, cursor, cursor + span)
			cursor += span
		}
	}

	if (roots.length === 1) {
		place(roots[0]!, 0, startAngle, startAngle + 2 * Math.PI)
	} else {
		// Several roots share the first ring around an empty centre, each with its own arc.
		const total = roots.reduce((sum, root) => sum + (leaves.get(root) ?? 1), 0)
		let cursor = startAngle
		for (const root of roots) {
			const span = (2 * Math.PI * (leaves.get(root) ?? 1)) / Math.max(1, total)
			place(root, 1, cursor, cursor + span)
			cursor += span
		}
	}
	// Anything left (a cycle with no way in) goes on the outer ring rather than vanishing.
	let extra = 0
	for (const node of nodes) {
		if (out.has(node.id)) continue
		out.set(node.id, { depth: 1 + Math.max(0, ...[...out.values()].map((p) => p.depth)), angle: startAngle + extra++ * 0.4 })
	}
	return out
}
