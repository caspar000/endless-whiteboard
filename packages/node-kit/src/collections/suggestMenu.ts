import type { Suggestion } from './suggest'

/**
 * The `{…}` menu itself — one popup, shared by both editors.
 *
 * The rules already lived in one place (`suggest.ts`), but the *menu* did not: the note used
 * CodeMirror's built-in completion widget and every other shape used this. Same order, same words,
 * and still not the same thing — different DOM, different key handling, different filtering, so the
 * two felt subtly unalike in exactly the way that makes an app feel unfinished. Now both editors
 * render this and nothing else.
 *
 * Deliberately plain DOM. It has to work inside a ProseMirror plugin view, whose lifecycle is not
 * React's, and mounting it in the body rather than in either editor keeps it clear of the canvas
 * transform — a menu drawn inside a shape would be scaled by the zoom and clipped by the shape.
 */

export interface MenuItems {
	items: Suggestion[]
	selected: number
	/** Where to hang the menu: the caret's viewport rectangle. */
	caret: { left: number; bottom: number }
}

export class SuggestMenu {
	private readonly dom: HTMLElement
	/**
	 * What was last *rendered*, not what the editor currently thinks.
	 *
	 * A click reaches this after the editor has blurred, and a blurred editor reports no caret — so
	 * asking it where the expression was is asking the wrong moment. The menu answers from the state
	 * it was drawn with instead, which is by definition the state the person was looking at when they
	 * decided to click.
	 */
	private shown: MenuItems | null = null

	constructor(private readonly onPick: (item: Suggestion) => void) {
		this.dom = document.createElement('div')
		this.dom.className = 'lb-suggest'
		this.dom.setAttribute('role', 'listbox')
		this.dom.style.display = 'none'
		// Pointer-down, not click: both editors blur on mousedown, and the default action has to be
		// stopped before that happens rather than after.
		this.dom.addEventListener('pointerdown', (event) => {
			event.preventDefault()
			event.stopPropagation()
			const row = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
			const item = row && this.shown?.items[Number(row.dataset.index)]
			if (item) this.onPick(item)
		})
		document.body.appendChild(this.dom)
	}

	render(state: MenuItems | null): void {
		this.shown = state
		if (!state || state.items.length === 0) {
			this.dom.style.display = 'none'
			return
		}
		this.dom.replaceChildren(
			...state.items.map((item, i) => {
				const row = document.createElement('div')
				const on = i === state.selected
				row.className = on ? 'lb-suggest__row lb-suggest__row--on' : 'lb-suggest__row'
				row.dataset.index = String(i)
				row.setAttribute('role', 'option')
				row.setAttribute('aria-selected', String(on))
				const label = document.createElement('span')
				label.className = 'lb-suggest__label'
				label.textContent = item.label
				const detail = document.createElement('span')
				detail.className = 'lb-suggest__detail'
				detail.textContent = item.detail
				row.append(label, detail)
				return row
			})
		)
		this.dom.style.display = 'block'
		this.dom.style.left = `${Math.round(state.caret.left)}px`
		this.dom.style.top = `${Math.round(state.caret.bottom + 4)}px`
		/*
		 * Scrolled *within the menu* by hand rather than with `scrollIntoView`.
		 *
		 * That call walks up the tree and scrolls every scrollable ancestor it finds, which from inside
		 * a shape's editor means scrolling the editor — and moving the caret out of the expression the
		 * menu is about, which closes the menu mid-sequence. Only this box should ever move.
		 */
		const row = this.dom.children[state.selected] as HTMLElement | undefined
		if (row) {
			const top = row.offsetTop
			const bottom = top + row.offsetHeight
			if (top < this.dom.scrollTop) this.dom.scrollTop = top
			else if (bottom > this.dom.scrollTop + this.dom.clientHeight) {
				this.dom.scrollTop = bottom - this.dom.clientHeight
			}
		}
	}

	/** Whether a menu is on screen — the gate every key handler checks before claiming a key. */
	get open(): boolean {
		return this.shown !== null && this.shown.items.length > 0
	}

	destroy(): void {
		this.dom.remove()
	}
}

/** Moves the highlight, wrapping at both ends. Shared so both editors wrap the same way. */
export function stepSelection(selected: number, delta: number, length: number): number {
	if (length === 0) return 0
	return (selected + delta + length) % length
}
