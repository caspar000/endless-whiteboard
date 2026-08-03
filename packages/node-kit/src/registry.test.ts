import { describe, expect, it } from 'vitest'
import {
	ITEM_NODE_TYPE,
	MARKDOWN_NODE_TYPE,
	ROLLUP_NODE_TYPE,
	getNodeDefinition,
	getNodeDefinitions,
	isNodeType,
	registerBuiltinNodes,
} from './index'

describe('registry', () => {
	it('has the built-in nodes registered at import time', () => {
		// The regression this pins: consumers read the registry at *their* module scope (shape utils
		// and canvas tools are both built that way). When registration was an imperative call the app
		// made later, `createNodeTools()` observed an empty registry and the node tools silently did
		// not exist — while shape utils, read from a separate array, did. One source, populated on
		// import, is what prevents that class of bug.
		expect(getNodeDefinitions().map((d) => d.type)).toEqual([
			MARKDOWN_NODE_TYPE,
			ITEM_NODE_TYPE,
			ROLLUP_NODE_TYPE,
		])
	})

	it('is idempotent, so a stray registerBuiltinNodes() call cannot throw or duplicate', () => {
		registerBuiltinNodes()
		registerBuiltinNodes()
		expect(getNodeDefinitions()).toHaveLength(3)
	})

	it('exposes definitions by type', () => {
		expect(getNodeDefinition(ITEM_NODE_TYPE)?.label).toBe('Item')
		expect(getNodeDefinition('nope')).toBeUndefined()
		expect(isNodeType(ROLLUP_NODE_TYPE)).toBe(true)
		expect(isNodeType('geo')).toBe(false)
	})

	it('gives every definition the metadata the registry-driven UI needs', () => {
		// The toolbar and menus are generated from these fields, so a definition missing one would
		// render a blank button rather than fail loudly at build time.
		for (const def of getNodeDefinitions()) {
			expect(def.type, 'namespaced type').toMatch(/^(node|plugin)\./)
			expect(def.label, `${def.type} label`).toBeTruthy()
			expect(def.icon, `${def.type} icon`).toBeTruthy()
			expect(def.defaultSize.w, `${def.type} width`).toBeGreaterThan(0)
			expect(def.defaultSize.h, `${def.type} height`).toBeGreaterThan(0)
		}
	})

	it('ships a migration sequence for every node, as §7 requires', () => {
		for (const def of getNodeDefinitions()) {
			expect(def.migrations, `${def.type} migrations`).toBeDefined()
			expect(Array.isArray(def.migrations.sequence), `${def.type} sequence`).toBe(true)
		}
	})

	it('validates every default prop value against its own validator', () => {
		// Catches the mismatch where a props change updates the validator but not defaultProps —
		// which would only surface as a runtime validation error when a user created that node.
		for (const def of getNodeDefinitions()) {
			const defaults = def.defaultProps() as Record<string, unknown>
			for (const [key, validator] of Object.entries(def.props)) {
				expect(
					() => (validator as { validate(v: unknown): unknown }).validate(defaults[key]),
					`${def.type}.${key}`
				).not.toThrow()
			}
		}
	})

	it('only computes values for the node whose data lives in props', () => {
		// Since Phase 2 a shape's property values live in `shape.meta`, so no node needs to project
		// them — a note carries a price exactly the way a sticky does. `extractValues` survives for the
		// legacy item node, whose fields are in props until the migration moves them.
		//
		// Rollups still contribute no values at all, which is what keeps rollup-of-rollup cycles
		// impossible.
		expect(getNodeDefinition(MARKDOWN_NODE_TYPE)?.extractValues).toBeUndefined()
		expect(getNodeDefinition(ROLLUP_NODE_TYPE)?.extractValues).toBeUndefined()
		expect(getNodeDefinition(ITEM_NODE_TYPE)?.extractValues).toBeTypeOf('function')
	})

	it('labels notes by their first heading and items by their title', () => {
		const note = getNodeDefinition(MARKDOWN_NODE_TYPE)!
		expect(note.getLabel!({ props: { md: '# Chores\n- milk' } } as never)).toBe('Chores')
		const item = getNodeDefinition(ITEM_NODE_TYPE)!
		expect(item.getLabel!({ props: { title: 'Desk' } } as never)).toBe('Desk')
	})
})

describe('item extractValues', () => {
	it('projects its fields, and its tags as a multi-select value', () => {
		const def = getNodeDefinition(ITEM_NODE_TYPE)!
		const values = def.extractValues!({
			id: 'shape:1',
			type: ITEM_NODE_TYPE,
			parentId: 'shape:frame1',
			x: 10,
			y: 20,
			rotation: 0,
			index: 'a1',
			isLocked: false,
			opacity: 1,
			meta: {},
			typeName: 'shape',
			props: {
				w: 220,
				h: 260,
				title: 'Desk',
				imageAssetId: null,
				tags: ['furniture'],
				fields: [
					{ key: 'price', type: 'currency', value: 2399, unit: 'GEL' },
					{ key: 'category', type: 'select', value: 'desk' },
					{ key: '', type: 'text', value: 'ignored — empty key' },
				],
			},
		} as never)!

		// Values only. Type, parent and label are the facts pipeline's job now, uniformly for every
		// shape, which is what let the per-shape facts cache take over the drag guarantee.
		expect(values).toEqual({
			price: 2399,
			category: 'desk',
			// Tags are no longer a separate concept: they are a multi-select value under a well-known id,
			// so a tag-scoped rollup keeps working on a board that hasn't been migrated yet.
			tags: ['furniture'],
		})
		// The contract that makes drags free: nothing positional anywhere in the output.
		expect(JSON.stringify(values)).not.toContain('"x"')
	})
})
