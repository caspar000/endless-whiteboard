/**
 * `@lifeboard/skill-tree`: syllabi and skill trees (docs/skill-tree-plan.md).
 *
 * Reaches the host only through `@lifeboard/node-kit`'s public barrel, like every extension.
 */

// Registers the node types with tldraw's type system. Side-effect import, kept above the exports.
import './shape-types'

export { skillTreeExtension } from './extension'
export {
	ITEM_TYPE,
	SKILL_TYPE,
	TRACK_TYPE,
	TREE_TYPE,
	type SkillItemProps,
	type SkillNodeProps,
	type SkillTreeProps,
	type TrackProps,
} from './board'
export {
	getHabitIndex,
	getSkillIndex,
	getTrackIndex,
	replaceHabitIndex,
	setHabitIndexPersistence,
	type TrackEntry,
	type TrackIndex,
	type HabitEntry,
	type HabitIndex,
	type IndexEntry,
	type SkillIndex,
} from './skillIndex'
export {
	getEvidence,
	getItems,
	getTracks,
	replaceEvidence,
	replaceItems,
	replaceTracks,
	setEvidencePersistence,
	setItemsPersistence,
	setTracksPersistence,
	type ItemDef,
	type TrackDef,
} from './syllabus'
export { evaluateTree, parseRequirements, type Condition, type NodeStatus } from './requirements'
export { getTreeDefs, replaceTreeDefs, setTreeDefsPersistence, type NodeDef, type TreeDef, type TreeDefs } from './treeDefs'
export { itemNodeDefinition } from './item/definition'
export { trackNodeDefinition } from './track/definition'
export { skillNodeDefinition } from './skill/definition'
export { treeNodeDefinition } from './tree/definition'
export { habitNodeDefinition } from './habit/definition'
export { upNextNodeDefinition } from './upnext/definition'
export { ADLER_SAMPLE } from './sample'
export { templateFor, MEDIA, type Medium, type Template } from './templates'
