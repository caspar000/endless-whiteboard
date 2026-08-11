import { memo } from 'react'
import { CollectionStrip } from '../../collections/CollectionStrip'
import { PropertyStrip } from '../../properties/PropertyStrip'
import { updateNodeProps, type NodeComponentProps } from '../../registry'
import { toggleTaskAt } from './tasks'
import type { NoteNodeProps } from './definition'
import { MarkdownView } from './MarkdownView'
import { NoteEditor } from './NoteEditor'

/**
 * The note node: rendered markdown in display mode, a live-preview block editor while editing.
 *
 * Display mode has no pointer events (the factory's container sets that), so the note drags and
 * marquee-selects like any other shape. Editing opts back in on its own root — see §4.6.
 */
function NoteNodeComponentImpl({ shape, isEditing, editor }: NodeComponentProps<NoteNodeProps>) {
	const { md } = shape.props

	if (isEditing) {
		return (
			<NoteEditor
				initial={md}
				editor={editor}
				onCommit={(next) => {
					if (next !== shape.props.md) updateNodeProps(editor, shape, { md: next })
				}}
				onExit={() => {
					editor.setEditingShape(null)
					editor.setSelectedShapes([shape.id])
				}}
			/>
		)
	}

	return (
		<div className="lb-note lb-md">
			{md.trim() ? (
				<MarkdownView
					md={md}
					// Checkboxes are live in display mode: ticking something off a list is the most common
					// thing anyone does to a checklist, and needing to enter an editor first to do it is the
					// difference between a note and a document.
					onToggleTask={(index) => {
						const next = toggleTaskAt(md, index)
						// `null` means nothing matched, which must not cost an undo entry.
						if (next !== null) updateNodeProps(editor, shape, { md: next })
					}}
				/>
			) : (
				<p className="lb-md__placeholder">Double-click to write</p>
			)}
			<PropertyStrip shape={shape} editor={editor} />
			<CollectionStrip shape={shape} editor={editor} />
		</div>
	)
}

/**
 * Memoized on what actually affects rendering.
 *
 * `props.h` is deliberately **excluded**: it is derived from `md` and `w` by the auto-height
 * observer, so including it would re-render the editor on every measurement — i.e. on every
 * keystroke, mid-typing. The container's size comes from the ShapeUtil's `HTMLContainer`, which
 * re-renders independently of this component.
 *
 * `meta` **must** be included, and wasn't until properties moved there: a property edit changes only
 * `meta`, so without this the strip below would never update and editing a price would appear to do
 * nothing until the shape was moved.
 */
export const NoteNodeComponent = memo(
	NoteNodeComponentImpl,
	(prev, next) =>
		prev.shape.props.md === next.shape.props.md &&
		prev.shape.props.w === next.shape.props.w &&
		prev.shape.meta === next.shape.meta &&
		prev.isEditing === next.isEditing
)

/** @deprecated Use {@link NoteNodeComponent}. */
export const MarkdownNodeComponent = NoteNodeComponent
