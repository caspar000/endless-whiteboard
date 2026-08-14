import type { TLShapeId, TLShapePartial } from 'tldraw'
import { createNodeShape, textPropFor } from '../nodes/insert'
import { defineOperation, fail, ok, type JsonValue, type RegisteredOperation } from '../operations'
import { shapeLabel } from '../properties/labels'
import { getNodeDefinition, getVisibleNodeDefinitions } from '../registry'
import { readShapeProperties } from '../properties/values'
import {
	BOARD_ID_PARAM,
	MAX_RESULTS,
	propertyDefs,
	resolveEditor,
	resolveProperty,
	resolveShape,
	shapeSummary,
} from './shared'

/** The types an agent may create, as a sentence for an error message. */
function offeredTypes(): string {
	const types = getVisibleNodeDefinitions().map((def) => def.type)
	return types.length ? types.join(', ') : '(none — every node extension is switched off)'
}

export const nodeOperations: RegisteredOperation[] = [
	defineOperation({
		id: 'node.types',
		title: 'List node types',
		description:
			'The kinds of node that can be created right now, with whether each accepts text. Types come from the enabled extensions, so this can change between calls — read it before guessing a type name.',
		readOnly: true,
		params: {},
		run: async () =>
			ok(
				getVisibleNodeDefinitions().map((def) => ({
					type: def.type,
					label: def.label,
					acceptsText: textPropFor(def) !== null,
					defaultSize: { w: def.defaultSize.w, h: def.defaultSize.h },
				}))
			),
	}),

	defineOperation({
		id: 'node.insert',
		title: 'Insert node',
		description:
			'Puts a new node on a board and returns its id. Use node.types for valid type values. Position is the centre of the node in page coordinates; omit x and y to place it in the middle of the current view.',
		params: {
			type: {
				type: 'string',
				description: 'The node type, e.g. the markdown note type. See node.types.',
				required: true,
			},
			text: {
				type: 'string',
				description:
					'Initial text, for types where acceptsText is true. Markdown notes take markdown.',
			},
			x: { type: 'number', description: 'Page x of the node’s centre.' },
			y: { type: 'number', description: 'Page y of the node’s centre.' },
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor

			const def = getNodeDefinition(args.type)
			if (!def) return fail(`Unknown node type "${args.type}". Available: ${offeredTypes()}.`)
			if (def.deprecated) {
				return fail(`"${args.type}" is a legacy type kept only so old boards load. Use one of: ${offeredTypes()}.`)
			}

			let props: Record<string, unknown> | undefined
			if (args.text !== undefined) {
				const textProp = textPropFor(def)
				if (!textProp) {
					return fail(`"${args.type}" does not hold text. node.types says which types do.`)
				}
				props = { [textProp]: args.text }
			}

			const centre = editor.getViewportPageBounds().center
			const point = { x: args.x ?? centre.x, y: args.y ?? centre.y }

			let id: TLShapeId | undefined
			editor.run(() => {
				// One stopping point per operation: a human watching can undo an agent one action at a
				// time, which is the whole reason agent writes go through the live editor at all.
				editor.markHistoryStoppingPoint(`agent: node.insert`)
				id = createNodeShape(editor, def, point, props)
			})
			if (!id) return fail('The node could not be created.')

			const shape = editor.getShape(id)
			if (!shape) return fail('The node was created but immediately vanished.')
			return ok(shapeSummary(editor, shape, propertyDefs(editor)))
		},
	}),

	defineOperation({
		id: 'node.find',
		title: 'Find nodes',
		description:
			'Searches the shapes on a board and returns what matched, with their ids, labels, positions and property values. With no filters it returns everything. This is how to look at a board before changing it.',
		readOnly: true,
		params: {
			query: {
				type: 'string',
				description: 'Case-insensitive substring of the shape’s label (its title or text).',
			},
			type: { type: 'string', description: 'Only shapes of this type. See node.types.' },
			hasProperty: {
				type: 'string',
				description:
					'Only shapes carrying this property, by name or id — e.g. "Price". Matches whether or not the value is filled in.',
			},
			limit: {
				type: 'number',
				description: `How many to return, at most ${MAX_RESULTS}. Defaults to ${MAX_RESULTS}.`,
			},
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor
			const defs = propertyDefs(editor)

			const wanted = args.query?.trim().toLowerCase()
			const property = args.hasProperty ? resolveProperty(defs, args.hasProperty) : undefined
			if (args.hasProperty && !property) {
				const known = defs.map((def) => def.name).join(', ')
				return fail(
					`No property called "${args.hasProperty}" on this board.${known ? ` Known: ${known}.` : ''}`
				)
			}

			const matches = editor.getCurrentPageShapes().filter((shape) => {
				if (args.type && shape.type !== args.type) return false
				if (property && !(property.id in readShapeProperties(shape))) return false
				if (wanted && !shapeLabel(editor, shape).toLowerCase().includes(wanted)) return false
				return true
			})

			const limit = Math.min(args.limit ?? MAX_RESULTS, MAX_RESULTS)
			return ok({
				matched: matches.length,
				// Said explicitly rather than left for the caller to infer from a length: an agent that
				// thinks it saw the whole board when it saw 200 of 900 shapes will reason wrongly.
				truncated: matches.length > limit,
				shapes: matches.slice(0, limit).map((shape) => shapeSummary(editor, shape, defs)),
			})
		},
	}),

	defineOperation({
		id: 'node.get',
		title: 'Get node',
		description:
			'One shape in full: type, label, position, size and every property value it carries.',
		readOnly: true,
		params: {
			shapeId: { type: 'string', description: 'The shape’s id, from node.find.', required: true },
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const found = resolveShape(resolved.editor, args.shapeId)
			if (!found.ok) return fail(found.error)
			return ok(shapeSummary(resolved.editor, found.shape, propertyDefs(resolved.editor)))
		},
	}),

	defineOperation({
		id: 'node.update',
		title: 'Update node',
		description:
			'Changes a node’s text, position or size. Only the values passed are touched. To change property values use property.set.',
		params: {
			shapeId: { type: 'string', description: 'The shape to change.', required: true },
			text: { type: 'string', description: 'Replacement text, for types that hold text.' },
			x: { type: 'number', description: 'New page x of the shape’s top-left corner.' },
			y: { type: 'number', description: 'New page y of the shape’s top-left corner.' },
			w: { type: 'number', description: 'New width.' },
			h: { type: 'number', description: 'New height.' },
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor
			const found = resolveShape(editor, args.shapeId)
			if (!found.ok) return fail(found.error)
			const shape = found.shape

			const props: Record<string, unknown> = {}
			if (args.text !== undefined) {
				const def = getNodeDefinition(shape.type)
				const textProp = def ? textPropFor(def) : null
				if (!textProp) return fail(`A "${shape.type}" shape does not hold text that can be set.`)
				props[textProp] = args.text
			}
			if (args.w !== undefined) props.w = args.w
			if (args.h !== undefined) props.h = args.h

			const patch: TLShapePartial = { id: shape.id, type: shape.type }
			if (args.x !== undefined) patch.x = args.x
			if (args.y !== undefined) patch.y = args.y
			if (Object.keys(props).length) patch.props = props as never

			if (patch.x === undefined && patch.y === undefined && !patch.props) {
				return fail('Nothing to change: pass at least one of text, x, y, w or h.')
			}

			editor.run(() => {
				editor.markHistoryStoppingPoint('agent: node.update')
				editor.updateShape(patch)
			})

			const updated = editor.getShape(shape.id)
			if (!updated) return fail('The shape disappeared while being updated.')
			return ok(shapeSummary(editor, updated, propertyDefs(editor)))
		},
	}),

	defineOperation({
		id: 'node.delete',
		title: 'Delete node',
		description:
			'Removes a shape from the board. Undoable, unlike board.delete — it goes into the board’s history.',
		params: {
			shapeId: { type: 'string', description: 'The shape to delete.', required: true },
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor
			const found = resolveShape(editor, args.shapeId)
			if (!found.ok) return fail(found.error)

			const label = shapeLabel(editor, found.shape)
			editor.run(() => {
				editor.markHistoryStoppingPoint('agent: node.delete')
				editor.deleteShape(found.shape.id)
			})
			return ok({ id: args.shapeId, label, deleted: true } satisfies JsonValue)
		},
	}),
]
