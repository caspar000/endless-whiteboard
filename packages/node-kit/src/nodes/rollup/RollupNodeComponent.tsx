import { memo } from 'react'
import { stopEventPropagation, useValue } from 'tldraw'
import { fieldKeyLabel } from '../../fields'
import type { NodeComponentProps } from '../../registry'
import { formatRollupValue } from './aggregate'
import type { RollupNodeProps } from './definition'
import { getRollupResult } from './engine'
import { NodeEditorPopover } from '../../NodeEditorPopover'
import { RollupConfig } from './RollupConfig'

function RollupNodeComponentImpl({
	shape,
	isEditing,
	editor,
}: NodeComponentProps<RollupNodeProps>) {
	const { title, agg, format } = shape.props

	// Subscribes to this rollup's cache entry. Because the entry is keyed by shape id and its
	// `areResultsEqual` is value-based, this re-renders only when the *numbers* change.
	const result = useValue('rollup', () => getRollupResult(editor, shape.id), [editor, shape.id])

	const grouped = agg.groupBy !== null && result.rows.length > 0
	const valueOf = (n: number) => formatRollupValue(n, format, result.inferredUnit)

	const body = (
		<div className="lb-rollup__body">
			<div className="lb-rollup__header">
				<span className="lb-rollup__title">{title || 'Rollup'}</span>
				<span className="lb-rollup__op">
					{agg.op}
					{agg.fieldKey ? ` · ${fieldKeyLabel(agg.fieldKey)}` : ''}
				</span>
			</div>

			{grouped ? (
				<table className="lb-rollup__table">
					<tbody>
						{result.rows.map((row) => (
							<tr key={row.group ?? '—'}>
								<td className="lb-rollup__group">{row.group}</td>
								<td className="lb-rollup__count">{row.count}</td>
								<td className="lb-rollup__cell">{valueOf(row.value)}</td>
							</tr>
						))}
						<tr className="lb-rollup__total-row">
							<td className="lb-rollup__group">Total</td>
							<td className="lb-rollup__count">{result.matched}</td>
							<td className="lb-rollup__cell">{valueOf(result.total)}</td>
						</tr>
					</tbody>
				</table>
			) : (
				<div className="lb-rollup__value">{valueOf(result.total)}</div>
			)}

			<div className="lb-rollup__meta">
				{result.matched} {result.matched === 1 ? 'node' : 'nodes'}
				{result.skipped > 0 ? ` · ${result.skipped} without a value` : ''}
			</div>
		</div>
	)

	if (!isEditing) return <div className="lb-rollup">{body}</div>

	return (
		<div
			className="lb-rollup lb-rollup--editing"
			onPointerDown={stopEventPropagation}
			onTouchStart={stopEventPropagation}
			onWheel={stopEventPropagation}
			style={{ pointerEvents: 'all' }}
		>
			{body}
			<NodeEditorPopover shape={shape} editor={editor} width={310}>
				<RollupConfig shape={shape} editor={editor} />
			</NodeEditorPopover>
		</div>
	)
}

export const RollupNodeComponent = memo(
	RollupNodeComponentImpl,
	(prev, next) =>
		prev.isEditing === next.isEditing &&
		prev.shape.props === next.shape.props &&
		// A property edit changes only `meta`; without this the shape would not re-render.
		prev.shape.meta === next.shape.meta
)
