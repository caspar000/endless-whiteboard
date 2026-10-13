import { useLayoutEffect, useState } from 'react'

/** Longer than the last of sixteen items takes to arrive (`.lb-stagger` in styles.css). */
const ARRIVAL_MS = 700

/**
 * `'lb-stagger'` while a list is arriving, then nothing. For lists whose items change as you type (the
 * palette, the pickers): there, a result appearing for a new query should just be there, and only
 * opening the list should stagger.
 *
 * `open` is for a list whose component stays mounted while closed: each opening arrives again. Switched
 * on in a layout effect, so a reopened list never paints a frame fully drawn before it rises.
 */
export function useStaggerIn(open = true): string {
	const [arriving, setArriving] = useState(open)
	useLayoutEffect(() => {
		if (!open) return
		setArriving(true)
		const timer = setTimeout(() => setArriving(false), ARRIVAL_MS)
		return () => clearTimeout(timer)
	}, [open])
	return open && arriving ? 'lb-stagger' : ''
}
