import { float32, isBytes, parseMessage, type Field } from './protobuf'

/**
 * Freeform's records, decoded. Each `board_items` blob is `crdt` + a 4-byte version + a protobuf
 * message holding a tree of CRDT values, and a table of the strings the tree refers to by index (map
 * keys, font names, link targets). This was worked out from the records themselves; the field numbers
 * below are what they hold, not names Apple gave them:
 *
 * - `15` a float, `5` an enum (or, length-delimited, a text), `6` an int, `3` a string-table index
 * - `4` a point (two fixed32s) or a map (key indices, then one value per key)
 * - `14` a list, `9` an optional value
 * - `1` + `2` a last-writer-wins register: a timestamp, then the value
 */
export type Value =
	| number
	| { kind: 'enum'; value: number }
	| { kind: 'int'; value: number }
	| { kind: 'ref'; value: number }
	| { kind: 'point'; x: number; y: number }
	| { kind: 'text'; text: FreeformText }
	| { kind: 'opt'; value: Value }
	| { kind: 'map'; entries: Record<string, Value> }
	| { kind: 'raw'; fields: Field[] }
	| Value[]
	| null

/** A run of characters sharing one set of attributes, `length` UTF-16 units long (as in NSString). */
export interface TextRun {
	length: number
	attrs: Record<string, Value>
}

export interface FreeformText {
	string: string
	runs: TextRun[]
}

const utf8 = new TextDecoder('utf-8', { fatal: false })

export class FreeformRecord {
	readonly root: Value
	/** The record's string table: map keys and interned strings, referred to by index. */
	readonly strings: string[]
	/** Every UUID the record mentions: the items a container holds, and the replicas that wrote it. */
	readonly uuids: Uint8Array[]

	constructor(blob: Uint8Array) {
		const body = blob[0] === 0x63 && blob[1] === 0x72 && blob[2] === 0x64 && blob[3] === 0x74 ? blob.subarray(8) : blob
		const top = parseMessage(body) ?? []
		const table = top.find((f) => f.field === 6)
		const tableFields = table && isBytes(table.value) ? (parseMessage(table.value) ?? []) : []
		this.strings = tableFields.filter((f) => f.field === 2 && isBytes(f.value)).map((f) => utf8.decode(f.value as Uint8Array))
		const ids = tableFields.find((f) => f.field === 1)?.value
		this.uuids = []
		if (ids && isBytes(ids)) for (let i = 0; i + 16 <= ids.length; i += 16) this.uuids.push(ids.subarray(i, i + 16))
		const root = top.find((f) => f.field === 1)?.value
		this.root = root && isBytes(root) ? this.value(root) : null
	}

	/** The string an index refers to. */
	string(index: number): string | undefined {
		return this.strings[index]
	}

	value(bytes: Uint8Array): Value {
		const fields = parseMessage(bytes)
		if (!fields || !fields.length) return fields ? { kind: 'raw', fields } : null
		const only = fields.length === 1 ? fields[0]! : null
		if (only) {
			const { field, value } = only
			if (field === 15 && isBytes(value) && value.length === 4) return float32(value)
			if (field === 5) return isBytes(value) ? { kind: 'text', text: this.text(value) } : { kind: 'enum', value }
			if (field === 6 && !isBytes(value)) return { kind: 'int', value }
			if (field === 3 && !isBytes(value)) return { kind: 'ref', value }
			if (field === 9 && isBytes(value)) return { kind: 'opt', value: this.value(value) }
			if (field === 14 && isBytes(value)) {
				return (parseMessage(value) ?? []).filter((f) => f.field === 2 && isBytes(f.value)).map((f) => this.value(f.value as Uint8Array))
			}
			if (field === 4 && isBytes(value)) {
				const inner = parseMessage(value) ?? []
				if (inner.length && inner.every((f) => f.wire === 5)) {
					const [x, y] = inner.map((f) => float32(f.value as Uint8Array))
					return { kind: 'point', x: x ?? 0, y: y ?? 0 }
				}
				return this.map(inner)
			}
		}
		const register = this.register(fields)
		if (register !== undefined) return register
		return { kind: 'raw', fields }
	}

	/** `1: { 1: timestamp, 2: value }`, the shape of every register; `undefined` if this isn't one. */
	private register(fields: Field[]): Value | undefined {
		if (fields.length > 2 || fields[0]?.field !== 1 || !isBytes(fields[0].value)) return undefined
		const inner = parseMessage(fields[0].value)
		if (!inner || inner[0]?.field !== 1) return undefined
		const value = inner.find((f) => f.field === 2)
		if (!value) return null
		return isBytes(value.value) ? this.value(value.value) : value.value
	}

	private map(fields: Field[]): Value {
		const keys = fields.find((f) => f.field === 1)?.value
		const values = fields.filter((f) => f.field === 2 && isBytes(f.value)).map((f) => f.value as Uint8Array)
		if (!keys || !isBytes(keys) || keys.length !== values.length) return { kind: 'raw', fields }
		const entries: Record<string, Value> = {}
		values.forEach((bytes, i) => {
			const name = this.strings[keys[i]!]
			if (name !== undefined) entries[name] = this.value(bytes)
		})
		return { kind: 'map', entries }
	}

	/** Apple's text CRDT: field 1 is the visible string, field 6 its attribute runs. */
	private text(bytes: Uint8Array): FreeformText {
		const fields = parseMessage(bytes) ?? []
		const string = fields.find((f) => f.field === 1)?.value
		const runs: TextRun[] = []
		for (const run of fields.filter((f) => f.field === 6 && isBytes(f.value))) {
			const parts = parseMessage(run.value as Uint8Array) ?? []
			const length = parts.find((f) => f.field === 1)?.value
			const attrs: Record<string, Value> = {}
			for (const attr of parts.filter((f) => f.field === 2 && isBytes(f.value))) {
				const pair = parseMessage(attr.value as Uint8Array) ?? []
				const key = pair.find((f) => f.field === 1)?.value
				const value = pair.find((f) => f.field === 2)?.value
				const name = typeof key === 'number' ? this.strings[key] : undefined
				if (name && value && isBytes(value)) attrs[name] = this.value(value)
			}
			runs.push({ length: typeof length === 'number' ? length : 0, attrs })
		}
		return { string: string && isBytes(string) ? utf8.decode(string) : '', runs }
	}
}

/* ------------------------------------------------------------------------------------- reading */

export const isMap = (v: Value | undefined): v is { kind: 'map'; entries: Record<string, Value> } =>
	!!v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'map'

export const isPoint = (v: Value | undefined): v is { kind: 'point'; x: number; y: number } =>
	!!v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'point'

/** Depth-first: every value in the tree, the root first. */
export function* walk(v: Value): Generator<Value> {
	yield v
	if (Array.isArray(v)) for (const child of v) yield* walk(child)
	else if (v && typeof v === 'object') {
		if (v.kind === 'map') for (const child of Object.values(v.entries)) yield* walk(child)
		else if (v.kind === 'opt') yield* walk(v.value)
	}
}

/** The first text in the tree. */
export function findText(v: Value): FreeformText | undefined {
	for (const node of walk(v)) if (node && typeof node === 'object' && !Array.isArray(node) && node.kind === 'text') return node.text
	return undefined
}

/** An enum, int or float as a number. */
export function num(v: Value | undefined): number | undefined {
	if (typeof v === 'number') return v
	if (v && typeof v === 'object' && !Array.isArray(v) && (v.kind === 'enum' || v.kind === 'int' || v.kind === 'ref')) return v.value
	return undefined
}

/** `[enum, [[enum, r, g, b]]]`, the shape of every colour: components 0–1. */
export function findColor(v: Value): { r: number; g: number; b: number } | undefined {
	for (const node of walk(v)) {
		if (Array.isArray(node) && node.length === 4 && node.slice(1).every((c) => typeof c === 'number')) {
			const [, r, g, b] = node as [Value, number, number, number]
			return { r, g, b }
		}
	}
	return undefined
}
