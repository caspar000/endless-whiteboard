import { T } from 'tldraw'
import { emptyPropsMigrations } from '../../migrations'
import type { NodeDefinition } from '../../registry'
import { AGG_OPS, FORMAT_STYLES, SOURCE_SCOPES, type RollupAgg, type RollupFormat, type RollupSource } from './aggregate'
import { RollupNodeComponent } from './RollupNodeComponent'

export const ROLLUP_NODE_TYPE = 'node.rollup'

export interface RollupNodeProps {
	title: string
	source: RollupSource
	agg: RollupAgg
	format: RollupFormat
}

export const rollupNodeDefinition: NodeDefinition<RollupNodeProps> = {
	type: ROLLUP_NODE_TYPE,
	label: 'Rollup',
	icon: 'Σ',
	props: {
		title: T.string,
		// Structured spec, deliberately not a formula string (§2.3): structured specs migrate
		// forward, hand-written formula strings would need a parser to migrate backward.
		source: T.object({
			scope: T.literalEnum(...SOURCE_SCOPES),
			frameId: T.string.nullable(),
			tags: T.arrayOf(T.string),
			nodeType: T.string.nullable(),
		}),
		agg: T.object({
			op: T.literalEnum(...AGG_OPS),
			fieldKey: T.string.nullable(),
			groupBy: T.string.nullable(),
		}),
		format: T.object({
			style: T.literalEnum(...FORMAT_STYLES),
			unit: T.string.optional(),
		}),
	},
	migrations: emptyPropsMigrations(),
	defaultProps: () => ({
		title: 'Total',
		// `nodeType: null` — **anything** carrying the chosen property counts, which is the whole point
		// of universal properties: a price on a photo is the same kind of fact as a price on a note.
		// It also has to be null now that the item node is retired: defaulting to a type nothing has any
		// more meant a freshly drawn rollup silently totalled zero.
		source: { scope: 'page' as const, frameId: null, tags: [], nodeType: null },
		agg: { op: 'sum' as const, fieldKey: null, groupBy: null },
		format: { style: 'currency' as const },
	}),
	defaultSize: { w: 280, h: 180 },
	component: RollupNodeComponent,
	canEdit: true,
	// No `extractFacts`: rollups of rollups would need cycle detection to be safe. Deferred until
	// there's a real use case — adding it later is one method on this object.
}
