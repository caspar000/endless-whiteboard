import type { FieldValue } from './fields'

/**
 * The uniform "what data does this node expose" contract (§4.3). Any node type — item, table,
 * plugin-defined — becomes aggregatable by existing rollup nodes by implementing `extractFacts`.
 *
 * Facts deliberately exclude anything positional. That is the whole point: dragging a shape
 * rewrites x/y but leaves its facts identical, so `areFactsMapsEqual` short-circuits the rollup
 * pipeline and nothing downstream recomputes during a drag.
 */
export interface NodeFacts {
	type: string
	/** tldraw parent id — a frame id when the shape sits in a frame. Powers `scope: 'frame'`. */
	parentId: string | null
	tags: readonly string[]
	fields: Readonly<Record<string, FieldValue>>
	/** Per-field unit, so a rollup can label its total ₾ without re-reading shapes. */
	units?: Readonly<Record<string, string>>
	/** Display name, used in grouped rollup output and pickers. */
	label?: string
}

export type FactsMap = ReadonlyMap<string, NodeFacts>

function areStringListsEqual(a: readonly string[], b: readonly string[]): boolean {
	if (a === b) return true
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
	return true
}

function areScalarRecordsEqual(
	a: Readonly<Record<string, FieldValue | string>> | undefined,
	b: Readonly<Record<string, FieldValue | string>> | undefined
): boolean {
	if (a === b) return true
	if (!a || !b) return false
	const aKeys = Object.keys(a)
	const bKeys = Object.keys(b)
	if (aKeys.length !== bKeys.length) return false
	for (const k of aKeys) {
		// `in` check matters: {x: undefined} and {} have different key counts but we still want
		// a missing key to compare unequal to a present-but-undefined one.
		if (!(k in b) || a[k] !== b[k]) return false
	}
	return true
}

export function areFactsEqual(a: NodeFacts, b: NodeFacts): boolean {
	if (a === b) return true
	return (
		a.type === b.type &&
		a.parentId === b.parentId &&
		a.label === b.label &&
		areStringListsEqual(a.tags, b.tags) &&
		areScalarRecordsEqual(a.fields, b.fields) &&
		areScalarRecordsEqual(a.units, b.units)
	)
}

/**
 * The `isEqual` passed to the `pageFacts` computed. Boards hold hundreds of scalar entries, so a
 * full structural comparison is microseconds — far cheaper than re-aggregating every rollup.
 */
export function areFactsMapsEqual(a: FactsMap, b: FactsMap): boolean {
	if (a === b) return true
	if (a.size !== b.size) return false
	for (const [id, factsA] of a) {
		const factsB = b.get(id)
		if (!factsB || !areFactsEqual(factsA, factsB)) return false
	}
	return true
}

/** Every field key present anywhere on the board — drives the rollup config pickers (§4.2). */
export function collectFieldKeys(facts: FactsMap, nodeType?: string | null): string[] {
	const keys = new Set<string>()
	for (const f of facts.values()) {
		if (nodeType && f.type !== nodeType) continue
		for (const k of Object.keys(f.fields)) keys.add(k)
	}
	return [...keys].sort()
}

/** Every tag present anywhere on the board — drives the `scope: 'tags'` picker. */
export function collectTags(facts: FactsMap): string[] {
	const tags = new Set<string>()
	for (const f of facts.values()) for (const t of f.tags) tags.add(t)
	return [...tags].sort()
}

/** The unit most commonly attached to a field key, used to label a rollup's output. */
export function dominantUnit(facts: FactsMap, fieldKey: string): string | undefined {
	const counts = new Map<string, number>()
	for (const f of facts.values()) {
		const unit = f.units?.[fieldKey]
		if (unit) counts.set(unit, (counts.get(unit) ?? 0) + 1)
	}
	let best: string | undefined
	let bestCount = 0
	for (const [unit, count] of counts) {
		if (count > bestCount) {
			best = unit
			bestCount = count
		}
	}
	return best
}
