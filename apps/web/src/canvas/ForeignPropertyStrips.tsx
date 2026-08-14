import { NodeStrips, hasCollection, hasStripsBelow } from '@lifeboard/node-kit'
import { useEditor, useValue } from 'tldraw'

/**
 * Property strips drawn *under* a shape rather than inside its card.
 *
 * Two kinds of shape need this, and they get the identical treatment (`hasStripsBelow`):
 *
 *  - **tldraw's own** — stickies, photos, rectangles, text — whose components we don't control, so a
 *    shape you gave a price to would otherwise carry invisible data: it would total correctly in a
 *    rollup while showing nothing at all.
 *  - **Our nodes that declare `strips: 'below'`** — a book, whose card is a cover image. Rows drawn
 *    on top of the artwork read as part of the jacket; below it they read as the shape's data, which
 *    is what they are.
 *
 * Text-surface nodes (the note, the table) still render their own strips inline, where they belong
 * in the layout and where auto-height measures them.
 *
 * Rendered through `OnTheCanvas`, which is inside the camera transform — so a strip pans, zooms and
 * moves with its shape without any of it being computed here.
 *
 * This is a *view* concern and deliberately outside the facts pipeline (§4.3): it is expected to
 * re-render when shapes move, which is precisely what rollups must not do.
 */
export function ForeignPropertyStrips() {
	const editor = useEditor()

	const targets = useValue(
		'lifeboard:foreign-strips',
		() => {
			const out: { id: string; x: number; y: number; w: number }[] = []
			for (const shape of editor.getCurrentPageShapes()) {
				// Nodes that draw their properties inside their own card are not ours to place.
				if (!hasStripsBelow(shape.type)) continue
				// Cheap pre-filter before asking for bounds, which is the expensive part: the
				// overwhelming majority of shapes on a board carry neither.
				if (!shape.meta['lifeboard:props'] && !hasCollection(shape)) continue
				const bounds = editor.getShapePageBounds(shape.id)
				if (!bounds) continue
				out.push({ id: shape.id, x: bounds.x, y: bounds.y + bounds.h, w: bounds.w })
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

function ForeignStrip({
	editor,
	target,
}: {
	editor: ReturnType<typeof useEditor>
	target: { id: string; x: number; y: number; w: number }
}) {
	// Read the shape rather than closing over it, so a property edit re-renders just this strip.
	const shape = useValue(
		`lifeboard:strip-${target.id}`,
		() => editor.getShape(target.id as never),
		[editor, target.id]
	)
	if (!shape) return null

	return (
		<div
			className="lb-foreign-strip"
			style={{
				// Page coordinates: `OnTheCanvas` already sits inside the camera transform.
				transform: `translate(${target.x}px, ${target.y}px)`,
				width: target.w,
			}}
		>
			<NodeStrips shape={shape} editor={editor} />
		</div>
	)
}
