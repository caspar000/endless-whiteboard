import type { Editor } from '@lifeboard/canvas'
import { isTree, TREE_TYPE } from '../board'
import { confirmDraft, importSyllabus } from '../syllabusIO'
import { parseSyllabus } from '../syllabusYaml'
import { getTreeDefs, updateTreeMeta } from '../treeDefs'
import { syncBoard } from '../treeSync'
import { holdImport } from '../importing'
import { working } from '../progress'

/** Vite's dev flag, read without the `vite/client` types this package doesn't load. */
export const isDevBuild = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true

/**
 * The board the whole-life layout is tested on (docs/skill-tree-layout-plan.md, "Test board"): you at
 * the centre, the five pillars, Adler on Mental and Film, Theatre and Games on Practical, nothing else. One
 * view, Mastery's, showing everything; no habit cards. Only the Mastery tree of
 * content/whole-life-test.yaml is used (its test trees stay in the file for the layout tests). Every
 * other tree hanging from a pillar is taken off it (its mount cleared, nothing deleted), so the view
 * reaches only these; importing a tree again hangs it back. Confirmed, as it is a sample to look at rather than an import to review.
 */
export async function insertWholeLifeTest(editor: Editor, at: { x: number; y: number }): Promise<void> {
	const files = { mastery: 'You and the pillars', adler: 'Adler', film: 'Film', theatre: 'Theatre', games: 'Games' }
	await working(editor, 'Inserting the whole-life test board', Object.keys(files).length + 3, async (step) => {
		await step('Reading the documents')
		const [life, ...trees] = (
			await Promise.all([
				import('../../content/whole-life-test.yaml?raw'),
				import('../../content/adler.yaml?raw'),
				import('../../content/film.yaml?raw'),
				import('../../content/theatre.yaml?raw'),
				import('../../content/games.yaml?raw'),
			])
		).map((m) => parseSyllabus(m.default))
		if (!life!.ok || trees.some((t) => !t.ok)) throw new Error('A whole-life test document does not parse')
		// Laid out once, at the end, rather than after each import.
		const release = holdImport(editor)
		try {
			await step(`Adding ${files.mastery}`)
			importSyllabus(editor, { ...life!.doc, trees: life!.doc.trees.filter((t) => t.treeId === 'mastery'), tracks: [], habits: [] }, at)
			for (const tree of trees) {
				if (!tree.ok) continue
				await step(`Adding ${tree.doc.trees[0]?.name ?? tree.doc.name}`)
				importSyllabus(editor, { ...tree.doc, habits: [] }, at)
			}
			await step('Confirming')
			confirmDraft(editor)
			const mounts: Record<string, string> = { adler: 'mastery/mental', film: 'mastery/practical', theatre: 'mastery/practical', games: 'mastery/practical' }
			for (const [treeId, mount] of Object.entries(mounts)) updateTreeMeta(treeId, { mount })
			const kept = new Set(Object.keys(mounts))
			for (const tree of Object.values(getTreeDefs())) if (!kept.has(tree.treeId) && tree.mount.startsWith('mastery/')) updateTreeMeta(tree.treeId, { mount: '' })
			// The imports made headers; Mastery's view reaches them all, so Mastery's is the one.
			const headers = editor.getCurrentPageShapes().filter(isTree)
			editor.run(() => {
				editor.deleteShapes(headers.filter((h) => h.props.treeId !== 'mastery').map((h) => h.id))
				for (const h of headers.filter((h) => h.props.treeId === 'mastery')) editor.updateShape({ id: h.id, type: TREE_TYPE, props: { mode: 'all' } } as never)
			})
			await step('Laying out the board')
		} finally {
			release()
		}
		syncBoard(editor)
	})
}
