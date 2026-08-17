import { createShapeId, toRichText, type Editor, type TLShapeId } from 'tldraw'

/**
 * tldraw's own shapes, offered to an agent beside the registered node types.
 *
 * A whiteboard is not only smart nodes. A person reaching for a board writes a loose caption, sticks
 * a sticky on it and draws a box round the lot — and an agent that can only create `node.*` types has
 * to answer "put a title above that" with a markdown note, which is a document where a word was
 * wanted. `node.types` said "Available: node.markdown, node.table, …" and the model believed it.
 *
 * Deliberately **not** entries in the node registry. That registry is the editor's *schema* — every
 * definition in it is turned into a `ShapeUtil` by `createNodeShapeUtil` — so registering `text` there
 * would replace tldraw's own text shape with a broken imitation of it. These shapes already have
 * utils, already migrate, already export; the only thing missing was a description of how to make one.
 * So this is a small table of exactly that, read by the same three operations that read the registry.
 *
 * Adding a row is the whole cost of offering another built-in (`line`, `highlight`, …). Arrows are
 * pointedly absent: an arrow between two shapes is a *binding*, which is what `relation.connect`
 * already draws properly.
 */
export interface NativeShapeSpec {
	/** tldraw's shape type, which is also the value an agent passes to `node.insert`. */
	type: string
	/** What to call it when offering the choice — "Text", "Sticky note". */
	label: string
	/** When to reach for this one rather than a node. Shown to the agent by `node.types`. */
	note: string
	/**
	 * Nominal size, used only to place the shape before its real bounds exist. A text shape's width
	 * comes from measuring the text and a sticky's height grows with it, so this is a starting point
	 * rather than a promise — `createNativeShape` re-centres on what the shape actually turned out to be.
	 */
	defaultSize: { w: number; h: number }
	/**
	 * This shape's text, as its own props — or `null` for one that holds none.
	 *
	 * Different shapes keep text in different places, and that is the point of the function: a sticky
	 * and a text shape hold rich text, while a frame's "text" is its title. One caller, three answers.
	 */
	textProps: ((text: string) => Record<string, unknown>) | null
	/** Props every instance is created with — a size, for the shapes that have one. */
	createProps?: Record<string, unknown>
}

/** Rich text is the shape both text-bearing built-ins use, so the conversion is written once. */
const richTextProps = (text: string) => ({ richText: toRichText(text) })

export const NATIVE_SHAPES: readonly NativeShapeSpec[] = [
	{
		type: 'text',
		label: 'Text',
		note: 'Plain text straight on the board, with no card around it — headings, captions, labels. Its width follows the text.',
		defaultSize: { w: 220, h: 32 },
		textProps: richTextProps,
	},
	{
		type: 'note',
		label: 'Sticky note',
		note: 'A square sticky. Right for a short thought in a cluster of them; a markdown note is the one that holds a document.',
		defaultSize: { w: 200, h: 200 },
		textProps: richTextProps,
	},
	{
		type: 'geo',
		label: 'Rectangle',
		note: 'A plain box, optionally with a label in it — a container, a swimlane, a background block behind a group.',
		defaultSize: { w: 240, h: 160 },
		textProps: richTextProps,
		createProps: { geo: 'rectangle', w: 240, h: 160 },
	},
	{
		type: 'frame',
		label: 'Frame',
		note: 'A titled region that shapes inside it belong to and move with. Its text is its title.',
		defaultSize: { w: 600, h: 420 },
		textProps: (text: string) => ({ name: text }),
		createProps: { w: 600, h: 420 },
	},
]

const byType = new Map(NATIVE_SHAPES.map((spec) => [spec.type, spec]))

export function getNativeShape(type: string): NativeShapeSpec | undefined {
	return byType.get(type)
}

/**
 * Puts one of tldraw's own shapes on the board, centred on `point`.
 *
 * The re-centre after creation is the part worth keeping: a text shape's width is *measured*, not
 * declared, so subtracting half of `defaultSize` before creating it would leave every caption
 * noticeably off from where the agent asked for it. Reading the bounds back and correcting is the
 * only way to centre a shape whose size it does not decide.
 *
 * Both writes are inside one `editor.run`, so the correction never lands as a second undo entry.
 */
export function createNativeShape(
	editor: Editor,
	spec: NativeShapeSpec,
	point: { x: number; y: number },
	text?: string
): TLShapeId {
	const id = createShapeId()
	const props = {
		...spec.createProps,
		...(text !== undefined && spec.textProps ? spec.textProps(text) : {}),
	}

	editor.run(() => {
		editor.createShapes([
			// tldraw's `TLShapePartial` is a closed union keyed by shape type, and `spec.type` is a
			// string — the same mismatch `createNodeShape` casts through, for the same reason.
			{ id, type: spec.type, x: point.x, y: point.y, props } as never,
		])

		const bounds = editor.getShapePageBounds(id)
		const size = bounds ?? spec.defaultSize
		editor.updateShape({
			id,
			type: spec.type,
			x: point.x - size.w / 2,
			y: point.y - size.h / 2,
		} as never)
	})

	return id
}
