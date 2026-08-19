import { MousePointerSquareDashed, X } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import {
	dismissSelection,
	getTurnContext,
	subscribeToTurnContext,
	isSelectionDismissed,
	restoreSelection,
} from '../agent/boardContext'

/**
 * What the next turn will carry, above the box you type in.
 *
 * The selection reaches the agent automatically, and this is the part that makes that acceptable
 * rather than spooky: context sent invisibly is context the user cannot correct. The chip says what is
 * going, and the × takes it back.
 *
 * Only the *selection* is shown. The board on screen also travels, but the user can see which board
 * they are on — a chip repeating it would be noise on every single turn.
 */
export function AgentContextChip() {
	const context = useSyncExternalStore(subscribeToTurnContext, getTurnContext)
	const dismissed = useSyncExternalStore(subscribeToTurnContext, isSelectionDismissed)

	if (context.selectionTotal === 0) return null

	const count = context.selectionTotal
	const names = context.selection
		.map((shape) => shape.label.trim())
		.filter(Boolean)
		.slice(0, 3)
	// Names when they exist, a count when they do not — an unlabelled shape has nothing to call it, and
	// "shape:x7Kq…" is not a name.
	const summary = names.length > 0 ? names.join(', ') : `${count} shape${count === 1 ? '' : 's'}`

	if (dismissed) {
		return (
			<div className="lb-agent-context lb-agent-context--off">
				<MousePointerSquareDashed size={12} aria-hidden="true" />
				<span className="lb-agent-context__label">Selection not included</span>
				<button type="button" className="lb-agent-context__undo" onClick={restoreSelection}>
					Include
				</button>
			</div>
		)
	}

	return (
		<div className="lb-agent-context">
			<MousePointerSquareDashed size={12} aria-hidden="true" />
			<span className="lb-agent-context__count">{count}</span>
			<span className="lb-agent-context__label" title={context.selection.map((s) => s.label || s.id).join('\n')}>
				{summary}
				{names.length > 0 && count > names.length ? ` +${count - names.length}` : ''}
			</span>
			<button
				type="button"
				className="lb-agent-context__remove"
				onClick={dismissSelection}
				title="Do not send the selection with this message"
				aria-label="Do not send the selection with this message"
			>
				<X size={11} aria-hidden="true" />
			</button>
		</div>
	)
}
