import { getNodeDefinitions } from '@lifeboard/node-kit'
import { useEffect, useRef } from 'react'
import { createShapeId, stopEventPropagation, type Editor, type TLShapePartial } from 'tldraw'

export interface NodeCreatePrompt {
	/** Where on the page the node should be created (the double-clicked point). */
	page: { x: number; y: number }
	/** Where to draw the menu, in screen coordinates. */
	screen: { x: number; y: number }
}

/**
 * The menu shown when you double-click empty canvas.
 *
 * tldraw's default is to create a text shape there. In an app where the whole premise is that
 * elements are *typed nodes*, defaulting to the one untyped shape is the wrong answer — so
 * `createTextOnCanvasDoubleClick` is off and this asks instead.
 *
 * Entries come from the node registry (§7), so a new node type — or later a plugin's — appears here
 * with no change to this file. Text is offered too, since it is genuinely useful for labelling a
 * diagram and is what the gesture used to do.
 */
const MENU_WIDTH = 232
const MENU_MARGIN = 8

export function NodeCreateMenu({
	editor,
	prompt,
	onClose,
}: {
	editor: Editor
	prompt: NodeCreatePrompt
	onClose: () => void
}) {
	const ref = useRef<HTMLDivElement>(null)

	/**
	 * Dismiss on Escape or an outside pointer-down.
	 *
	 * Bound to the *document*, not to `editor.getContainer()`. The menu renders alongside the editor
	 * rather than inside it, so once focus moves to a menu item the container never sees the keystroke
	 * — an earlier container-scoped listener meant Escape simply did nothing.
	 */
	useEffect(() => {
		const onPointerDown = (e: PointerEvent) => {
			if (!ref.current?.contains(e.target as Node)) onClose()
		}
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				// Stop it here: tldraw also treats Escape as "deselect", and the menu closing is the
				// only thing the user asked for.
				e.stopPropagation()
				onClose()
			}
		}
		document.addEventListener('pointerdown', onPointerDown, { capture: true })
		document.addEventListener('keydown', onKeyDown, { capture: true })
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, { capture: true })
			document.removeEventListener('keydown', onKeyDown, { capture: true })
		}
	}, [onClose])

	useEffect(() => {
		// Focus the first entry so the menu is keyboard-drivable straight away.
		const frame = requestAnimationFrame(() =>
			ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
		)
		return () => cancelAnimationFrame(frame)
	}, [])

	const create = (type: string) => {
		const def = getNodeDefinitions().find((d) => d.type === type)
		const id = createShapeId()

		editor.run(() => {
			editor.markHistoryStoppingPoint('create node')
			if (def) {
				// Centre the node on the point that was double-clicked, which is where the user was
				// looking — creating it with its corner there feels offset by half a card.
				const { w, h } = def.defaultSize
				editor.createShapes([
					{
						id,
						type: def.type,
						x: prompt.page.x - w / 2,
						y: prompt.page.y - h / 2,
					} as unknown as TLShapePartial,
				])
			} else {
				editor.createShapes([
					{ id, type: 'text', x: prompt.page.x, y: prompt.page.y, props: { autoSize: true } },
				])
			}
			editor.select(id)
		})

		// Straight into editing: double-clicking to make a node and then having to double-click it
		// again to type in it would be a silly two-step.
		const shape = editor.getShape(id)
		if (shape && editor.canEditShape(shape)) editor.setEditingShape(id)

		onClose()
	}

	const viewport = editor.getViewportScreenBounds()
	const left = Math.max(
		MENU_MARGIN,
		Math.min(prompt.screen.x, viewport.w - MENU_WIDTH - MENU_MARGIN)
	)
	const top = Math.max(MENU_MARGIN, Math.min(prompt.screen.y, viewport.h - 220))

	return (
		<div
			ref={ref}
			className="lb-create-menu"
			style={{ left, top, width: MENU_WIDTH }}
			role="menu"
			aria-label="Create a node"
			onPointerDown={stopEventPropagation}
			onWheel={stopEventPropagation}
		>
			<div className="lb-create-menu__label">Add to board</div>
			{getNodeDefinitions().map((def) => (
				<button
					key={def.type}
					className="lb-create-menu__item"
					role="menuitem"
					onClick={() => create(def.type)}
				>
					<span className="lb-create-menu__icon">{def.icon}</span>
					<span className="lb-create-menu__name">{def.label}</span>
					<span className="lb-create-menu__hint">{DESCRIPTIONS[def.type] ?? ''}</span>
				</button>
			))}
			<button className="lb-create-menu__item" role="menuitem" onClick={() => create('text')}>
				<span className="lb-create-menu__icon">T</span>
				<span className="lb-create-menu__name">Text</span>
				<span className="lb-create-menu__hint">Plain label</span>
			</button>
		</div>
	)
}

/** One line each, so the menu explains what a "rollup" is at the moment you'd wonder. */
const DESCRIPTIONS: Record<string, string> = {
	'node.markdown': 'Notes, lists, headings',
	'node.item': 'Record with typed fields',
	'node.rollup': 'Live total over items',
}
