import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useEditor } from 'tldraw'
import { DiceStage } from './DiceStage'
import { DiceTray } from './DiceTray'
import { HeldDice } from './HeldDice'
import { RollReadout } from './RollReadout'
import { createRollCard } from './card/create'
import { clearHand, getHand, subscribeToHand } from './hand'
import { getDicePrefs, subscribeToDicePrefs } from './prefs'
import { clearRolls, getActiveRoll, subscribeToRolls, throwHand } from './rolls'

/**
 * Everything this extension draws on the board — the tray, what you are holding, and what you last
 * rolled — plus the two gestures it borrows while your hand is full.
 *
 * Rendered through `Extension.overlays` into tldraw's `InFrontOfTheCanvas` slot. The root takes no
 * pointer events at all, and neither does anything under it except the tray, which is what makes a
 * board with dice enabled behave exactly like one without until you pick a die up.
 */
export function DiceOverlay() {
	const hand = useSyncExternalStore(subscribeToHand, getHand)
	const roll = useSyncExternalStore(subscribeToRolls, getActiveRoll)
	const prefs = useSyncExternalStore(subscribeToDicePrefs, getDicePrefs)
	const holding = hand.total > 0

	useKeptResult(roll)

	useThrowOnPointerDown()
	useDropOnEscape(holding)
	useGrabCursor(holding)

	/*
	 * The hand and the roll are module-scope state, so they outlive this component unless something
	 * puts them down — and a hand carried into the next board would be held over a tray whose owner
	 * had gone, a roll carried over would be read out at a page point that means nothing there.
	 *
	 * Doing it here rather than from the board's own unmount path (which is how `canvas/tracing.ts`
	 * handles the same obligation) is what keeps the app from having to know this extension exists:
	 * the overlay renders inside `<Tldraw>`, so it unmounts with the board by construction.
	 */
	useEffect(
		() => () => {
			clearHand()
			clearRolls()
		},
		[]
	)

	return (
		<div className="lb-dice">
			{/* Behind the tray and the readout, and above the shapes: the dice land *on* the board. */}
			<DiceStage roll={roll} />
			<DiceTray />
			{holding && <HeldDice hand={hand} />}
			{/*
			  * The readout and the card are alternatives, not both: the card *is* the result, and drawing a
			  * floating copy of it over the top would read as two rolls.
			  */}
			{roll && !prefs.keepResults && <RollReadout key={roll.seq} roll={roll} />}
		</div>
	)
}

/**
 * Writes a kept roll onto the board, once.
 *
 * Waits for `settlement` rather than firing on the throw, so the card lands on the dice rather than on
 * the spot you clicked — and so a roll still in the air has not been written down yet. Guarded by the
 * roll's `seq`, because the settlement arriving *is* a second render of the same roll.
 */
function useKeptResult(roll: ReturnType<typeof getActiveRoll>): void {
	const editor = useEditor()
	const written = useRef(-1)

	useEffect(() => {
		if (!roll?.settlement || written.current === roll.seq) return
		written.current = roll.seq
		if (getDicePrefs().keepResults) createRollCard(editor, roll)
	}, [editor, roll])
}

/**
 * Claims the click that throws the dice.
 *
 * The obvious implementation is a transparent full-viewport layer with `pointer-events: auto`, and it
 * is **wrong**. `InFrontOfTheCanvas` renders as a *sibling* of `.tl-canvas`, not inside it, and
 * `.tl-canvas` is where tldraw binds its wheel gesture (`useGestureEvents(rCanvas)` in
 * `DefaultCanvas`). A layer over the board therefore becomes the hit-target for wheel events that then
 * have no path to tldraw's listener — so panning and zooming silently stop working for exactly as long
 * as you are holding a die. Verified rather than theorised: with the layer in place, a trusted `wheel`
 * moved the camera by nothing at all, while the same wheel with an empty hand moved it normally.
 *
 * A capture-phase listener on `window` has none of that problem. It puts no element over the board, so
 * wheel, pinch and every other gesture reach tldraw untouched; and because `window` is an ancestor of
 * both tldraw's container and React's root, it still runs before either of them sees the event.
 *
 * Two things it deliberately lets through:
 *
 *  - **The tray.** Clicking a die while already holding one loads another, which is the whole gesture.
 *  - **Anything outside the board.** The tab strip, the agent panel, a dialog. Those are not the board,
 *    so a click there is not a throw — and it does not drop the dice either, because nothing about
 *    reaching for another part of the app says you have changed your mind.
 */
function useThrowOnPointerDown(): void {
	const editor = useEditor()

	useEffect(() => {
		const container = editor.getContainer()

		/**
		 * A right-click we have acted on, so the `contextmenu` events it drags behind it can be swallowed
		 * too.
		 *
		 * This exists because of a bug worth remembering. Dropping the dice on `contextmenu` empties the
		 * hand, and when these listeners were bound only *while* holding, that emptying tore them down —
		 * mid-gesture. A right click produces **two** `contextmenu` events, so the first was swallowed,
		 * the hand went empty, the effect cleaned up, and the second reached Radix and opened the board's
		 * menu over the dice being put away. Latching on the pointerdown, and clearing the latch on the
		 * *next* pointerdown rather than after n events, is what makes the number of trailing events
		 * stop mattering.
		 */
		let swallowContextMenu = false

		const claims = (target: EventTarget | null): boolean => {
			if (!(target instanceof Node) || !container.contains(target)) return false
			// The tray is inside the container, and it is the one thing in there that is not the board.
			return !(target instanceof Element && target.closest('.lb-dice-tray'))
		}

		const claim = (e: Event) => {
			e.preventDefault()
			e.stopPropagation()
		}

		const onPointerDown = (e: PointerEvent) => {
			// A new gesture: whatever the last one latched is finished with.
			swallowContextMenu = false
			if (!claims(e.target)) return

			// Read the hand *now* rather than closing over it. These listeners outlive any particular
			// hand — that is the whole point of them not being bound to `holding`.
			const holding = getHand().total > 0
			if (!holding) return

			if (e.button === 2) {
				// tldraw opens its context menu from the pointerdown as well, so claiming the event here is
				// what actually keeps the menu shut; the `contextmenu` handler below only mops up.
				swallowContextMenu = true
				claim(e)
				clearHand()
				return
			}

			// Middle-click and anything exotic is left alone, so a middle-drag pan stays a pan.
			if (e.button !== 0) return
			claim(e)
			// `screenToPage` subtracts tldraw's own screen bounds, so it wants *client* coordinates — the
			// opposite of `pageToViewport`, which returns container-relative ones. Getting these two the
			// wrong way round puts the roll off by the board's offset in the window.
			throwHand(editor.screenToPage({ x: e.clientX, y: e.clientY }))
		}

		// Deliberately not cleared here: see `swallowContextMenu`. However many of these one gesture
		// produces, all of them belong to the right-click already dealt with.
		const onContextMenu = (e: MouseEvent) => {
			if (swallowContextMenu) claim(e)
		}

		/*
		 * Bound for as long as the overlay is mounted, not for as long as dice are held.
		 *
		 * The cost is two capture listeners that return immediately on an empty hand. What it buys is
		 * that no gesture can ever be half-handled by a listener that removed itself partway through it,
		 * which is the bug described above.
		 */
		window.addEventListener('pointerdown', onPointerDown, { capture: true })
		window.addEventListener('contextmenu', onContextMenu, { capture: true })
		return () => {
			window.removeEventListener('pointerdown', onPointerDown, { capture: true })
			window.removeEventListener('contextmenu', onContextMenu, { capture: true })
		}
	}, [editor])
}

/**
 * Escape puts the dice back.
 *
 * On `window`, in the **capture** phase, because tldraw's own `keydown` listener sits on its container
 * and Escape is the one key that reaches it regardless of what is focused — `handleKeyDown` returns
 * before the `areShortcutsDisabled` check for that case (see `docs/tldraw-api-notes.md`). A listener
 * on an ancestor in capture therefore runs first in every case, where one on the container itself
 * would race tldraw's by registration order.
 *
 * `markEventAsHandled` and nothing else: it is the documented gate tldraw's handler checks first, and
 * it stops tldraw calling `cancel()` — which would clear the selection *and* leave an empty history
 * entry on the undo stack. `stopPropagation` is deliberately not used; from `window` it would take
 * Escape away from every other consumer in the app.
 *
 * Only bound while something is held, so an empty hand leaves the key entirely alone.
 */
function useDropOnEscape(holding: boolean): void {
	const editor = useEditor()

	useEffect(() => {
		if (!holding) return
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return
			editor.markEventAsHandled(e)
			clearHand()
		}
		window.addEventListener('keydown', onKeyDown, { capture: true })
		return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
	}, [editor, holding])
}

/**
 * Says with the cursor that the board is about to take a throw.
 *
 * A class on tldraw's container rather than `editor.setCursor`: tldraw's cursor is *state*, reset by
 * the select tool as the pointer moves on and off shapes, so a cursor set once would flick back to an
 * arrow the first time you crossed a sticky note. See the rule in styles.css for why winning that
 * needs `!important`.
 */
function useGrabCursor(holding: boolean): void {
	const editor = useEditor()

	useEffect(() => {
		if (!holding) return
		const container = editor.getContainer()
		container.classList.add('lb-dice-holding')
		return () => container.classList.remove('lb-dice-holding')
	}, [editor, holding])
}
