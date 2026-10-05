import { Editor as TipTapEditor } from '@tiptap/core'
import { track, useEditor } from '@lifeboard/canvas-editor'
import { useEffect, useState } from 'react'

interface Format {
	id: string
	label: string
	title: string
	isActive: (tiptap: TipTapEditor) => boolean
	run: (tiptap: TipTapEditor) => void
}

const FORMATS: Format[] = [
	{
		id: 'bold',
		label: 'B',
		title: 'Bold',
		isActive: (t) => t.isActive('bold'),
		run: (t) => t.chain().focus().toggleBold().run(),
	},
	{
		id: 'italic',
		label: 'I',
		title: 'Italic',
		isActive: (t) => t.isActive('italic'),
		run: (t) => t.chain().focus().toggleItalic().run(),
	},
	{
		id: 'strike',
		label: 'S',
		title: 'Strikethrough',
		isActive: (t) => t.isActive('strike'),
		run: (t) => t.chain().focus().toggleStrike().run(),
	},
	{
		id: 'code',
		label: '</>',
		title: 'Code',
		isActive: (t) => t.isActive('code'),
		run: (t) => t.chain().focus().toggleCode().run(),
	},
	{
		id: 'bullet-list',
		label: '•',
		title: 'Bulleted list',
		isActive: (t) => t.isActive('bulletList'),
		run: (t) => t.chain().focus().toggleBulletList().run(),
	},
	{
		id: 'ordered-list',
		label: '1.',
		title: 'Numbered list',
		isActive: (t) => t.isActive('orderedList'),
		run: (t) => t.chain().focus().toggleOrderedList().run(),
	},
]

/**
 * Formatting for the label being edited: bold, italic, strikethrough, code and lists, above the
 * shape. Its buttons never take focus, so the selection being formatted stays put.
 */
export const RichTextToolbar = track(function RichTextToolbar() {
	const editor = useEditor()
	const tiptap = editor.getRichTextEditor()
	const shapeId = editor.getEditingShapeId()

	// Re-render as the selection moves, so the active formats are right.
	const [, setVersion] = useState(0)
	useEffect(() => {
		if (!tiptap) return
		const update = () => setVersion((v) => v + 1)
		tiptap.on('transaction', update)
		return () => {
			tiptap.off('transaction', update)
		}
	}, [tiptap])

	if (!tiptap || !shapeId) return null
	const bounds = editor.getShapePageBounds(shapeId)
	if (!bounds) return null
	const top = editor.pageToScreen({ x: bounds.midX, y: bounds.minY })

	return (
		<div
			className="tlui-rich-text-toolbar"
			role="toolbar"
			aria-label="Text formatting"
			style={{ left: top.x, top: top.y }}
			onPointerDown={(e) => {
				e.preventDefault()
				e.stopPropagation()
			}}
		>
			{FORMATS.map((format) => (
				<button
					key={format.id}
					type="button"
					className="tlui-rich-text-toolbar__button"
					data-format={format.id}
					data-active={format.isActive(tiptap)}
					title={format.title}
					aria-label={format.title}
					aria-pressed={format.isActive(tiptap)}
					tabIndex={-1}
					onClick={() => format.run(tiptap)}
				>
					{format.label}
				</button>
			))}
		</div>
	)
})
