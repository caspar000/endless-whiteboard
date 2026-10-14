import type { Editor, TLShape, TLShapePartial } from '@lifeboard/canvas'
import { currencySymbol, formatPropertyValue } from './format'
import type { PropertyDef, PropertyType, PropertyValue } from './types'
import type { ShapeWithMeta } from './values'
import { autoLayoutGroups } from './view'

/**
 * A node's card layout: how display mode lays out its properties (docs/property-display-plan.md).
 *
 * Each node owns its layout outright. A layout is a stack of rows, each row three slots (left, centre,
 * right), and a slot holds elements that flow inline. Rows grow to fit what is in them. Properties are
 * referenced by id, so renaming one breaks nothing.
 *
 * Stored as plain JSON on `shape.meta`, because meta is JSON and nothing validates it on the way in;
 * `parseStoredLayout` is the gate on the way out, and drops what it cannot read rather than throwing.
 */

export const LAYOUT_SIZES = ['s', 'm', 'l', 'xl'] as const
export type LayoutSize = (typeof LAYOUT_SIZES)[number]

export const LAYOUT_WEIGHTS = ['regular', 'bold'] as const
export type LayoutWeight = (typeof LAYOUT_WEIGHTS)[number]

export const ROW_ALIGNS = ['top', 'middle', 'bottom', 'baseline'] as const
export type RowAlign = (typeof ROW_ALIGNS)[number]

export const SLOTS = ['left', 'center', 'right'] as const
export type Slot = (typeof SLOTS)[number]

/** How one property is drawn. Which of these a type allows is `displaysFor`. */
export const PROPERTY_DISPLAYS = ['text', 'badge', 'chip', 'icon', 'bar', 'stars', 'checkbox'] as const
export type PropertyDisplay = (typeof PROPERTY_DISPLAYS)[number]

export const DATE_STYLES = ['short', 'medium', 'long'] as const
export type DateStyle = (typeof DATE_STYLES)[number]

/** Per-element formatting. Each field only means something for some types; the others ignore it. */
export interface ValueFormat {
	/** Decimal places for number, financial and progress. */
	decimals?: number
	/** `false` drops the currency symbol or number unit. */
	symbol?: boolean
	date?: DateStyle
}

export interface PropertyElement {
	kind: 'property'
	property: string
	as?: PropertyDisplay
	size?: LayoutSize
	weight?: LayoutWeight
	showName?: boolean
	format?: ValueFormat
}

/** Chosen properties as a labelled two-column table. */
export interface TableElement {
	kind: 'table'
	properties: string[]
	size?: LayoutSize
}

export interface SeparatorElement {
	kind: 'separator'
}

/** A fixed label. */
export interface TextElement {
	kind: 'text'
	text: string
	size?: LayoutSize
	weight?: LayoutWeight
}

export type LayoutElement = PropertyElement | TableElement | SeparatorElement | TextElement

export interface LayoutRow {
	left?: LayoutElement[]
	center?: LayoutElement[]
	right?: LayoutElement[]
	align?: RowAlign
}

/** A width in page units, `fit` (hug the content) or `full` (the node's width). */
export type CardWidth = number | 'fit' | 'full'

export interface PropertyLayout {
	width?: CardWidth
	rows: LayoutRow[]
}

/** The widths a card may be given, so a typo can't make one 3px or 30,000px wide. */
export const CARD_WIDTH_RANGE = { min: 80, max: 1200 } as const

/**
 * The displays a property type allows, the first being its default.
 *
 * Text works for anything with a single value. The rest are the shapes a type's value can honestly
 * take: stars only mean something for a rating, a bar only for a fraction.
 */
export function displaysFor(type: PropertyType): readonly PropertyDisplay[] {
	switch (type) {
		case 'select':
		case 'status':
			return ['badge', 'chip', 'text']
		case 'multiSelect':
			return ['chip', 'badge', 'text']
		case 'progress':
			return ['bar', 'text', 'badge']
		case 'rating':
			return ['stars', 'bar', 'text', 'badge']
		case 'checkbox':
			return ['checkbox', 'text']
		case 'link':
			return ['text', 'icon', 'badge']
		default:
			return ['text', 'badge']
	}
}

export function defaultDisplay(type: PropertyType): PropertyDisplay {
	return displaysFor(type)[0]!
}

const LAYOUT_KEY = 'lifeboard:propLayout'

export function readPropertyLayout(shape: ShapeWithMeta): PropertyLayout | null {
	return parseStoredLayout(shape.meta[LAYOUT_KEY])
}

/** Writes a layout, or `null` to go back to the automatic one. */
export function setPropertyLayout(editor: Editor, shape: TLShape, layout: PropertyLayout | null): void {
	editor.updateShape({
		id: shape.id,
		type: shape.type,
		meta: { [LAYOUT_KEY]: layout === null ? null : (toJson(layout) as never) },
	} as TLShapePartial)
}

/** A layout as plain JSON, with no `undefined` fields (meta is JSON, and they would not survive sync). */
function toJson(layout: PropertyLayout): unknown {
	return JSON.parse(JSON.stringify(layout))
}

/** The stored JSON as a layout, dropping whatever doesn't fit. `null` for nothing usable. */
export function parseStoredLayout(raw: unknown): PropertyLayout | null {
	if (!isRecord(raw) || !Array.isArray(raw.rows)) return null
	const rows = raw.rows.flatMap((row): LayoutRow[] => {
		if (!isRecord(row)) return []
		const out: LayoutRow = {}
		for (const slot of SLOTS) {
			const elements = Array.isArray(row[slot]) ? row[slot].flatMap(parseStoredElement) : []
			if (elements.length) out[slot] = elements
		}
		if (oneOf(ROW_ALIGNS, row.align)) out.align = row.align
		return [out]
	})
	const layout: PropertyLayout = { rows }
	const width = parseWidth(raw.width)
	if (width !== undefined) layout.width = width
	return layout
}

function parseStoredElement(raw: unknown): LayoutElement[] {
	if (!isRecord(raw)) return []
	switch (raw.kind) {
		case 'separator':
			return [{ kind: 'separator' }]
		case 'text':
			if (typeof raw.text !== 'string') return []
			return [{ kind: 'text', text: raw.text, ...sizeAndWeight(raw) }]
		case 'table': {
			if (!Array.isArray(raw.properties)) return []
			const properties = raw.properties.filter((p): p is string => typeof p === 'string')
			const element: TableElement = { kind: 'table', properties }
			if (oneOf(LAYOUT_SIZES, raw.size)) element.size = raw.size
			return [element]
		}
		case 'property': {
			if (typeof raw.property !== 'string') return []
			const element: PropertyElement = { kind: 'property', property: raw.property, ...sizeAndWeight(raw) }
			if (oneOf(PROPERTY_DISPLAYS, raw.as)) element.as = raw.as
			if (raw.showName === true) element.showName = true
			const format = parseFormat(raw.format)
			if (format) element.format = format
			return [element]
		}
		default:
			return []
	}
}

function sizeAndWeight(raw: Record<string, unknown>): { size?: LayoutSize; weight?: LayoutWeight } {
	const out: { size?: LayoutSize; weight?: LayoutWeight } = {}
	if (oneOf(LAYOUT_SIZES, raw.size)) out.size = raw.size
	if (oneOf(LAYOUT_WEIGHTS, raw.weight)) out.weight = raw.weight
	return out
}

function parseFormat(raw: unknown): ValueFormat | null {
	if (!isRecord(raw)) return null
	const format: ValueFormat = {}
	if (isDecimals(raw.decimals)) format.decimals = raw.decimals
	if (typeof raw.symbol === 'boolean') format.symbol = raw.symbol
	if (oneOf(DATE_STYLES, raw.date)) format.date = raw.date
	return Object.keys(format).length ? format : null
}

export function parseWidth(raw: unknown): CardWidth | undefined {
	if (raw === 'fit' || raw === 'full') return raw
	if (typeof raw === 'number' && raw >= CARD_WIDTH_RANGE.min && raw <= CARD_WIDTH_RANGE.max) return raw
	return undefined
}

export function isDecimals(raw: unknown): raw is number {
	return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 6
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function oneOf<T extends string>(options: readonly T[], value: unknown): value is T {
	return typeof value === 'string' && (options as readonly string[]).includes(value)
}

/**
 * A value as text, with a layout element's formatting applied. Without a format this is exactly what
 * every other surface shows (`formatPropertyValue`).
 */
export function formatLayoutValue(
	def: PropertyDef,
	value: PropertyValue,
	unit: string | undefined,
	format: ValueFormat | undefined
): string {
	if (!format || value === null || typeof value === 'boolean' || Array.isArray(value)) {
		return formatPropertyValue(def, value, unit)
	}
	if (typeof value === 'number' && (def.type === 'number' || def.type === 'financial' || def.type === 'progress')) {
		const decimals = format.decimals ?? (def.type === 'financial' ? 2 : undefined)
		const amount = new Intl.NumberFormat('en-US', {
			minimumFractionDigits: decimals ?? 0,
			maximumFractionDigits: decimals ?? 2,
		}).format(value)
		if (def.type === 'progress') return `${amount}%`
		if (format.symbol === false) return amount
		if (def.type === 'financial') return `${currencySymbol(unit)} ${amount}`
		return unit ? `${amount} ${unit}` : amount
	}
	if (def.type === 'date' && format.date) {
		const d = new Date(String(value))
		if (Number.isNaN(d.getTime())) return String(value)
		return d.toLocaleDateString('en-GB', DATE_FORMATS[format.date])
	}
	return formatPropertyValue(def, value, unit)
}

const DATE_FORMATS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
	short: { day: 'numeric', month: 'short' },
	medium: { day: 'numeric', month: 'short', year: 'numeric' },
	long: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
}

/**
 * The automatic layout written out as a real one: a badge row, then each meta value, chips and bars.
 * What the YAML editor starts from on a node that has no layout yet, so the first edit is a tweak
 * rather than a blank page.
 */
export function layoutFromAuto(defs: readonly PropertyDef[]): PropertyLayout {
	const rows: LayoutRow[] = autoLayoutGroups(defs.map((def) => ({ def }))).map((group) => ({
		left: group.rows.map(({ def }): LayoutElement => ({ kind: 'property', property: def.id })),
	}))
	return { rows }
}

/**
 * What of a layout is left to draw once empty values are taken out, or `null` for nothing at all.
 *
 * Empty hides all the way up: an element with no value goes, then a row whose data all went (its
 * static labels with it, since a label beside nothing labels nothing), then the card once no data is
 * left anywhere. A row that was only ever a label or a line stays. Separators that end up first,
 * last or doubled are dropped, so hiding a row never leaves a stray line.
 */
export function visibleLayoutRows(
	layout: PropertyLayout,
	isFilled: (propertyId: string) => boolean
): LayoutRow[] | null {
	let anyData = false
	const rows: LayoutRow[] = []
	for (const row of layout.rows) {
		let hadData = false
		let hasData = false
		const out: LayoutRow = row.align ? { align: row.align } : {}
		for (const slot of SLOTS) {
			const elements = (row[slot] ?? []).flatMap((element): LayoutElement[] => {
				if (element.kind === 'property') {
					hadData = true
					return isFilled(element.property) ? [element] : []
				}
				if (element.kind === 'table') {
					hadData = true
					const properties = element.properties.filter(isFilled)
					return properties.length ? [{ ...element, properties }] : []
				}
				return [element]
			})
			if (elements.some((e) => e.kind === 'property' || e.kind === 'table')) hasData = true
			if (elements.length) out[slot] = elements
		}
		if (hadData && !hasData) continue
		if (!SLOTS.some((slot) => out[slot]?.length)) continue
		anyData ||= hasData
		rows.push(out)
	}
	if (!anyData) return null

	const isRule = (row: LayoutRow) =>
		SLOTS.every((slot) => (row[slot] ?? []).every((element) => element.kind === 'separator'))
	const kept: LayoutRow[] = []
	for (const row of rows) {
		if (isRule(row) && (!kept.length || isRule(kept[kept.length - 1]!))) continue
		kept.push(row)
	}
	if (kept.length && isRule(kept[kept.length - 1]!)) kept.pop()
	return kept
}
