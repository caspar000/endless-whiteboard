import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { CatalogueIcon, InlineIconPicker } from '../app/boardLook/iconBridge'
import { DAILY_WIDGETS, REVIEW_WIDGETS, newId, type BlockTemplate, type DailySetup, type Widget, type WidgetType } from './model'
import { updateSetup } from './store'
import { WIDGET_NAMES } from './widgets'

/** What a drag from the Library, or of a widget's grip, carries. */
export const DRAG_TYPE = 'application/x-lifeboard-daily'

export type DragPayload = { kind: 'new'; type: WidgetType; templateId?: string } | { kind: 'move'; id: string }

const DESCRIPTIONS: Record<WidgetType, string> = {
	header: 'Date, weekday strip, week and cycle',
	block: 'A new block of icon tasks to cross out',
	tasks: 'The day’s checklist, with an add row',
	physical: 'Icon tasks, numbers, fasting, food photos',
	pick: 'A daily draw from any list, with stamps',
	focus: 'Follows the week cycle',
	notes: 'Free text for the day',
	reviewLink: 'Opens the weekly review',
	nextWeek: 'Next week’s cycle and evenings',
	weeklyTasks: 'Next week’s tasks, each put on a day',
	rotation: 'Evenings per area over the weeks',
	logs: 'Your log lists: watched, read…',
	habits: 'Filled from the daily pages',
	numbers: 'Totals and averages from the pages',
	creative: 'Goal, done and next per area',
	reflection: 'Your own questions for the week',
	picks: 'The week’s draws, stamps and impressions',
}

type Tab = 'widgets' | 'templates' | 'icons'

export function Library({
	mode,
	setup,
	widgets,
	onAdd,
	onSelect,
}: {
	mode: 'daily' | 'review'
	setup: DailySetup
	widgets: readonly Widget[]
	onAdd: (payload: DragPayload & { kind: 'new' }) => void
	onSelect: (id: string) => void
}) {
	const [tab, setTab] = useState<Tab>('widgets')
	const types = mode === 'daily' ? DAILY_WIDGETS : REVIEW_WIDGETS
	return (
		<aside className="lb-daily-panel lb-daily-library" aria-label="Library">
			<header className="lb-daily-panel__head">
				<h2>Library</h2>
				<span className="lb-daily-faint">Drag to the page</span>
			</header>
			<div className="lb-daily-tabs" role="tablist" aria-label="Library sections">
				{(
					[
						['widgets', 'Widgets'],
						['templates', 'Block templates'],
						['icons', 'Icon tasks'],
					] as const
				).map(([id, label]) => (
					<button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
						{label}
					</button>
				))}
			</div>
			<div className="lb-daily-panel__body" role="tabpanel">
				{tab === 'widgets' && (
					<>
						<p className="lb-daily-faint">
							{mode === 'daily'
								? 'Drag a widget onto a free cell, or press + to put it in the first gap that fits.'
								: 'Review widgets for the weekly page. Drag one onto the review, or press + to put it back.'}
						</p>
						<ul className="lb-daily-libitems">
							{types.map((type) => {
								// Review widgets are one of each: one on the page is selected rather than added again.
								const placed = mode === 'review' ? widgets.find((w) => w.type === type) : undefined
								return (
									<LibraryItem
										key={type}
										name={type === 'block' ? 'Icon-task block' : sentence(WIDGET_NAMES[type])}
										description={DESCRIPTIONS[type]}
										payload={{ kind: 'new', type }}
										placed={!!placed}
										onAdd={() => (placed ? onSelect(placed.id) : onAdd({ kind: 'new', type }))}
									/>
								)
							})}
						</ul>
					</>
				)}
				{tab === 'templates' && <Templates setup={setup} widgets={widgets} onAdd={onAdd} mode={mode} />}
				{tab === 'icons' && <IconTasks setup={setup} />}
			</div>
		</aside>
	)
}

/** `FOCUS OF THE DAY` as `Focus of the day`. */
export function sentence(name: string): string {
	return name === name.toUpperCase() ? name.slice(0, 1) + name.slice(1).toLowerCase() : name
}

function LibraryItem({ name, description, payload, placed, onAdd, disabled }: { name: string; description: string; payload: DragPayload; placed?: boolean; onAdd: () => void; disabled?: boolean }) {
	return (
		<li
			className="lb-daily-libitem"
			draggable={!placed && !disabled}
			onDragStart={(e) => {
				e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload))
				e.dataTransfer.effectAllowed = 'copy'
			}}
		>
			<span className="lb-daily-libitem__text">
				<strong>{name}</strong>
				<span className="lb-daily-faint">{description}</span>
			</span>
			<button
				type="button"
				className="lb-daily-iconbtn lb-daily-libitem__add"
				aria-label={placed ? `${name} is on the page. Select it` : `Add ${name}`}
				title={placed ? 'On the page: select it' : 'Put it in the first gap'}
				disabled={disabled}
				onClick={onAdd}
			>
				{placed ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
			</button>
		</li>
	)
}

function Templates({ setup, widgets, onAdd, mode }: { setup: DailySetup; widgets: readonly Widget[]; onAdd: (payload: DragPayload & { kind: 'new' }) => void; mode: 'daily' | 'review' }) {
	const used = (t: BlockTemplate) => setup.layouts.filter((l) => l.widgets.some((w) => w.config.templateId === t.id)).length
	return (
		<>
			<p className="lb-daily-faint">A block made once and put on any page. Changing it changes every page that uses it.</p>
			<ul className="lb-daily-libitems">
				{setup.templates.map((t) => {
					const onPage = widgets.some((w) => w.config.templateId === t.id)
					const count = t.kind === 'icons' ? t.iconTaskIds.length : t.items.length
					return (
						<LibraryItem
							key={t.id}
							name={t.name || 'Untitled'}
							description={`${t.kind === 'icons' ? 'Icon tasks' : 'Checklist'} · ${count} item${count === 1 ? '' : 's'}${onPage ? ' · on this page' : used(t) ? ` · in ${used(t)} layout${used(t) === 1 ? '' : 's'}` : ''}`}
							payload={{ kind: 'new', type: 'block', templateId: t.id }}
							disabled={mode === 'review'}
							onAdd={() => onAdd({ kind: 'new', type: 'block', templateId: t.id })}
						/>
					)
				})}
			</ul>
			<button
				type="button"
				className="lb-daily-dashed"
				onClick={() =>
					updateSetup((s) => ({ ...s, templates: [...s.templates, { id: newId('b'), name: 'NEW BLOCK', kind: 'checklist', iconTaskIds: [], items: [] }] }))
				}
			>
				<Plus size={14} aria-hidden="true" /> New block template
			</button>
		</>
	)
}

function IconTasks({ setup }: { setup: DailySetup }) {
	const [picking, setPicking] = useState<string | null>(null)
	const rename = (id: string, name: string) => updateSetup((s) => ({ ...s, iconTasks: s.iconTasks.map((t) => (t.id === id ? { ...t, name } : t)) }))
	const setIcon = (id: string, icon: string) => updateSetup((s) => ({ ...s, iconTasks: s.iconTasks.map((t) => (t.id === id ? { ...t, icon } : t)) }))
	const remove = (id: string) =>
		updateSetup((s) => ({
			...s,
			iconTasks: s.iconTasks.filter((t) => t.id !== id),
			templates: s.templates.map((t) => ({ ...t, iconTaskIds: t.iconTaskIds.filter((x) => x !== id) })),
		}))
	return (
		<>
			<p className="lb-daily-faint">Recurring tasks drawn as tiles you cross out. Put them in a block template to use them.</p>
			<ul className="lb-daily-icontasks">
				{setup.iconTasks.map((t) => (
					<li key={t.id}>
						<div className="lb-daily-icontask">
							<button type="button" className="lb-daily-tile lb-daily-tile--small" aria-label={`Change ${t.name}'s icon`} title="Change the icon" onClick={() => setPicking(picking === t.id ? null : t.id)}>
								<span className="lb-daily-tile__icon">{t.icon ? <CatalogueIcon name={t.icon} size={16} /> : <Pencil size={14} aria-hidden="true" />}</span>
							</button>
							<input className="lb-daily-input" value={t.name} aria-label="Icon task name" onChange={(e) => rename(t.id, e.target.value)} />
							<button type="button" className="lb-daily-iconbtn" aria-label={`Delete ${t.name}`} title="Delete it from every block" onClick={() => remove(t.id)}>
								<Trash2 size={13} aria-hidden="true" />
							</button>
						</div>
						{picking === t.id && (
							<InlineIconPicker
								value={t.icon}
								onPick={(name) => {
									setIcon(t.id, name ?? '')
									setPicking(null)
								}}
							/>
						)}
					</li>
				))}
			</ul>
			<button
				type="button"
				className="lb-daily-dashed"
				onClick={() => {
					const id = newId('i')
					updateSetup((s) => ({ ...s, iconTasks: [...s.iconTasks, { id, name: 'New task', icon: '' }] }))
					setPicking(id)
				}}
			>
				<Plus size={14} aria-hidden="true" /> Add icon task
			</button>
		</>
	)
}
