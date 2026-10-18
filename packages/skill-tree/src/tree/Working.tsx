import { useEditor, useValue } from '@lifeboard/canvas'
import { getWork } from '../progress'

/** The note over the board while an import or a layout runs (progress.ts): what, which step, how far. */
export function Working() {
	const editor = useEditor()
	const work = useValue('lifeboard:skill-tree-working', () => getWork(editor), [editor])
	if (!work) return null
	return (
		<div className="lb-working" role="status" aria-live="polite">
			<span className="lb-working__spinner" aria-hidden />
			<span className="lb-working__text">
				<strong>{work.title}</strong>
				<span>{work.step}</span>
			</span>
			{work.total > 1 && (
				<span className="lb-working__count">
					{work.done + 1} of {work.total}
				</span>
			)}
			<span className="lb-working__bar" aria-hidden>
				<span style={{ transform: `scaleX(${work.done / work.total})` }} />
			</span>
		</div>
	)
}
