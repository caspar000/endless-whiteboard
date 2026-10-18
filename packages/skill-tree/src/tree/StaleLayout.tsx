import { useEditor, useValue } from '@lifeboard/canvas'
import { isTree } from '../board'
import { getWork, working } from '../progress'
import { recalculate, staleViews } from './viewSync'

/**
 * The "layout out of date" note (docs/skill-tree-layout-plan.md, "Stability"): shown while a tree
 * view on this board changed in structure since it was laid out, or a cluster outgrew its room.
 * Nothing moves on its own; Re-calculate lays every such view out again, one undo step each.
 */
export function StaleLayout() {
	const editor = useEditor()
	const stale = useValue('lifeboard:skill-tree-stale-layout', () => staleViews(editor).get(), [editor])
	// While the board is busy (progress.ts), its note shows here instead.
	const busy = useValue('lifeboard:skill-tree-busy', () => !!getWork(editor), [editor])
	if (!stale.length || busy) return null
	return (
		<div
			className="lb-stale-layout"
			role="status"
			// Kept off the board, which would take the press as a gesture on the canvas, and kept from
			// taking focus off it, as the dice tray does (dice/DiceTray.tsx).
			onPointerDown={(e) => {
				e.stopPropagation()
				e.preventDefault()
			}}
		>
			<span>The tree&apos;s layout is out of date</span>
			<button
				type="button"
				onClick={() =>
					void working(editor, 'Re-calculating the layout', stale.length, async (step) => {
						for (const id of stale) {
							const header = editor.getShape(id)
							if (!isTree(header)) continue
							await step(`Laying out ${header.props.name || 'the tree'}`)
							recalculate(editor, header)
						}
					})
				}
			>
				Re-calculate
			</button>
		</div>
	)
}

/** Lays every tree view on the board out again from scratch. One undo step per view. */
export function recalculateAll(editor: ReturnType<typeof useEditor>): void {
	for (const header of editor.getCurrentPageShapes().filter(isTree)) recalculate(editor, header)
}
