import { NodeStrips, hasCollection, hasStripsBelow } from '@lifeboard/node-kit'
import { useEditor, useValue, type Editor, type TLArrowShape, type TLShape } from 'tldraw'
import { arrowStripAnchor } from './arrowAnchor'

/**
 * Property strips drawn *outside* a shape rather than inside its card.
 *
 * Two kinds of shape need this, and they get the identical treatment (`hasStripsBelow`):
 *
 *  - **tldraw's own** — stickies, photos, rectangles, text, arrows — whose components we don't
 *    control, so a shape you gave a price to would otherwise carry invisible data: it would total
 *    correctly in a rollup while showing nothing at all.
 *  - **Our nodes that declare `strips: 'below'`** — a book, whose card is a cover image. Rows drawn
 *    on top of the artwork read as part of the jacket; below it they read as the shape's data, which
 *    is what they are.
 *
 * Text-surface nodes (the note, the table) still render their own strips inline, where they belong
 * in the layout and where auto-height measures them.
 *
 * **An arrow is placed differently from everything else** (see `arrowAnchor.ts`): under the middle of
 * the line, not at the corner of its bounding box, because a line does not pass through the corners
 * of the box that contains it.
 *
 * Rendered through `OnTheCanvas`, which is inside the camera transform — so a strip pans, zooms and
 * moves with its shape without any of it being computed here.
 *
 * This is a *view* concern and deliberately outside the facts pipeline (§4.3): it is expected to
 * re-render when shapes move, which is precisely what rollups must not do.
 */

interface StripTarget {
	id: string
	x: number
	y: number
	/** The shape's width, so the strip matches it. Absent for an arrow: it is centred and hugs. */
	w?: number
}

/**
 * Under the middle of the arrow, in page coordinates.
 *
 * The anchor is in the shape's own space — geometry always is — so it has to go through the shape's
 * page transform, which is also what makes a rotated or scaled arrow come out right.
 */
function arrowTarget(editor: Editor, shape: TLArrowShape): StripTarget | null {
	const geometry = editor.getShapeGeometry(shape)
	if (!geometry) return null
	const anchor = arrowStripAnchor(geometry, shape.props.labelPosition)
	const page = editor.getShapePageTransform(shape.id)?.applyToPoint(anchor)
	if (!page) return null
	return { id: shape.id, x: page.x, y: page.y }
}

function boundsTarget(editor: Editor, shape: TLShape): StripTarget | null {
	const bounds = editor.getShapePageBounds(shape.id)
	if (!bounds) return null
	return { id: shape.id, x: bounds.x, y: bounds.y + bounds.h, w: bounds.w }
}

export function ForeignPropertyStrips() {
	const editor = useEditor()

	const targets = useValue(
		'lifeboard:foreign-strips',
		() => {
			const out: StripTarget[] = []
			for (const shape of editor.getCurrentPageShapes()) {
				// Nodes that draw their properties inside their own card are not ours to place.
				if (!hasStripsBelow(shape.type)) continue
				// Cheap pre-filter before asking for bounds, which is the expensive part: the
				// overwhelming majority of shapes on a board carry neither.
				if (!shape.meta['lifeboard:props'] && !hasCollection(shape)) continue
				// A hidden relation takes its properties with it. `getCurrentPageShapes` still returns a
				// hidden shape — that is exactly what keeps a hidden relation an edge — so this layer
				// has to ask, or hiding an arrow would leave its `Amount · 200 g` stranded on the canvas
				// with no line under it.
				if (editor.isShapeHidden(shape)) continue
				const target =
					shape.type === 'arrow'
						? arrowTarget(editor, shape as TLArrowShape)
						: boundsTarget(editor, shape)
				if (target) out.push(target)
			}
			return out
		},
		[editor]
	)

	if (!targets.length) return null

	return (
		<>
			{targets.map((target) => (
				<ForeignStrip key={target.id} editor={editor} target={target} />
			))}
		</>
	)
}

function ForeignStrip({ editor, target }: { editor: Editor; target: StripTarget }) {
	// Read the shape rather than closing over it, so a property edit re-renders just this strip.
	const shape = useValue(
		`lifeboard:strip-${target.id}`,
		() => editor.getShape(target.id as never),
		[editor, target.id]
	)
	if (!shape) return null

	const onArrow = target.w === undefined

	return (
		<div
			className={onArrow ? 'lb-foreign-strip lb-foreign-strip--arrow' : 'lb-foreign-strip'}
			style={{
				// Page coordinates: `OnTheCanvas` already sits inside the camera transform. The arrow's
				// anchor is a point on a line rather than a corner, so the strip is pulled back by half
				// its own width to hang centred under it — a width nothing here has to know.
				transform: onArrow
					? `translate(${target.x}px, ${target.y}px) translateX(-50%)`
					: `translate(${target.x}px, ${target.y}px)`,
				...(target.w === undefined ? {} : { width: target.w }),
				/*
				 * In front of the shapes, which only the arrow's strip needs to be.
				 *
				 * `OnTheCanvas` is inside the camera transform but painted *before* tldraw's shapes, so
				 * by default the arrow is drawn over its own card and the line cuts through the values.
				 * A strip under a shape never has this problem — it has paper behind it.
				 *
				 * The number is tldraw's, not a guess: shapes are given z-indices starting at
				 * `maxShapesPerPage * 2` and counting up, so one page of them cannot reach `* 3`. Both
				 * layers live inside `.tl-shapes`, which is itself a stacking context, so this cannot
				 * climb over the selection overlays or the UI however large it is.
				 */
				...(onArrow ? { zIndex: editor.options.maxShapesPerPage * 3 } : {}),
			}}
		>
			<NodeStrips shape={shape} editor={editor} />
		</div>
	)
}
