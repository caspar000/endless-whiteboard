import { X } from 'lucide-react'
import { useEffect, type RefObject } from 'react'

/** Where the popover may sit before it is nudged back on screen. */
const WIDTH = 380
const MAX_HEIGHT = 260
const MARGIN = 12

/** Client coordinates of the reference a note hangs from. */
export interface NoteAnchor {
	left: number
	top: number
	bottom: number
}

/**
 * A footnote, shown where you are rather than where it lives.
 *
 * This is the fix for the oldest annoyance in digital reading: tapping a reference throws you to
 * the back of the book, and nothing offers to bring you back. Keeping the note under the sentence
 * that raised it means never leaving the page at all — the reference stops being a trapdoor.
 *
 * The body is a `<foliate-view>` holding the note and nothing else — a real rendered fragment of
 * the book, so its markup, emphasis and links survive. *The parent appends it*, into `hostRef`,
 * and this element is therefore always in the document even with no note to show: foliate renders
 * the fragment as soon as it is handed over, and an element that is not yet in the page has no
 * size to render into. Hence `hidden` rather than unmounting.
 */
export function FootnotePopover({
	anchor,
	hostRef,
	onClose,
}: {
	/** The open note's reference point, or null when there is none. */
	anchor: NoteAnchor | null
	hostRef: RefObject<HTMLDivElement | null>
	onClose(): void
}) {
	// Dismiss on anything that isn't the note itself: reading on is the common case, and a note
	// that needs to be dismissed deliberately is worse than one that lingers a moment too long.
	useEffect(() => {
		if (!anchor) return
		const onDown = (event: PointerEvent) => {
			const popover = hostRef.current?.closest('.lb-reader__note')
			if (!popover?.contains(event.target as Node)) onClose()
		}
		// Deferred: the click that opened this is still propagating.
		const timer = setTimeout(() => document.addEventListener('pointerdown', onDown), 0)
		return () => {
			clearTimeout(timer)
			document.removeEventListener('pointerdown', onDown)
		}
	}, [anchor, hostRef, onClose])

	// Prefer below the reference, flip above when there is no room, and never off the side.
	const room = anchor ? window.innerHeight - anchor.bottom : 0
	const above = anchor ? room < MAX_HEIGHT + MARGIN && anchor.top > room : false
	const left = anchor
		? Math.min(Math.max(MARGIN, anchor.left - WIDTH / 2), window.innerWidth - WIDTH - MARGIN)
		: 0

	return (
		<div
			className="lb-reader__note"
			hidden={!anchor}
			style={{
				left,
				width: WIDTH,
				height: MAX_HEIGHT,
				...(above && anchor
					? { bottom: window.innerHeight - anchor.top + 8 }
					: { top: (anchor?.bottom ?? 0) + 8 }),
			}}
		>
			<button
				type="button"
				className="lb-reader__note-close"
				onClick={onClose}
				aria-label="Close note"
			>
				<X size={13} aria-hidden />
			</button>
			<div className="lb-reader__note-body" ref={hostRef} />
		</div>
	)
}
