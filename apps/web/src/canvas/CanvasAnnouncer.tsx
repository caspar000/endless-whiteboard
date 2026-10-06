import { getNativeShape, getNodeDefinition, isRelation, shapeLabel } from '@lifeboard/node-kit'
import { useEffect, useState } from 'react'
import { react, useEditor, type Editor, type TLShape } from '@lifeboard/canvas'

/**
 * What a screen reader hears about the board (docs/fork-parity.md A2): the selection as it changes —
 * what kind of shape and what it says, or how many — and the tool when it changes. A polite live
 * region, so it waits for whatever is being read; and settled for a moment first, so a drag across a
 * crowd of shapes is one announcement, not one per shape it touched.
 *
 * Mounted in every board, but a hidden board's region is hidden with it, so only the board on screen
 * is ever heard.
 */
export function CanvasAnnouncer() {
	const editor = useEditor()
	const [message, setMessage] = useState('')

	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined
		let first = true
		const stop = react('lifeboard:announce', () => {
			const next = describe(editor)
			// Nothing to say when the board opens; only changes are news.
			if (first) {
				first = false
				return
			}
			clearTimeout(timer)
			timer = setTimeout(() => setMessage(next), SETTLE_MS)
		})
		return () => {
			stop()
			clearTimeout(timer)
		}
	}, [editor])

	return (
		<div className="lb-sr-only" role="status" aria-live="polite" data-testid="lb.announcer">
			{message}
		</div>
	)
}

const SETTLE_MS = 250

function describe(editor: Editor): string {
	const tool = editor.getCurrentToolId()
	const selected = editor.getSelectedShapes()
	if (tool !== 'select') return `${toolName(editor, tool)} tool`
	if (selected.length === 0) return 'Nothing selected'
	if (selected.length > 1) return `${selected.length} shapes selected`
	const shape = selected[0]!
	const label = shapeLabel(editor, shape)
	return label ? `${kindOf(editor, shape)}: ${label}` : kindOf(editor, shape)
}

/** A shape's kind as the dock and the node picker call it. */
export function kindOf(editor: Editor, shape: TLShape): string {
	const node = getNodeDefinition(shape.type)
	if (node) return node.label
	if (shape.type === 'geo') return capitalise(String((shape.props as { geo: string }).geo).replace(/-/g, ' '))
	if (shape.type === 'arrow') return isRelation(editor, shape) ? 'Relation' : 'Arrow'
	return getNativeShape(shape.type)?.label ?? KINDS[shape.type] ?? capitalise(shape.type)
}

const KINDS: Record<string, string> = {
	draw: 'Drawing',
	highlight: 'Highlight',
	line: 'Line',
	image: 'Image',
	video: 'Video',
	bookmark: 'Link',
	embed: 'Embed',
	group: 'Group',
}

const TOOLS: Record<string, string> = {
	hand: 'Hand',
	arrow: 'Relation',
	note: 'Sticky note',
	'pinned-note': 'Pinned note',
	draw: 'Pen',
	highlight: 'Highlighter',
	eraser: 'Eraser',
	geo: 'Shape',
	text: 'Text',
	frame: 'Frame',
	laser: 'Laser',
}

function toolName(editor: Editor, tool: string): string {
	return getNodeDefinition(tool)?.label ?? TOOLS[tool] ?? capitalise(tool)
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
