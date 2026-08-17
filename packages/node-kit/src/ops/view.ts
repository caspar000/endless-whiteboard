import type { TLShapeId } from 'tldraw'
import { defineOperation, fail, ok, type RegisteredOperation } from '../operations'
import {
	RELATION_VIEWS,
	RELATION_VIEW_NOTES,
	readRelationView,
	setRelationView,
} from '../relationView'
import { BOARD_ID_PARAM, resolveEditor } from './shared'

/**
 * Showing the person watching what just happened.
 *
 * Not decoration. The reason agent writes go through the live editor at all is that somebody is
 * looking at the board while they land — and an agent that fills a corner of an endless canvas
 * off-screen has done invisible work. These are how it points.
 */
export const viewOperations: RegisteredOperation[] = [
	defineOperation({
		id: 'view.select',
		title: 'Select shapes',
		description:
			'Selects shapes and, unless told not to, moves the view to them. Use it after creating or changing things so the person watching can see what was done.',
		params: {
			shapeIds: {
				type: 'string[]',
				description: 'The shapes to select. A single id may be passed on its own.',
				required: true,
			},
			zoom: {
				type: 'boolean',
				description: 'Move the camera to fit the selection. Defaults to true.',
			},
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor

			const present = args.shapeIds.filter((id) => editor.getShape(id as TLShapeId))
			const missing = args.shapeIds.filter((id) => !editor.getShape(id as TLShapeId))
			if (!present.length) {
				return fail(`None of those shapes are on this board: ${args.shapeIds.join(', ')}.`)
			}

			editor.select(...(present as TLShapeId[]))
			if (args.zoom !== false) editor.zoomToSelection()

			// Partial success is reported, not silently rounded up to success: an agent that asked for
			// five shapes and moved three needs to know which two went missing.
			return ok({ selected: present, missing })
		},
	}),

	defineOperation({
		id: 'view.relations',
		title: 'Show or hide the board’s relations',
		description: [
			'How much of a board’s wiring is drawn. This is a view of the board, not a change to it — no relation is created, deleted or altered, and everything that follows arrows keeps working either way.',
			`"none" — ${RELATION_VIEW_NOTES.none}`,
			`"normal" — ${RELATION_VIEW_NOTES.normal}`,
			`"all" — ${RELATION_VIEW_NOTES.all}`,
			'Set "all" before showing someone a board whose relations are hidden, or they will be looking at wiring that isn’t there.',
		].join(' '),
		params: {
			view: {
				type: 'string',
				description: 'Which of the three states to put the board in.',
				required: true,
				choices: RELATION_VIEWS,
			},
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor

			// `args.view` is already narrowed to the three states: `choices` both validates the
			// argument and types it, so an unknown value fails before `run` is ever reached.
			const before = readRelationView(editor)
			setRelationView(editor, args.view)
			return ok({ view: args.view, previous: before })
		},
	}),

	defineOperation({
		// Deliberately the same id as the existing `view.zoom-fit` *command*: one capability, one
		// name, in whichever table you reach it from.
		id: 'view.zoom-fit',
		title: 'Zoom to fit',
		description: 'Frames everything on the board, so the whole thing is visible at once.',
		params: { boardId: BOARD_ID_PARAM },
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			resolved.editor.zoomToFit()
			return ok({ zoomed: true })
		},
	}),
]
