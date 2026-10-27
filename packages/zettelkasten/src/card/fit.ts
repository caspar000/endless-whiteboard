import { useLayoutEffect, type RefObject } from 'react'

/** The smallest a note's type goes to fit its card, against its usual size. Past that the card scrolls. */
export const MIN_FIT = 0.5
const TRIES = 6

function overflows(body: HTMLElement): boolean {
	return body.scrollHeight > body.clientHeight + 1
}

/**
 * Sets the body's type scale (`--zfit`, styles.css) to the largest that fits the whole note on the card
 * without scrolling, as a note written to the edge of a card is written smaller. Runs synchronously
 * between layouts, so the card is never painted at a size it doesn't keep.
 */
export function fitText(body: HTMLElement): number {
	body.style.setProperty('--zfit', '1')
	if (!overflows(body)) return 1
	// The text's area goes with the square of its size, which puts a first guess close; then halve the
	// gap between a size that fits and one that doesn't a few times.
	let fits = MIN_FIT
	let tooBig = 1
	let guess = Math.max(MIN_FIT, Math.min(0.98, Math.sqrt(body.clientHeight / body.scrollHeight)))
	for (let i = 0; i < TRIES; i++) {
		body.style.setProperty('--zfit', String(guess))
		if (overflows(body)) tooBig = guess
		else fits = guess
		guess = (fits + tooBig) / 2
	}
	body.style.setProperty('--zfit', String(fits))
	return fits
}

/**
 * Keeps a card's text fitted (`fitText`) as it is written and as the card changes size. `deps` are
 * whatever redraws the text: the note's rich text, and whether it is drawn by its editor.
 */
export function useFitText(ref: RefObject<HTMLElement | null>, deps: readonly unknown[]): void {
	useLayoutEffect(() => {
		const body = ref.current
		if (body) fitText(body)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ref, ...deps])

	useLayoutEffect(() => {
		const body = ref.current
		if (!body || typeof ResizeObserver === 'undefined') return
		let width = body.clientWidth
		const resizes = new ResizeObserver(() => {
			// Only a new width changes how the text wraps; its height is ours to change.
			if (body.clientWidth === width) return
			width = body.clientWidth
			fitText(body)
		})
		resizes.observe(body)
		// The note's editor draws its text a moment after it mounts, and redraws it as it is typed.
		const edits = new MutationObserver(() => fitText(body))
		edits.observe(body, { childList: true, subtree: true, characterData: true })
		// Measured in a fallback face until the handwriting has loaded.
		let gone = false
		document.fonts?.ready.then(() => !gone && fitText(body))
		return () => {
			gone = true
			resizes.disconnect()
			edits.disconnect()
		}
	}, [ref])
}
