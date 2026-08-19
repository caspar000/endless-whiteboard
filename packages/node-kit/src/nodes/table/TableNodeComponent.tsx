import { memo } from 'react'
import { stopEventPropagation, useValue } from 'tldraw'
import { NodeEditorPopover } from '../../NodeEditorPopover'
import { propertyMap, readPropertyRegistry } from '../../properties/schema'
import type { NodeComponentProps } from '../../registry'
import { getTableResult } from './engine'
import { TableConfig } from './TableConfig'
import { getViewDefinition } from './views'
import type { TableNodeProps } from './spec'

/**
 * Below this zoom a row of cells is a few pixels tall and unreadable, so the table collapses to the
 * headline number it would otherwise bury. Chosen to match the point at which the 11px cell text stops
 * being legible rather than a round number.
 */
const COLLAPSE_ZOOM = 0.35

/**
 * The node's chrome, and the dispatcher that picks a view.
 *
 * Everything specific to *how* the answer is drawn lives in `views/` — this owns only what is true of
 * every view: the title, the row count, the skipped-rows note, and the zoom collapse. Adding a view
 * therefore never touches this file, which is the point of the registry it reads.
 */
function TableNodeComponentImpl({ shape, isEditing, editor }: NodeComponentProps<TableNodeProps>) {
	const { title, layout } = shape.props

	// Subscribes to this table's cache entry. Its `areResultsEqual` is structural, so this re-renders
	// only when what it displays actually changes — not on every board edit.
	const result = useValue('table', () => getTableResult(editor, shape.id), [editor, shape.id])
	const properties = useValue('table-properties', () => propertyMap(readPropertyRegistry(editor)), [
		editor,
	])
	// Zoom, unlike everything above, is *expected* to change constantly — but it lives in a
	// session-scoped record the facts pipeline never reads, so this costs a re-render of this component
	// and nothing downstream (§4.3).
	const zoom = useValue('zoom', () => editor.getZoomLevel(), [editor])

	/*
	 * Zoomed out far enough, every view collapses to the big number — which is to say the collapse is
	 * not a special rendering mode, it is a fall back to the `value` view. That equivalence is why this
	 * stays one line as views are added: a kanban seen from across the board should show its total, the
	 * same as a table does.
	 */
	const mode = zoom < COLLAPSE_ZOOM && !isEditing ? 'value' : layout.mode
	const view = getViewDefinition(mode)
	const blocked = view?.blockedReason?.(shape.props, properties) ?? null
	const View = view?.component
	const rendered =
		blocked || !View ? (
			<div className="lb-table__empty">{blocked ?? 'This view is not available'}</div>
		) : (
			<View
				id={shape.id}
				result={result}
				props={shape.props}
				properties={properties}
				width={shape.props.w}
				height={shape.props.h}
			/>
		)

	/*
	 * A `fills` view replaces the chrome rather than sitting inside it — see `ViewDefinition.fills`. It
	 * is still given the blocked state in the shared frame, because "group by something" has to be
	 * readable on a card that has not been configured yet, and a half-drawn kanban is not the place to
	 * say it.
	 */
	const fills = view?.fills === true && !blocked
	const body = fills ? (
		rendered
	) : (
		<div className="lb-table__body">
			<div className="lb-table__header">
				<span className="lb-table__title">{title || 'Table'}</span>
				<span className="lb-table__count">
					{result.matched} {result.matched === 1 ? 'row' : 'rows'}
				</span>
			</div>

			{rendered}

			{result.skipped > 0 && <div className="lb-table__meta">{result.skipped} without a value</div>}
		</div>
	)

	// `--fills` makes the card full-height, which is what lets a view lay itself out against the shape's
	// own box instead of against its content.
	const className = fills ? 'lb-table lb-table--fills' : 'lb-table'

	if (!isEditing) return <div className={className}>{body}</div>

	return (
		<div
			className={`${className} lb-table--editing`}
			onPointerDown={stopEventPropagation}
			onTouchStart={stopEventPropagation}
			style={{ pointerEvents: 'all' }}
		>
			{body}
			<NodeEditorPopover shape={shape} editor={editor} width={340}>
				<TableConfig shape={shape} editor={editor} />
			</NodeEditorPopover>
		</div>
	)
}

export const TableNodeComponent = memo(
	TableNodeComponentImpl,
	(prev, next) =>
		prev.isEditing === next.isEditing &&
		prev.shape.props === next.shape.props &&
		// A property edit changes only `meta` — a table can carry properties like any other shape.
		prev.shape.meta === next.shape.meta
)
