import type { ItemNodeProps } from './nodes/item/definition'
import type { MarkdownNodeProps } from './nodes/markdown/definition'
import type { NodeBaseProps } from './registry'
import type { RollupNodeProps } from './nodes/rollup/definition'
import type { TableNodeProps } from './nodes/table/spec'

/**
 * tldraw 5 made `TLShape` a *closed* union derived from `TLGlobalShapePropsMap`. Custom shapes are
 * registered into the type system by augmenting that interface — this is the sanctioned mechanism
 * (see the `TLGlobalShapePropsMap` docs in `@tldraw/tlschema`).
 *
 * Doing so buys real safety in app code: `editor.updateShape({ type: 'node.item', props: … })`
 * checks its props, and `shape.type === 'node.rollup'` narrows `shape.props` to `RollupNodeProps`.
 *
 * Note the boundary this creates for the future plugin SDK (§4.1): a *runtime*-loaded plugin cannot
 * augment a compile-time interface, so plugin-supplied definitions will work through the generic
 * `NodeShape<Props>` structural type instead. That is exactly why `createNodeShapeUtil` is written
 * against the structural type and casts once at the tldraw boundary, rather than depending on this
 * augmentation — the built-in nodes get precise types, and plugins still work.
 *
 * Importing this module for side effects is what activates the augmentation; `src/index.ts` does so.
 */
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'node.markdown': MarkdownNodeProps & NodeBaseProps
		'node.item': ItemNodeProps & NodeBaseProps
		'node.rollup': RollupNodeProps & NodeBaseProps
		'node.table': TableNodeProps & NodeBaseProps
	}
}
