import type { NodeBaseProps } from '@lifeboard/node-kit'
import type { NoteNodeProps } from './definition'

/**
 * Registers `node.markdown` with tldraw's closed `TLShape` union, exactly as node-kit's own
 * `shape-types.ts` does for the core types: each compile-time package augments the map for the types
 * it owns, and app code gets `shape.type === 'node.markdown'` narrowing for free. Runtime-loaded
 * plugins can't do this and use the structural `NodeShape<Props>` path instead — see node-kit.
 *
 * Imported for side effect by `src/index.ts`.
 */
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'node.markdown': NoteNodeProps & NodeBaseProps
	}
}
