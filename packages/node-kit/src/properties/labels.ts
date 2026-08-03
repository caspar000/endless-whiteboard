import type { Editor, TLAssetId, TLShape } from 'tldraw'
import { getNodeDefinition } from '../registry'

/**
 * A human-readable name for **any** shape, for grouped rollup output, table rows and pickers.
 *
 * Universal properties mean the facts pipeline now walks every shape on the board, not just the node
 * types we defined — so "what do I call this thing?" needs an answer for a sticky note, a photo and an
 * arrow too. The ladder tries the most specific source first:
 *
 * 1. The node definition's own `getLabel`, for our types.
 * 2. **`ShapeUtil.getText`**, which tldraw already implements for note (sticky), geo, text, frame,
 *    arrow, bookmark and embed. Reusing it rather than reaching into each shape's props means new
 *    tldraw shape types get labels for free, and the text shape's implementation memoises on its
 *    `richText` object, so this is a cache hit during a drag.
 * 3. The asset's filename, which is the only name an image has.
 * 4. Nothing. An unlabelled shape is a normal state, not an error.
 */
const MAX_LABEL_LENGTH = 120

export function shapeLabel(editor: Editor, shape: TLShape): string {
	const fromDefinition = getNodeDefinition(shape.type)?.getLabel?.(shape as never)
	if (fromDefinition) return truncate(fromDefinition)

	const fromShapeUtil = editor.getShapeUtil(shape).getText(shape)
	if (fromShapeUtil) return truncate(fromShapeUtil)

	const fromAsset = assetName(editor, shape)
	if (fromAsset) return truncate(fromAsset)

	return ''
}

function assetName(editor: Editor, shape: TLShape): string | undefined {
	const assetId = (shape.props as { assetId?: unknown }).assetId
	if (typeof assetId !== 'string') return undefined
	const asset = editor.getAsset(assetId as TLAssetId)
	const name = (asset?.props as { name?: unknown } | undefined)?.name
	return typeof name === 'string' && name ? name : undefined
}

/**
 * Truncation is not cosmetic here. A label goes into `ShapeFacts`, which is compared field-by-field on
 * every store change — so a text shape holding a page of prose would put that whole page into an
 * equality check that runs for every shape on the board.
 */
function truncate(text: string): string {
	const collapsed = text.replace(/\s+/g, ' ').trim()
	return collapsed.length > MAX_LABEL_LENGTH ? collapsed.slice(0, MAX_LABEL_LENGTH) : collapsed
}
