import { T } from 'tldraw'
import { fieldValidator, type NodeField } from '../../fields'
import { emptyPropsMigrations } from '../../migrations'
import { TAGS_PROPERTY_ID, type PropertyValue } from '../../properties/types'
import type { ShapeProperties } from '../../properties/values'
import type { NodeDefinition, NodeShape } from '../../registry'
import { ItemNodeComponent } from './ItemNodeComponent'

export const ITEM_NODE_TYPE = 'node.item'

export interface ItemNodeProps {
	title: string
	/** References a `TLAsset`; the blob itself lives in the BlobStore, never inline (§4.4). */
	imageAssetId: string | null
	tags: string[]
	fields: NodeField[]
}

export const itemNodeDefinition: NodeDefinition<ItemNodeProps> = {
	type: ITEM_NODE_TYPE,
	label: 'Item',
	icon: '▤',
	props: {
		title: T.string,
		imageAssetId: T.string.nullable(),
		tags: T.arrayOf(T.string),
		fields: T.arrayOf(fieldValidator),
	},
	migrations: emptyPropsMigrations(),
	defaultProps: () => ({
		title: '',
		imageAssetId: null,
		tags: [],
		fields: [],
	}),
	defaultSize: { w: 220, h: 260 },
	component: ItemNodeComponent,
	canEdit: true,
	/**
	 * **Retired.** Still registered, because unregistering a shape type makes any surviving record a
	 * *validation* failure rather than a stale one — `createShapeRecordType` builds its validator as a
	 * union over registered types, so a board would fail to open before the store migration got a chance
	 * to repair it. Hidden from the toolbar, the canvas tools and the create menu instead.
	 *
	 * In practice no board reaches the app with an item on it: `itemsToNotesMigrations` converts them
	 * before validation on every load path. This registration is the belt to that braces.
	 */
	deprecated: true,

	/**
	 * The rollup contract (§4.3). Note what is *absent*: x, y, rotation, selection. Facts change
	 * only when the item's data changes, which is what makes dragging free of rollup recomputes.
	 */
	getLabel: (shape) => shape.props.title,
	/**
	 * The legacy route: an item's values live in `props.fields`, not in `shape.meta`, so they have to be
	 * projected. The item→note migration moves them into meta for good, after which this is dead code
	 * and the node type can be retired.
	 */
	extractValues: (shape: NodeShape<ItemNodeProps>): ShapeProperties => {
		const values: Record<string, PropertyValue> = {}
		for (const field of shape.props.fields) {
			if (!field.key) continue
			values[field.key] = field.value
		}
		// Tags were a separate concept; as a property they are just a multi-select value. `TAGS_PROPERTY_ID`
		// is the id the migration creates, so a rollup keeps working across the migration.
		if (shape.props.tags.length) values[TAGS_PROPERTY_ID] = shape.props.tags
		return values
	},
}

/**
 * "Duplicate as template" (§4.2): copies field keys, types and units but clears values. Field-key
 * consistency across items is a UX concern, not a schema constraint — items stay self-contained so
 * copy/paste, export and future sync remain trivially correct.
 */
export function toTemplateFields(fields: readonly NodeField[]): NodeField[] {
	return fields.map((f) => ({
		key: f.key,
		type: f.type,
		value: f.type === 'checkbox' ? false : null,
		...(f.unit ? { unit: f.unit } : {}),
	}))
}
