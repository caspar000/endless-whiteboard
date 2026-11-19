import { DOUBLE_CLICK_DURATION, isValidUrl, type Editor, type TLBookmarkShape, type TLShapeId } from '@lifeboard/canvas'

/**
 * Opening a link card's link on a click (or a tap, on a phone in Hand: `phoneMode.ts`).
 *
 * After a double-click's worth of waiting, because a second click makes it a double-click, which
 * edits the card (or, in Hand, opens Quick look) instead. One click waits at a time.
 */
let pending: { id: TLShapeId; timer: ReturnType<typeof setTimeout> } | null = null

/**
 * A click on this card: the link opens once no second click follows. Says whether this click was the
 * second, which the caller treats as the double-click it is.
 */
export function clickToOpen(editor: Editor, id: TLShapeId): 'first' | 'second' {
	if (pending?.id === id) {
		cancelOpen()
		return 'second'
	}
	cancelOpen()
	pending = {
		id,
		timer: setTimeout(() => {
			pending = null
			// A double-click that went another way (straight into editing) still means no open.
			if (editor.getEditingShapeId() === id) return
			const url = editor.getShape<TLBookmarkShape>(id)?.props.url ?? ''
			if (isValidUrl(url)) window.open(url, '_blank', 'noopener,noreferrer')
		}, DOUBLE_CLICK_DURATION),
	}
	return 'first'
}

/** Forgets a click still waiting: it turned out to be part of something else. */
export function cancelOpen(): void {
	if (pending) clearTimeout(pending.timer)
	pending = null
}
