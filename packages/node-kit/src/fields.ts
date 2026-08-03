import { T } from 'tldraw'
import { coercePropertyValue, formatPropertyValue, numericPropertyValue } from './properties/format'
import {
	nameFromPropertyKey,
	propertyIdFromName,
	type PropertyDef,
	type PropertyType,
} from './properties/types'

/**
 * The old per-node field system, now a **thin adapter over `properties/`**.
 *
 * It survives for exactly one reason: `node.item`'s props are validated against `fieldValidator`, so
 * the shape of a stored field is part of the schema of every existing board and cannot change until
 * those shapes are migrated away (see the item→note migration). Everything *behavioural* — coercion,
 * formatting, numeric projection — now lives in `properties/` and is merely re-exposed here, so there
 * is one implementation rather than two that drift.
 *
 * The direction of travel: new code imports from `properties/`. This file shrinks to nothing once no
 * board can contain a `node.item`.
 */
export const FIELD_TYPES = [
	'text',
	'number',
	'currency',
	'select',
	'url',
	'date',
	'checkbox',
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

/** A field's value. `null` means "empty" for every type — templates rely on this. */
export type FieldValue = string | number | boolean | null

export interface NodeField {
	key: string
	type: FieldType
	value: FieldValue
	/** ISO-4217-ish code for `currency` ('GEL' → ₾), or a display unit for `number` ('kg'). */
	unit?: string
}

export const fieldValidator: T.Validatable<NodeField> = T.object({
	key: T.string,
	type: T.literalEnum(...FIELD_TYPES),
	value: T.jsonValue.refine((v): FieldValue => {
		if (v === null) return null
		const t = typeof v
		if (t === 'string' || t === 'number' || t === 'boolean') return v as FieldValue
		throw new Error(`Field value must be a JSON scalar, got ${t}`)
	}),
	unit: T.string.optional(),
})

/** Views a legacy field as a property definition, which is what the shared code now takes. */
export function fieldAsPropertyDef(field: NodeField): PropertyDef {
	return {
		id: field.key,
		name: nameFromPropertyKey(field.key),
		// `FieldType` is a subset of `PropertyType` — every member is spelled identically.
		type: field.type satisfies PropertyType,
		// Spread, never `unit: field.unit`. A property definition ends up in `shape.meta`, which tldraw
		// validates as `T.jsonValue` — and `undefined` is not a JSON value, so an explicit
		// `unit: undefined` on a non-currency field made the whole board fail to load.
		...(field.unit ? { unit: field.unit } : {}),
	}
}

export function coerceFieldValue(type: FieldType, raw: unknown): FieldValue {
	// No legacy field type is a list type, so the shared coercion can never return an array here.
	return coercePropertyValue(type, raw) as FieldValue
}

export function formatFieldValue(field: NodeField): string {
	return formatPropertyValue(fieldAsPropertyDef(field), field.value)
}

export function numericFieldValue(field: NodeField): number | null {
	return numericPropertyValue(fieldAsPropertyDef(field), field.value)
}

/** Slug used as a field key when the user types a label. Keeps keys comparable across items. */
export const normalizeFieldKey = propertyIdFromName

/** Title-cases a field key for display: `unit_price` → `Unit price`. */
export const fieldKeyLabel = nameFromPropertyKey

export { currencySymbol, formatCurrency, formatNumber } from './properties/format'
export { DEFAULT_CURRENCY, defaultUnitForType } from './properties/types'
