import { useSyncExternalStore } from 'react'
import { DieIcon } from './DieIcon'
import { getHand, loadDie, subscribeToHand, unloadDie } from './hand'
import { DIE_KINDS, MAX_DICE_IN_HAND } from './kinds'

/**
 * The tray, down the right-hand edge of the canvas.
 *
 * Floating *inside* the board's own area, the way the bottom dock does, rather than taking a column in
 * the app shell. That is what lets it coexist with the agent panel — which is a real shell column, so
 * it shrinks the canvas and the tray travels inward with it — for no layout code at all.
 *
 * Click to load, click again to load another. Right-click (or shift-click) puts one back, which is the
 * gesture nobody guesses and everybody wants the moment they click once too often; the count badge is
 * what makes it discoverable, because it is the thing that visibly went up.
 */
export function DiceTray() {
	const hand = useSyncExternalStore(subscribeToHand, getHand)
	const full = hand.total >= MAX_DICE_IN_HAND

	return (
		<div
			className="lb-dice-tray"
			/*
			 * Both, for two different reasons.
			 *
			 * `stopPropagation` keeps the click off the board: this renders inside tldraw's container, and
			 * tldraw has document-level pointer handling that would otherwise treat loading a die as a
			 * gesture on the canvas.
			 *
			 * `preventDefault` is what stops the button *taking focus*. Without it, clicking a die moves
			 * `document.activeElement` off tldraw's container onto the button, and the board stops being
			 * the thing the keyboard is talking to — which is the same reason the selection toolbar does
			 * it (`canvas/SelectionToolbar.tsx`). It does not cost the click: `preventDefault` on
			 * `pointerdown` suppresses focus and text selection, not the click that follows.
			 */
			onPointerDown={(e) => {
				e.stopPropagation()
				e.preventDefault()
			}}
			role="group"
			aria-label="Dice"
		>
			{DIE_KINDS.map((kind) => {
				const count = hand.counts.get(kind) ?? 0
				return (
					<button
						key={kind}
						type="button"
						className="lb-dice-tray__die"
						// Held dice are the button's *state*, not a separate control, so the count reads out
						// as part of it — "d6, 2 loaded" — rather than as a number floating beside it.
						aria-label={count > 0 ? `${kind}, ${count} loaded` : kind}
						title={count > 0 ? `${kind} — right-click to put one back` : `Load a ${kind}`}
						data-loaded={count > 0 || undefined}
						disabled={full && count === 0}
						onClick={(e) => (e.shiftKey ? unloadDie(kind) : loadDie(kind))}
						onContextMenu={(e) => {
							e.preventDefault()
							unloadDie(kind)
						}}
					>
						<DieIcon kind={kind} />
						{count > 0 && <span className="lb-dice-tray__count">{count}</span>}
					</button>
				)
			})}

			{/*
			  * No "clear" button.
			  *
			  * There was one, and it was actively harmful: it only appeared once dice were held, so the tray
			  * grew by a row mid-gesture and every button below the pointer moved out from under it — the
			  * second click of "d6, d6" landed somewhere else. A control that rearranges the thing you are
			  * in the middle of using is worse than no control, and there are already two ways to put the
			  * dice down that cost nothing: Escape, and right-clicking the board.
			  */}
		</div>
	)
}
