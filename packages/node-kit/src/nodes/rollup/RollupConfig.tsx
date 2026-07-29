import { useValue, type Editor } from 'tldraw'
import { collectFieldKeys, collectTags } from '../../facts'
import { fieldKeyLabel } from '../../fields'
import { updateNodeProps, type NodeShape } from '../../registry'
import { AGG_OPS, FORMAT_STYLES, SOURCE_SCOPES, type AggOp, type FormatStyle, type SourceScope } from './aggregate'
import type { RollupNodeProps } from './definition'
import { getPageFacts } from './engine'

/**
 * Rollup configuration UI. Every picker is populated from what actually exists on the board
 * (§4.2) — field keys and tags come from the live facts map, frames from the current page. That is
 * what makes field-key typos self-correcting: a mistyped key simply never appears as an option.
 */
export function RollupConfig({
	shape,
	editor,
}: {
	shape: NodeShape<RollupNodeProps>
	editor: Editor
}) {
	const { title, source, agg, format } = shape.props

	const facts = useValue('facts', () => getPageFacts(editor).get(), [editor])
	const fieldKeys = collectFieldKeys(facts, source.nodeType)
	const tags = collectTags(facts)
	const frames = useValue(
		'frames',
		() =>
			editor
				.getCurrentPageShapes()
				.filter((s) => s.type === 'frame')
				.map((s) => ({ id: s.id, name: (s.props as { name?: string }).name || 'Frame' })),
		[editor]
	)

	const update = (props: Partial<RollupNodeProps>) => updateNodeProps(editor, shape, props)

	return (
		<div className="lb-rollup__config">
			<label className="lb-rollup__row">
				<span>Title</span>
				<input
					aria-label="Rollup title"
					value={title}
					onChange={(e) => update({ title: e.currentTarget.value })}
					onKeyDown={(e) => e.stopPropagation()}
				/>
			</label>

			<label className="lb-rollup__row">
				<span>Scope</span>
				<select
					aria-label="Scope"
					value={source.scope}
					onChange={(e) => update({ source: { ...source, scope: e.currentTarget.value as SourceScope } })}
				>
					{SOURCE_SCOPES.map((s) => (
						<option key={s} value={s}>
							{s === 'page' ? 'whole board' : s === 'frame' ? 'inside frame' : 'by tag'}
						</option>
					))}
				</select>
			</label>

			{source.scope === 'frame' && (
				<label className="lb-rollup__row">
					<span>Frame</span>
					<select
						aria-label="Frame"
						value={source.frameId ?? ''}
						onChange={(e) => update({ source: { ...source, frameId: e.currentTarget.value || null } })}
					>
						<option value="">— pick a frame —</option>
						{frames.map((f) => (
							<option key={f.id} value={f.id}>
								{f.name}
							</option>
						))}
					</select>
				</label>
			)}

			{source.scope === 'tags' && (
				<div className="lb-rollup__row">
					<span>Tags</span>
					<div className="lb-rollup__tags">
						{tags.length === 0 && <em className="lb-rollup__hint">No tags on this board yet</em>}
						{tags.map((tag) => {
							const on = source.tags.includes(tag)
							return (
								<button
									key={tag}
									className={on ? 'lb-rollup__tag lb-rollup__tag--on' : 'lb-rollup__tag'}
									onClick={() =>
										update({
											source: {
												...source,
												tags: on ? source.tags.filter((t) => t !== tag) : [...source.tags, tag],
											},
										})
									}
								>
									{tag}
								</button>
							)
						})}
					</div>
				</div>
			)}

			<label className="lb-rollup__row">
				<span>Operation</span>
				<select
					aria-label="Operation"
					value={agg.op}
					onChange={(e) => update({ agg: { ...agg, op: e.currentTarget.value as AggOp } })}
				>
					{AGG_OPS.map((op) => (
						<option key={op} value={op}>
							{op}
						</option>
					))}
				</select>
			</label>

			{agg.op !== 'count' && (
				<label className="lb-rollup__row">
					<span>Field</span>
					<select
						aria-label="Field"
						value={agg.fieldKey ?? ''}
						onChange={(e) => update({ agg: { ...agg, fieldKey: e.currentTarget.value || null } })}
					>
						<option value="">— pick a field —</option>
						{fieldKeys.map((k) => (
							<option key={k} value={k}>
								{fieldKeyLabel(k)}
							</option>
						))}
					</select>
				</label>
			)}

			<label className="lb-rollup__row">
				<span>Group by</span>
				<select
					aria-label="Group by"
					value={agg.groupBy ?? ''}
					onChange={(e) => update({ agg: { ...agg, groupBy: e.currentTarget.value || null } })}
				>
					<option value="">— none —</option>
					{fieldKeys.map((k) => (
						<option key={k} value={k}>
							{fieldKeyLabel(k)}
						</option>
					))}
				</select>
			</label>

			<label className="lb-rollup__row">
				<span>Format</span>
				<select
					aria-label="Format"
					value={format.style}
					onChange={(e) => update({ format: { ...format, style: e.currentTarget.value as FormatStyle } })}
				>
					{FORMAT_STYLES.map((s) => (
						<option key={s} value={s}>
							{s}
						</option>
					))}
				</select>
			</label>

			{format.style === 'currency' && (
				<label className="lb-rollup__row">
					<span>Currency</span>
					<input
						aria-label="Currency"
						value={format.unit ?? ''}
						placeholder="GEL"
						onChange={(e) => {
							const unit = e.currentTarget.value.trim()
							update({ format: unit ? { ...format, style: format.style, unit } : { style: format.style } })
						}}
						onKeyDown={(e) => e.stopPropagation()}
					/>
				</label>
			)}
		</div>
	)
}
