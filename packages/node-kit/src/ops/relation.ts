import type { TLShapeId } from 'tldraw'
import { EDGE_DIRECTIONS, edgesTouching, type Edge } from '../edges'
import { getPageEdges } from '../nodes/rollup/engine'
import { defineOperation, fail, ok, type JsonValue, type RegisteredOperation } from '../operations'
import { shapeLabel } from '../properties/labels'
import { connectShapes, disconnectShapes, isHiddenRelation, setRelationHidden } from '../relations'
import { BOARD_ID_PARAM, MAX_RESULTS, resolveEditor, resolveShape } from './shared'

/**
 * Relations are arrows, and an arrow is only a relation when both of its ends are bound to a shape
 * (`edges.ts`). Everything here reads and writes through that one definition, so an agent cannot
 * create a connection that the board draws but no table can see.
 */

/**
 * What "hidden" means, written once and pasted into every description that mentions it.
 *
 * An agent picks a tool by reading these, and the one thing it could plausibly get wrong here is
 * assuming a hidden relation is a weaker relation — and so drawing a visible one "to be safe", which
 * is the clutter the flag exists to remove.
 */
const HIDDEN_MEANING =
	'A hidden relation is a real one: tables, collections and expressions follow it exactly as they follow a visible one. It is simply not drawn, which is how a busy board stays readable.'

export const relationOperations: RegisteredOperation[] = [
	defineOperation({
		id: 'relation.connect',
		title: 'Connect two nodes',
		description:
			'Draws an arrow from one shape to another, which is how this app records a relation — tables and collections can then follow it. Returns the arrow’s id, which relation.delete takes.',
		params: {
			from: { type: 'string', description: 'The shape the arrow starts at.', required: true },
			to: { type: 'string', description: 'The shape it points at.', required: true },
			hidden: {
				type: 'boolean',
				description: `Create it hidden. ${HIDDEN_MEANING} Defaults to false.`,
			},
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor

			const from = resolveShape(editor, args.from)
			if (!from.ok) return fail(from.error)
			const to = resolveShape(editor, args.to)
			if (!to.ok) return fail(to.error)
			if (args.from === args.to) {
				return fail('A shape cannot be connected to itself — nothing would be able to read it.')
			}

			const arrowId = connectShapes(editor, from.shape.id, to.shape.id, {
				markHistory: true,
				hidden: args.hidden === true,
			})
			if (!arrowId) return fail('The connection could not be made.')

			return ok({
				id: arrowId,
				hidden: args.hidden === true,
				from: { id: args.from, label: shapeLabel(editor, from.shape) },
				to: { id: args.to, label: shapeLabel(editor, to.shape) },
			})
		},
	}),

	defineOperation({
		id: 'relation.list',
		title: 'List relations',
		description:
			'The relations on a board, as from/to pairs with labels. Pass a shapeId to get only the ones touching it — that is how to answer "what is connected to this?".',
		readOnly: true,
		params: {
			shapeId: {
				type: 'string',
				description: 'Only relations touching this shape. Omit for every relation on the board.',
			},
			direction: {
				type: 'string',
				description:
					'With shapeId: "out" for arrows leaving it, "in" for arrows pointing at it, "either" for both. Defaults to either.',
				choices: EDGE_DIRECTIONS,
			},
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor

			const index = getPageEdges(editor).get()
			let edges: readonly Edge[] = index.all
			if (args.shapeId) {
				const found = resolveShape(editor, args.shapeId)
				if (!found.ok) return fail(found.error)
				edges = edgesTouching(index, args.shapeId, args.direction ?? 'either')
			}

			const describe = (id: string): JsonValue => {
				const shape = editor.getShape(id as TLShapeId)
				return { id, label: shape ? shapeLabel(editor, shape) : '' }
			}

			return ok({
				matched: edges.length,
				truncated: edges.length > MAX_RESULTS,
				relations: edges.slice(0, MAX_RESULTS).map((edge) => ({
					id: edge.id,
					// Reported per relation rather than filtered on: hidden ones are listed like any
					// other, because they connect like any other.
					hidden: isHiddenRelation(editor.getShape(edge.id as TLShapeId)),
					from: describe(edge.from),
					to: describe(edge.to),
				})),
			})
		},
	}),

	defineOperation({
		id: 'relation.set-hidden',
		title: 'Show or hide a relation',
		description: `Draws a relation or stops drawing it, without changing what it connects. ${HIDDEN_MEANING} Use it to tidy a board that has become a ball of arrows.`,
		params: {
			relationId: {
				type: 'string',
				description: 'The arrow’s id, as relation.connect and relation.list return it.',
				required: true,
			},
			hidden: {
				type: 'boolean',
				description: 'True to stop drawing it, false to draw it again.',
				required: true,
			},
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor

			const changed = setRelationHidden(editor, args.relationId as TLShapeId, args.hidden, {
				markHistory: true,
			})
			if (!changed) {
				return fail(
					`No relation with id "${args.relationId}". That id must be the arrow's, which relation.list returns as "id".`
				)
			}
			return ok({ id: args.relationId, hidden: args.hidden })
		},
	}),

	defineOperation({
		id: 'relation.delete',
		title: 'Delete relation',
		description:
			'Removes a relation by deleting its arrow. Takes the arrow id from relation.connect or relation.list, not the ids of the shapes it joined.',
		params: {
			relationId: { type: 'string', description: 'The arrow’s id.', required: true },
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor

			let removed = false
			editor.run(() => {
				editor.markHistoryStoppingPoint('agent: relation.delete')
				removed = disconnectShapes(editor, args.relationId as TLShapeId)
			})
			if (!removed) {
				return fail(
					`No relation with id "${args.relationId}". That id must be the arrow's, which relation.list returns as "id".`
				)
			}
			return ok({ id: args.relationId, deleted: true })
		},
	}),
]
