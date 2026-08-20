import { useCallback, useRef, useState } from 'react'

const WIDTH_KEY = 'lifeboard:agentPanel:width'

/**
 * The panel's width when nobody has dragged it.
 *
 * Wider than the 372px it started at, and the reason is what a board transcript actually holds: file
 * paths, tool arguments, node names and fenced code. Those are the strings that wrap worst, so at 372
 * a good share of the column went on two-word orphan lines. Still a minority of any normal window,
 * because the board is the thing being worked on and the panel only narrates it.
 */
const AGENT_WIDTH_DEFAULT = 440

/** Below this the composer's model and effort menus stop fitting beside the send button. */
const MIN_WIDTH = 320

/** Past this it is not a side panel any more. */
const MAX_WIDTH = 760

/** Whatever the window, the board keeps at least this much of it — the panel cannot squeeze it out. */
const BOARD_RESERVE = 420

/**
 * The nominal range is a pair of constants, but the usable one depends on the window: on a laptop
 * screen `MAX_WIDTH` would leave the canvas a sliver, so the reserve wins there. `MIN_WIDTH` is the
 * floor either way — a window too narrow to honour the reserve gets an overlay panel instead (see
 * the 900px media query), not an unusably thin one.
 */
function clamp(px: number): number {
	const max = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - BOARD_RESERVE))
	return Math.round(Math.min(Math.max(px, MIN_WIDTH), max))
}

function loadWidth(): number {
	try {
		const stored = Number(localStorage.getItem(WIDTH_KEY))
		if (Number.isFinite(stored) && stored > 0) return clamp(stored)
	} catch {
		// Use the default when storage is unavailable.
	}
	return clamp(AGENT_WIDTH_DEFAULT)
}

/** Everything the divider needs, so the panel can render it at its own edge without owning the state. */
export interface AgentDivider {
	width: number
	onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
	onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
	onDoubleClick: () => void
}

/**
 * The agent panel's width, remembered across reloads.
 *
 * Lives up in the shell rather than in the panel because the width *is* a shell fact: it is one of
 * the grid's three columns, so the board's width is whatever this leaves. The panel only draws the
 * handle.
 */
export function useAgentPanelWidth(): { divider: AgentDivider; resizing: boolean } {
	const [width, setWidth] = useState(loadWidth)
	const [resizing, setResizing] = useState(false)

	/**
	 * The width the last drag or keypress settled on.
	 *
	 * Kept beside the state because the arrow keys step from the current width, and reading it from
	 * the closure would step from whatever it was when the handler was created.
	 */
	const current = useRef(width)

	const resize = useCallback((px: number) => {
		const next = clamp(px)
		current.current = next
		setWidth(next)
	}, [])

	const save = useCallback(() => {
		try {
			localStorage.setItem(WIDTH_KEY, String(current.current))
		} catch {
			// The width still holds for this session when private storage rejects the write.
		}
	}, [])

	const onPointerDown = useCallback(
		(event: React.PointerEvent<HTMLElement>) => {
			// Primary button only, so a right-click on the divider does not leave a drag running.
			if (event.button !== 0) return
			event.preventDefault()
			const handle = event.currentTarget
			/*
			 * Pointer capture rather than window listeners, because of what is on the other side of the
			 * divider: tldraw. Without capture, a drag that outruns the handle lands on the canvas, which
			 * reads it as a canvas gesture and pans the board under the panel while you are resizing it.
			 * Capture also means the release is delivered here even if it happens off-window.
			 */
			handle.setPointerCapture(event.pointerId)
			setResizing(true)

			// Measured from the right edge of the window, because that is the edge the panel is docked to.
			const onMove = (move: PointerEvent) => resize(window.innerWidth - move.clientX)
			const onUp = () => {
				handle.removeEventListener('pointermove', onMove)
				handle.removeEventListener('pointerup', onUp)
				handle.removeEventListener('pointercancel', onUp)
				setResizing(false)
				// Written once on release rather than on every move: a drag is one decision, not fifty.
				save()
			}
			handle.addEventListener('pointermove', onMove)
			handle.addEventListener('pointerup', onUp)
			handle.addEventListener('pointercancel', onUp)
		},
		[resize, save]
	)

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLElement>) => {
			// Left grows the panel: the key moves the divider, which is what the focus ring is on.
			const step = event.shiftKey ? 48 : 16
			if (event.key === 'ArrowLeft') resize(current.current + step)
			else if (event.key === 'ArrowRight') resize(current.current - step)
			else if (event.key === 'Home') resize(AGENT_WIDTH_DEFAULT)
			else return
			event.preventDefault()
			save()
		},
		[resize, save]
	)

	const onDoubleClick = useCallback(() => {
		resize(AGENT_WIDTH_DEFAULT)
		save()
	}, [resize, save])

	return { divider: { width, onPointerDown, onKeyDown, onDoubleClick }, resizing }
}

/**
 * The drag handle between the board and the panel.
 *
 * A focusable `separator` rather than a bare div: the arrow keys are the only way to reach this
 * without a pointer, and a resize you cannot perform from the keyboard is a layout the keyboard
 * cannot use. It is a few pixels of hit area straddling the panel's 1px border, so the line stays
 * hairline while the target stays hittable.
 */
export function AgentResizeDivider({
	width,
	onPointerDown,
	onKeyDown,
	onDoubleClick,
}: AgentDivider) {
	return (
		<div
			className="lb-agent-panel__divider"
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize agent panel"
			aria-valuenow={width}
			aria-valuemin={MIN_WIDTH}
			aria-valuemax={MAX_WIDTH}
			tabIndex={0}
			onPointerDown={onPointerDown}
			onKeyDown={onKeyDown}
			onDoubleClick={onDoubleClick}
			title="Drag to resize — double-click to reset"
		/>
	)
}
