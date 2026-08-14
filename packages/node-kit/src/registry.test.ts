import { describe, expect, it } from 'vitest'
import { T } from 'tldraw'
import {
	ITEM_NODE_TYPE,
	ROLLUP_NODE_TYPE,
	TABLE_NODE_TYPE,
	defineNode,
	emptyPropsMigrations,
	getDisabledExtensionIds,
	getExtensions,
	getNodeDefinition,
	getNodeDefinitions,
	getNodeTypesVersion,
	getVisibleNodeDefinitions,
	isNodeType,
	isNodeTypeEnabled,
	registerBuiltinNodes,
	registerExtension,
	setDisabledExtensionIds,
	setExtensionEnabled,
	tablesExtension,
	type NodeDefinition,
} from './index'

/** A node type an already-registered extension gains later — see the regression test below. */
const latecomerDefinition: NodeDefinition<{ text: string }> = {
	type: 'node.latecomer',
	label: 'Latecomer',
	icon: 'L',
	props: { text: T.string },
	migrations: emptyPropsMigrations(),
	defaultProps: () => ({ text: '' }),
	defaultSize: { w: 100, h: 100 },
	component: () => null,
}

// The registry is module state, so this file registers once up front — the same shape as the app's
// composition root — and every test below reads the composed result.
registerExtension(tablesExtension)

describe('registry', () => {
	it('has the legacy nodes registered at import time', () => {
		// The regression this pins: consumers read the registry at *their* module scope (shape utils
		// and canvas tools are both built that way). When registration was an imperative call the app
		// made later, `createNodeTools()` observed an empty registry and the node tools silently did
		// not exist — while shape utils, read from a separate array, did. Legacy types register on
		// import; live types arrive from the app's composition root, which importers pull in first.
		const types = getNodeDefinitions().map((d) => d.type)
		expect(types.slice(0, 2)).toEqual([ITEM_NODE_TYPE, ROLLUP_NODE_TYPE])
	})

	it('is idempotent, so a stray registerBuiltinNodes() call cannot throw or duplicate', () => {
		const before = getNodeDefinitions().length
		registerBuiltinNodes()
		registerBuiltinNodes()
		expect(getNodeDefinitions()).toHaveLength(before)
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
		// them. `extractValues` survives for the legacy item node, whose fields are in props until the
		// migration moves them. Tables and rollups still contribute no values at all, which is what
		// keeps view-of-view cycles impossible.
		expect(getNodeDefinition(TABLE_NODE_TYPE)?.extractValues).toBeUndefined()
		expect(getNodeDefinition(ROLLUP_NODE_TYPE)?.extractValues).toBeUndefined()
		expect(getNodeDefinition(ITEM_NODE_TYPE)?.extractValues).toBeTypeOf('function')
	})

	it('labels items by their title', () => {
		const item = getNodeDefinition(ITEM_NODE_TYPE)!
		expect(item.getLabel!({ props: { title: 'Desk' } } as never)).toBe('Desk')
	})
})

describe('extensions', () => {
	it('registers an extension’s nodes under its id', () => {
		expect(getExtensions().map((e) => e.id)).toContain('lifeboard.tables')
		expect(isNodeType(TABLE_NODE_TYPE)).toBe(true)
		expect(isNodeTypeEnabled(TABLE_NODE_TYPE)).toBe(true)
	})

	it('is idempotent by id, so HMR re-evaluation of a composition root cannot throw', () => {
		expect(() => registerExtension(tablesExtension)).not.toThrow()
		expect(getExtensions().filter((e) => e.id === 'lifeboard.tables')).toHaveLength(1)
	})

	it('picks up node types an already-registered extension has gained', () => {
		/*
		 * Regression: registration used to return early on a known id, so re-registering an extension
		 * that had *grown* a node type silently skipped it. The registry then disagreed with the code
		 * creating that type, and the editor died with "No shape util found for type …" — a dead board
		 * until a full reload. Re-evaluation with new nodes is the normal case under HMR, and is
		 * exactly what a runtime-loaded plugin will do.
		 */
		const grown = {
			...tablesExtension,
			nodes: [...tablesExtension.nodes, defineNode(latecomerDefinition)],
		}
		const versionBefore = getNodeTypesVersion()

		registerExtension(grown)

		expect(isNodeType('node.latecomer')).toBe(true)
		expect(getNodeDefinitions().map((d) => d.type)).toContain('node.latecomer')
		// The version bump is what tells the board its schema changed and the utils must be rebuilt.
		expect(getNodeTypesVersion()).toBe(versionBefore + 1)
		// Still one extension, and its existing nodes are untouched.
		expect(getExtensions().filter((e) => e.id === 'lifeboard.tables')).toHaveLength(1)
		expect(isNodeType(TABLE_NODE_TYPE)).toBe(true)
	})

	it('hides a disabled extension’s nodes from the UI but never from the schema', () => {
		setExtensionEnabled('lifeboard.tables', false)
		try {
			// Gone from every creation surface…
			expect(getVisibleNodeDefinitions().map((d) => d.type)).not.toContain(TABLE_NODE_TYPE)
			expect(isNodeTypeEnabled(TABLE_NODE_TYPE)).toBe(false)
			// …but still in the schema source, so existing boards keep opening and rendering.
			expect(getNodeDefinitions().map((d) => d.type)).toContain(TABLE_NODE_TYPE)
		} finally {
			setExtensionEnabled('lifeboard.tables', true)
		}
		expect(getVisibleNodeDefinitions().map((d) => d.type)).toContain(TABLE_NODE_TYPE)
	})

	it('never gates core types: nodes registered without an owner cannot be toggled off', () => {
		// The legacy types are deprecated (hidden anyway), but the invariant matters for any core
		// registration: enablement is a property of extensions, not of nodes.
		setDisabledExtensionIds(['lifeboard.tables', 'some.unknown.extension'])
		try {
			expect(isNodeTypeEnabled(ITEM_NODE_TYPE)).toBe(true)
			expect(getDisabledExtensionIds().sort()).toEqual([
				'lifeboard.tables',
				'some.unknown.extension',
			])
		} finally {
			setDisabledExtensionIds([])
		}
	})
})
