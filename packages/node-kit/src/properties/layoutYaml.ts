import {
	Document,
	LineCounter,
	isMap,
	isPair,
	isScalar,
	isSeq,
	parseDocument,
	visit,
	type Node as YamlNode,
	type Pair,
	type YAMLMap,
} from 'yaml'
import {
	DATE_STYLES,
	LAYOUT_SIZES,
	LAYOUT_WEIGHTS,
	ROW_ALIGNS,
	SLOTS,
	displaysFor,
	isDecimals,
	oneOf,
	parseWidth,
	CARD_WIDTH_RANGE,
	type LayoutElement,
	type LayoutRow,
	type PropertyElement,
	type PropertyLayout,
	type TableElement,
	type TextElement,
} from './layout'
import type { PropertyDef } from './types'

/**
 * A card layout as YAML, both ways (docs/property-display-plan.md).
 *
 * The YAML is for people, so it refers to properties by name and has shorthands: a row can be the
 * word `separator`, a `table:`, or a bare element instead of a `left:` holding one. Formatting keys sit
 * on the element itself (`{ property: Price, decimals: 0 }`) rather than under a `format:` map.
 *
 * Parsing never half-succeeds: any error and nothing is returned but the errors, each with its line,
 * so the editor can keep the last good layout on the board.
 */

export interface LayoutYamlError {
	/** 1-based. */
	line: number
	message: string
}

export type LayoutYamlResult =
	| { ok: true; layout: PropertyLayout }
	| { ok: false; errors: LayoutYamlError[] }

const ELEMENT_KEYS = ['property', 'text', 'table'] as const
const PROPERTY_KEYS = ['property', 'as', 'size', 'weight', 'showName', 'decimals', 'symbol', 'date']
const TEXT_KEYS = ['text', 'size', 'weight']
const TABLE_KEYS = ['table', 'size']
const ROW_KEYS = [...SLOTS, 'align']

export function layoutFromYaml(text: string, defs: readonly PropertyDef[]): LayoutYamlResult {
	const lines = new LineCounter()
	const doc = parseDocument(text, { lineCounter: lines, prettyErrors: false })
	if (doc.errors.length) {
		return {
			ok: false,
			errors: doc.errors.map((e) => ({ line: lines.linePos(e.pos[0]).line, message: e.message.split('\n')[0]! })),
		}
	}

	const errors: LayoutYamlError[] = []
	const lineOf = (node: unknown): number => {
		const range = (node as { range?: [number, number, number] } | null)?.range
		return range ? lines.linePos(range[0]).line : 1
	}
	const fail = (node: unknown, message: string): null => {
		errors.push({ line: lineOf(node), message })
		return null
	}

	const byName = new Map<string, PropertyDef>()
	for (const def of defs) {
		byName.set(def.id.toLowerCase(), def)
		byName.set(def.name.trim().toLowerCase(), def)
	}
	const resolve = (node: unknown): PropertyDef | null => {
		const name = isScalar(node) && typeof node.value === 'string' ? node.value : null
		if (name === null) return fail(node, 'A property is named by a word, like `Price`')
		return byName.get(name.trim().toLowerCase()) ?? fail(node, `No property called “${name}” on this board`)
	}

	const root = doc.contents
	if (root === null) return { ok: false, errors: [{ line: 1, message: 'Empty. Write a layout, or reset to automatic' }] }
	if (!isMap(root)) return { ok: false, errors: [{ line: lineOf(root), message: 'A layout starts with `rows:`' }] }

	checkKeys(root, ['width', 'rows'], fail)
	const layout: PropertyLayout = { rows: [] }

	const widthNode = root.get('width', true)
	if (widthNode !== undefined) {
		const width = parseWidth(scalarValue(widthNode))
		if (width === undefined) {
			fail(
				widthNode,
				`width is a number from ${CARD_WIDTH_RANGE.min} to ${CARD_WIDTH_RANGE.max}, \`fit\` or \`full\``
			)
		} else layout.width = width
	}

	const rowsNode = root.get('rows', true)
	if (rowsNode === undefined) fail(root, 'A layout needs `rows:`')
	else if (!isSeq(rowsNode)) fail(rowsNode, '`rows:` is a list, one `- ` per row')
	else {
		for (const item of rowsNode.items) {
			const row = parseRow(item as YamlNode)
			if (row) layout.rows.push(row)
		}
	}

	return errors.length ? { ok: false, errors } : { ok: true, layout }

	function parseRow(node: YamlNode): LayoutRow | null {
		if (isScalar(node)) {
			const element = parseElement(node)
			return element ? { left: [element] } : null
		}
		if (!isMap(node)) return fail(node, 'A row is `separator`, a `table:`, or slots: `left:`, `center:`, `right:`')
		const keys = keysOf(node)
		const hasSlots = keys.some((k) => (SLOTS as readonly string[]).includes(k))
		const hasElement = keys.some((k) => (ELEMENT_KEYS as readonly string[]).includes(k))
		if (hasElement && !hasSlots) {
			const element = parseElement(node)
			return element ? { left: [element] } : null
		}
		if (hasElement) return fail(node, 'Put this element inside a slot: `left:`, `center:` or `right:`')
		checkKeys(node, ROW_KEYS, fail)
		const row: LayoutRow = {}
		for (const slot of SLOTS) {
			const slotNode = node.get(slot, true) as YamlNode | undefined
			if (slotNode === undefined) continue
			const items = isSeq(slotNode) ? (slotNode.items as YamlNode[]) : [slotNode]
			const elements = items.map(parseElement).filter((e): e is LayoutElement => e !== null)
			if (elements.length) row[slot] = elements
		}
		const alignNode = node.get('align', true)
		if (alignNode !== undefined) {
			const align = scalarValue(alignNode)
			if (oneOf(ROW_ALIGNS, align)) row.align = align
			else fail(alignNode, `align is one of ${ROW_ALIGNS.join(', ')}`)
		}
		return row
	}

	function parseElement(node: YamlNode): LayoutElement | null {
		if (isScalar(node)) {
			if (node.value === 'separator') return { kind: 'separator' }
			return fail(node, 'An element is `separator`, or `{ property: … }`, `{ text: … }`, `{ table: […] }`')
		}
		if (!isMap(node)) return fail(node, 'An element is `separator`, or `{ property: … }`, `{ text: … }`, `{ table: […] }`')
		const kinds = keysOf(node).filter((k) => (ELEMENT_KEYS as readonly string[]).includes(k))
		if (kinds.length !== 1) return fail(node, 'An element has exactly one of `property:`, `text:` or `table:`')
		switch (kinds[0]) {
			case 'property':
				return parseProperty(node)
			case 'text':
				return parseText(node)
			default:
				return parseTable(node)
		}
	}

	function parseProperty(node: YAMLMap): PropertyElement | null {
		checkKeys(node, PROPERTY_KEYS, fail)
		const def = resolve(node.get('property', true))
		if (!def) return null
		const element: PropertyElement = { kind: 'property', property: def.id }
		readSizeAndWeight(node, element)

		const asNode = node.get('as', true)
		if (asNode !== undefined) {
			const allowed = displaysFor(def.type)
			const as = scalarValue(asNode)
			if (oneOf(allowed, as)) element.as = as
			else fail(asNode, `${def.name} can be shown as ${allowed.join(', ')}`)
		}

		const showName = node.get('showName', true)
		if (showName !== undefined) {
			const value = scalarValue(showName)
			if (typeof value !== 'boolean') fail(showName, 'showName is true or false')
			else if (value) element.showName = true
		}

		const decimals = node.get('decimals', true)
		if (decimals !== undefined) {
			if (def.type !== 'number' && def.type !== 'financial' && def.type !== 'progress') {
				fail(decimals, `decimals only applies to numbers, and ${def.name} is a ${def.type} property`)
			} else if (!isDecimals(scalarValue(decimals))) fail(decimals, 'decimals is a whole number from 0 to 6')
			else element.format = { ...element.format, decimals: scalarValue(decimals) as number }
		}

		const symbol = node.get('symbol', true)
		if (symbol !== undefined) {
			if (def.type !== 'number' && def.type !== 'financial') {
				fail(symbol, `symbol only applies to money and numbers, and ${def.name} is a ${def.type} property`)
			} else if (typeof scalarValue(symbol) !== 'boolean') fail(symbol, 'symbol is true or false')
			else element.format = { ...element.format, symbol: scalarValue(symbol) as boolean }
		}

		const date = node.get('date', true)
		if (date !== undefined) {
			const style = scalarValue(date)
			if (def.type !== 'date') fail(date, `date only applies to dates, and ${def.name} is a ${def.type} property`)
			else if (!oneOf(DATE_STYLES, style)) fail(date, `date is one of ${DATE_STYLES.join(', ')}`)
			else element.format = { ...element.format, date: style }
		}
		return element
	}

	function parseText(node: YAMLMap): TextElement | null {
		checkKeys(node, TEXT_KEYS, fail)
		const value = scalarValue(node.get('text', true))
		if (typeof value !== 'string' && typeof value !== 'number') return fail(node, 'text is the words to show')
		const element: TextElement = { kind: 'text', text: String(value) }
		readSizeAndWeight(node, element)
		return element
	}

	function parseTable(node: YAMLMap): TableElement | null {
		checkKeys(node, TABLE_KEYS, fail)
		const list = node.get('table', true) as YamlNode
		const items = isSeq(list) ? (list.items as YamlNode[]) : [list]
		const properties = items.map(resolve).filter((d): d is PropertyDef => d !== null).map((d) => d.id)
		const element: TableElement = { kind: 'table', properties }
		const size = node.get('size', true)
		if (size !== undefined) {
			const value = scalarValue(size)
			if (oneOf(LAYOUT_SIZES, value)) element.size = value
			else fail(size, `size is one of ${LAYOUT_SIZES.join(', ')}`)
		}
		return element
	}

	function readSizeAndWeight(node: YAMLMap, element: { size?: unknown; weight?: unknown }): void {
		const size = node.get('size', true)
		if (size !== undefined) {
			const value = scalarValue(size)
			if (oneOf(LAYOUT_SIZES, value)) element.size = value
			else fail(size, `size is one of ${LAYOUT_SIZES.join(', ')}`)
		}
		const weight = node.get('weight', true)
		if (weight !== undefined) {
			const value = scalarValue(weight)
			if (oneOf(LAYOUT_WEIGHTS, value)) element.weight = value
			else fail(weight, `weight is one of ${LAYOUT_WEIGHTS.join(', ')}`)
		}
	}
}

function scalarValue(node: unknown): unknown {
	return isScalar(node) ? node.value : undefined
}

function keysOf(node: YAMLMap): string[] {
	return node.items.map((pair) => String(scalarValue(pair.key) ?? ''))
}

function checkKeys(node: YAMLMap, allowed: readonly string[], fail: (node: unknown, message: string) => null): void {
	for (const pair of node.items as Pair[]) {
		const key = String(scalarValue(pair.key) ?? '')
		if (!allowed.includes(key)) fail(pair.key, `Unknown key “${key}”. Use one of: ${allowed.join(', ')}`)
	}
}

/**
 * A layout as YAML, properties by name. Elements are written as one-line `{ … }` maps and a slot with
 * one element holds it directly, so a short layout reads like the plan's example.
 */
export function layoutToYaml(layout: PropertyLayout, defs: readonly PropertyDef[]): string {
	const names = new Map(defs.map((def) => [def.id, def.name]))
	const nameOf = (id: string) => names.get(id) ?? id

	const element = (el: LayoutElement): unknown => {
		switch (el.kind) {
			case 'separator':
				return 'separator'
			case 'text':
				return { text: el.text, ...(el.size && { size: el.size }), ...(el.weight && { weight: el.weight }) }
			case 'table':
				return { table: el.properties.map(nameOf), ...(el.size && { size: el.size }) }
			case 'property':
				return {
					property: nameOf(el.property),
					...(el.as && { as: el.as }),
					...(el.size && { size: el.size }),
					...(el.weight && { weight: el.weight }),
					...(el.showName && { showName: true }),
					...(el.format?.decimals !== undefined && { decimals: el.format.decimals }),
					...(el.format?.symbol !== undefined && { symbol: el.format.symbol }),
					...(el.format?.date && { date: el.format.date }),
				}
		}
	}

	const rows = layout.rows.map((row) => {
		const used = SLOTS.filter((slot) => row[slot]?.length)
		const only = used.length === 1 && used[0] === 'left' && row.left!.length === 1 && !row.align ? row.left![0]! : null
		// The shorthands: a lone separator or table in the left slot is the whole row.
		if (only?.kind === 'separator' || only?.kind === 'table') return element(only)
		const out: Record<string, unknown> = {}
		for (const slot of used) {
			const elements = row[slot]!
			out[slot] = elements.length === 1 ? element(elements[0]!) : elements.map(element)
		}
		if (row.align) out.align = row.align
		return out
	})

	const doc = new Document({ ...(layout.width !== undefined && { width: layout.width }), rows })
	visit(doc, {
		Map(_, node, path) {
			// A row that is a table (the shorthand) stays a block, `- table: [ … ]`.
			const grandparent = path[path.length - 2]
			const isRow = isPair(grandparent) && scalarValue(grandparent.key) === 'rows'
			if (isRow && node.has('table')) return
			if (ELEMENT_KEYS.some((key) => node.has(key))) node.flow = true
		},
		Seq(_, node, path) {
			// A table's property list stays on its line.
			const parent = path[path.length - 1]
			if (isPair(parent) && scalarValue(parent.key) === 'table') node.flow = true
		},
	})
	return doc.toString({ lineWidth: 0 })
}
