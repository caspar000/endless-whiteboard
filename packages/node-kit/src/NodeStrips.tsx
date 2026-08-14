import type { Editor } from 'tldraw'
import { CollectionStrip } from './collections/CollectionStrip'
import { PropertyStrip } from './properties/PropertyStrip'
import type { ShapeWithMeta } from './properties/values'

/**
 * The one way a shape presents its properties and collection — on a node card (the note, the book)
 * and below tldraw's own shapes (see the app's ForeignPropertyStrips).
 *
 * This wrapper exists so presentation is a single seam: every host renders `<NodeStrips>` and the
 * `.lb-node-strips` class owns the inset, which is what lets a future restyle of how properties
 * look reach every node — extensions included — without touching any of them. A node component
 * must not compose `PropertyStrip`/`CollectionStrip` directly, or it forks that seam.
 *
 * Renders an empty div when the shape carries nothing; `.lb-node-strips:empty` hides it, so hosts
 * don't need their own "has properties" check.
 */
export function NodeStrips({ shape, editor }: { shape: ShapeWithMeta; editor: Editor }) {
	return (
		<div className="lb-node-strips">
			<PropertyStrip shape={shape} editor={editor} />
			<CollectionStrip shape={shape} editor={editor} />
		</div>
	)
}
