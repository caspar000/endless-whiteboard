import { beforeEach, describe, expect, it } from 'vitest'
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
		expect(await run('node.types')).toEqual([
			{ type: NOTE, label: 'Test note', acceptsText: true, defaultSize: { w: 200, h: 120 } },
		])
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
})
