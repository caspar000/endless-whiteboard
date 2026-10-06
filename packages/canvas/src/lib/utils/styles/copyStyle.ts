import { Editor, TLShape } from '@lifeboard/canvas-editor'

/**
 * Copies a shape's style (docs/fork-parity.md I7): the shape under the pointer, or failing that the
 * one selected. Its colour, fill, dash, size, font and the rest become the next shapes' styles, and any
 * other selected shapes take them too, in one undo step. Returns the shape it copied from.
 *
 * @public
 */
export function copyShapeStyle(editor: Editor): TLShape | null {
	const source = editor.getHoveredShape() ?? editor.getOnlySelectedShape()
	if (!source) return null
	const styles = editor.styleProps[source.type]
	if (!styles?.size) return null
	const targets = editor.getSelectedShapeIds().filter((id) => id !== source.id)
	const props = source.props as Record<string, unknown>
	editor.mark('copy style')
	editor.batch(() => {
		for (const [style, key] of styles) {
			if (!(key in props)) continue
			editor.setStyleForNextShapes(style, props[key])
			if (targets.length) editor.setStyleForSelectedShapes(style, props[key])
		}
	})
	return source
}
