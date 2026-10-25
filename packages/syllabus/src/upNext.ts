import type { IndexEntry, SkillIndex, TrackEntry } from './skillIndex'

/**
 * What to do now (docs/skill-tree-plan.md, "Up next"): the next undone step of every active track,
 * and which days had anything done. Pure: the indexes in.
 */
export interface NextStep {
	track: TrackEntry
	/** The step to do: the item itself, or a unit's next undone child (depth first). */
	step: IndexEntry
	/** The track's item the step belongs to, when the step is one of its children. */
	parent: IndexEntry | null
}

export interface UpNext {
	steps: NextStep[]
	/** Completions per day, `YYYY-MM-DD` to count. */
	days: Map<string, number>
}

/** The next undone leaf under an item, children in their order; `null` when it is all done. */
export function nextLeaf(entry: IndexEntry, byParent: Map<string, IndexEntry[]>, depth = 0): IndexEntry | null {
	if (depth > 16) return null
	const children = byParent.get(entry.itemId)
	if (!children?.length) return entry.done ? null : entry
	for (const child of children) {
		const leaf = nextLeaf(child, byParent, depth + 1)
		if (leaf) return leaf
	}
	return null
}

export function upNext(
	tracks: readonly TrackEntry[],
	index: SkillIndex,
	goal = ''
): UpNext {
	const inGoal = (g: string) => !goal || g === goal
	const byParent = new Map<string, IndexEntry[]>()
	for (const entry of Object.values(index)) {
		if (!entry.parentItemId) continue
		const list = byParent.get(entry.parentItemId)
		if (list) list.push(entry)
		else byParent.set(entry.parentItemId, [entry])
	}
	for (const list of byParent.values()) list.sort((a, b) => a.position - b.position)

	const steps: NextStep[] = []
	for (const track of tracks) {
		if (track.state !== 'active' || !inGoal(track.goal)) continue
		for (const id of track.order) {
			const entry = index[id]
			if (!entry || entry.done) continue
			const step = nextLeaf(entry, byParent)
			if (!step) continue
			steps.push({ track, step, parent: step.itemId === entry.itemId ? null : entry })
			break
		}
	}

	const entries = Object.values(index)
	const days = new Map<string, number>()
	for (const entry of entries) {
		if (!entry.done || !entry.doneAt || entry.hasChildren) continue
		if (goal && !tracks.some((t) => t.goal === goal && t.order.includes(rootOf(entry, index)))) continue
		days.set(entry.doneAt, (days.get(entry.doneAt) ?? 0) + 1)
	}
	return { steps, days }
}

/** The top-level item an entry belongs to, which is what tracks list. */
function rootOf(entry: IndexEntry, index: SkillIndex): string {
	let current = entry
	for (let depth = 0; current.parentItemId && depth < 16; depth++) {
		const parent = index[current.parentItemId]
		if (!parent) break
		current = parent
	}
	return current.itemId
}

/** The goals tracks name, for the card's filter. */
export function goalsOf(tracks: readonly TrackEntry[]): string[] {
	return [...new Set(tracks.map((t) => t.goal).filter(Boolean))].sort()
}

/**
 * A track's next `count` steps in reading order: undone leaves, depth first through each entry's
 * works, each with the entry it belongs to (itself when it has no works). Pure.
 */
export function upcomingSteps<T extends { itemId: string; children: readonly string[]; done: boolean }>(
	order: readonly string[],
	items: Readonly<Record<string, T>>,
	count: number
): { step: T; entry: T }[] {
	const out: { step: T; entry: T }[] = []
	const walk = (id: string, entry: T, depth: number) => {
		const item = items[id]
		if (!item || out.length >= count || depth > 16) return
		if (!item.children.length) {
			if (!item.done) out.push({ step: item, entry })
			return
		}
		for (const child of item.children) walk(child, entry, depth + 1)
	}
	for (const id of order) {
		const entry = items[id]
		if (entry) walk(id, entry, 0)
		if (out.length >= count) break
	}
	return out
}
