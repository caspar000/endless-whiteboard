import { T } from 'tldraw'

/**
 * The property type system — the replacement for the old per-node "field" system.
 *
 * The shift is what makes this a system rather than a set of components: a property is *defined once
 * per board* and any shape may carry a value for it, including tldraw's own stickies, text and images.
 * That is the Notion/Tana model (a schema objects opt into) and it is what makes a user-built table
 * view possible instead of a hard-coded rollup.
 *
 * Values stay JSON scalars plus string lists (§7: "JSON-scalar props only"). That bound is
 * load-bearing twice over: it keeps values validatable and sync-ready, and it keeps the facts
 * equality check one level deep, which is what makes dragging free of recomputes.
 */
export const PROPERTY_TYPES = [
	'text',
	'number',
	// Money: a number plus a currency code. Formerly `'currency'`; boards persisted with the old
	// name are normalised on read (see `parsePropertyRegistry`), so the old string never needs to
	// be a member here.
	'financial',
	'date',
	'checkbox',
	'url',
	// A titled URL: what you call it, and where it goes. `url` is the bare address; `link` is the pair,
	// encoded into one string so values stay JSON scalars (see `link.ts`).
	'link',
	'select',
	'multiSelect',
] as const

export type PropertyType = (typeof PROPERTY_TYPES)[number]

/**
 * A property's value. `null` means "empty" for every type.
 *
 * `readonly string[]` is only ever produced by `multiSelect` — which is how tags stopped being a
 * separate concept and became just another property.
 */
export type PropertyValue = string | number | boolean | null | readonly string[]

export interface PropertyDef {
	/**
	 * Stable identity. Values are keyed by this, so renaming a property touches no shapes.
	 *
	 * Deterministically derived from the name at *creation* time via `propertyIdFromName`, never
	 * random: the item→note migration has to produce the same ids every time it runs, because tldraw
	 * only persists a migrated schema on the first store change (open a board, touch nothing, and it
	 * migrates again next load).
	 */
	id: string
	name: string
	type: PropertyType
	/** ISO-4217-ish code for `financial` ('GEL' → ₾), or a display unit for `number` ('kg'). */
	unit?: string
	/** Known choices for `select` / `multiSelect`. Not a constraint — a value outside it still shows. */
	options?: string[]
}

export const propertyValueValidator: T.Validatable<PropertyValue> = T.jsonValue.refine(
	(v): PropertyValue => {
		if (v === null) return null
		if (Array.isArray(v)) {
			// A multiSelect value. Homogeneity is checked rather than assumed, because meta is untyped
			// JSON that may come from an older app version or an imported backup.
			for (const item of v) {
				if (typeof item !== 'string') throw new Error('A property list may only hold strings')
			}
			return v as readonly string[]
		}
		const t = typeof v
		if (t === 'string' || t === 'number' || t === 'boolean') return v as PropertyValue
		throw new Error(`Property value must be a JSON scalar or string list, got ${t}`)
	}
)

export const propertyDefValidator: T.Validatable<PropertyDef> = T.object({
	id: T.string,
	name: T.string,
	type: T.literalEnum(...PROPERTY_TYPES),
	unit: T.string.optional(),
	options: T.arrayOf(T.string).optional(),
})

/** Whether this type's values are lists — the one place that distinction is decided. */
export function isListType(type: PropertyType): boolean {
	return type === 'multiSelect'
}

/**
 * The id for a newly created property, derived from its name.
 *
 * Deterministic and human-readable, which makes the stored JSON debuggable and makes the item→note
 * migration idempotent. Leading underscores are stripped because ids beginning with `_` are reserved
 * for built-in table columns (`__label`).
 *
 * Returns `''` for a name with nothing usable in it — `'---'`, say. That empty result is the
 * rejection signal callers check, deliberately rather than inventing a placeholder name: a property
 * called "property" is worse than no property.
 */
export function propertyIdFromName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
}

/** Title-cases an old field key for use as a property name: `unit_price` → `Unit price`. */
export function nameFromPropertyKey(key: string): string {
	const spaced = key.replace(/[_-]+/g, ' ').trim()
	return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * The id of the `Tags` property.
 *
 * Well-known because two places must agree on it without talking to each other: the item→note
 * migration creates it, and the legacy item node projects `props.tags` onto it so that a rollup scoped
 * to tags keeps working on a board that hasn't been migrated yet.
 */
export const TAGS_PROPERTY_ID = 'tags'

export const DEFAULT_CURRENCY = 'GEL'

export function defaultUnitForType(type: PropertyType): string | undefined {
	return type === 'financial' ? DEFAULT_CURRENCY : undefined
}

/** The empty value for a type — `false` for a checkbox, an empty list for multiSelect, else `null`. */
export function emptyValueForType(type: PropertyType): PropertyValue {
	if (type === 'checkbox') return false
	if (isListType(type)) return []
	return null
}
