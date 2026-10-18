import type { Editor } from '@lifeboard/canvas'
import { isTree, TREE_TYPE } from '../board'
import { confirmDraft, importSyllabus } from '../syllabusIO'
import { parseSyllabus } from '../syllabusYaml'
import { getTreeDefs, updateTreeMeta } from '../treeDefs'
import { syncBoard } from '../treeSync'

/** Vite's dev flag, read without the `vite/client` types this package doesn't load. */
export const isDevBuild = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true

/**
 * The board the whole-life layout is tested on (docs/skill-tree-layout-plan.md, "Test board"): you at
 * the centre, the five pillars, Adler on Mental and Film on Practical, nothing else. One view, Mastery's, showing
 * everything; no habit cards. Only the Mastery tree of content/whole-life-test.yaml is used (its test
 * trees stay in the file for the layout tests). Every other tree hanging from a pillar is taken off
 * it (its mount cleared, nothing deleted), so the view reaches Adler alone; importing a tree again
 * hangs it back. Confirmed, as it is a sample to look at rather than an import to review.
 */
export async function insertWholeLifeTest(editor: Editor, at: { x: number; y: number }): Promise<void> {
	const [life, adler, film] = await Promise.all([
		import('../../content/whole-life-test.yaml?raw'),
		import('../../content/adler.yaml?raw'),
		import('../../content/film.yaml?raw'),
	])
	const parsedLife = parseSyllabus(life.default)
	const parsedAdler = parseSyllabus(adler.default)
	const parsedFilm = parseSyllabus(film.default)
	if (!parsedLife.ok || !parsedAdler.ok || !parsedFilm.ok) throw new Error('A whole-life test document does not parse')
	importSyllabus(editor, { ...parsedLife.doc, trees: parsedLife.doc.trees.filter((t) => t.treeId === 'mastery'), tracks: [], habits: [] }, at)
	importSyllabus(editor, { ...parsedAdler.doc, habits: [] }, at)
	importSyllabus(editor, { ...parsedFilm.doc, habits: [] }, at)
	confirmDraft(editor)
	updateTreeMeta('adler', { mount: 'mastery/mental' })
	updateTreeMeta('film', { mount: 'mastery/practical' })
	const kept = new Set(['adler', 'film'])
	for (const tree of Object.values(getTreeDefs())) if (!kept.has(tree.treeId) && tree.mount.startsWith('mastery/')) updateTreeMeta(tree.treeId, { mount: '' })
	// Adler's and Film's imports made headers; Mastery's view reaches both, so Mastery's is the one.
	const headers = editor.getCurrentPageShapes().filter(isTree)
	editor.run(() => {
		editor.deleteShapes(headers.filter((h) => h.props.treeId !== 'mastery').map((h) => h.id))
		for (const h of headers.filter((h) => h.props.treeId === 'mastery')) editor.updateShape({ id: h.id, type: TREE_TYPE, props: { mode: 'all' } } as never)
	})
	syncBoard(editor)
}
