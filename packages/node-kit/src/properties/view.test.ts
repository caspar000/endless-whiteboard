import { describe, expect, it } from 'vitest'
import type { PropertyDef, PropertyType } from './types'
import {
	autoLayoutGroups,
	isEmptyPropertyValue,
	nextPropertyView,
	propertyCardSpace,
	setPropertyCardHeight,
} from './view'

const def = (id: string, type: PropertyType): PropertyDef => ({ id, name: id, type })

describe('the automatic layout', () => {
	it('groups by role, groups in the order their first member appears', () => {
		const rows = [
			{ def: def('price', 'financial') },
			{ def: def('type', 'select') },
			{ def: def('weight', 'number') },
			{ def: def('tags', 'multiSelect') },
			{ def: def('status', 'status') },
			{ def: def('done', 'progress') },
		]
		const groups = autoLayoutGroups(rows).map((g) => [g.role, g.rows.map((r) => r.def.id)])
		// One meta line holding both numbers, even though a badge sits between them in the panel.
		expect(groups).toEqual([
			['meta', ['price', 'weight']],
			['badge', ['type', 'status']],
			['chips', ['tags']],
			['bar', ['done']],
		])
	})
})

describe('empty values', () => {
	it('hides nothing-values, including an unticked box and an empty tag list', () => {
		for (const value of [null, undefined, '', false, []]) expect(isEmptyPropertyValue(value)).toBe(true)
		for (const value of [0, 'x', true, ['a']]) expect(isEmptyPropertyValue(value)).toBe(false)
	})
})

describe('the source/display toggle', () => {
	const shape = (view?: string) => ({ meta: view ? { 'lifeboard:propView': view } : {} })

	it('shows source unless every selected shape already does', () => {
		expect(nextPropertyView([shape(), shape()])).toBe('source')
		expect(nextPropertyView([shape('source'), shape()])).toBe('source')
		expect(nextPropertyView([shape('source'), shape('source')])).toBe('display')
	})
})

describe('card space', () => {
	it('is the measured height plus the gap, and nothing without a card', () => {
		expect(propertyCardSpace('shape:a')).toBe(0)
		setPropertyCardHeight('shape:a', 40)
		expect(propertyCardSpace('shape:a')).toBe(46)
		setPropertyCardHeight('shape:a', null)
		expect(propertyCardSpace('shape:a')).toBe(0)
	})
})
