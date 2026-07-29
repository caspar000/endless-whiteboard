import { T } from 'tldraw'
import type { NodeFacts } from '../../facts'
import { fieldValidator, type NodeField } from '../../fields'
import { emptyPropsMigrations } from '../../migrations'
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
	 * The rollup contract (§4.3). Note what is *absent*: x, y, rotation, selection. Facts change
	 * only when the item's data changes, which is what makes dragging free of rollup recomputes.
	 */
	extractFacts: (shape: NodeShape<ItemNodeProps>): NodeFacts => {
		const fields: Record<string, NodeField['value']> = {}
		const units: Record<string, string> = {}
		for (const field of shape.props.fields) {
			if (!field.key) continue
			fields[field.key] = field.value
			if (field.unit) units[field.key] = field.unit
		}
		return {
			type: ITEM_NODE_TYPE,
			parentId: shape.parentId ?? null,
			tags: shape.props.tags,
			fields,
			units,
			label: shape.props.title,
		}
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
