import { CollectionStrip, PropertyStrip, hasCollection, isNodeType } from '@lifeboard/node-kit'
import { useEditor, useValue } from 'tldraw'

/**
 * Property strips for shapes that can't render their own.
 *
 * Our node types put their properties inside the card, where they belong in the layout and where
 * auto-height measures them. tldraw's own shapes — stickies, photos, rectangles, text — render
 * components we don't control, so a shape you gave a price to would carry invisible data: it would
 * total correctly in a rollup while showing nothing at all. That is the worst of both worlds, so the
 * app draws the strip underneath them instead.
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
				// Our own nodes draw their properties themselves.
				if (isNodeType(shape.type)) continue
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
			<PropertyStrip shape={shape} editor={editor} />
			<CollectionStrip shape={shape} editor={editor} />
		</div>
	)
}
