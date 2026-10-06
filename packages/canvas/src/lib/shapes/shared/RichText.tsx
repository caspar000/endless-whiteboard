import {
	Extension,
	Editor as TipTapEditor,
	type EditorOptions as TipTapEditorOptions,
	type JSONContent,
} from '@tiptap/core'
import {
	TLRichText,
	TLShapeId,
	TLUnknownShape,
	getPointerInfo,
	renderHtmlFromRichText,
	stopEventPropagation,
	useEditor,
	useValue,
} from '@lifeboard/canvas-editor'
import { goToNextNote, isNoteLike, type NoteDirection } from '../note/nextNote'
import classNames from 'classnames'
import React, { useLayoutEffect, useRef } from 'react'

interface RichTextProps {
	shapeId: TLShapeId
	shapeType: string
	richText: TLRichText
	/** Classes for the text box, the same whether it is drawn or being edited. */
	className?: string
	style?: React.CSSProperties
}

/**
 * A shape's rich-text label: drawn as HTML, and edited in place with TipTap while the shape is being
 * edited. Text shapes, notes, geo labels and arrow labels all use it.
 */
export function RichText(props: RichTextProps) {
	const editor = useEditor()
	const isEditing = useValue('isEditing', () => editor.getEditingShapeId() === props.shapeId, [
		editor,
		props.shapeId,
	])
	if (isEditing) return <RichTextEditor {...props} />
	return (
		<div
			className={classNames('tl-text tl-text-content tl-rich-text', props.className)}
			style={props.style}
			dir="auto"
			dangerouslySetInnerHTML={{
				__html: renderHtmlFromRichText(props.richText, editor.getTextExtensions()),
			}}
		/>
	)
}

/**
 * Tab outside a list indents with two spaces, as the 2023 labels did, rather than moving focus off
 * the canvas. Lower priority than the list keymap, so in a list Tab still nests the item.
 */
const LabelTab = Extension.create({
	name: 'lifeboardLabelTab',
	priority: 1,
	addKeyboardShortcuts() {
		return {
			Tab: () => this.editor.commands.insertContent('  '),
			'Shift-Tab': () => true,
		}
	},
})

function RichTextEditor({ shapeId, shapeType, className, style }: RichTextProps) {
	const editor = useEditor()
	const rContainer = useRef<HTMLDivElement>(null)

	useLayoutEffect(() => {
		const element = rContainer.current
		// Every shape that draws a label this way has `richText`.
		const shape = editor.getShape(shapeId) as (TLUnknownShape & { props: { richText: TLRichText } }) | undefined
		if (!element || !shape) return

		const config: Partial<TipTapEditorOptions> = editor.getTextOptions().tipTapConfig ?? {}
		const tiptap = new TipTapEditor({
			...config,
			element,
			extensions: [...editor.getTextExtensions(), LabelTab],
			content: shape.props.richText as JSONContent,
			editorProps: {
				...config.editorProps,
				attributes: { class: 'tl-rich-text', spellcheck: 'true' },
			},
			onUpdate: (update) => {
				config.onUpdate?.(update)
				editor.updateShapes<TLUnknownShape & { props: { richText: TLRichText } }>([
					{ id: shapeId, type: shapeType, props: { richText: update.editor.getJSON() as TLRichText } },
				])
			},
			onBlur: (blur) => {
				config.onBlur?.(blur)
				// Focus can leave for a moment (a menu, a toolbar button); only stop editing if the
				// editor has moved on, otherwise take it back.
				requestAnimationFrame(() => {
					if (tiptap.isDestroyed) return
					const editingId = editor.getEditingShapeId()
					if (editingId === shapeId) tiptap.commands.focus()
					else if (editingId === null) editor.complete()
				})
			},
		})
		editor.setRichTextEditor(tiptap)
		// Start with everything selected, as the 2023 labels did, so typing replaces it.
		tiptap.commands.focus(tiptap.isEmpty ? 'end' : 'all')

		return () => {
			if (editor.getRichTextEditor() === tiptap) editor.setRichTextEditor(null)
			tiptap.destroy()
		}
	}, [editor, shapeId, shapeType])

	return (
		<div
			ref={rContainer}
			className={classNames('tl-text tl-rich-text-editor', className)}
			style={style}
			dir="auto"
			onKeyDownCapture={(e) => {
				// Writing a note: Tab and Shift+Tab go on to the next note right or left, ⌘Enter and
				// ⌘⇧Enter below or above, making it if it isn't there (B3). Before the text sees them.
				const direction = noteKeyDirection(e)
				if (direction && isNoteLike(editor.getShape(shapeId))) {
					e.preventDefault()
					stopEventPropagation(e)
					goToNextNote(editor, shapeId, direction)
				}
			}}
			onKeyDown={(e) => {
				// Formatting and undo shortcuts belong to the text, not the canvas.
				if (e.ctrlKey || e.metaKey) stopEventPropagation(e)
				if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) editor.complete()
			}}
			onPointerDown={(e) => {
				// The canvas still hears the press, on this shape, so editing carries on; the text
				// keeps it for placing the caret.
				editor.dispatch({
					...getPointerInfo(e),
					type: 'pointer',
					name: 'pointer_down',
					target: 'shape',
					shape: editor.getShape(shapeId)!,
				})
				stopEventPropagation(e)
			}}
			onDoubleClick={stopEventPropagation}
			onContextMenu={stopEventPropagation}
			onTouchEnd={stopEventPropagation}
		/>
	)
}

function noteKeyDirection(e: React.KeyboardEvent): NoteDirection | null {
	const accel = e.metaKey || e.ctrlKey
	if (e.key === 'Tab' && !accel && !e.altKey) return e.shiftKey ? 'left' : 'right'
	if (e.key === 'Enter' && accel && !e.altKey) return e.shiftKey ? 'above' : 'below'
	return null
}
