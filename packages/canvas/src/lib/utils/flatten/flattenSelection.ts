import { Editor, TLImageShape, TLShapeId, createShapeId } from '@lifeboard/canvas-editor'

/**
 * Flattens the selection into one picture (docs/fork-parity.md B11): drawn as it shows, at twice its
 * size for a sharp result, stored as any dropped picture is, and put where the shapes were, at their
 * size, in their place. One undo step brings the shapes back. Returns the new image's id.
 *
 * @public
 */
export async function flattenSelection(editor: Editor): Promise<TLShapeId | null> {
	const ids = editor.getSelectedShapeIds().filter((id) => !editor.isShapeOrAncestorLocked(id))
	const bounds = editor.getSelectionPageBounds()
	if (!ids.length || !bounds) return null

	const { blob } = await editor.toImage(ids, { format: 'png', background: false, padding: 0, pixelRatio: 2 })
	const file = new File([blob], 'flattened.png', { type: 'image/png' })
	const asset = await editor.getAssetForExternalContent({ type: 'file', file })
	if (!asset) return null

	// Where the lowest of them was, so the picture sits at their depth.
	const lowest = [...editor.getSelectedShapes()].sort((a, b) => (a.index < b.index ? -1 : 1))[0]!
	const id = createShapeId()
	editor.mark('flatten')
	editor.batch(() => {
		if (!editor.getAsset(asset.id)) editor.createAssets([asset])
		editor.createShape<TLImageShape>({
			id,
			type: 'image',
			x: bounds.minX,
			y: bounds.minY,
			props: { assetId: asset.id, w: bounds.width, h: bounds.height },
		})
		if (lowest.parentId === editor.getCurrentPageId()) editor.updateShape({ id, type: 'image', index: lowest.index })
		editor.deleteShapes(ids)
		editor.select(id)
	})
	return id
}
