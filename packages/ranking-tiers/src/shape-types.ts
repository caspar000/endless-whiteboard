import type { NodeBaseProps } from '@lifeboard/node-kit'
import type { RankingProps } from './props'

/**
 * Registers `node.ranking` with tldraw's closed `TLShape` union, the same pattern every extension
 * package uses for the types it owns.
 *
 * Imported for side effect by `src/index.ts`. Without it tldraw's schema never learns the type, and the
 * board throws "No shape util found" the first time one is created.
 */
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'node.ranking': RankingProps & NodeBaseProps
	}
}
