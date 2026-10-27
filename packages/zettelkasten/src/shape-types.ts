import type { NodeBaseProps } from '@lifeboard/node-kit'
import type { CardProps, SourceProps } from './box'

/**
 * Registers the box's three card types with tldraw's closed `TLShape` union, as every compile-time extension does
 * for the types it owns. Imported for its side effect by `src/index.ts`.
 */
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'node.zettel': CardProps & NodeBaseProps
		'node.zettelSource': SourceProps & NodeBaseProps
		'node.zettelIndex': NodeBaseProps
	}
}
