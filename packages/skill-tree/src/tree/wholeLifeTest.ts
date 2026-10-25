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

/** A browser driven by a test (Playwright sets `navigator.webdriver`). */
export const isAutomated = (): boolean => typeof navigator !== 'undefined' && navigator.webdriver === true

/**
 * The board the whole-life layout is tested on (docs/skill-tree-layout-plan.md, "Test board"): you at
 * the centre, the five pillars, Adler on Mental and Film, Theatre and Games on Practical, nothing else.
 * One view, Mastery's, showing everything. Only the Mastery tree of fixtures/whole-life-test.yaml is
 * used (its test trees stay in the file for the layout tests). Every other tree hanging from a pillar
 * is taken off it (its mount cleared, nothing deleted), so the view reaches only these; importing a
 * tree again hangs it back. Confirmed, as it is a sample to look at rather than an import to review.
 *
 * The documents come in as text: the e2e suite reads them from disk (fixtures/ and syllabi/ at the
 * repo root), so none of them is in the app's bundle.
 */
export async function insertWholeLifeTest(editor: Editor, at: { x: number; y: number }, docs: { life: string; trees: readonly string[] }): Promise<void> {
	await working(editor, 'Inserting the whole-life test board', docs.trees.length + 3, async (step) => {
		await step('Reading the documents')
		const life = parseSyllabus(docs.life)
		const trees = docs.trees.map(parseSyllabus)
		if (!life.ok || trees.some((t) => !t.ok)) throw new Error('A whole-life test document does not parse')
		// Laid out once, at the end, rather than after each import.
		const release = holdImport(editor)
		try {
			await step('Adding You and the pillars')
			importSyllabus(editor, { ...life.doc, trees: life.doc.trees.filter((t) => t.treeId === 'mastery'), tracks: [] }, at)
			for (const tree of trees) {
				if (!tree.ok) continue
				await step(`Adding ${tree.doc.trees[0]?.name ?? tree.doc.name}`)
				importSyllabus(editor, tree.doc, at)
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

/**
 * Puts `window.lifeboardWholeLifeTest` on the page for the e2e suite, inserting the board into the
 * editor that opened last. Only in a browser driven by a test.
 */
export function exposeWholeLifeTest(editor: Editor): void {
	if (!isAutomated()) return
	;(window as unknown as { lifeboardWholeLifeTest?: unknown }).lifeboardWholeLifeTest = (docs: { life: string; trees: string[] }) => {
		const bounds = editor.getCurrentPageBounds()
		return insertWholeLifeTest(editor, bounds ? { x: bounds.maxX + 400, y: bounds.minY } : editor.getViewportPageBounds().center, docs)
	}
}
