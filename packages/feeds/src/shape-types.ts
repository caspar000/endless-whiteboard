import type { NodeBaseProps } from '@lifeboard/node-kit'
import type { FeedProps } from './board'

/**
 * Registers the feed's node type with tldraw's closed `TLShape` union, the same pattern every
 * compile-time package follows. Imported for its side effect by `src/index.ts`.
 */
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'node.feed': FeedProps & NodeBaseProps
	}
}
