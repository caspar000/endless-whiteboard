import { useEditor, useValue } from '@lifeboard/canvas'
import { getTreeDefs, getWork } from '@lifeboard/skill-tree'
import { boardIdOf } from './skillIndex'
import { getTracks } from './syllabus'
import { confirmImport } from './syllabusCommands'
import { boardHasDraft, discardDraft } from './syllabusIO'

/**
 * The bar a board shows while it holds an unconfirmed import: what it is, and Confirm or Discard.
 * Fixed over the board rather than on it, so a draft can't be scrolled out of sight and left there:
 * until one of the two is pressed, the import counts toward nothing.
 */
export function DraftBar() {
	const editor = useEditor()
	const names = useValue(
		'lifeboard:syllabus-draft-bar',
		() => {
			if (!boardHasDraft(editor)) return null
			const board = boardIdOf(editor)
			return [
				...Object.values(getTracks()).filter((t) => t.draft && t.draft === board).map((t) => t.name || t.trackId),
				...Object.values(getTreeDefs()).filter((t) => t.draft && t.draft === board).map((t) => `${t.name || t.treeId} (tree)`),
			].join(', ')
		},
		[editor]
	)
	// While the board is busy importing or confirming, its progress note shows here instead.
	const busy = useValue('lifeboard:syllabus-draft-bar-busy', () => !!getWork(editor), [editor])
	if (names === null || busy) return null
	return (
		<div
			className="lb-draft-bar"
			role="alertdialog"
			aria-label="Imported syllabus draft"
			// Kept off the board, which would take the press as a gesture on the canvas (as StaleLayout does).
			onPointerDown={(e) => {
				e.stopPropagation()
				e.preventDefault()
			}}
		>
			<span className="lb-draft-bar__text">
				<strong>Draft import</strong>
				{names && <span className="lb-draft-bar__names">{names}</span>}
				<span className="lb-draft-bar__hint">Counts toward nothing until you confirm it.</span>
			</span>
			<button type="button" className="lb-draft-bar__discard" onClick={() => discardDraft(editor)}>
				Discard
			</button>
			<button type="button" className="lb-draft-bar__confirm" onClick={() => void confirmImport(editor)}>
				Confirm
			</button>
		</div>
	)
}
