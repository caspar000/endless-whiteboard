import { useEffect, useSyncExternalStore } from 'react'

/** Where the phone layout starts (docs/mobile-plan.md); styles.css uses the same width. */
export const PHONE_QUERY = '(max-width: 767px)'

/** Whether the window is phone-sized, live. */
export function usePhone(): boolean {
	return useSyncExternalStore(
		(onChange) => {
			const query = window.matchMedia(PHONE_QUERY)
			query.addEventListener('change', onChange)
			return () => query.removeEventListener('change', onChange)
		},
		() => window.matchMedia(PHONE_QUERY).matches
	)
}

/**
 * Keeps `--lb-keyboard` on the document at how much of the window the on-screen keyboard covers, so a
 * card with a text box (the agent's) can sit above it rather than behind it. Zero without a keyboard,
 * and everywhere `visualViewport` is missing.
 */
export function useKeyboardInset(): void {
	useEffect(() => {
		const viewport = window.visualViewport
		if (!viewport) return
		const root = document.documentElement
		const update = () => {
			const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
			root.style.setProperty('--lb-keyboard', `${Math.round(covered)}px`)
		}
		update()
		viewport.addEventListener('resize', update)
		viewport.addEventListener('scroll', update)
		return () => {
			viewport.removeEventListener('resize', update)
			viewport.removeEventListener('scroll', update)
			root.style.removeProperty('--lb-keyboard')
		}
	}, [])
}
