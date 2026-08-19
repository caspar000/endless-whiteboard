import { beforeEach, describe, expect, it } from 'vitest'
import { clearAgentActivity, getAgentActivity } from '../agentPresence'
import { clearBoardBridge } from '../boardBridge'
import { clearCommandRegistry } from '../commands'
import { clearExtensionRegistry, defineNode } from '../extensions'
import { emptyPropsMigrations } from '../migrations'
import {
	clearOperationRegistry,
	getVisibleOperations,
	operationManifest,
	runOperation,
	type JsonValue,
	type OperationResult,
} from '../operations'
import { clearNodeRegistry, registerNode, type NodeDefinition } from '../registry'
import { fakeWorkspace, type FakeWorkspace } from './fakeBoard'
import { registerCoreOperations } from './index'
import { lookScale } from './view'

const NOTE = 'node.testnote'

/** A stand-in for the markdown note: holds its text in `md`, which is what `textPropFor` looks for. */
function noteDefinition(): NodeDefinition<never> {
	return defineNode({
		type: NOTE,
		label: 'Test note',
		icon: 'N',
		props: {},
		migrations: emptyPropsMigrations,
		defaultProps: () => ({ md: '' }),
		defaultSize: { w: 200, h: 120 },
		component: () => null,
		getLabel: (shape: { props: { md?: string } }) => shape.props.md ?? '',
	} as unknown as NodeDefinition<object>)
}

let workspace: FakeWorkspace

beforeEach(async () => {
	clearOperationRegistry()
	clearCommandRegistry()
	clearExtensionRegistry()
	clearNodeRegistry()
	clearBoardBridge()
	clearAgentActivity()
	registerNode(noteDefinition())
	registerCoreOperations()
	workspace = fakeWorkspace()
})

/** Runs an operation and fails the test with the error if it did not succeed. */
async function run(id: string, args: Record<string, unknown> = {}): Promise<JsonValue> {
	const result = await runOperation(id, workspace.ctx, args)
	if (!result.ok) throw new Error(`${id} failed: ${result.error}`)
	return result.data
}

async function attempt(id: string, args: Record<string, unknown> = {}): Promise<OperationResult> {
	return runOperation(id, workspace.ctx, args)
}

/** Opens the default board and returns a note on it. */
async function boardWithNote(text = 'Standing desk'): Promise<{ id: string }> {
	await run('board.open', { boardId: 'board-1' })
	const node = (await run('node.insert', { type: NOTE, text })) as { id: string }
	return node
}

describe('the core surface', () => {
	it('registers every operation ownerless, so they are always offered', () => {
		expect(getVisibleOperations().length).toBeGreaterThan(15)
		expect(operationManifest().every((entry) => entry.inputSchema.type === 'object')).toBe(true)
	})

	it('gives every operation a description, which is how an agent picks one', () => {
		for (const entry of operationManifest()) {
			expect(entry.description.length, `${entry.id} has no description`).toBeGreaterThan(20)
		}
	})

	it('describes every parameter of every operation', () => {
		for (const entry of operationManifest()) {
			for (const [name, property] of Object.entries(entry.inputSchema.properties)) {
				expect(property.description, `${entry.id}.${name} has no description`).toBeTruthy()
			}
		}
	})

	/**
	 * The gap this closes: `node.insert`'s type was a bare string saying "see node.types", so a model's
	 * only route to a type name was a tool call. Every "add a note" cost a discovery round trip, and the
	 * registry knew the answer the whole time.
	 */
	it('puts the creatable types in node.insert’s schema, so no discovery call is needed', () => {
		const insert = operationManifest().find((entry) => entry.id === 'node.insert')
		const types = insert?.inputSchema.properties.type?.enum

		expect(types, 'node.insert.type has no enum').toBeDefined()
		// The registered note and tldraw's own shapes, which is exactly what `node.types` reports.
		expect(types).toContain(NOTE)
		expect(types).toContain('text')
		expect(types).toContain('note')
		expect(types).toContain('frame')
	})

	it('tracks the registry, so a toggled extension cannot leave a stale enum behind', () => {
		const typesNow = () =>
			operationManifest().find((entry) => entry.id === 'node.insert')?.inputSchema.properties.type
				?.enum ?? []

		expect(typesNow()).toContain(NOTE)
		clearNodeRegistry()
		// The whole reason the set is read at manifest time rather than written in the source: it is a
		// function of what is enabled, and the host re-announces its tools when this changes.
		expect(typesNow()).not.toContain(NOTE)
		expect(typesNow()).toContain('text')
	})

	/**
	 * `node.find` is deliberately *not* enumerated. A board can hold a type an extension no longer
	 * offers — an old note from a disabled plugin — and a closed set would make it unfindable.
	 */
	it('leaves node.find’s type open, so shapes of withdrawn types stay findable', () => {
		const find = operationManifest().find((entry) => entry.id === 'node.find')
		expect(find?.inputSchema.properties.type?.enum).toBeUndefined()
	})

	it('marks the reads read-only and the writes not', () => {
		const byId = new Map(operationManifest().map((entry) => [entry.id, entry.readOnly]))
		expect(byId.get('board.list')).toBe(true)
		expect(byId.get('node.find')).toBe(true)
		expect(byId.get('board.query')).toBe(true)
		expect(byId.get('node.insert')).toBe(false)
		expect(byId.get('board.delete')).toBe(false)
	})
})

describe('boards', () => {
	it('lists what exists', async () => {
		expect(await run('board.list')).toEqual([
			{ id: 'board-1', name: 'First board', createdAt: 0, updatedAt: 0, favorite: false },
		])
	})

	it('creates and opens a board by default', async () => {
		const board = (await run('board.create', { name: 'Shopping' })) as { id: string; name: string }
		expect(board.name).toBe('Shopping')
		expect(workspace.opened).toContain(board.id)
	})

	it('can create without opening', async () => {
		const board = (await run('board.create', { name: 'Quiet', open: false })) as { id: string }
		expect(workspace.opened).not.toContain(board.id)
	})

	it('names an untitled board rather than leaving it blank', async () => {
		const board = (await run('board.create', { name: '   ' })) as { name: string }
		expect(board.name).toBe('Untitled board')
	})

	it('renames', async () => {
		await run('board.rename', { boardId: 'board-1', name: 'Renamed' })
		expect(await run('board.list')).toMatchObject([{ name: 'Renamed' }])
	})

	it('refuses an empty name', async () => {
		const result = await attempt('board.rename', { boardId: 'board-1', name: '  ' })
		expect(result.ok).toBe(false)
	})

	it('reports a board that is not there', async () => {
		const result = await attempt('board.open', { boardId: 'nope' })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('nope')
	})
})

describe('board.delete', () => {
	it('deletes only with confirmation', async () => {
		const refused = await attempt('board.delete', { boardId: 'board-1', confirm: false })
		expect(refused.ok).toBe(false)
		if (refused.ok) return
		expect(refused.error).toContain('confirm')
		// Still there — a refusal must not half-delete.
		expect(await run('board.list')).toHaveLength(1)

		await run('board.delete', { boardId: 'board-1', confirm: true })
		expect(await run('board.list')).toEqual([])
	})

	it('will not delete without the confirm argument at all', async () => {
		const result = await attempt('board.delete', { boardId: 'board-1' })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('Missing required argument "confirm"')
	})
})

describe('nodes', () => {
	it('says which types exist and which take text', async () => {
		const types = (await run('node.types')) as { type: string; builtIn: boolean }[]
		// The registered node comes first, then tldraw's own shapes — one answer to "what can I put on
		// a board", with `builtIn` telling the two apart.
		expect(types[0]).toEqual({
			type: NOTE,
			label: 'Test note',
			builtIn: false,
			acceptsText: true,
			defaultSize: { w: 200, h: 120 },
		})
		expect(types.filter((entry) => entry.builtIn).map((entry) => entry.type)).toEqual([
			'text',
			'note',
			'geo',
			'frame',
		])
	})

	it('creates tldraw’s own text shape, which is not a registered node type', async () => {
		await run('board.open', { boardId: 'board-1' })
		const shape = (await run('node.insert', { type: 'text', text: 'Q3 plan', x: 80, y: 140 })) as {
			id: string
			type: string
		}
		expect(shape.type).toBe('text')
		const created = workspace.board('board-1').shapes().at(-1)
		// Rich text, not a `text` prop: this is where an agent's words have to end up for tldraw to
		// draw them, and getting it wrong produces an empty shape rather than an error.
		expect((created?.props as { richText?: unknown }).richText).toBeDefined()
	})

	it('puts a frame’s text in its name, since that is where a frame keeps one', async () => {
		await run('board.open', { boardId: 'board-1' })
		await run('node.insert', { type: 'frame', text: 'Ideas' })
		const created = workspace.board('board-1').shapes().at(-1)
		expect((created?.props as { name?: string }).name).toBe('Ideas')
	})

	it('refuses a size a built-in shape has no room for, rather than failing validation later', async () => {
		await run('board.open', { boardId: 'board-1' })
		const shape = (await run('node.insert', { type: 'text', text: 'Caption' })) as { id: string }
		const result = await attempt('node.update', { shapeId: shape.id, h: 400 })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('no h to set')
	})

	it('lists the built-ins too when given a bad type', async () => {
		await run('board.open', { boardId: 'board-1' })
		const result = await attempt('node.insert', { type: 'sticky' })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('text')
	})

	it('inserts a node at the centre of the view by default and returns it', async () => {
		await run('board.open', { boardId: 'board-1' })
		const node = (await run('node.insert', { type: NOTE, text: 'Standing desk' })) as {
			id: string
			label: string
			x: number
			y: number
		}
		expect(node.label).toBe('Standing desk')
		// The viewport centre (500,400) less half the default size — the node is centred on the point.
		expect(node.x).toBe(400)
		expect(node.y).toBe(340)
	})

	it('inserts at a given point', async () => {
		await run('board.open', { boardId: 'board-1' })
		const node = (await run('node.insert', { type: NOTE, x: 80, y: 140 })) as {
			x: number
			y: number
		}
		expect(node).toMatchObject({ x: -20, y: 80 })
	})

	it('leaves one undo step per write', async () => {
		await boardWithNote()
		expect(workspace.board('board-1').stops).toEqual(['agent: node.insert'])
	})

	it('does not select or start editing, unlike the palette’s insert', async () => {
		await boardWithNote()
		// Nobody is at the keyboard; stealing the caret from whoever is would be worse than useless.
		expect(workspace.board('board-1').selected).toEqual([])
	})

	it('lists the valid types when given a bad one', async () => {
		await run('board.open', { boardId: 'board-1' })
		const result = await attempt('node.insert', { type: 'node.nonsense' })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain(NOTE)
	})

	it('finds nodes by label, type and property', async () => {
		await boardWithNote('Standing desk')
		await run('node.insert', { type: NOTE, text: 'Desk chair' })
		await run('node.insert', { type: NOTE, text: 'Floor lamp' })

		const byLabel = (await run('node.find', { query: 'desk' })) as { matched: number }
		expect(byLabel.matched).toBe(2)

		const all = (await run('node.find')) as { matched: number; truncated: boolean }
		expect(all).toMatchObject({ matched: 3, truncated: false })

		const byType = (await run('node.find', { type: 'nothing' })) as { matched: number }
		expect(byType.matched).toBe(0)
	})

	it('says when a result was truncated rather than letting it look complete', async () => {
		await run('board.open', { boardId: 'board-1' })
		await run('node.insert', { type: NOTE, text: 'a' })
		await run('node.insert', { type: NOTE, text: 'b' })

		const result = (await run('node.find', { limit: 1 })) as {
			matched: number
			truncated: boolean
			shapes: unknown[]
		}
		expect(result).toMatchObject({ matched: 2, truncated: true })
		expect(result.shapes).toHaveLength(1)
	})

	it('gets, updates and deletes one node', async () => {
		const node = await boardWithNote('Old text')

		const updated = (await run('node.update', {
			shapeId: node.id,
			text: 'New text',
			x: 10,
			y: 20,
		})) as { label: string; x: number; y: number }
		expect(updated).toMatchObject({ label: 'New text', x: 10, y: 20 })

		const fetched = (await run('node.get', { shapeId: node.id })) as { label: string }
		expect(fetched.label).toBe('New text')

		await run('node.delete', { shapeId: node.id })
		expect(await attempt('node.get', { shapeId: node.id })).toMatchObject({ ok: false })
	})

	it('refuses an update that changes nothing', async () => {
		const node = await boardWithNote()
		const result = await attempt('node.update', { shapeId: node.id })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('at least one')
	})

	it('explains a missing shape instead of failing silently', async () => {
		await run('board.open', { boardId: 'board-1' })
		const result = await attempt('node.get', { shapeId: 'shape:ghost' })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('node.find')
	})
})

describe('choosing a board', () => {
	it('tells an agent what to do when nothing is open', async () => {
		const result = await attempt('node.find')
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('board.open')
		expect(result.error).toContain('board.list')
	})

	it('opens an unmounted board when given its id, and waits for it', async () => {
		const created = (await run('board.create', { name: 'Other', open: false })) as { id: string }
		const node = (await run('node.insert', {
			type: NOTE,
			text: 'On the other board',
			boardId: created.id,
		})) as { id: string }

		expect(workspace.opened).toContain(created.id)
		expect(workspace.board(created.id).shapes().map((shape) => shape.id)).toContain(node.id)
		// And it did not land on the board that happened to be open.
		expect(workspace.board('board-1').shapes()).toEqual([])
	})
})

describe('properties', () => {
	it('creates, lists and sets a property', async () => {
		const node = await boardWithNote()

		const def = (await run('property.create', {
			name: 'Price',
			type: 'financial',
			unit: 'GEL',
		})) as { id: string; name: string }
		expect(def.name).toBe('Price')

		expect(await run('property.list')).toMatchObject([{ name: 'Price', type: 'financial' }])

		const written = (await run('property.set', {
			shapeId: node.id,
			property: 'Price',
			value: '2399',
		})) as { value: JsonValue }
		// Read according to the property's type — the agent sent a string and should see the number.
		expect(written.value).toBe(2399)

		const fetched = (await run('node.get', { shapeId: node.id })) as {
			properties: { id: string; name: string; value: JsonValue }[]
		}
		expect(fetched.properties).toEqual([{ id: def.id, name: 'Price', value: 2399 }])
	})

	it('accepts a property by id as well as by name, case-insensitively', async () => {
		const node = await boardWithNote()
		const def = (await run('property.create', { name: 'Price', type: 'number' })) as { id: string }

		await run('property.set', { shapeId: node.id, property: def.id, value: '1' })
		await run('property.set', { shapeId: node.id, property: 'pRiCe', value: '2' })

		const fetched = (await run('node.get', { shapeId: node.id })) as {
			properties: { value: JsonValue }[]
		}
		expect(fetched.properties[0]?.value).toBe(2)
	})

	it('is safe to call create twice — the second returns the existing definition', async () => {
		await run('board.open', { boardId: 'board-1' })
		const first = (await run('property.create', { name: 'Price', type: 'number' })) as { id: string }
		const again = (await run('property.create', { name: 'Price', type: 'number' })) as { id: string }
		expect(again.id).toBe(first.id)
		expect(await run('property.list')).toHaveLength(1)
	})

	it('lists the known properties when asked for one that does not exist', async () => {
		const node = await boardWithNote()
		await run('property.create', { name: 'Price', type: 'number' })

		const result = await attempt('property.set', {
			shapeId: node.id,
			property: 'Cost',
			value: '1',
		})
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('Price')
	})

	it('rejects a property type that is not one', async () => {
		await run('board.open', { boardId: 'board-1' })
		const result = await attempt('property.create', { name: 'X', type: 'colour' })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('must be one of')
	})

	it('filters a find by which shapes carry a property', async () => {
		const node = await boardWithNote('Desk')
		await run('node.insert', { type: NOTE, text: 'Lamp' })
		await run('property.create', { name: 'Price', type: 'number' })
		await run('property.set', { shapeId: node.id, property: 'Price', value: '10' })

		const result = (await run('node.find', { hasProperty: 'Price' })) as { matched: number }
		expect(result.matched).toBe(1)
	})
})

describe('relations', () => {
	it('connects two nodes and reads the relation back', async () => {
		const from = await boardWithNote('Desk')
		const to = (await run('node.insert', { type: NOTE, text: 'Chair' })) as { id: string }

		const relation = (await run('relation.connect', { from: from.id, to: to.id })) as { id: string }

		const listed = (await run('relation.list')) as {
			matched: number
			relations: { id: string; from: { label: string }; to: { label: string } }[]
		}
		expect(listed.matched).toBe(1)
		expect(listed.relations[0]).toMatchObject({
			id: relation.id,
			from: { label: 'Desk' },
			to: { label: 'Chair' },
		})
	})

	it('answers "what is connected to this?" by direction', async () => {
		const a = await boardWithNote('A')
		const b = (await run('node.insert', { type: NOTE, text: 'B' })) as { id: string }
		await run('relation.connect', { from: a.id, to: b.id })

		const out = (await run('relation.list', { shapeId: a.id, direction: 'out' })) as {
			matched: number
		}
		const into = (await run('relation.list', { shapeId: a.id, direction: 'in' })) as {
			matched: number
		}
		expect(out.matched).toBe(1)
		expect(into.matched).toBe(0)
	})

	it('refuses to connect a shape to itself', async () => {
		const node = await boardWithNote()
		const result = await attempt('relation.connect', { from: node.id, to: node.id })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('itself')
	})

	it('deletes a relation by the arrow id, and says so when given the wrong one', async () => {
		const a = await boardWithNote('A')
		const b = (await run('node.insert', { type: NOTE, text: 'B' })) as { id: string }
		const relation = (await run('relation.connect', { from: a.id, to: b.id })) as { id: string }

		const wrong = await attempt('relation.delete', { relationId: a.id })
		expect(wrong.ok).toBe(false)
		if (wrong.ok) return
		expect(wrong.error).toContain('arrow')

		await run('relation.delete', { relationId: relation.id })
		expect(await run('relation.list')).toMatchObject({ matched: 0 })
	})

	it('connects hidden when asked, and still lists the relation', async () => {
		const a = await boardWithNote('A')
		const b = (await run('node.insert', { type: NOTE, text: 'B' })) as { id: string }
		await run('relation.connect', { from: a.id, to: b.id, hidden: true })

		// Listed like any other: hiding is about drawing, and an agent asking what is connected must
		// be told about every connection or it will helpfully draw a duplicate.
		const listed = (await run('relation.list')) as {
			matched: number
			relations: { hidden: boolean }[]
		}
		expect(listed.matched).toBe(1)
		expect(listed.relations[0]?.hidden).toBe(true)
	})

	it('shows and hides an existing relation, and says so when given the wrong id', async () => {
		const a = await boardWithNote('A')
		const b = (await run('node.insert', { type: NOTE, text: 'B' })) as { id: string }
		const relation = (await run('relation.connect', { from: a.id, to: b.id })) as { id: string }

		await run('relation.set-hidden', { relationId: relation.id, hidden: true })
		const hidden = (await run('relation.list')) as { relations: { hidden: boolean }[] }
		expect(hidden.relations[0]?.hidden).toBe(true)

		await run('relation.set-hidden', { relationId: relation.id, hidden: false })
		const shown = (await run('relation.list')) as { relations: { hidden: boolean }[] }
		expect(shown.relations[0]?.hidden).toBe(false)

		const wrong = await attempt('relation.set-hidden', { relationId: a.id, hidden: true })
		expect(wrong.ok).toBe(false)
		if (wrong.ok) return
		expect(wrong.error).toContain('arrow')
	})

	it('puts the board into a relation view, and reports what it was', async () => {
		await boardWithNote('A')

		const first = (await run('view.relations', { view: 'none' })) as {
			view: string
			previous: string
		}
		expect(first).toEqual({ view: 'none', previous: 'normal' })

		const second = (await run('view.relations', { view: 'all' })) as { previous: string }
		expect(second.previous).toBe('none')

		// The closed set is enforced before `run` is reached, so a typo is a readable failure rather
		// than a board left in a state nothing knows how to draw.
		const bad = await attempt('view.relations', { view: 'everything' })
		expect(bad.ok).toBe(false)
		if (bad.ok) return
		expect(bad.error).toContain('none, normal, all')
	})

	it('drops the relation when either end is deleted', async () => {
		const a = await boardWithNote('A')
		const b = (await run('node.insert', { type: NOTE, text: 'B' })) as { id: string }
		await run('relation.connect', { from: a.id, to: b.id })

		await run('node.delete', { shapeId: b.id })
		expect(await run('relation.list')).toMatchObject({ matched: 0 })
	})
})

describe('board.query', () => {
	async function priced() {
		const desk = await boardWithNote('Desk')
		const chair = (await run('node.insert', { type: NOTE, text: 'Chair' })) as { id: string }
		const lamp = (await run('node.insert', { type: NOTE, text: 'Lamp' })) as { id: string }
		await run('property.create', { name: 'Price', type: 'number' })
		await run('property.set', { shapeId: desk.id, property: 'Price', value: '2399' })
		await run('property.set', { shapeId: chair.id, property: 'Price', value: '850' })
		return { desk, chair, lamp }
	}

	it('sums a property across the board', async () => {
		await priced()
		const result = (await run('board.query', { property: 'Price', op: 'sum' })) as { value: number }
		expect(result.value).toBe(3249)
	})

	it('counts by default', async () => {
		await priced()
		const result = (await run('board.query')) as { value: number | null; matched: number }
		expect(result.matched).toBe(3)
	})

	it('filters, comparing numbers as numbers', async () => {
		await priced()
		// The string "9" sorts above "100"; this passes only because the threshold is read as a number.
		const result = (await run('board.query', {
			property: 'Price',
			op: 'count',
			filterProperty: 'Price',
			filterOp: 'gt',
			filterValue: '900',
		})) as { matched: number }
		expect(result.matched).toBe(1)
	})

	it('rejects a filter with nothing to filter on', async () => {
		await run('board.open', { boardId: 'board-1' })
		const result = await attempt('board.query', { filterOp: 'gt', filterValue: '1' })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('filterProperty')
	})

	it('names the known properties when given an unknown one', async () => {
		await priced()
		const result = await attempt('board.query', { property: 'Cost' })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('Price')
	})
})

describe('view', () => {
	it('selects and zooms so the person watching sees the change', async () => {
		const node = await boardWithNote()
		await run('view.select', { shapeIds: [node.id] })

		const board = workspace.board('board-1')
		expect(board.selected).toEqual([node.id])
		expect(board.zoomed.toSelection).toBe(1)
	})

	it('accepts a single id, because agents pass one', async () => {
		const node = await boardWithNote()
		await run('view.select', { shapeIds: node.id })
		expect(workspace.board('board-1').selected).toEqual([node.id])
	})

	it('can select without moving the camera', async () => {
		const node = await boardWithNote()
		await run('view.select', { shapeIds: [node.id], zoom: false })
		expect(workspace.board('board-1').zoomed.toSelection).toBe(0)
	})

	it('reports partial success rather than rounding it up', async () => {
		const node = await boardWithNote()
		const result = (await run('view.select', { shapeIds: [node.id, 'shape:ghost'] })) as {
			selected: string[]
			missing: string[]
		}
		expect(result).toEqual({ selected: [node.id], missing: ['shape:ghost'] })
	})

	it('fails when none of the shapes exist', async () => {
		await run('board.open', { boardId: 'board-1' })
		expect(await attempt('view.select', { shapeIds: ['shape:ghost'] })).toMatchObject({ ok: false })
	})

	it('zooms to fit', async () => {
		await boardWithNote()
		await run('view.zoom-fit')
		expect(workspace.board('board-1').zoomed.toFit).toBe(1)
	})

	it('reads what the user has selected, which is what "these ones" means', async () => {
		const node = await boardWithNote('Standing desk')
		await run('view.select', { shapeIds: [node.id] })

		const result = (await run('view.selection')) as {
			selected: number
			shapes: { id: string; label: string }[]
		}
		expect(result.selected).toBe(1)
		expect(result.shapes[0]).toMatchObject({ id: node.id, label: 'Standing desk' })
	})

	it('says nothing is selected rather than failing', async () => {
		await boardWithNote()
		expect(await run('view.selection')).toMatchObject({ selected: 0, shapes: [] })
	})

	it('hands back a picture beside the JSON, so the agent can see the board', async () => {
		const node = await boardWithNote()
		const result = await attempt('view.look', { shapeIds: [node.id] })
		expect(result.ok).toBe(true)
		if (!result.ok) return

		expect(result.images?.[0]?.mediaType).toBe('image/png')
		// Base64 of the four PNG magic bytes the fake renderer returns.
		expect(result.images?.[0]?.data).toBe('iVBORw==')
		expect(result.data).toMatchObject({ shapes: 1, width: 100, height: 80 })
		expect(workspace.board('board-1').looks[0]?.shapeIds).toEqual([node.id])
	})

	it('crops to the window when asked for what is on screen', async () => {
		await boardWithNote()
		await run('view.look', { region: 'viewport' })

		const look = workspace.board('board-1').looks[0]
		// A viewport look is a question about the window, so it renders the window — padding off and
		// explicit bounds — rather than whichever shapes happened to poke into it.
		expect(look?.opts).toMatchObject({ padding: 0 })
		expect(look?.opts.bounds).toBeDefined()
	})

	it('refuses to render a selection that is not there', async () => {
		await boardWithNote()
		const result = await attempt('view.look', { region: 'selection' })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('Nothing is selected')
	})

	it('renders an empty board as a failure an agent can act on', async () => {
		await run('board.open', { boardId: 'board-1' })
		expect(await attempt('view.look')).toMatchObject({ ok: false })
	})

	it('never renders bigger than the source, so a sticky does not cost a full-page image', () => {
		expect(lookScale({ w: 4000, h: 2000 }, 1200)).toBe(0.3)
		expect(lookScale({ w: 200, h: 200 }, 1200)).toBe(1)
	})
})

/**
 * The presence channel: what the board is told about an agent at work.
 *
 * Tested at the operation layer rather than through the cursor, because this is the contract the
 * cursor draws from — if an operation forgets to report, no amount of correct drawing helps.
 */
describe('presence', () => {
	it('says what was created, and where', async () => {
		const node = await boardWithNote('Standing desk')
		const activity = getAgentActivity()
		expect(activity).toMatchObject({ kind: 'create', operation: 'node.insert' })
		expect(activity?.shapes.map((shape) => shape.id)).toEqual([node.id])
		expect(activity?.point).toEqual({ x: 400, y: 340 })
	})

	it('captures where a shape was before deleting it, since afterwards there is nowhere to point', async () => {
		const node = await boardWithNote()
		await run('node.delete', { shapeId: node.id })

		const activity = getAgentActivity()
		expect(activity).toMatchObject({ kind: 'delete', operation: 'node.delete' })
		expect(activity?.shapes).toHaveLength(1)
	})

	it('bounds how much of the board one activity lights up', async () => {
		await run('board.open', { boardId: 'board-1' })
		for (let i = 0; i < 20; i++) await run('node.insert', { type: NOTE, text: `n${i}` })

		await run('node.find')
		const activity = getAgentActivity()
		// The cursor still says twenty; outlining all of them would be a full-screen flash rather
		// than a signal.
		expect(activity?.verb).toBe('Looking at 20 shapes')
		expect(activity?.shapes.length).toBe(12)
	})
})
