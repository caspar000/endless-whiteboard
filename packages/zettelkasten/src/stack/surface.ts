import type { Editor } from '@lifeboard/canvas'

/**
 * What the box's two full-screen surfaces, the stack and the chain, both need to know about a key or a
 * press before they act on it.
 */

/** Whether this editor's board is the one on screen: a tab in the background keeps its editor. */
export function onScreen(editor: Editor): boolean {
	const container = editor.getContainer()
	return (
		container.isConnected &&
		getComputedStyle(container).visibility !== 'hidden' &&
		container.getClientRects().length > 0
	)
}

/** Somewhere text is being typed: the card's own editor, the jump field, the palette. */
export function typingIn(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

/** A press on something of the card's own (a chip, a link, the picker), which is not a press on its text. */
export function onControl(target: EventTarget): boolean {
	return (target as HTMLElement).closest('.lb-zchip, .lb-zlink, .lb-zpick, .lb-zcard__foot, .lb-zsource__form') !== null
}
