import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { CatalogueIcon } from '../app/boardLook/iconBridge'
import { newId, type BlockContents, type DailySetup, type TaskText } from './model'

/** The Inspector's and the Library's form parts. */

export function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="lb-daily-field">
			<span className="lb-daily-label">{label}</span>
			{children}
		</div>
	)
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
	return (
		<label className="lb-daily-toggle">
			<span>{label}</span>
			<input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
		</label>
	)
}

/** Lines of text to edit, reorder and add to. */
export function TextList({ items, placeholder, onChange }: { items: readonly TaskText[]; placeholder: string; onChange: (items: TaskText[]) => void }) {
	return (
		<div className="lb-daily-textlist">
			{items.map((item, i) => (
				<div key={item.id} className="lb-daily-textlist__row">
					<input className="lb-daily-input" value={item.text} aria-label={placeholder} onChange={(e) => onChange(items.map((x) => (x.id === item.id ? { ...x, text: e.target.value } : x)))} />
					<Reorder i={i} n={items.length} onMove={(to) => onChange(move(items, i, to))} />
					<button type="button" className="lb-daily-iconbtn" aria-label={`Remove ${item.text}`} onClick={() => onChange(items.filter((x) => x.id !== item.id))}>
						<X size={12} aria-hidden="true" />
					</button>
				</div>
			))}
			<button type="button" className="lb-daily-dashed" onClick={() => onChange([...items, { id: newId('x'), text: '' }])}>
				<Plus size={13} aria-hidden="true" /> Add
			</button>
		</div>
	)
}

export function move<T>(items: readonly T[], from: number, to: number): T[] {
	const out = [...items]
	const [item] = out.splice(from, 1)
	out.splice(to, 0, item!)
	return out
}

export function Reorder({ i, n, onMove }: { i: number; n: number; onMove: (to: number) => void }) {
	return (
		<>
			<button type="button" className="lb-daily-iconbtn" aria-label="Move up" disabled={i === 0} onClick={() => onMove(i - 1)}>
				<ArrowUp size={12} aria-hidden="true" />
			</button>
			<button type="button" className="lb-daily-iconbtn" aria-label="Move down" disabled={i === n - 1} onClick={() => onMove(i + 1)}>
				<ArrowDown size={12} aria-hidden="true" />
			</button>
		</>
	)
}

/** A block's icon tasks and checklist: a template's, or one block's own. */
export function ContentsEditor({ setup, contents, onChange }: { setup: DailySetup; contents: BlockContents; onChange: (contents: BlockContents) => void }) {
	const { iconTaskIds, items } = contents
	const setIcons = (next: string[]) => onChange({ iconTaskIds: next, items })
	return (
		<>
			<Field label={`Icon tasks · ${iconTaskIds.length}`}>
				<div className="lb-daily-textlist">
					{iconTaskIds.map((id, i) => {
						const task = setup.iconTasks.find((t) => t.id === id)
						return (
							<div key={id} className="lb-daily-textlist__row">
								<span className="lb-daily-tile lb-daily-tile--small" aria-hidden="true">
									<span className="lb-daily-tile__icon">{task?.icon ? <CatalogueIcon name={task.icon} size={14} /> : null}</span>
								</span>
								<span className="lb-daily-textlist__name">{task?.name ?? 'Deleted'}</span>
								<Reorder i={i} n={iconTaskIds.length} onMove={(to) => setIcons(move(iconTaskIds, i, to))} />
								<button type="button" className="lb-daily-iconbtn" aria-label={`Take ${task?.name ?? 'it'} out`} onClick={() => setIcons(iconTaskIds.filter((x) => x !== id))}>
									<X size={12} aria-hidden="true" />
								</button>
							</div>
						)
					})}
					<select className="lb-daily-select" value="" aria-label="Add an icon task" onChange={(e) => e.target.value && setIcons([...iconTaskIds, e.target.value])}>
						<option value="">+ Add icon task</option>
						{setup.iconTasks
							.filter((t) => !iconTaskIds.includes(t.id))
							.map((t) => (
								<option key={t.id} value={t.id}>
									{t.name}
								</option>
							))}
					</select>
					<span className="lb-daily-faint">Make new icon tasks in the Library’s Icon tasks tab.</span>
				</div>
			</Field>
			<Field label={`Checklist · ${items.length}`}>
				<TextList items={items} placeholder="A checklist item" onChange={(next) => onChange({ iconTaskIds, items: next })} />
				<span className="lb-daily-faint">Shown under the icon tasks.</span>
			</Field>
		</>
	)
}
