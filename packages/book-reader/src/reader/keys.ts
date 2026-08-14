/**
 * Whether a keystroke belongs to something else on screen.
 *
 * The reader and its settings both listen for Escape on the *window*, in the capture phase, because
 * focus while reading may sit almost anywhere — the page, a control in the panel, the book's own
 * iframe — and a listener on any one of them would miss the others. That reach is also the hazard:
 * a surface opened *over* the reader has focus, and its Escape is not the reader's to read. Closing
 * the command palette should close the palette, not quietly dismiss the settings panel behind it.
 *
 * The test is "is something outside us taking typed input", which is what a palette, a rename box
 * and a search field all are, rather than a list of the app's own class names — a package has no
 * business knowing those, and the rule is the honest one anyway.
 */
export function typingElsewhere(container: Element): boolean {
	const active = document.activeElement
	// The common case while reading: focus is on the body or the canvas, and the key is ours.
	if (!active || container.contains(active)) return false
	return (
		active instanceof HTMLInputElement ||
		active instanceof HTMLTextAreaElement ||
		(active instanceof HTMLElement && active.isContentEditable)
	)
}
