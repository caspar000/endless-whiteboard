import { useEffect, useRef } from 'react'
import type { Editor } from 'tldraw'

/**
 * Grows a node's `h` to fit its rendered content.
 *
 * Lives in the factory rather than in a node definition so the guards below are structurally
 * impossible for any node type — present or future — to get wrong. Each of them protects against a
 * failure that actually happens:
 *
 * 1. **Measure an intrinsically-sized *inner* element, never the container.** The container's height
 *    is `props.h`, i.e. our own output; observing it would be a feedback loop by construction.
 * 2. **`ResizeObserver`, not `getBoundingClientRect`.** RO reports *layout* size, unaffected by
 *    ancestor CSS transforms. `getBoundingClientRect` is scaled by tldraw's camera, so the stored
 *    height would depend on the current zoom — a note would grow when you zoomed in.
 * 3. **Ignore non-positive measurements.** tldraw culls off-screen shapes, which fires the observer
 *    with `blockSize === 0`. `h` is validated as `T.nonZeroNumber`, so writing `0` *throws*.
 * 4. **Write from a `requestAnimationFrame`, never synchronously inside the callback.** A store write
 *    inside the callback renders React during a layout pass, producing the browser's
 *    "ResizeObserver loop completed with undelivered notifications" error.
 *
 * The write uses `history: 'ignore'`: `h` is a cache derived from `md` and `w`, not user data. Undo
 * does not restore it, which is correct — undoing the *content* re-triggers the observer and the
 * height re-derives. Without this, every keystroke would push an undo entry.
 */
export function useAutoHeight({
	editor,
	shapeId,
	shapeType,
	currentHeight,
	enabled,
	minHeight,
}: {
	editor: Editor
	shapeId: string
	shapeType: string
	currentHeight: number
	enabled: boolean
	minHeight: number
}) {
	const contentRef = useRef<HTMLDivElement>(null)

	// Read through refs so the observer is created once and never re-subscribes mid-typing.
	const state = useRef({ currentHeight, enabled, minHeight })
	state.current = { currentHeight, enabled, minHeight }

	useEffect(() => {
		const element = contentRef.current
		if (!element) return

		let frame: number | null = null

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0]
			if (!entry) return

			const { enabled: on, minHeight: min, currentHeight: current } = state.current
			if (!on) return

			// Guard 3: a culled or unmounted subtree measures 0, and h must be non-zero.
			const measured = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
			if (!(measured > 0)) return

			const next = Math.max(min, Math.round(measured))
			// Sub-pixel jitter would otherwise write forever.
			if (Math.abs(next - current) <= 1) return

			// Guard 4: defer the write out of the layout pass.
			if (frame !== null) cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => {
				frame = null
				editor.run(
					() => {
						editor.updateShape({
							id: shapeId as never,
							type: shapeType as never,
							props: { h: next },
						} as never)
					},
					{ history: 'ignore' }
				)
			})
		})

		observer.observe(element)
		return () => {
			if (frame !== null) cancelAnimationFrame(frame)
			observer.disconnect()
		}
	}, [editor, shapeId, shapeType])

	return contentRef
}
