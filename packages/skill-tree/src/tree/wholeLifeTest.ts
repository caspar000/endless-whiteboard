import type { Editor } from '@lifeboard/canvas'
import { isTree, TREE_TYPE } from '../board'
import { confirmDraft, importSyllabus } from '../syllabusIO'
import { parseSyllabus } from '../syllabusYaml'
import { updateTreeMeta } from '../treeDefs'
import { syncBoard } from '../treeSync'

/** Vite's dev flag, read without the `vite/client` types this package doesn't load. */
export const isDevBuild = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true

/**
 * The board the whole-life layout is built against (docs/skill-tree-layout-plan.md, "Test board"):
 * you at the centre, the five pillars, the test trees of content/whole-life-test.yaml, Director on
 * Practical and Adler on Mental. One view, Mastery's, showing everything; no habit cards and no other
 * tree's header. Confirmed, as it is a sample to look at rather than an import to review.
 */
export async function insertWholeLifeTest(editor: Editor, at: { x: number; y: number }): Promise<void> {
	const [life, adler, director] = await Promise.all([
		import('../../content/whole-life-test.yaml?raw'),
		import('../../content/adler.yaml?raw'),
		import('../../content/director.yaml?raw'),
	])
	for (const { default: text } of [life, adler, director]) {
		const parsed = parseSyllabus(text)
		if (!parsed.ok) throw new Error(`A whole-life test document does not parse: ${parsed.errors.join('; ')}`)
		importSyllabus(editor, { ...parsed.doc, habits: [] }, at)
	}
	confirmDraft(editor)
	updateTreeMeta('adler', { mount: 'mastery/mental' })
	updateTreeMeta('director', { mount: 'mastery/practical' })
	// Adler's and Director's imports each made a header; Mastery's view reaches both, so it is the one.
	const headers = editor.getCurrentPageShapes().filter(isTree)
	editor.run(() => {
		editor.deleteShapes(headers.filter((h) => h.props.treeId !== 'mastery').map((h) => h.id))
		for (const h of headers.filter((h) => h.props.treeId === 'mastery')) editor.updateShape({ id: h.id, type: TREE_TYPE, props: { mode: 'all' } } as never)
	})
	syncBoard(editor)
}
