import { T } from 'tldraw'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearBoardBridge } from '../boardBridge'
import { clearCommandRegistry } from '../commands'
import { clearExtensionRegistry, defineNode } from '../extensions'
import { emptyPropsMigrations } from '../migrations'
import {
	clearOperationRegistry,
	runOperation,
	type JsonValue,
	type OperationResult,
} from '../operations'
import { clearNodeRegistry, registerNode, type NodeDefinition } from '../registry'
import { fakeWorkspace, type FakeWorkspace } from './fakeBoard'
import { MAX_TEXT_CHARS } from './shared'
import { registerCoreOperations } from './index'

/**
 * Configuring a node.
 *
 * The property worth pinning is that validation is **the node type's own**, not a second schema
 * written here: a definition declares validators for its props, and this reads them. That is what
 * makes a third-party node configurable for free — and what makes a bad value a named error instead
 * of a shape written into an invalid state.
 */

const WIDGET = 'node.testwidget'
const TEXT_NODE = 'node.testnote'

/** Stands in for the table: a node with real, differently-typed configuration. */
function widgetDefinition(): NodeDefinition<never> {
	return defineNode({
		type: WIDGET,
		label: 'Test widget',
		icon: 'W',
		props: {
			title: T.string,
			maxRows: T.number,
			groupBy: T.string.nullable(),
		},
		migrations: emptyPropsMigrations,
		defaultProps: () => ({ title: 'Widget', maxRows: 12, groupBy: null }),
		defaultSize: { w: 200, h: 120 },
		component: () => null,
	} as unknown as NodeDefinition<object>)
}

/** Stands in for the markdown note: holds its body in `md`, and labels itself with the first line. */
function textNodeDefinition(): NodeDefinition<never> {
	return defineNode({
		type: TEXT_NODE,
		label: 'Test note',
		icon: 'N',
		props: { md: T.string },
		migrations: emptyPropsMigrations,
		defaultProps: () => ({ md: '' }),
		defaultSize: { w: 200, h: 120 },
		component: () => null,
		// The heart of the bug: the label is a derived *title*, never the body.
		getLabel: (shape: { props: { md?: string } }) => (shape.props.md ?? '').split('\n')[0] ?? '',
	} as unknown as NodeDefinition<object>)
}

let workspace: FakeWorkspace

beforeEach(() => {
	clearOperationRegistry()
	clearCommandRegistry()
	clearExtensionRegistry()
	clearNodeRegistry()
	clearBoardBridge()
	registerNode(widgetDefinition())
	registerNode(textNodeDefinition())
	registerCoreOperations()
	workspace = fakeWorkspace()
})

async function run(id: string, args: Record<string, unknown> = {}): Promise<JsonValue> {
	const result = await runOperation(id, workspace.ctx, args)
	if (!result.ok) throw new Error(`${id} failed: ${result.error}`)
	return result.data
}

async function attempt(id: string, args: Record<string, unknown> = {}): Promise<OperationResult> {
	return runOperation(id, workspace.ctx, args)
}

async function widget(): Promise<{ id: string }> {
	await run('board.open', { boardId: 'board-1' })
	return (await run('node.insert', { type: WIDGET })) as { id: string }
}

describe('reading a configuration', () => {
	it('returns the settings the type declared, and says it is configurable', async () => {
		const node = await widget()
		const config = (await run('node.config', { shapeId: node.id })) as {
			configurable: boolean
			config: Record<string, unknown>
		}

		expect(config.configurable).toBe(true)
		expect(config.config).toEqual({ title: 'Widget', maxRows: 12, groupBy: null })
	})

	it('withholds geometry, which node.update owns', async () => {
		const node = await widget()
		const config = (await run('node.config', { shapeId: node.id })) as {
			config: Record<string, unknown>
		}

		// Two operations that both resize a shape would disagree about whether that is configuration.
		expect(config.config).not.toHaveProperty('w')
		expect(config.config).not.toHaveProperty('h')
	})
})

describe('writing a configuration', () => {
	it('merges only the keys passed', async () => {
		const node = await widget()
		await run('node.configure', { shapeId: node.id, config: '{"groupBy":"status"}' })

		const after = (await run('node.config', { shapeId: node.id })) as {
			config: Record<string, unknown>
		}
		expect(after.config).toEqual({ title: 'Widget', maxRows: 12, groupBy: 'status' })
	})

	it('is one undo step even when settings and a collection both change', async () => {
		const node = await widget()
		const before = workspace.board('board-1').stops.length

		await run('node.configure', {
			shapeId: node.id,
			config: '{"title":"Costs","maxRows":5}',
			collection: JSON.stringify({
				source: { shapeTypes: null, scope: 'page', frameId: null, filters: [] },
				view: 'value',
				op: 'sum',
				property: 'price',
			}),
		})

		// Two writes to two storage locations, one ⌘Z — otherwise undoing an agent's change leaves
		// the node half-configured.
		expect(workspace.board('board-1').stops.length).toBe(before + 1)
	})

	/**
	 * The whole reason this reads the registry rather than carrying its own schema: a wrong value is
	 * refused by the type's own validator, with the field named, before anything is written.
	 */
	it('refuses a value of the wrong type and names the field', async () => {
		const node = await widget()
		const result = await attempt('node.configure', {
			shapeId: node.id,
			config: '{"maxRows":"twelve"}',
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('maxRows')

		// And the shape is untouched, rather than half-written.
		const after = (await run('node.config', { shapeId: node.id })) as {
			config: Record<string, unknown>
		}
		expect(after.config.maxRows).toBe(12)
	})

	it('refuses a setting the type does not have, and lists the ones it does', async () => {
		const node = await widget()
		const result = await attempt('node.configure', {
			shapeId: node.id,
			config: '{"colour":"red"}',
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('colour')
		expect(result.error).toContain('maxRows')
	})

	it('sends the agent to node.update for size', async () => {
		const node = await widget()
		const result = await attempt('node.configure', { shapeId: node.id, config: '{"w":400}' })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('node.update')
	})

	it('explains malformed JSON rather than failing opaquely', async () => {
		const node = await widget()
		const result = await attempt('node.configure', { shapeId: node.id, config: '{groupBy: status}' })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('JSON')
	})

	it('refuses an empty call rather than reporting a no-op as success', async () => {
		const node = await widget()
		const result = await attempt('node.configure', { shapeId: node.id })
		expect(result.ok).toBe(false)
	})
})

describe('collections, which any shape may carry', () => {
	const collection = JSON.stringify({
		source: { shapeTypes: null, scope: 'page', frameId: null, filters: [] },
		view: 'value',
		op: 'sum',
		property: 'price',
	})

	it('sets one and reads it back', async () => {
		const node = await widget()
		await run('node.configure', { shapeId: node.id, collection })

		const after = (await run('node.config', { shapeId: node.id })) as {
			collection: { op: string; property: string } | null
		}
		expect(after.collection).toMatchObject({ op: 'sum', property: 'price' })
	})

	it('clears one with null', async () => {
		const node = await widget()
		await run('node.configure', { shapeId: node.id, collection })
		await run('node.configure', { shapeId: node.id, collection: 'null' })

		const after = (await run('node.config', { shapeId: node.id })) as { collection: unknown }
		expect(after.collection).toBeNull()
	})

	it('refuses a malformed one', async () => {
		const node = await widget()
		const result = await attempt('node.configure', {
			shapeId: node.id,
			collection: '{"op":"sum"}',
		})
		expect(result.ok).toBe(false)
	})
})

/**
 * Reading what a node *says*, not just what it is called.
 *
 * The bug: a markdown note's label is its first line, truncated — so an agent that had only
 * `node.find` could see a note called "Finish the shopping list" and had no way to reach the list
 * inside it. Label and text answer different questions and both have to be reachable.
 */
describe('reading a node’s text', () => {
	const BODY = '# Finish the shopping list\n\n- Milk\n- Bread\n- Eggs'

	async function noteWithBody(): Promise<{ id: string }> {
		await run('board.open', { boardId: 'board-1' })
		return (await run('node.insert', { type: TEXT_NODE, text: BODY })) as { id: string }
	}

	it('returns the whole body, not the title', async () => {
		const node = await noteWithBody()
		const got = (await run('node.get', { shapeId: node.id })) as { text: string }

		expect(got.text).toBe(BODY)
		// The part that was unreachable before.
		expect(got.text).toContain('Milk')
	})

	it('keeps listings free of bodies, which is why text is opt-in', async () => {
		await noteWithBody()
		const found = (await run('node.find', {})) as { shapes: Record<string, unknown>[] }

		// 200 note bodies is not a listing. `node.find` stays a listing.
		expect(found.shapes.length).toBeGreaterThan(0)
		for (const row of found.shapes) {
			expect(row).not.toHaveProperty('text')
			// The label is still there — it is just a title, which is the distinction being drawn.
			expect(row.label).toBe('# Finish the shopping list')
		}
	})

	it('says so when it truncated rather than handing back a silent prefix', async () => {
		await run('board.open', { boardId: 'board-1' })
		const long = 'x'.repeat(MAX_TEXT_CHARS + 500)
		const node = (await run('node.insert', { type: TEXT_NODE, text: long })) as { id: string }

		const got = (await run('node.get', { shapeId: node.id })) as {
			text: string
			textTruncated?: boolean
		}
		expect(got.text).toHaveLength(MAX_TEXT_CHARS)
		expect(got.textTruncated).toBe(true)
	})

	it('reports null for a node type that holds no text', async () => {
		await run('board.open', { boardId: 'board-1' })
		const widget = (await run('node.insert', { type: WIDGET })) as { id: string }

		const got = (await run('node.get', { shapeId: widget.id })) as { text: unknown }
		expect(got.text).toBeNull()
	})
})
