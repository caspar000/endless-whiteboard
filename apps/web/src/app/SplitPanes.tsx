import { useRef, type CSSProperties, type RefObject } from 'react'
import { MIN_SPLIT_SIZE, type PaneRect } from './tabsModel'

/** The gap between the panes of a split, in px. */
const GAP = 8

/** How far an arrow key moves the divider, in percent. */
const KEYBOARD_STEP = 5

/**
 * Where a pane of a split sits in the page area: its rect (`paneRects`), less half the gap on each side
 * that meets another pane. Placed by position rather than nested in columns, so splitting, resizing or
 * ending a split never moves a page in the DOM, and a board in it keeps its editor.
 */
export function paneStyle(rect: PaneRect): CSSProperties {
	const half = GAP / 2
	const inset = (start: number, size: number) => ({
		start: start > 0.1 ? half : 0,
		end: start + size < 99.9 ? half : 0,
	})
	const x = inset(rect.left, rect.width)
	const y = inset(rect.top, rect.height)
	return {
		left: `calc(${rect.left}% + ${x.start}px)`,
		width: `calc(${rect.width}% - ${x.start + x.end}px)`,
		top: `calc(${rect.top}% + ${y.start}px)`,
		height: `calc(${rect.height}% - ${y.start + y.end}px)`,
		right: 'auto',
		bottom: 'auto',
	}
}

/**
 * The handle between a split's columns, as oritask's: dragging it moves the left column's share live
 * through `onDrag`, and letting go keeps it through `onCommit`. Arrow keys move it in steps.
 */
export function SplitDivider({
	size,
	containerRef,
	onDrag,
	onCommit,
}: {
	size: number
	containerRef: RefObject<HTMLDivElement | null>
	onDrag: (size: number) => void
	onCommit: (size: number) => void
}) {
	const dragged = useRef<number | null>(null)

	const sizeAt = (clientX: number) => {
		const box = containerRef.current?.getBoundingClientRect()
		if (!box?.width) return null
		const percent = ((clientX - box.left) / box.width) * 100
		return Math.min(100 - MIN_SPLIT_SIZE, Math.max(MIN_SPLIT_SIZE, percent))
	}

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize the split"
			aria-valuenow={Math.round(size)}
			aria-valuemin={MIN_SPLIT_SIZE}
			aria-valuemax={100 - MIN_SPLIT_SIZE}
			tabIndex={0}
			className="lb-split-divider"
			style={{ left: `calc(${size}% - ${GAP / 2}px)`, width: GAP }}
			onPointerDown={(e) => {
				e.preventDefault()
				e.currentTarget.setPointerCapture(e.pointerId)
				dragged.current = size
			}}
			onPointerMove={(e) => {
				if (dragged.current === null) return
				const next = sizeAt(e.clientX)
				if (next === null) return
				dragged.current = next
				onDrag(next)
			}}
			onPointerUp={(e) => {
				if (dragged.current === null) return
				e.currentTarget.releasePointerCapture(e.pointerId)
				onCommit(dragged.current)
				dragged.current = null
			}}
			onKeyDown={(e) => {
				if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
				e.preventDefault()
				// The canvas would otherwise pan with the arrows.
				e.stopPropagation()
				onCommit(size + (e.key === 'ArrowRight' ? KEYBOARD_STEP : -KEYBOARD_STEP))
			}}
		>
			<span className="lb-split-divider__grip" />
		</div>
	)
}
