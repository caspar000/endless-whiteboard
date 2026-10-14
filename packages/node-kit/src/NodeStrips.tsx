import type { Editor } from '@lifeboard/canvas'
import { CollectionStrip } from './collections/CollectionStrip'
import { readPropertyLayout } from './properties/layout'
import { PropertyLayoutView } from './properties/PropertyLayoutView'
import { PropertyDisplay, PropertyStrip } from './properties/PropertyStrip'
import type { ShapeWithMeta } from './properties/values'
import { readPropertyView } from './properties/view'

/**
 * What a shape's property card shows: its properties in the shape's chosen view (source, its own
 * layout, or the automatic one), then its collection.
 *
 * The app's PropertyCards is the only host. It draws the card under every shape, ours and tldraw's
 * alike, so no node component renders this itself (docs/property-display-plan.md).
 *
 * Renders an empty div when the shape carries nothing; `.lb-node-strips:empty` hides it, and the
 * card hides with it.
 */
export function NodeStrips({ shape, editor }: { shape: ShapeWithMeta; editor: Editor }) {
	const layout = readPropertyLayout(shape)
	return (
		<div className="lb-node-strips">
			{readPropertyView(shape) === 'source' ? (
				<PropertyStrip shape={shape} editor={editor} />
			) : layout ? (
				<PropertyLayoutView shape={shape} editor={editor} layout={layout} />
			) : (
				<PropertyDisplay shape={shape} editor={editor} />
			)}
			<CollectionStrip shape={shape} editor={editor} />
		</div>
	)
}
