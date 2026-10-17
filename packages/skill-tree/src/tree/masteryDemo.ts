import type { Editor } from '@lifeboard/canvas'
import { MASTERY_NODE } from '../board'
import { confirmDraft, importSyllabus } from '../syllabusIO'
import { parseSyllabus } from '../syllabusYaml'
import { getTreeDef, updateTreeMeta } from '../treeDefs'
import { syncBoard } from '../treeSync'
import { layoutReach } from './ops'
import MASTERY_DEMO from '../../content/mastery.yaml?raw'

/**
 * The Mastery demo (content/mastery.yaml): Mastery, five pillars (Physical, Mental, Spiritual,
 * Practical, Social) and a starter tree on each, the shape of a whole self-education on one board.
 * Every node past a tree's root asks for one written-up item tagged to it, so it starts in reach
 * rather than lit.
 *
 * Puts the demo on this board, confirmed (it is a sample, not something to review), and hangs the
 * Adler tree under Mental if the vault has it and it hangs from nothing yet. Then lays the whole
 * view out around Mastery.
 */
export function insertMasteryDemo(editor: Editor, at: { x: number; y: number }): void {
	const parsed = parseSyllabus(MASTERY_DEMO)
	if (!parsed.ok) throw new Error(`The Mastery demo does not parse: ${parsed.errors.join('; ')}`)
	importSyllabus(editor, parsed.doc, at)
	confirmDraft(editor)
	if (getTreeDef('adler') && !getTreeDef('adler')!.mount) updateTreeMeta('adler', { mount: 'mastery/mental' })
	// Bring in what the view now reaches (Adler) before the one layout, so it is placed with the rest.
	syncBoard(editor)
	layoutReach(editor, MASTERY_NODE, 'lay out Mastery')
}
