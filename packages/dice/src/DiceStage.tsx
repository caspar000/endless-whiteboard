import { useEffect, useRef } from 'react'
import { useEditor } from 'tldraw'
import { markRollSettled, type ActiveRoll } from './rolls'
import type { Stage } from './three/stage'

/**
 * The canvas the dice roll on, and the only place three.js is ever loaded.
 *
 * The import is dynamic and happens on the **first throw**, never at startup. three.js and cannon-es
 * together are the largest thing this app would pull in for a feature you might not use, so a board
 * with the tray switched on but never clicked pays nothing for it — which is the only reason the tray
 * can be on by default.
 *
 * The renderer is kept for the life of the board rather than rebuilt per roll: creating a WebGL context
 * is expensive, and browsers cap how many may exist at once, so churning one per throw eventually
 * starts losing them.
 */
export function DiceStage({ roll }: { roll: ActiveRoll | null }) {
	const editor = useEditor()
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const stageRef = useRef<Stage | null>(null)
	/** The roll the stage has already been given, so a re-render does not throw it again. */
	const playedRef = useRef(-1)

	useEffect(() => {
		return () => {
			stageRef.current?.dispose()
			stageRef.current = null
			delete (window as unknown as { __diceStage?: Stage }).__diceStage
		}
	}, [])

	useEffect(() => {
		if (!roll || roll.seq === playedRef.current) return
		const canvas = canvasRef.current
		if (!canvas) return
		playedRef.current = roll.seq

		let cancelled = false
		void (async () => {
			// Loaded here, not imported at the top: this is the line that keeps ~180 KB out of the
			// startup bundle.
			const { createStage } = await import('./three/stage')
			if (cancelled) return
			stageRef.current ??= createStage(canvas, editor)
			/*
			 * A debug seam, like the `window.editor` the board already exposes.
			 *
			 * Honest about its limits: it reports the face *it* computes as upward, using the same function
			 * the labelling used, so it can confirm the two halves of the pipeline agree and cannot prove
			 * what is on screen. When the numbers and the card genuinely disagreed, this said they matched.
			 * The thing that settles it is the result face being inked (see `materialsFor`) — you can then
			 * see whether the coloured numeral is the one on top.
			 */
			;(window as unknown as { __diceStage?: Stage }).__diceStage = stageRef.current
			// The stage tells the store where the dice stopped, and the readout is waiting on that — which
			// is what keeps the card off the top of a throw still in the air.
			stageRef.current.play(roll.result.dice, roll.point, !prefersReducedMotion(), (pile) =>
				markRollSettled(roll.seq, pile)
			)
		})()

		return () => {
			cancelled = true
		}
	}, [roll, editor])

	// Kept mounted across rolls so the WebGL context survives, and inert between them: it takes no
	// pointer events and, with nothing thrown, draws nothing at all.
	return <canvas className="lb-dice-stage" ref={canvasRef} aria-hidden="true" />
}

/**
 * Whether to skip the tumble.
 *
 * Skipping costs nothing and changes nothing about the outcome — the roll is decided before the
 * animation exists (`three/simulate.ts`), so this is genuinely "show me the result without the ride"
 * rather than a second, quieter way of rolling.
 */
function prefersReducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
