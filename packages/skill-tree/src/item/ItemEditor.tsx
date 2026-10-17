import { useState, type KeyboardEvent } from 'react'
import { formatChildRule, ITEM_KINDS, makeItemId, parseChildRule } from '../model'
import { putItems, updateItem, type ItemDef } from '../syllabus'
import { MEDIA } from '../templates'

/** Keys typed in a field belong to the field, not to the board's shortcuts. */
const keepKeys = (e: KeyboardEvent) => e.stopPropagation()

/**
 * An item's own settings: its title, what kind of thing it is, which skill nodes it feeds, and how
 * its works decide it is done. Edits go to the vault, so every view of the item changes with them.
 */
export function ItemEditor({ item }: { item: ItemDef }) {
	const [workTitle, setWorkTitle] = useState('')
	const rule = parseChildRule(item.childRule)
	const set = (patch: Partial<ItemDef>) => updateItem(item.itemId, patch)

	const addWork = () => {
		const title = workTitle.trim()
		if (!title) return
		putItems([
			{
				itemId: `${item.itemId}/${makeItemId(title)}`,
				title,
				kind: '',
				medium: item.medium === 'book' ? 'work' : item.medium,
				tags: [],
				core: false,
				childRule: 'core',
				parent: item.itemId,
				children: [],
				done: false,
				doneAt: '',
				draft: item.draft,
			},
		])
		setWorkTitle('')
	}

	return (
		<div className="lb-skill-editor">
			<label>
				<span>Title</span>
				<input autoFocus value={item.title} onKeyDown={keepKeys} onChange={(e) => set({ title: e.target.value })} />
			</label>
			<div className="lb-skill-editor__pair">
				<label>
					<span>Kind</span>
					<select value={item.kind} onChange={(e) => set({ kind: e.target.value })}>
						<option value="">None</option>
						{ITEM_KINDS.map((kind) => (
							<option key={kind}>{kind}</option>
						))}
					</select>
				</label>
				<label>
					<span>Medium</span>
					<select value={item.medium} onChange={(e) => set({ medium: e.target.value })}>
						<option value="">None</option>
						{MEDIA.map((medium) => (
							<option key={medium}>{medium}</option>
						))}
					</select>
				</label>
			</div>
			{item.parent && (
				<label className="lb-skill-editor__check">
					<input type="checkbox" checked={item.core} onChange={(e) => set({ core: e.target.checked })} />
					<span>Core to its parent</span>
				</label>
			)}
			{item.children.length > 0 && (
				<label>
					<span>Done when</span>
					<select
						value={rule.kind}
						onChange={(e) => {
							const kind = e.target.value
							set({ childRule: formatChildRule(kind === 'n' ? { kind: 'n', n: 1 } : kind === 'all' ? { kind: 'all' } : { kind: 'core' }) })
						}}
					>
						<option value="core">its core works are done</option>
						<option value="all">all its works are done</option>
						<option value="n">some of its works are done</option>
					</select>
				</label>
			)}
			{rule.kind === 'n' && item.children.length > 0 && (
				<label>
					<span>How many</span>
					<input
						type="number"
						min={1}
						value={rule.n}
						onKeyDown={keepKeys}
						onChange={(e) => set({ childRule: formatChildRule({ kind: 'n', n: Math.max(1, Number(e.target.value) || 1) }) })}
					/>
				</label>
			)}
			<label>
				<span>Tags</span>
				<input
					value={item.tags.join(', ')}
					placeholder="skill node ids, comma-separated"
					onKeyDown={keepKeys}
					onChange={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
				/>
			</label>
			<div className="lb-skill-editor__add">
				<input
					value={workTitle}
					placeholder="Add a work…"
					onKeyDown={(e) => {
						e.stopPropagation()
						if (e.key === 'Enter') addWork()
					}}
					onChange={(e) => setWorkTitle(e.target.value)}
				/>
				<button type="button" onClick={addWork} disabled={!workTitle.trim()}>
					Add
				</button>
			</div>
			<p className="lb-skill-editor__id">{item.itemId}</p>
		</div>
	)
}
