import {
	clearCommandRegistry,
	clearExtensionRegistry,
	clearNodeRegistry,
	defineNode,
	emptyPropsMigrations,
	getCommand,
	getVisibleCommands,
	registerExtension,
	registerNode,
	setExtensionEnabled,
	type NodeDefinition,
} from '@lifeboard/node-kit'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerNodeCommands } from './insertNode'

function node(type: string, over: Partial<NodeDefinition<object>> = {}): NodeDefinition<never> {
	return defineNode({
		type,
		label: 'Widget',
		icon: 'W',
		props: {},
		migrations: emptyPropsMigrations,
		defaultProps: () => ({}),
		defaultSize: { w: 100, h: 100 },
		component: () => null,
		...over,
	} as NodeDefinition<object>)
}

beforeEach(() => {
	clearCommandRegistry()
	clearExtensionRegistry()
	clearNodeRegistry()
})

describe('registerNodeCommands', () => {
	it('generates one insert command per node type, named from the definition', () => {
		registerNode(node('node.widget', { label: 'Sticky note' }))
		registerNodeCommands()

		const command = getCommand('node.widget.insert')
		expect(command?.title).toBe('Add sticky note')
		expect(command?.group).toBe('Insert')
	})

	it('skips deprecated types, which stay in the schema but must never be offered', () => {
		registerNode(node('node.old', { deprecated: true }))
		registerNodeCommands()

		expect(getCommand('node.old.insert')).toBeUndefined()
	})

	it('is not available without a board', () => {
		registerNode(node('node.widget'))
		registerNodeCommands()

		const command = getCommand('node.widget.insert')
		expect(command?.when?.({ editor: null, view: 'list' })).toBe(false)
	})

	it("inherits the node's extension, so one toggle hides the node and its command together", () => {
		registerExtension({ id: 'vendor.widgets', name: 'Widgets', nodes: [node('node.widget')] })
		registerNodeCommands()

		expect(getVisibleCommands().map((c) => c.id)).toEqual(['node.widget.insert'])

		setExtensionEnabled('vendor.widgets', false)
		expect(getVisibleCommands()).toEqual([])

		setExtensionEnabled('vendor.widgets', true)
		expect(getVisibleCommands().map((c) => c.id)).toEqual(['node.widget.insert'])
	})

	it('leaves core (ownerless) node types always offered', () => {
		registerNode(node('node.core'))
		registerNodeCommands()

		setExtensionEnabled('vendor.widgets', false)
		expect(getVisibleCommands().map((c) => c.id)).toEqual(['node.core.insert'])
	})
})
