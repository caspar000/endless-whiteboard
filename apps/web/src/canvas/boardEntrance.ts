import type { Editor } from '@lifeboard/canvas'

/** However many shapes are on screen, they arrive in this many waves, so a busy board is as quick. */
const STEPS = 16
/** Past the last wave's arrival: the stagger step and duration are tokens, so this errs long. */
const DONE_MS = 1000

/**
 * A board's shapes rise into place one after another the first time it opens, roughly in reading
 * order: top to bottom, and left to right within a band. Only the shapes on screen take part; the rest
 * are culled, and arrive as they always have when the camera reaches them.
 *
 * Opacity and `translate` only: a shape is positioned by its inline `transform`, which a `scale` or a
 * `transform` keyframe would fight. Runs once per editor, from `onMount`, so switching back to an open
 * tab is instant as before. Returns a cancel for an editor unmounted mid-entrance.
 */
export function playBoardEntrance(editor: Editor): () => void {
	const container = editor.getContainer()
	let timer: ReturnType<typeof setTimeout> | undefined
	// Two frames: one for the shapes to render, one for them to be laid out.
	let frame = requestAnimationFrame(() => {
		frame = requestAnimationFrame(start)
	})

	function start() {
		const view = container.getBoundingClientRect()
		// A shape can draw in two elements, its body and its background; both carry its id.
		const byShape = new Map<string, HTMLElement[]>()
		for (const el of container.querySelectorAll<HTMLElement>('.tl-shape[data-shape-id]')) {
			const id = el.dataset.shapeId!
			byShape.set(id, [...(byShape.get(id) ?? []), el])
		}
		const shown = [...byShape.values()]
			.map((els) => ({ els, at: els[0]!.getBoundingClientRect() }))
			.filter(({ at }) => at.width > 0 && at.bottom > view.top && at.top < view.bottom && at.right > view.left && at.left < view.right)
		if (!shown.length) return

		shown.sort((a, b) => a.at.top + a.at.left / 2 - (b.at.top + b.at.left / 2))
		// Marked one by one rather than by a class on the board, so a shape made in the first second
		// is simply there, not rising under the pointer that made it.
		shown.forEach(({ els }, i) => {
			const wave = String(Math.floor((i * Math.min(STEPS, shown.length)) / shown.length))
			for (const el of els) {
				el.style.setProperty('--enter-i', wave)
				el.dataset.entering = ''
			}
		})
		timer = setTimeout(finish, DONE_MS)
	}

	function finish() {
		for (const el of container.querySelectorAll<HTMLElement>('.tl-shape[data-entering]')) {
			delete el.dataset.entering
			el.style.removeProperty('--enter-i')
		}
	}

	return () => {
		cancelAnimationFrame(frame)
		if (timer !== undefined) {
			clearTimeout(timer)
			finish()
		}
	}
}
