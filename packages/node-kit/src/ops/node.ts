import type { TLShapeId, TLShapePartial } from 'tldraw'
import { createNodeShape, textPropFor } from '../nodes/insert'
import { createNativeShape, getNativeShape, NATIVE_SHAPES } from '../nodes/native'
import { defineOperation, fail, ok, type JsonValue, type RegisteredOperation } from '../operations'
import { shapeLabel } from '../properties/labels'
import { getNodeDefinition, getVisibleNodeDefinitions } from '../registry'
import { readShapeProperties } from '../properties/values'
import {
	BOARD_ID_PARAM,
	MAX_RESULTS,
	propertyDefs,
	reportAgentWork,
	resolveEditor,
	resolveProperty,
	resolveShape,
	shapeSummary,
} from './shared'

/**
 * What an agent may create: the registered node types, then tldraw's own shapes.
 *
 * One list rather than two operations, because "what can I put on this board" is one question. The
 * `builtIn` flag is what tells the two apart where it matters — a node carries properties and can be
 * rolled up into a table, a text shape is a caption — and `node.types` passes it straight through.
 */
function creatableTypes(): { type: string; label: string; builtIn: boolean; note?: string }[] {
	return [
		...getVisibleNodeDefinitions().map((def) => ({
			type: def.type,
			label: def.label,
			builtIn: false,
		})),
		...NATIVE_SHAPES.map((spec) => ({
			type: spec.type,
			label: spec.label,
			builtIn: true,
			note: spec.note,
		})),
	]
}

/** The types an agent may create, as a sentence for an error message. */
function offeredTypes(): string {
	const types = creatableTypes().map((entry) => entry.type)
	return types.length ? types.join(', ') : '(none — every node extension is switched off)'
}

/**
 * Which prop of this shape holds text an agent may set, and how to write it.
 *
 * Our nodes keep text in a declared prop (`md`, `text`); tldraw's keep rich text, except a frame
 * whose text is its title. One function so the two update paths — insert and update — cannot end up
 * disagreeing about where a sticky's words live.
 */
function textPropsFor(type: string, text: string): Record<string, unknown> | null {
	const def = getNodeDefinition(type)
	if (def) {
		const prop = textPropFor(def)
		return prop ? { [prop]: text } : null
	}
	const native = getNativeShape(type)
	return native?.textProps ? native.textProps(text) : null
}

export const nodeOperations: RegisteredOperation[] = [
	defineOperation({
		id: 'node.types',
		title: 'List node types',
		description:
			'Details about each type that can be put on a board: its label, whether it holds text, and its default size. The type *names* are already in node.insert’s schema, so this is not needed before creating something — reach for it when the size or text-handling matters, or to show the user what this board supports.',
		readOnly: true,
		params: {},
		run: async () =>
			ok(
				creatableTypes().map((entry) => {
					const def = getNodeDefinition(entry.type)
					const size = def?.defaultSize ?? getNativeShape(entry.type)?.defaultSize
					return {
						type: entry.type,
						label: entry.label,
						builtIn: entry.builtIn,
						acceptsText: textPropsFor(entry.type, '') !== null,
						defaultSize: { w: size?.w ?? 0, h: size?.h ?? 0 },
						...(entry.note ? { note: entry.note } : {}),
					}
				})
			),
	}),

	defineOperation({
		id: 'node.insert',
		title: 'Insert node',
		description:
			'Puts a new node or shape on a board and returns its id. The type parameter lists everything available right now, so create straight away rather than checking first: the smart node types the enabled extensions provide, plus tldraw’s own shapes — "text" for a plain caption, "note" for a sticky, "geo" for a rectangle, "frame" for a titled region. Position is the centre in page coordinates; omit x and y to place it in the middle of the current view.',
		params: {
			type: {
				type: 'string',
				description:
					'What to create. The listed values are the ones this board accepts right now — they change with which extensions are enabled, which is why they are in the schema rather than written in prose.',
				required: true,
				// The whole point: without this the model cannot know a type name without calling
				// `node.types` first, so every "add a note" costs an extra round trip.
				liveChoices: () => creatableTypes().map((entry) => entry.type),
			},
			text: {
				type: 'string',
				description:
					'Initial text, for types where acceptsText is true. Markdown notes take markdown; a frame’s text is its title.',
			},
			x: { type: 'number', description: 'Page x of the node’s centre.' },
			y: { type: 'number', description: 'Page y of the node’s centre.' },
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor

			// Registered types are namespaced (`node.markdown`) and tldraw's are not (`text`), so the two
			// tables cannot collide — but the node registry is asked first either way, since a definition
			// is the richer thing to create.
			const def = getNodeDefinition(args.type)
			const native = getNativeShape(args.type)
			if (!def && !native) {
				return fail(`Unknown node type "${args.type}". Available: ${offeredTypes()}.`)
			}
			if (def?.deprecated) {
				return fail(`"${args.type}" is a legacy type kept only so old boards load. Use one of: ${offeredTypes()}.`)
			}

			let props: Record<string, unknown> | undefined
			if (args.text !== undefined) {
				const written = textPropsFor(args.type, args.text)
				if (!written) {
					return fail(`"${args.type}" does not hold text. node.types reports acceptsText for each type.`)
				}
				props = written
			}

			const centre = editor.getViewportPageBounds().center
			const point = { x: args.x ?? centre.x, y: args.y ?? centre.y }

			let id: TLShapeId | undefined
			editor.run(() => {
				// One stopping point per operation: a human watching can undo an agent one action at a
				// time, which is the whole reason agent writes go through the live editor at all.
				editor.markHistoryStoppingPoint(`agent: node.insert`)
				id = def
					? createNodeShape(editor, def, point, props)
					: native && createNativeShape(editor, native, point, args.text)
			})
			if (!id) return fail('The node could not be created.')

			const shape = editor.getShape(id)
			if (!shape) return fail('The node was created but immediately vanished.')
			const label = def?.label ?? native?.label ?? args.type
			reportAgentWork(editor, 'create', 'node.insert', `Adding ${label.toLowerCase()}`, [id])
			return ok(shapeSummary(editor, shape, propertyDefs(editor)))
		},
	}),

	defineOperation({
		id: 'node.find',
		title: 'Find nodes',
		description:
			'Searches the shapes on a board and returns what matched, with their ids, labels, positions and property values. With no filters it returns everything. This is how to look at a board before changing it. Labels are titles only — a note’s label is its first line — so use node.get on a shape to read what it actually says.',
		readOnly: true,
		params: {
			query: {
				type: 'string',
				description: 'Case-insensitive substring of the shape’s label (its title or text).',
			},
			type: {
				type: 'string',
				description:
					'Only shapes of this type. Not a closed set, unlike node.insert’s: a board can hold types an extension no longer offers, and those still have to be findable.',
			},
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
			reportAgentWork(
				editor,
				'read',
				'node.find',
				matches.length === 1 ? 'Looking at 1 shape' : `Looking at ${matches.length} shapes`,
				matches.slice(0, limit).map((shape) => shape.id)
			)
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
			'One shape in full: type, label, position, size, every property value it carries, and its text — the actual body of a note, not just the title node.find shows. Use this to read what a node says before acting on it.',
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
			reportAgentWork(resolved.editor, 'read', 'node.get', 'Reading', [found.shape.id])
			return ok(
				shapeSummary(resolved.editor, found.shape, propertyDefs(resolved.editor), {
					includeText: true,
				})
			)
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
				const written = textPropsFor(shape.type, args.text)
				if (!written) return fail(`A "${shape.type}" shape does not hold text that can be set.`)
				Object.assign(props, written)
			}

			// Checked against the shape's *own* props rather than written blindly: tldraw's text shape
			// has no `h` (its height is measured) and a sticky has neither, so an unguarded write is a
			// validation error the agent reads as "the operation is broken" rather than "that shape
			// does not have a height".
			const sizeable = shape.props as Record<string, unknown>
			for (const [key, value] of [
				['w', args.w],
				['h', args.h],
			] as const) {
				if (value === undefined) continue
				if (!(key in sizeable)) {
					return fail(
						`A "${shape.type}" shape has no ${key} to set — its size comes from its content.`
					)
				}
				props[key] = value
			}

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
			reportAgentWork(editor, 'update', 'node.update', 'Editing', [shape.id])
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
			// Reported *before* the delete: the presence layer draws where the shape is, and a shape that
			// has already gone has nowhere to draw.
			reportAgentWork(editor, 'delete', 'node.delete', 'Removing', [found.shape.id])
			editor.run(() => {
				editor.markHistoryStoppingPoint('agent: node.delete')
				editor.deleteShape(found.shape.id)
			})
			return ok({ id: args.shapeId, label, deleted: true } satisfies JsonValue)
		},
	}),
]
