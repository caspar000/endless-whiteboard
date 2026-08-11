import type { PropertyDef, PropertyValue } from './properties/types'
import { isListType } from './properties/types'
import type { ShapeProperties, ShapePropertyUnits } from './properties/values'

/**
 * What one shape contributes to everything derived from the board (§4.3).
 *
 * **Universal since Phase 2**: facts are extracted from *every* shape on the page, not only from the
 * node types we defined. A dragged-in photo with a price is as aggregatable as an item card, which is
 * the whole point of moving values into `shape.meta`.
 *
 * Facts deliberately exclude anything positional. That is load-bearing: dragging a shape rewrites x/y
 * but leaves its facts identical, so `areFactsMapsEqual` short-circuits the pipeline and nothing
 * downstream recomputes during a drag.
 */
export interface ShapeFacts {
	type: string
	/** tldraw parent id — a frame id when the shape sits in a frame. Powers `scope: 'frame'`. */
	parentId: string | null
	/** Display name from the `shapeLabel` ladder. `''` when the shape has no name to give. */
	label: string
	/** Property values, keyed by property id. Type comes from the board's registry. */
	values: ShapeProperties
	/**
	 * Per-shape unit overrides, keyed by property id — the currency of a money value.
	 *
	 * Here rather than left to the registry because a unit is per shape: two cards can carry the same
	 * `price` property in different currencies, and a table has to render each row in its own.
	 */
	units: ShapePropertyUnits
}

export type FactsMap = ReadonlyMap<string, ShapeFacts>

function areStringListsEqual(a: readonly string[], b: readonly string[]): boolean {
	if (a === b) return true
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
	return true
}

/**
 * Compares two value maps. **Exactly one level deep** — that shallowness is why the drag
 * short-circuit is cheap, and it is the reason property values are bounded to scalars and string
 * lists rather than arbitrary JSON.
 */
export function areValueRecordsEqual(a: ShapeProperties, b: ShapeProperties): boolean {
	if (a === b) return true
	const aKeys = Object.keys(a)
	const bKeys = Object.keys(b)
	if (aKeys.length !== bKeys.length) return false
	for (const k of aKeys) {
		// The `in` check matters: {x: undefined} and {} have different key counts, but a missing key
		// must still compare unequal to a present-but-undefined one.
		if (!(k in b)) return false
		const av = a[k]
		const bv = b[k]
		if (av === bv) continue
		// A list value is a fresh array on every read, so reference equality never fires for tags.
		if (Array.isArray(av) && Array.isArray(bv) && areStringListsEqual(av, bv)) continue
		return false
	}
	return true
}

export function areFactsEqual(a: ShapeFacts, b: ShapeFacts): boolean {
	if (a === b) return true
	return (
		a.type === b.type &&
		a.parentId === b.parentId &&
		a.label === b.label &&
		areValueRecordsEqual(a.values, b.values) &&
		areUnitRecordsEqual(a.units, b.units)
	)
}

/**
 * Units compare like values do — one level deep, identity first.
 *
 * Deliberately part of `areFactsEqual` rather than left out as "cosmetic": a table renders each row in
 * its own currency, so changing one shape's currency genuinely changes what is derived from the board.
 * Leaving it out would make that edit invisible until something else forced a recompute.
 */
function areUnitRecordsEqual(a: ShapePropertyUnits, b: ShapePropertyUnits): boolean {
	if (a === b) return true
	const aKeys = Object.keys(a)
	if (aKeys.length !== Object.keys(b).length) return false
	for (const k of aKeys) if (a[k] !== b[k]) return false
	return true
}

/**
 * The `isEqual` passed to the `pageFacts` computed. Boards hold hundreds of scalar entries, so a full
 * structural comparison is microseconds — far cheaper than re-aggregating every rollup.
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

/** Property ids actually carried by something on the board — used to highlight what's in use. */
export function collectPropertyIds(facts: FactsMap, shapeType?: string | null): string[] {
	const ids = new Set<string>()
	for (const f of facts.values()) {
		if (shapeType && f.type !== shapeType) continue
		for (const id of Object.keys(f.values)) ids.add(id)
	}
	return [...ids].sort()
}

/**
 * The distinct values present on the board for one property, for pickers.
 *
 * Reads from facts rather than from the registry's `options` because a value may legitimately exist
 * outside the recorded options — `options` is a convenience list, never a constraint.
 */
export function collectValuesForProperty(facts: FactsMap, propertyId: string): string[] {
	const values = new Set<string>()
	for (const f of facts.values()) {
		const value = f.values[propertyId]
		if (Array.isArray(value)) for (const v of value) values.add(v)
		else if (typeof value === 'string' && value) values.add(value)
	}
	return [...values].sort()
}

/**
 * Every value held by any list-typed property on this shape.
 *
 * What "the tags of a shape" now means: tags were folded into properties as a multi-select type, so
 * there is no dedicated tag storage to read — the answer is derived from the registry's types.
 */
export function listValuesOf(
	values: ShapeProperties,
	properties: ReadonlyMap<string, PropertyDef>
): string[] {
	const out: string[] = []
	for (const [id, value] of Object.entries(values)) {
		if (!Array.isArray(value)) continue
		const def = properties.get(id)
		if (def && !isListType(def.type)) continue
		for (const v of value) out.push(v)
	}
	return out
}

/** Narrowing helper for the aggregation path, which only ever wants a usable number. */
export function isEmptyValue(value: PropertyValue | undefined): boolean {
	if (value === undefined || value === null || value === '') return true
	return Array.isArray(value) && value.length === 0
}
