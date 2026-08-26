import { useEffect, useRef } from 'react'
import { useEditor } from 'tldraw'
import { DieIcon } from './DieIcon'
import type { Hand } from './hand'
import { DIE_KINDS } from './kinds'

/**
 * What you are holding, beside the pointer.
 *
 * tldraw's `setCursor` takes a closed union of cursor types — there is no custom-image cursor — so a
 * "hand full of dice" pointer has to be drawn rather than set. That turns out to be the better answer
 * anyway: a cursor image could not carry the counts, and the counts are the entire reason this exists.
 * `AgentPresence` draws its cursor for the same reason.
 *
 * The position is written **straight to the element** in the pointer listener, not held in state. A
 * `setState` per `pointermove` would re-render this subtree at the pointer's sample rate — around 120
 * times a second on a trackpad — for a value nothing else reads.
 */
export function HeldDice({ hand }: { hand: Hand }) {
	const editor = useEditor()
	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const node = ref.current
		if (!node) return
		const container = editor.getContainer()

		const place = (clientX: number, clientY: number) => {
			const rect = container.getBoundingClientRect()
			node.style.transform = `translate(${clientX - rect.left}px, ${clientY - rect.top}px)`
		}

		/*
		 * Start where the pointer already is. Without this the cluster sits in the container's top-left
		 * corner until the first move — which, if you load a die and then click without moving, is the
		 * entire lifetime of the thing you were meant to see.
		 *
		 * `getCurrentScreenPoint` is already container-relative — tldraw subtracts its own
		 * `screenBounds` when it records the point — so it needs no conversion, unlike the client
		 * coordinates a raw `PointerEvent` carries.
		 */
		const start = editor.inputs.getCurrentScreenPoint()
		node.style.transform = `translate(${start.x}px, ${start.y}px)`

		const onMove = (e: PointerEvent) => place(e.clientX, e.clientY)
		// On `window`, so the cluster keeps up with the pointer over the tray, over a shape, and over
		// the app chrome outside the board — anywhere it can still be seen.
		window.addEventListener('pointermove', onMove)
		return () => window.removeEventListener('pointermove', onMove)
	}, [editor])

	return (
		<div className="lb-dice-held" ref={ref} aria-hidden="true">
			{DIE_KINDS.filter((kind) => (hand.counts.get(kind) ?? 0) > 0).map((kind) => (
				<span className="lb-dice-held__die" key={kind}>
					<DieIcon kind={kind} size={20} />
					<span className="lb-dice-held__count">{hand.counts.get(kind)}</span>
				</span>
			))}
		</div>
	)
}
