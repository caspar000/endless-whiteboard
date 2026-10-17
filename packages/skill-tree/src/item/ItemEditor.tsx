import { updateShapeProperties } from '@lifeboard/node-kit'
import type { Editor } from '@lifeboard/canvas'
import { useState, type KeyboardEvent } from 'react'
import { ITEM_TYPE, type ItemShape, type SkillItemProps } from '../board'
import { formatChildRule, ITEM_KINDS, parseChildRule } from '../model'
import { ensureProperties, hideOnCard, PROP_ID, readText } from '../properties'
import { MEDIA } from '../templates'

/** Keys typed in a field belong to the field, not to the board's shortcuts. */
const keepKeys = (e: KeyboardEvent) => e.stopPropagation()

/**
 * The item's own settings: its title, what kind of thing it is, and how its children decide it is
 * done. Kind and Medium are properties, so they also show (and can be edited) in the properties panel.
 */
export function ItemEditor({
	item,
	editor,
	onAddChild,
}: {
	item: ItemShape
	editor: Editor
	onAddChild: (title: string) => void
}) {
	const [childTitle, setChildTitle] = useState('')
	const rule = parseChildRule(item.props.childRule)

	const setProps = (props: Partial<SkillItemProps>) =>
		editor.updateShape({ id: item.id, type: ITEM_TYPE, props } as never)

	const setProperty = (key: 'kind' | 'medium', value: string) => {
		ensureProperties(editor, [key])
		const fresh = editor.getShape(item.id)
		if (fresh) updateShapeProperties(editor, fresh, { [PROP_ID[key]]: value || null })
		hideOnCard(editor, item.id, [key])
	}

	const addChild = () => {
		const title = childTitle.trim()
		if (!title) return
		onAddChild(title)
		setChildTitle('')
	}

	return (
		<div className="lb-skill-editor">
			<label>
				<span>Title</span>
				<input
					autoFocus
					value={item.props.title}
					onKeyDown={keepKeys}
					onChange={(e) => setProps({ title: e.target.value })}
				/>
			</label>
			<div className="lb-skill-editor__pair">
				<label>
					<span>Kind</span>
					<select value={readText(item, 'kind')} onChange={(e) => setProperty('kind', e.target.value)}>
						<option value="">None</option>
						{ITEM_KINDS.map((kind) => (
							<option key={kind}>{kind}</option>
						))}
					</select>
				</label>
				<label>
					<span>Medium</span>
					<select value={readText(item, 'medium')} onChange={(e) => setProperty('medium', e.target.value)}>
						<option value="">None</option>
						{MEDIA.map((medium) => (
							<option key={medium}>{medium}</option>
						))}
					</select>
				</label>
			</div>
			{item.props.parentId && (
				<label className="lb-skill-editor__check">
					<input type="checkbox" checked={item.props.core} onChange={(e) => setProps({ core: e.target.checked })} />
					<span>Core to its parent</span>
				</label>
			)}
			<label>
				<span>Done when</span>
				<select
					value={rule.kind}
					onChange={(e) => {
						const kind = e.target.value
						setProps({
							childRule: formatChildRule(kind === 'n' ? { kind: 'n', n: 1 } : kind === 'all' ? { kind: 'all' } : { kind: 'core' }),
						})
					}}
				>
					<option value="core">its core children are done</option>
					<option value="all">all its children are done</option>
					<option value="n">some of its children are done</option>
				</select>
			</label>
			{rule.kind === 'n' && (
				<label>
					<span>How many</span>
					<input
						type="number"
						min={1}
						value={rule.n}
						onKeyDown={keepKeys}
						onChange={(e) => setProps({ childRule: formatChildRule({ kind: 'n', n: Math.max(1, Number(e.target.value) || 1) }) })}
					/>
				</label>
			)}
			<label>
				<span>Tags</span>
				<input
					value={item.props.tags}
					placeholder="skill node ids, comma-separated"
					onKeyDown={keepKeys}
					onChange={(e) => setProps({ tags: e.target.value })}
				/>
			</label>
			<div className="lb-skill-editor__add">
				<input
					value={childTitle}
					placeholder="Add a child item…"
					onKeyDown={(e) => {
						e.stopPropagation()
						if (e.key === 'Enter') addChild()
					}}
					onChange={(e) => setChildTitle(e.target.value)}
				/>
				<button type="button" onClick={addChild} disabled={!childTitle.trim()}>
					Add
				</button>
			</div>
			<p className="lb-skill-editor__id">{item.props.itemId}</p>
		</div>
	)
}
