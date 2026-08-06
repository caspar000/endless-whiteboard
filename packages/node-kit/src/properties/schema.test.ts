import { describe, expect, it } from 'vitest'
import { fakeEditor } from './fakeEditor'
import {
	createProperty,
	deleteProperty,
	mergeProperties,
	parsePropertyRegistry,
	readPropertyRegistry,
	updateProperty,
} from './schema'
import type { PropertyDef } from './types'

const price: Omit<PropertyDef, 'id'> = { name: 'Price', type: 'financial', unit: 'GEL' }

describe('parsePropertyRegistry', () => {
	it('returns nothing for anything that is not an array', () => {
		expect(parsePropertyRegistry(undefined)).toEqual([])
		expect(parsePropertyRegistry(null)).toEqual([])
		expect(parsePropertyRegistry({ price: {} })).toEqual([])
		expect(parsePropertyRegistry('nope')).toEqual([])
	})

	it('drops malformed entries but keeps the good ones', () => {
		// Meta is untyped JSON that tldraw neither validates nor migrates, so an entry may predate the
		// current schema or arrive from an imported backup. One bad entry must cost that entry only.
		const parsed = parsePropertyRegistry([
			{ id: 'price', name: 'Price', type: 'financial', unit: 'GEL' },
			{ id: 'broken', name: 'Broken', type: 'not-a-type' },
			null,
			'string',
			{ name: 'No id', type: 'text' },
			{ id: 'tags', name: 'Tags', type: 'multiSelect', options: ['a', 'b'] },
		])
		expect(parsed.map((d) => d.id)).toEqual(['price', 'tags'])
	})

	it('drops a duplicate id, because an ambiguous id makes values unreadable', () => {
		const parsed = parsePropertyRegistry([
			{ id: 'price', name: 'Price', type: 'financial' },
			{ id: 'price', name: 'Cost', type: 'number' },
		])
		expect(parsed).toHaveLength(1)
		expect(parsed[0]!.name).toBe('Price')
	})

	it('rejects an entry whose id is blank', () => {
		expect(parsePropertyRegistry([{ id: '', name: 'Nameless', type: 'text' }])).toEqual([])
	})
})

describe('createProperty', () => {
	it('derives a deterministic id from the name', () => {
		const f = fakeEditor()
		expect(createProperty(f.editor, { name: 'Unit Price', type: 'number' })?.id).toBe('unit_price')
	})

	it('returns the existing property instead of duplicating it', () => {
		const f = fakeEditor()
		const first = createProperty(f.editor, price)
		const second = createProperty(f.editor, { name: 'price', type: 'text' })
		expect(second).toEqual(first)
		expect(readPropertyRegistry(f.editor)).toHaveLength(1)
		// And the existing definition wins — creating must never silently retype a property that
		// shapes already hold values for.
		expect(readPropertyRegistry(f.editor)[0]!.type).toBe('financial')
	})

	it('refuses a name with nothing usable in it', () => {
		const f = fakeEditor()
		expect(createProperty(f.editor, { name: '---', type: 'text' })).toBeNull()
		expect(createProperty(f.editor, { name: '  ', type: 'text' })).toBeNull()
		expect(readPropertyRegistry(f.editor)).toEqual([])
	})

	it('writes inside one editor.run, so one action is one undo entry', () => {
		const f = fakeEditor()
		createProperty(f.editor, price)
		expect(f.runs).toBe(1)
	})

	it('leaves unrelated document meta alone', () => {
		const f = fakeEditor()
		f.editor.updateDocumentSettings({ meta: { 'lifeboard:fieldTemplates': ['keep me'] } })
		createProperty(f.editor, price)
		expect(f.documentMeta()['lifeboard:fieldTemplates']).toEqual(['keep me'])
		expect(readPropertyRegistry(f.editor)).toHaveLength(1)
	})
})

describe('updateProperty', () => {
	it('renames without changing the id, so no shape needs touching', () => {
		const f = fakeEditor()
		createProperty(f.editor, price)
		updateProperty(f.editor, 'price', { name: 'Cost' })
		expect(readPropertyRegistry(f.editor)[0]).toMatchObject({ id: 'price', name: 'Cost' })
	})

	it('ignores an unknown id rather than creating one', () => {
		const f = fakeEditor()
		updateProperty(f.editor, 'nope', { name: 'Nope' })
		expect(readPropertyRegistry(f.editor)).toEqual([])
	})
})

describe('deleteProperty', () => {
	it('removes the definition', () => {
		const f = fakeEditor()
		createProperty(f.editor, price)
		createProperty(f.editor, { name: 'Tags', type: 'multiSelect' })
		deleteProperty(f.editor, 'price')
		expect(readPropertyRegistry(f.editor).map((d) => d.id)).toEqual(['tags'])
	})
})

describe('mergeProperties', () => {
	it('adds definitions the board does not have', () => {
		const f = fakeEditor()
		createProperty(f.editor, price)
		mergeProperties(f.editor, [
			{ id: 'price', name: 'Renamed', type: 'text' },
			{ id: 'tags', name: 'Tags', type: 'multiSelect' },
		])
		const registry = readPropertyRegistry(f.editor)
		expect(registry.map((d) => d.id)).toEqual(['price', 'tags'])
		// An existing definition is never overwritten: this runs on paste, and the target board's own
		// meaning of "price" has to win over a copy's.
		expect(registry[0]).toMatchObject({ name: 'Price', type: 'financial' })
	})

	it('is a no-op when everything is already known, so paste stays cheap and undo stays clean', () => {
		const f = fakeEditor()
		createProperty(f.editor, price)
		const runsBefore = f.runs
		mergeProperties(f.editor, [{ id: 'price', name: 'Price', type: 'financial', unit: 'GEL' }])
		expect(f.runs).toBe(runsBefore)
	})
})

describe('legacy type normalisation', () => {
	it("reads a pre-rename 'currency' definition as 'financial'", () => {
		// Registries written before the rename live in untyped meta, so the old string arrives from
		// old boards, imported backups and pasted shapes alike; read-time is the one choke point.
		const defs = parsePropertyRegistry([
			{ id: 'price', name: 'Price', type: 'currency', unit: 'GEL' },
		])
		expect(defs).toEqual([{ id: 'price', name: 'Price', type: 'financial', unit: 'GEL' }])
	})
})
