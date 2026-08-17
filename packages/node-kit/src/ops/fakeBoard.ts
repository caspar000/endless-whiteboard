import { atom, type Editor, type TLShape, type TLShapeId } from 'tldraw'
import type { BoardBridge, BoardSummary } from '../boardBridge'
import type { OperationContext } from '../operations'
import { getNodeDefinition } from '../registry'

/**
 * A board that behaves enough like a real one to test operations against.
 *
 * Backed by a tldraw `atom` rather than a plain Map, which is not fussiness: `getPageFacts` and
 * `getPageEdges` return `computed` signals, and a computed with no reactive dependency computes once
 * and caches forever. Against a plain Map, any test that created shapes and *then* queried would
 * silently read the empty board it saw first — passing or failing for reasons that have nothing to do
 * with the operation. Reading through an atom makes invalidation work here exactly as it does in the app.
 */

interface FakeBinding {
	type: string
	fromId: string
	toId: string
	props: { terminal: 'start' | 'end' }
}

export interface FakeBoard {
	editor: Editor
	shapes(): TLShape[]
	/** Every `markHistoryStoppingPoint` reason, in order — one per write operation is the contract. */
	stops: string[]
	selected: string[]
	zoomed: { toFit: number; toSelection: number }
}

export function fakeBoard(): FakeBoard {
	const shapes = atom<Map<string, TLShape>>('shapes', new Map())
	const bindings = atom<FakeBinding[]>('bindings', [])
	let documentMeta: Record<string, unknown> = {}
	const state: FakeBoard = {
		editor: null as unknown as Editor,
		shapes: () => [...shapes.get().values()],
		stops: [],
		selected: [],
		zoomed: { toFit: 0, toSelection: 0 },
	}

	const write = (mutate: (next: Map<string, TLShape>) => void) => {
		const next = new Map(shapes.get())
		mutate(next)
		shapes.set(next)
	}

	const makeShape = (partial: {
		id: string
		type: string
		x?: number
		y?: number
		props?: object
		meta?: object
	}) => {
		// Defaults come from the node registry, the way tldraw fills them from the shape util.
		const defaults = getNodeDefinition(partial.type)?.defaultProps() ?? {}
		return {
			id: partial.id as TLShapeId,
			typeName: 'shape',
			type: partial.type,
			parentId: 'page:page',
			index: 'a1',
			x: partial.x ?? 0,
			y: partial.y ?? 0,
			rotation: 0,
			isLocked: false,
			opacity: 1,
			props: { w: 100, h: 100, ...defaults, ...(partial.props ?? {}) },
			// Carried through, as tldraw does: a shape can be created *with* meta, which is how a
			// relation is drawn hidden in one step rather than created and then amended.
			meta: partial.meta ?? {},
		} as unknown as TLShape
	}

	const editor = {
		run: (fn: () => void) => fn(),
		markHistoryStoppingPoint: (reason?: string) => state.stops.push(reason ?? ''),

		getShape: (id: string) => shapes.get().get(id),
		getCurrentPageShapes: () => [...shapes.get().values()],
		getCurrentPageShapeIds: () => new Set(shapes.get().keys()),

		createShape: (partial: {
			id: string
			type: string
			x?: number
			y?: number
			props?: object
			meta?: object
		}) => {
			write((next) => next.set(partial.id, makeShape(partial)))
		},
		createShapes: (partials: { id: string; type: string; x?: number; y?: number; props?: object }[]) => {
			write((next) => {
				for (const partial of partials) next.set(partial.id, makeShape(partial))
			})
		},
		updateShape: (partial: { id: string; x?: number; y?: number; props?: object; meta?: object }) => {
			write((next) => {
				const prev = next.get(partial.id)
				if (!prev) return
				next.set(partial.id, {
					...prev,
					...(partial.x !== undefined ? { x: partial.x } : {}),
					...(partial.y !== undefined ? { y: partial.y } : {}),
					props: { ...prev.props, ...(partial.props ?? {}) },
					// One level deep, as tldraw merges it — see properties/fakeEditor.ts.
					meta: { ...prev.meta, ...(partial.meta ?? {}) },
				} as TLShape)
			})
		},
		deleteShape: (id: string) => {
			write((next) => next.delete(id))
			bindings.set(bindings.get().filter((b) => b.fromId !== id && b.toId !== id))
		},

		getShapePageBounds: (id: string) => {
			const shape = shapes.get().get(id)
			if (!shape) return undefined
			const props = shape.props as { w?: number; h?: number }
			return { x: shape.x, y: shape.y, w: props.w ?? 0, h: props.h ?? 0 }
		},
		getViewportPageBounds: () => ({ center: { x: 500, y: 400 } }),
		getShapeUtil: () => ({ getText: () => '' }),
		getAsset: () => undefined,
		canEditShape: () => true,

		createBindings: (next: FakeBinding[]) => bindings.set([...bindings.get(), ...next]),
		getBindingsFromShape: (shape: { id: string }, type: string) =>
			bindings.get().filter((b) => b.fromId === shape.id && b.type === type),

		getDocumentSettings: () => ({ meta: documentMeta }),
		updateDocumentSettings: (partial: { meta?: Record<string, unknown> }) => {
			if (partial.meta) documentMeta = partial.meta
		},

		select: (...ids: string[]) => {
			state.selected = ids
		},
		getSelectedShapeIds: () => state.selected,
		zoomToFit: () => {
			state.zoomed.toFit++
		},
		zoomToSelection: () => {
			state.zoomed.toSelection++
		},
	} as unknown as Editor

	state.editor = editor
	return state
}

export interface FakeWorkspace {
	ctx: OperationContext
	boards: BoardBridge
	board(id: string): FakeBoard
	/** The board the context points at — what an operation acts on when given no boardId. */
	active: FakeBoard | null
	opened: string[]
}

/**
 * A workspace of boards behind a `BoardBridge`, so board-targeted operations can be tested for the
 * thing that actually matters about them: that passing a boardId reaches a board other than the
 * open one, and that an unmounted board gets opened first.
 */
export function fakeWorkspace(
	initial: { id: string; name: string }[] = [{ id: 'board-1', name: 'First board' }]
): FakeWorkspace {
	const metas = new Map<string, BoardSummary>(
		initial.map((board, i) => [
			board.id,
			{ id: board.id, name: board.name, createdAt: i, updatedAt: i },
		])
	)
	const editors = new Map<string, FakeBoard>()
	const mounted = new Set<string>()
	let nextId = initial.length + 1

	const boardFor = (id: string): FakeBoard => {
		let board = editors.get(id)
		if (!board) editors.set(id, (board = fakeBoard()))
		return board
	}

	const workspace: FakeWorkspace = {
		ctx: null as unknown as OperationContext,
		boards: null as unknown as BoardBridge,
		board: boardFor,
		active: null,
		opened: [],
	}

	const boards: BoardBridge = {
		list: async () => [...metas.values()].sort((a, b) => b.updatedAt - a.updatedAt),
		create: async (name: string) => {
			const board: BoardSummary = {
				id: `board-${nextId++}`,
				name,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}
			metas.set(board.id, board)
			return board
		},
		rename: async (id, name) => {
			const board = metas.get(id)
			if (board) metas.set(id, { ...board, name })
		},
		remove: async (id) => {
			metas.delete(id)
			editors.delete(id)
			mounted.delete(id)
		},
		open: async (id) => {
			if (!metas.has(id)) return null
			workspace.opened.push(id)
			mounted.add(id)
			const board = boardFor(id)
			workspace.active = board
			return board.editor
		},
		// Deliberately null until opened: an operation given a boardId for an unmounted board must go
		// through `open` and await the mount, and this is what makes a test that skips it fail.
		editorFor: (id) => (mounted.has(id) ? boardFor(id).editor : null),
	}

	workspace.boards = boards
	workspace.ctx = {
		get editor() {
			return workspace.active?.editor ?? null
		},
		boards,
	}
	return workspace
}
