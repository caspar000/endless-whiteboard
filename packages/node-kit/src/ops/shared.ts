import type { Editor, TLShape, TLShapeId } from 'tldraw'
import { textPropFor } from '../nodes/insert'
import type { OperationContext, JsonValue, ParamSpec } from '../operations'
import { shapeLabel } from '../properties/labels'
import { readPropertyRegistry } from '../properties/schema'
import { readShapeProperties } from '../properties/values'
import type { PropertyDef } from '../properties/types'
import { getNodeDefinition } from '../registry'

/**
 * The pieces every operation needs and none of them should re-answer: which board am I acting on,
 * what does a shape look like as JSON, and which property did the caller mean.
 */

/**
 * Every board-touching operation takes this, so "which board" is one parameter with one meaning
 * everywhere rather than a convention each operation invents.
 */
export const BOARD_ID_PARAM: ParamSpec = {
	type: 'string',
	description:
		'Which board to act on. Omit to use the board currently open on screen. Passing one opens it if it is not already.',
}

export type EditorResult = { ok: true; editor: Editor } | { ok: false; error: string }

/**
 * Resolves the board an operation runs against.
 *
 * Opening is a real await, not a formality: tldraw mounts an editor asynchronously, and an operation
 * that wrote before the mount would write into nothing. Already-mounted boards skip it — including
 * ones behind hidden tabs, which is how an agent can touch a background board without stealing the
 * view from whoever is watching.
 */
export async function resolveEditor(
	ctx: OperationContext,
	boardId?: string
): Promise<EditorResult> {
	if (!boardId) {
		if (ctx.editor) return { ok: true, editor: ctx.editor }
		return {
			ok: false,
			error:
				'No board is open. Pass boardId, or open one first with board.open — board.list shows what exists.',
		}
	}

	const mounted = ctx.boards.editorFor(boardId)
	if (mounted) return { ok: true, editor: mounted }

	const opened = await ctx.boards.open(boardId)
	if (opened) return { ok: true, editor: opened }
	return { ok: false, error: `No board with id "${boardId}". Use board.list to see what exists.` }
}

export type ShapeResult = { ok: true; shape: TLShape } | { ok: false; error: string }

export function resolveShape(editor: Editor, shapeId: string): ShapeResult {
	const shape = editor.getShape(shapeId as TLShapeId)
	if (!shape) {
		return {
			ok: false,
			error: `No shape with id "${shapeId}" on this board. It may have been deleted; node.find lists what is there.`,
		}
	}
	return { ok: true, shape }
}

/**
 * A property named the way a caller would name it: by id, or by the name shown in the UI.
 *
 * Agents overwhelmingly pass the name — it is what they can see on a card — and property ids are
 * derived from names anyway (`propertyIdFromName`), so insisting on the id would be pedantry that
 * costs a round trip. Case-insensitive for the same reason.
 */
export function resolveProperty(
	defs: readonly PropertyDef[],
	nameOrId: string
): PropertyDef | undefined {
	const wanted = nameOrId.trim().toLowerCase()
	return (
		defs.find((def) => def.id.toLowerCase() === wanted) ??
		defs.find((def) => def.name.toLowerCase() === wanted)
	)
}

/**
 * How much of a node's text a single read will return.
 *
 * Generous, because the whole point is to let an agent *read* a note rather than guess at it from a
 * title — but bounded, because a node can hold a document and an unbounded read is a context-window
 * incident. A truncated read says so in the payload rather than silently handing back a prefix.
 */
export const MAX_TEXT_CHARS = 20_000

/**
 * A node's own text content, or `null` for a shape that holds none.
 *
 * Distinct from its **label**, and that distinction is the bug this exists to fix: a label is a
 * *derived title* — a markdown note's is its first heading, truncated — so an agent reading only
 * labels can see that a note is called "Finish the shopping list" and have no way to discover the
 * list inside it. Two different questions, two different fields.
 *
 * Our own node types answer through their declared text prop; anything else — a tldraw text shape,
 * a sticky — answers through the shape util, which is where tldraw keeps the same idea.
 */
export function shapeText(editor: Editor, shape: TLShape): string | null {
	const definition = getNodeDefinition(shape.type)
	if (definition) {
		const prop = textPropFor(definition)
		if (!prop) return null
		const value = (shape.props as Record<string, unknown>)[prop]
		return typeof value === 'string' ? value : null
	}
	return editor.getShapeUtil(shape).getText(shape) ?? null
}

export interface SummaryOptions {
	/**
	 * Include the node's full text.
	 *
	 * Off by default and opt-in per operation rather than always on: `node.find` can return 200
	 * shapes, and 200 note bodies is not a listing, it is a context-window incident. The operations
	 * that read *one* shape turn it on.
	 */
	includeText?: boolean
}

/**
 * A shape as an agent sees it: what it is, what it is called, where it sits, what it carries.
 *
 * Property values are returned with **both** the id and the name. The name is what the agent
 * reasoned about when it read the board; the id is what it must send back to change the value, and
 * two properties can legitimately share a display name.
 */
export function shapeSummary(
	editor: Editor,
	shape: TLShape,
	defs: readonly PropertyDef[],
	options: SummaryOptions = {}
): JsonValue {
	const bounds = editor.getShapePageBounds(shape.id)
	const values = readShapeProperties(shape)

	let text: JsonValue = null
	let truncated = false
	if (options.includeText) {
		const full = shapeText(editor, shape)
		if (full !== null) {
			truncated = full.length > MAX_TEXT_CHARS
			text = truncated ? full.slice(0, MAX_TEXT_CHARS) : full
		}
	}

	return {
		id: shape.id,
		type: shape.type,
		label: shapeLabel(editor, shape),
		// Present only when asked for, so a listing's rows keep the shape they have always had.
		...(options.includeText ? { text, ...(truncated ? { textTruncated: true } : {}) } : {}),
		x: bounds?.x ?? shape.x,
		y: bounds?.y ?? shape.y,
		w: bounds?.w ?? null,
		h: bounds?.h ?? null,
		properties: Object.entries(values).map(([id, value]) => ({
			id,
			name: resolveProperty(defs, id)?.name ?? id,
			value: (value ?? null) as JsonValue,
		})),
	}
}

/** The board's property definitions, for turning ids into names and back. */
export function propertyDefs(editor: Editor): PropertyDef[] {
	return readPropertyRegistry(editor)
}

/**
 * How many rows any listing operation will return at most.
 *
 * Not a detail: an uncapped `node.find` on a large board is a context-window incident, and an agent
 * that silently received half a board would reason confidently about the wrong thing. Every capped
 * result says how many actually matched, so the caller can tell it was truncated.
 */
export const MAX_RESULTS = 200
