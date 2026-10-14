import { describe, expect, it } from 'vitest'
import type { PropertyLayout } from './layout'
import {
	addElement,
	addRow,
	layoutsMatch,
	moveElement,
	moveRow,
	removeElement,
	replaceElement,
	setRowAlign,
	setWidth,
} from './layoutEdit'

const prop = (id: string) => ({ kind: 'property' as const, property: id })
const base: PropertyLayout = {
	rows: [{ left: [prop('a'), prop('b')] }, { center: [prop('c')] }],
}

describe('layout edits', () => {
	it('adds, moves and aligns rows', () => {
		const added = addRow(base)
		expect(added.rows).toHaveLength(3)
		expect(moveRow(base, 1, -1).rows[0]).toEqual({ center: [prop('c')] })
		expect(moveRow(base, 0, -1)).toBe(base)
		expect(setRowAlign(base, 0, 'top').rows[0]!.align).toBe('top')
		expect(setRowAlign(setRowAlign(base, 0, 'top'), 0, 'middle').rows[0]).not.toHaveProperty('align')
	})

	it('moves an element between slots and drops a slot left empty', () => {
		const moved = moveElement(base, { row: 1, slot: 'center', index: 0 }, { row: 0, slot: 'right', index: 0 })
		expect(moved.rows).toEqual([{ left: [prop('a'), prop('b')], right: [prop('c')] }, {}])
	})

	it('reorders within a slot', () => {
		const moved = moveElement(base, { row: 0, slot: 'left', index: 0 }, { row: 0, slot: 'left', index: 1 })
		expect(moved.rows[0]!.left).toEqual([prop('b'), prop('a')])
	})

	it('adds, replaces and removes elements', () => {
		let layout = addElement(base, 1, 'right', { kind: 'separator' })
		expect(layout.rows[1]!.right).toEqual([{ kind: 'separator' }])
		layout = replaceElement(layout, { row: 0, slot: 'left', index: 1 }, { ...prop('b'), size: 'xl' })
		expect(layout.rows[0]!.left![1]).toEqual({ kind: 'property', property: 'b', size: 'xl' })
		layout = removeElement(layout, { row: 1, slot: 'center', index: 0 })
		expect(layout.rows[1]).toEqual({ right: [{ kind: 'separator' }] })
	})

	it('sets and clears the width', () => {
		expect(setWidth(base, 'fit').width).toBe('fit')
		expect(setWidth(setWidth(base, 300), undefined)).not.toHaveProperty('width')
	})
})

describe('several shapes', () => {
	const meta = (layout: PropertyLayout | null) => ({ meta: layout ? { 'lifeboard:propLayout': layout as never } : {} })

	it('match when their layouts are the same, or all automatic', () => {
		expect(layoutsMatch([meta(base), meta(base)])).toBe(true)
		expect(layoutsMatch([meta(null), meta(null)])).toBe(true)
		expect(layoutsMatch([meta(base), meta(null)])).toBe(false)
		expect(layoutsMatch([meta(base), meta(addRow(base))])).toBe(false)
	})
})
