import type { NodeBaseProps } from '@lifeboard/node-kit'
import type { EntryProps, HabitProps, SkillItemProps, SkillNodeProps, SkillTreeProps, TrackProps, UpNextProps } from './board'

/**
 * Registers the syllabus node types with tldraw's closed `TLShape` union, the same pattern every
 * compile-time package follows. Imported for its side effect by `src/index.ts`.
 */
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'node.skillItem': SkillItemProps & NodeBaseProps
		'node.track': TrackProps & NodeBaseProps
		'node.skill': SkillNodeProps & NodeBaseProps
		'node.skillTree': SkillTreeProps & NodeBaseProps
		'node.skillEntry': EntryProps & NodeBaseProps
		'node.habit': HabitProps & NodeBaseProps
		'node.upNext': UpNextProps & NodeBaseProps
		'node.skillLayoutTuner': NodeBaseProps
	}
}
