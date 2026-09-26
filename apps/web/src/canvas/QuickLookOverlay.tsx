import { useEffect } from 'react'
import { useEditor, useValue } from 'tldraw'
import {
	closeQuickLook,
	getQuickLook,
	getQuickLookShapeId,
	refitQuickLook,
	stepQuickLook,
} from './quickLook'

/** Screen pixels of sharp board kept around the node, so it doesn't sit flush against the blur. */
const PAD = 12
const RADIUS = 14

/**
 * The blur behind a Quick look: one layer over the whole canvas with a hole cut where the node is.
 *
 * `clip-path` clips hit-testing as well as painting, so the node inside the hole stays clickable and
 * editable while a click anywhere on the blur closes the preview. The hole follows the camera, which
 * is what keeps it on the node while the zoom animates.
 *
 * Also owns the preview's own keys, which are not commands: Esc closes, ← and → step. Space is the
 * `view.quick-look` command, so it toggles through the keymap like any other binding.
 */
export function QuickLookOverlay() {
	const editor = useEditor()

	const hole = useValue(
		'lifeboard:quick-look-hole',
		() => {
			const id = getQuickLookShapeId(editor)
			const bounds = id && editor.getShapePageBounds(id)
			if (!bounds) return null
			const min = editor.pageToViewport({ x: bounds.x, y: bounds.y })
			const max = editor.pageToViewport({ x: bounds.maxX, y: bounds.maxY })
			const viewport = editor.getViewportScreenBounds()
			return {
				x: min.x - PAD,
				y: min.y - PAD,
				w: max.x - min.x + PAD * 2,
				h: max.y - min.y + PAD * 2,
				vw: viewport.w,
				vh: viewport.h,
			}
		},
		[editor]
	)

	// The shape went away under the preview — deleted, or undone out of existence.
	const orphaned = useValue(
		'lifeboard:quick-look-orphaned',
		() => {
			const id = getQuickLookShapeId(editor)
			return id !== null && !editor.getShape(id)
		},
		[editor]
	)
	useEffect(() => {
		if (orphaned) closeQuickLook(editor, { animate: false })
	}, [orphaned, editor])

	// The camera is locked, so a resized window would leave the node off-centre without this.
	const viewportSize = useValue(
		'lifeboard:quick-look-viewport',
		() => {
			const { w, h } = editor.getViewportScreenBounds()
			return `${w}x${h}`
		},
		[editor]
	)
	useEffect(() => {
		refitQuickLook(editor)
	}, [viewportSize, editor])

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!getQuickLook(editor)) return
			// Another tab's board, or the palette talking over this one.
			if (!editor.getInstanceState().isFocused) return
			// While editing, keys belong to the editor: Esc stops editing first, arrows move the caret.
			if (editor.getEditingShapeId() !== null || editor.menus.hasAnyOpenMenus()) return
			if (event.metaKey || event.ctrlKey || event.altKey) return

			switch (event.key) {
				case 'Escape':
					closeQuickLook(editor)
					break
				case 'ArrowRight':
					stepQuickLook(editor, 1)
					break
				case 'ArrowLeft':
					stepQuickLook(editor, -1)
					break
				// Swallowed so they don't nudge the shape being looked at.
				case 'ArrowUp':
				case 'ArrowDown':
					break
				default:
					return
			}
			event.preventDefault()
			event.stopPropagation()
		}
		window.addEventListener('keydown', onKeyDown, { capture: true })
		return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
	}, [editor])

	if (!hole) return null

	return (
		<div
			className="lb-quick-look"
			data-testid="lb.quick-look"
			style={{ clipPath: `path(evenodd, "${holePath(hole)}")` }}
			onPointerDown={(event) => {
				event.stopPropagation()
				editor.setEditingShape(null)
				closeQuickLook(editor)
			}}
		/>
	)
}

/** The viewport, minus a rounded rectangle. `evenodd` is what makes the inner path a hole. */
function holePath({ x, y, w, h, vw, vh }: Record<'x' | 'y' | 'w' | 'h' | 'vw' | 'vh', number>) {
	const r = Math.min(RADIUS, w / 2, h / 2)
	return (
		`M0 0H${vw}V${vh}H0Z` +
		`M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}` +
		`V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
		`H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
		`V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
	)
}
