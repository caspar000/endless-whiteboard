import { memo } from 'react'
import { useValue } from 'tldraw'
import { CollectionStrip } from '../../collections/CollectionStrip'
import { renderExpressions } from '../../collections/expressions'
import { getPageEdges, getPageFacts } from '../rollup/engine'
import { PropertyStrip } from '../../properties/PropertyStrip'
import { getCurrentRates } from '../../properties/rates'
import { propertyMap, readPropertyRegistry } from '../../properties/schema'
import { readShapeProperties, readShapePropertyUnits } from '../../properties/values'
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

	/*
	 * `{…}` resolved for display only — the source keeps the expression.
	 *
	 * That asymmetry is the feature: you edit `{sum price}` and read ₾1,540. It also means the editor
	 * below never sees a substitution, so typing is never fighting a value that rewrites itself.
	 *
	 * Cheap when there is nothing to do: `renderExpressions` returns the string untouched if it holds
	 * no brace at all, which is almost every note.
	 */
	const rendered = useValue(
		'lifeboard:note-expressions',
		() =>
			renderExpressions(md, {
				facts: getPageFacts(editor).get(),
				edges: getPageEdges(editor).get(),
				properties: propertyMap(readPropertyRegistry(editor)),
				rates: getCurrentRates(),
				selfId: shape.id,
				values: readShapeProperties(shape),
				units: readShapePropertyUnits(shape),
			}),
		// `shape.meta` rather than `shape`: auto-height rewrites the record on every measurement, and
		// depending on the whole thing would re-run this mid-render for a value that cannot have moved.
		[editor, md, shape.id, shape.meta]
	)

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
					md={rendered}
					// Checkboxes are live in display mode: ticking something off a list is the most common
					// thing anyone does to a checklist, and needing to enter an editor first to do it is the
					// difference between a note and a document.
					// Against the *source*, never the rendered text: expressions never change the line
					// structure, so the indices agree.
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
