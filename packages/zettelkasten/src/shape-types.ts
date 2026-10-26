import type { NodeBaseProps } from '@lifeboard/node-kit'
import type { CardProps } from './box'

/**
 * Registers `node.zettel` with tldraw's closed `TLShape` union, as every compile-time extension does
 * for the types it owns. Imported for its side effect by `src/index.ts`.
 */
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'node.zettel': CardProps & NodeBaseProps
	}
}
