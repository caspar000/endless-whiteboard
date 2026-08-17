import type { Box, Editor, TLShape, TLShapeId } from 'tldraw'
import { defineOperation, fail, ok, type RegisteredOperation } from '../operations'
import {
	RELATION_VIEWS,
	RELATION_VIEW_NOTES,
	readRelationView,
	setRelationView,
} from '../relationView'
import {
	BOARD_ID_PARAM,
	propertyDefs,
	reportAgentWork,
	resolveEditor,
	shapeSummary,
} from './shared'

/**
 * Showing the person watching what just happened — and letting the agent see the board back.
 *
 * Not decoration. The reason agent writes go through the live editor at all is that somebody is
 * looking at the board while they land — and an agent that fills a corner of an endless canvas
 * off-screen has done invisible work. These are how it points.
 *
 * `view.look` runs the other way, and is the one that changes what an agent *is*: everything else
 * here describes a board in JSON, which cannot say what a photograph shows, whether two columns line
 * up, or what somebody sketched. Rendering the board and handing back the pixels is the only answer
 * to that, and it is the same one every design agent worth using arrived at.
 */

/** What `view.look` can be pointed at when it is not given specific shapes. */
const LOOK_REGIONS = ['board', 'viewport', 'selection'] as const

/**
 * Longest side of the rendered image, in pixels.
 *
 * The number is a token budget, not a taste call: a model is charged roughly by pixel count, so a
 * board rendered at its natural size would be an expensive way to answer "which of these is the
 * cat photo". 1200 is legible for text at a glance and costs about 1.5k tokens.
 */
const DEFAULT_LOOK_SIZE = 1200
const MIN_LOOK_SIZE = 200
const MAX_LOOK_SIZE = 2400

/**
 * The ceiling on the encoded image. Anthropic refuses one over 5 MB; stopping short of it leaves room
 * for the rest of the message, and a picture that arrives is worth more than one that was perfect.
 */
const MAX_IMAGE_BASE64 = 3.5 * 1024 * 1024

/**
 * How much to shrink the render by, so its longest side lands on `size`.
 *
 * Never *up*: a single sticky rendered at 6× would be a blurry 1200px image of something that is
 * genuinely 200px, and the agent would be paying six times over for the interpolation.
 *
 * Exported for its test — the arithmetic is the part that decides both cost and legibility.
 */
export function lookScale(bounds: { w: number; h: number }, size: number): number {
	const longest = Math.max(bounds.w, bounds.h)
	if (!Number.isFinite(longest) || longest <= 0) return 1
	return Math.min(1, size / longest)
}

/** Base64 without the `data:` prefix, which is what both content-block formats want. */
async function toBase64(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer())
	// Chunked: `String.fromCharCode(...bytes)` on a megabyte-long array overflows the call stack.
	const CHUNK = 0x8000
	let binary = ''
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
	}
	return btoa(binary)
}

/**
 * The box these shapes span, in page coordinates, or `null` if none of them can be measured.
 *
 * Computed rather than taken from `Box.Common` so it holds against the operation tests' editor, which
 * answers `getShapePageBounds` with a plain rectangle. Only the size is used — the render decides its
 * own origin.
 */
function spannedBounds(editor: Editor, shapes: TLShape[]): { w: number; h: number } | null {
	const boxes = shapes.flatMap((shape) => {
		const bounds = editor.getShapePageBounds(shape.id)
		return bounds ? [bounds] : []
	})
	if (!boxes.length) return null
	const left = Math.min(...boxes.map((box) => box.x))
	const top = Math.min(...boxes.map((box) => box.y))
	const right = Math.max(...boxes.map((box) => box.x + box.w))
	const bottom = Math.max(...boxes.map((box) => box.y + box.h))
	return { w: right - left, h: bottom - top }
}

type LookTarget = { ok: true; shapes: TLShape[]; bounds?: Box; described: string } | { ok: false; error: string }

/**
 * What to render: the shapes named, the selection, what is on screen, or the whole board.
 *
 * The viewport case also returns explicit `bounds`, so the render is cropped to exactly what the
 * person is looking at rather than to the shapes that happen to poke into it — "show me what I can
 * see" is a question about the window, not about the shapes.
 */
function lookTarget(editor: Editor, region: string, shapeIds: string[] | undefined): LookTarget {
	if (shapeIds?.length) {
		const found = shapeIds.map((id) => editor.getShape(id as TLShapeId))
		const missing = shapeIds.filter((_, i) => !found[i])
		const shapes = found.filter((shape): shape is TLShape => shape !== undefined)
		if (!shapes.length) return { ok: false, error: `None of those shapes are on this board: ${shapeIds.join(', ')}.` }
		return {
			ok: true,
			shapes,
			described: missing.length ? `${shapes.length} shapes (${missing.length} no longer exist)` : `${shapes.length} shapes`,
		}
	}

	if (region === 'selection') {
		const shapes = editor.getSelectedShapes()
		if (!shapes.length) {
			return {
				ok: false,
				error: 'Nothing is selected on this board. Pass shapeIds, or use region "viewport" or "board".',
			}
		}
		return { ok: true, shapes, described: 'the selection' }
	}

	if (region === 'viewport') {
		const bounds = editor.getViewportPageBounds()
		const shapes = editor
			.getCurrentPageShapes()
			.filter((shape) => editor.getShapePageBounds(shape.id)?.collides(bounds))
		if (!shapes.length) {
			return { ok: false, error: 'There is nothing on screen. Use region "board", or zoom to fit first.' }
		}
		return { ok: true, shapes, bounds, described: 'what is on screen' }
	}

	const shapes = editor.getCurrentPageShapes()
	if (!shapes.length) return { ok: false, error: 'This board is empty — there is nothing to look at.' }
	return { ok: true, shapes, described: 'the whole board' }
}

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
			reportAgentWork(editor, 'read', 'view.select', 'Pointing at this', present)

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
		id: 'view.look',
		title: 'Look at the board',
		description: [
			'Renders the board — or some shapes on it — to a picture and hands it back, so you can see it rather than infer it from coordinates.',
			'Use this whenever the answer depends on what something *looks like*: what a photo or diagram shows, whether a layout is aligned or overlapping, what somebody drew by hand, or what colour things are.',
			'Pass shapeIds to look at particular shapes (this is how to see an image on the board), or region: "viewport" for what the user can see right now, "selection" for what they have selected, "board" for everything. Costs tokens like any image, so look once at the right thing rather than repeatedly at everything.',
		].join(' '),
		readOnly: true,
		params: {
			shapeIds: {
				type: 'string[]',
				description:
					'The shapes to render, from node.find. A single id may be passed on its own. Omit to use region.',
			},
			region: {
				type: 'string',
				description:
					'What to render when no shapeIds are given. "board" (the default) is everything, "viewport" is what is on screen, "selection" is what the user has selected.',
				choices: LOOK_REGIONS,
			},
			size: {
				type: 'number',
				description: `Longest side of the returned image in pixels — between ${MIN_LOOK_SIZE} and ${MAX_LOOK_SIZE}, ${DEFAULT_LOOK_SIZE} by default. Larger reads finer detail and costs more.`,
			},
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor

			const region = args.region ?? 'board'
			const target = lookTarget(editor, region, args.shapeIds)
			if (!target.ok) return fail(target.error)

			const size = Math.min(Math.max(args.size ?? DEFAULT_LOOK_SIZE, MIN_LOOK_SIZE), MAX_LOOK_SIZE)
			const bounds = target.bounds ?? spannedBounds(editor, target.shapes)
			let scale = lookScale(bounds ?? { w: size, h: size }, size)

			reportAgentWork(
				editor,
				'look',
				'view.look',
				`Looking at ${target.described}`,
				target.shapes.map((shape) => shape.id)
			)

			// Two attempts at most. A board dense enough to blow the size ceiling at 1200px is rare, and
			// halving once is the difference between a picture the model can read and no picture at all —
			// but a loop that keeps halving would answer "your board is complicated" with a thumbnail.
			for (let attempt = 0; attempt < 2; attempt++) {
				const rendered = await editor.toImage(target.shapes, {
					format: 'png',
					background: true,
					scale,
					// One device pixel per rendered pixel, so `size` means what it says. tldraw's default
					// of 2 would quadruple the token cost of every look without being asked.
					pixelRatio: 1,
					// Cropped exactly to the window when that is what was asked for; otherwise a small
					// margin, so a shape's own outline is not shaved off at the edge of the picture.
					padding: target.bounds ? 0 : 16,
					...(target.bounds ? { bounds: target.bounds } : {}),
				})

				const data = await toBase64(rendered.blob)
				if (data.length <= MAX_IMAGE_BASE64) {
					return ok(
						{
							rendered: target.described,
							shapes: target.shapes.length,
							width: rendered.width,
							height: rendered.height,
							scale: Number(scale.toFixed(3)),
						},
						[{ mediaType: 'image/png', data }]
					)
				}
				scale = scale / 2
			}

			return fail(
				'That render came out too large to send even at half size. Look at fewer shapes, or pass a smaller size.'
			)
		},
	}),

	defineOperation({
		id: 'view.selection',
		title: 'Read the selection',
		description:
			'What the user has selected on screen right now, with the same detail node.find returns. This is how to answer "these ones" — when someone says "name these images" or "tidy this up", the selection is what they are pointing at. Returns an empty list when nothing is selected.',
		readOnly: true,
		params: { boardId: BOARD_ID_PARAM },
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor

			const shapes = editor.getSelectedShapes()
			const defs = propertyDefs(editor)
			return ok({
				selected: shapes.length,
				shapes: shapes.map((shape) => shapeSummary(editor, shape, defs)),
			})
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
