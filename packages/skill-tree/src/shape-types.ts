import type { NodeBaseProps } from '@lifeboard/node-kit'
import type { EntryProps, SkillNodeProps, SkillTreeProps } from './board'

/**
 * Registers the skill tree's node types with tldraw's closed `TLShape` union, the same pattern every
 * compile-time package follows. Imported for its side effect by `src/index.ts`.
 */
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'node.skill': SkillNodeProps & NodeBaseProps
		'node.skillTree': SkillTreeProps & NodeBaseProps
		'node.skillEntry': EntryProps & NodeBaseProps
		'node.skillLayoutTuner': NodeBaseProps
	}
}
