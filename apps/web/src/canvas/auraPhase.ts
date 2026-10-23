import { useEffect, useState } from 'react'

/**
 * The clock the aura drifts on, shared by the canvas and by the preview in Settings.
 *
 * Its own module because both callers need it and neither should own it — and because the guardrails
 * below are the sort of thing that gets forgotten when copied.
 */

/** ~30fps. The aura drifts; it does not need a frame budget. */
const FRAME_MS = 33

/**
 * Whether the aura should move at all.
 *
 * Read once per mount rather than watched: someone who turns this on mid-session can afford to switch
 * the lens off and on again, and a media-query listener here would be more machinery than the
 * preference deserves.
 */
function prefersStillness(): boolean {
	return (
		typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
	)
}

/**
 * Seconds since the loop started, or `0` when it is not running.
 *
 * `requestAnimationFrame` is already paused in a background tab, so a board left open behind another
 * one costs nothing — no visibility listener needed. Returning 0 while inactive means no loop exists
 * at all until there is something to animate.
 *
 * `paused` holds the drift where it is, rather than resetting it: the canvas pauses while the camera
 * moves, because rebuilding the outline on top of a pan frame costs more than the drift is worth, and
 * an outline that jumped back to its starting shape whenever you scrolled would read as a glitch.
 */
export function useAuraPhase(active: boolean, paused = false): number {
	const [phase, setPhase] = useState(0)

	useEffect(() => {
		if (!active || paused || prefersStillness()) return
		let frame = 0
		let last = 0
		const tick = (now: number) => {
			frame = requestAnimationFrame(tick)
			if (now - last < FRAME_MS) return
			last = now
			setPhase(now / 1000)
		}
		frame = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(frame)
	}, [active, paused])

	return active ? phase : 0
}
