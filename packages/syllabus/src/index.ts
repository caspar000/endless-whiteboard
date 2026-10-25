/**
 * `@lifeboard/syllabus`: syllabi you work through (docs/skill-tree-plan.md), and a source for skill
 * trees.
 *
 * Reaches the host only through `@lifeboard/node-kit`'s public barrel, like every extension, and the
 * skill tree through its own.
 */

// Registers the node types with tldraw's type system. Side-effect import, kept above the exports.
import './shape-types'
import { registerTreeSource } from '@lifeboard/skill-tree'
import { syllabusTreeSource } from './syllabusSource'

// The syllabus's entries, write-ups and requirement kinds, for skill trees.
registerTreeSource(syllabusTreeSource)

export { syllabusExtension } from './extension'
export { ITEM_TYPE, TRACK_TYPE, UP_NEXT_TYPE, type SkillItemProps, type TrackProps, type UpNextProps } from './board'
export { getSkillIndex, getTrackIndex, type IndexEntry, type SkillIndex, type TrackEntry, type TrackIndex } from './skillIndex'
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
export { itemNodeDefinition } from './item/definition'
export { trackNodeDefinition } from './track/definition'
export { upNextNodeDefinition } from './upnext/definition'
export { templateFor, MEDIA, type Medium, type Template } from './templates'
