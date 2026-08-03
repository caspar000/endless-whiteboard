import type { Editor, JsonObject, TLShape, TLShapePartial } from 'tldraw'
import { parsePropertyRegistry, propertyMap, readPropertyRegistry } from './schema'
import { propertyValueValidator, type PropertyDef, type PropertyValue } from './types'

/**
 * Property *values* live on `shape.meta` — the one field tldraw gives every shape, its own built-ins
 * included. That is precisely why properties can be universal: a dragged-in image and a sticky note
 * carry a price the same way an item node does, with no shape-type cooperation at all.
 *
 * ### Why two flat, colon-namespaced keys and not one nested object
 *
 * `Editor.updateShape` merges `meta` exactly *one* level deep (`next.meta = {...prev.meta,
 * ...partial.meta}`). A nested `meta.lifeboard` would therefore be **wholly replaced** on every write,
 * silently clobbering its siblings — so a write of a property value would destroy the sidecar, and a
 * write from anywhere else would destroy the values. Flat top-level keys merge correctly, and match
 * the precedent already set on document meta.
 *
 * Within a key there is no merging: `lifeboard:props` is replaced atomically, which is why every write
 * here is read-modify-write.
 */
const VALUES_KEY = 'lifeboard:props'
const DEFS_KEY = 'lifeboard:propDefs'

export type ShapeProperties = Readonly<Record<string, PropertyValue>>

/**
 * The minimum a *read* needs.
 *
 * Not `TLShape`, on purpose: node components hold the structural `NodeShape<Props>` whose `type` is
 * `string`, which tldraw's closed `TLShape` union rejects (see `registry.tsx`). Asking only for what is
 * actually read means both kinds of caller work without a cast, and the type says something true.
 */
export interface ShapeWithMeta {
	meta: JsonObject
}

const EMPTY: ShapeProperties = Object.freeze({})

/**
 * The values a shape carries, keyed by property id.
 *
 * Pure and cheap on purpose: this runs for every shape on the board inside the facts pipeline. Unknown
 * or malformed entries are dropped — meta is untyped JSON that tldraw neither validates nor migrates.
 */
export function readShapeProperties(shape: ShapeWithMeta): ShapeProperties {
	const raw = shape.meta[VALUES_KEY]
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY

	let values: Record<string, PropertyValue> | null = null
	for (const [id, value] of Object.entries(raw)) {
		let parsed: PropertyValue
		try {
			parsed = propertyValueValidator.validate(value)
		} catch {
			continue
		}
		values ??= {}
		values[id] = parsed
	}
	// The shared frozen empty object matters: `areFactsEqual`'s fast path is reference equality, and
	// the overwhelming majority of shapes on a board carry no properties at all.
	return values ?? EMPTY
}

/** Whether the shape carries this property at all — distinct from carrying it with an empty value. */
export function shapeCarriesProperty(shape: ShapeWithMeta, id: string): boolean {
	return id in readShapeProperties(shape)
}

/**
 * The definitions a shape carries a copy of, for the ids in its values map.
 *
 * A self-describing sidecar, so that **pasting a shape into another board is self-healing**: without
 * it, the pasted values would be unrecoverable id → value pairs with no name, type or unit. Read only
 * by the paste path (`mergeProperties`), never by the facts pipeline — it is redundant data, and the
 * registry is the source of truth wherever one exists.
 */
export function readShapePropertyDefs(shape: ShapeWithMeta): PropertyDef[] {
	// Reuses the registry parser, so the sidecar can never be more trusted than the registry itself.
	return parsePropertyRegistry(shape.meta[DEFS_KEY])
}

/**
 * Writes property values on any shape, in one undo entry.
 *
 * `undefined` for a value **removes** that property from the shape; `null` keeps it attached but
 * empty. Those are genuinely different states — an attached-but-empty property is what "add Price,
 * fill it in later" produces, and aggregation counts it as *skipped* rather than *not matched*.
 */
export function updateShapeProperties(
	editor: Editor,
	shape: TLShape,
	patch: Readonly<Record<string, PropertyValue | undefined>>
): void {
	const current = readShapeProperties(shape)
	const next: Record<string, PropertyValue> = { ...current }
	for (const [id, value] of Object.entries(patch)) {
		if (value === undefined) delete next[id]
		else next[id] = value
	}

	const registry = propertyMap(readPropertyRegistry(editor))
	// The sidecar is rebuilt from the registry on every write rather than patched, so a renamed or
	// retyped property propagates to copies instead of leaving stale definitions behind.
	const defs: PropertyDef[] = []
	for (const id of Object.keys(next)) {
		const def = registry.get(id)
		if (def) defs.push(def)
	}

	editor.run(() => {
		editor.updateShape({
			id: shape.id,
			type: shape.type,
			meta: {
				[VALUES_KEY]: next as unknown as JsonObject,
				[DEFS_KEY]: defs as unknown as JsonObject,
			},
		} as TLShapePartial)
	})
}

/** Attaches a property with its type's empty value, if the shape doesn't already carry it. */
export function attachProperty(
	editor: Editor,
	shape: TLShape,
	def: PropertyDef,
	empty: PropertyValue
): void {
	if (shapeCarriesProperty(shape, def.id)) return
	updateShapeProperties(editor, shape, { [def.id]: empty })
}

export function removeShapeProperty(editor: Editor, shape: TLShape, id: string): void {
	if (!shapeCarriesProperty(shape, id)) return
	updateShapeProperties(editor, shape, { [id]: undefined })
}
