import { habitHistory, habitStart, periodKey, type Period } from './habits'
import type { HabitEntry, IndexEntry, SkillIndex, TrackEntry } from './skillIndex'

/**
 * What to do now (docs/skill-tree-plan.md, "Up next"): the next undone step of every active track,
 * the habits not yet met this period, and which days had anything done. Pure: the three indexes in.
 */
export interface NextStep {
	track: TrackEntry
	/** The step to do: the item itself, or a unit's next undone child (depth first). */
	step: IndexEntry
	/** The track's item the step belongs to, when the step is one of its children. */
	parent: IndexEntry | null
}

export interface DueHabit {
	habit: HabitEntry
	count: number
	target: number
	period: Period
}

export interface UpNext {
	steps: NextStep[]
	habits: DueHabit[]
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
	habits: readonly HabitEntry[],
	today: string,
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

	const due: DueHabit[] = []
	const entries = Object.values(index)
	for (const habit of habits) {
		if (habit.state !== 'active' || !inGoal(habit.goal)) continue
		const start = habitStart(habit, index)
		if (!start) continue
		const period = (habit.period || 'week') as Period
		const history = habitHistory({ ...habit, period, startedAt: start }, entries, today)
		const current = history[history.length - 1]
		const target = Math.max(1, habit.target)
		if (current && current.key === periodKey(today, period) && current.count < target) {
			due.push({ habit, count: current.count, target, period })
		}
	}

	const days = new Map<string, number>()
	for (const entry of entries) {
		if (!entry.done || !entry.doneAt || entry.hasChildren) continue
		if (goal && !tracks.some((t) => t.goal === goal && t.order.includes(rootOf(entry, index)))) continue
		days.set(entry.doneAt, (days.get(entry.doneAt) ?? 0) + 1)
	}
	return { steps, habits: due, days }
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

/** The goals tracks and habits name, for the card's filter. */
export function goalsOf(tracks: readonly TrackEntry[], habits: readonly HabitEntry[]): string[] {
	return [...new Set([...tracks.map((t) => t.goal), ...habits.map((h) => h.goal)].filter(Boolean))].sort()
}
