import { useValue } from '@lifeboard/canvas'
import { offeredItemSources, sourceKey } from '@lifeboard/node-kit'
import { ArrowDown, ArrowUp, Copy, Minus, Plus, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { BoardMeta } from '../boards/boardIndex'
import { CatalogueIcon } from '../app/boardLook/iconBridge'
import { sentence } from './Library'
import {
	WEEKDAYS,
	newId,
	type BlockTemplate,
	type DailySetup,
	type LogColumn,
	type TaskText,
	type TrackRef,
	type TrackRow,
	type Widget,
} from './model'
import { rowName } from './reviewWidgets'
import { updateSetup } from './store'
import { WIDGET_NAMES, widgetTitle } from './widgets'

export function Inspector({
	mode,
	setup,
	widget,
	focus,
	boards,
	grid,
	onChange,
	onRemove,
	onClose,
}: {
	mode: 'daily' | 'review'
	setup: DailySetup
	widget: Widget | null
	/** The day's focus, for a focus widget's tasks. */
	focus: string
	boards: readonly BoardMeta[]
	grid: { rows: number }
	onChange: (widget: Widget) => void
	onRemove: (id: string) => void
	onClose: () => void
}) {
	if (!widget) {
		return (
			<aside className="lb-daily-panel lb-daily-inspector" aria-label="Inspector">
				<header className="lb-daily-panel__head">
					<h2>Inspector</h2>
					<span className="lb-daily-faint">Page settings</span>
				</header>
				<div className="lb-daily-panel__body">
					<p className="lb-daily-faint">Select a widget on the page to change it. These settings are the whole page’s.</p>
					<PageSettings setup={setup} />
				</div>
			</aside>
		)
	}
	const template = setup.templates.find((t) => t.id === widget.config.templateId)
	const set = (config: Partial<Widget['config']>) => onChange({ ...widget, config: { ...widget.config, ...config } })
	const title = widgetTitle(widget, setup.templates)
	return (
		<aside className="lb-daily-panel lb-daily-inspector" aria-label="Inspector">
			<header className="lb-daily-panel__head">
				<h2>Inspector</h2>
				<button type="button" className="lb-daily-linkbtn" onClick={onClose}>
					Page settings
				</button>
			</header>
			<div className="lb-daily-panel__body">
				<p className="lb-daily-inspector__what">
					<strong>{title}</strong>
					<span className="lb-daily-faint">
						{sentence(WIDGET_NAMES[widget.type])} · Col {widget.col + 1} · Row {widget.row + 1}
						{widget.h > 1 ? `–${widget.row + widget.h}` : ''}
					</span>
				</p>

				{widget.type === 'block' && template ? (
					<Field label="Name">
						<input className="lb-daily-input" value={template.name} onChange={(e) => updateTemplate(template.id, { name: e.target.value })} />
					</Field>
				) : (
					widget.type !== 'header' && (
						<Field label="Title">
							<input
								className="lb-daily-input"
								value={widget.title ?? ''}
								placeholder={title}
								onChange={(e) => {
									const { title: _, ...rest } = widget
									onChange(e.target.value ? { ...rest, title: e.target.value } : rest)
								}}
							/>
						</Field>
					)
				)}

				<Field label="Height on grid">
					<div className="lb-daily-stepper">
						<button type="button" className="lb-daily-iconbtn" aria-label="One row shorter" disabled={widget.h <= 1} onClick={() => onChange({ ...widget, h: widget.h - 1 })}>
							<Minus size={14} aria-hidden="true" />
						</button>
						<span>
							{widget.h} row{widget.h === 1 ? '' : 's'}
						</span>
						<button type="button" className="lb-daily-iconbtn" aria-label="One row taller" disabled={widget.row + widget.h >= grid.rows} onClick={() => onChange({ ...widget, h: widget.h + 1 })}>
							<Plus size={14} aria-hidden="true" />
						</button>
						<span className="lb-daily-faint">or drag its bottom edge</span>
					</div>
				</Field>

				{(widget.type === 'block' || widget.type === 'physical') && (
					<TemplateSection setup={setup} widget={widget} template={template} onTemplate={(templateId) => set({ templateId })} />
				)}
				{widget.type === 'physical' && <PhysicalSection setup={setup} widget={widget} set={set} />}
				{widget.type === 'pick' && <PickSection widget={widget} boards={boards} set={set} />}
				{widget.type === 'focus' && <FocusSection setup={setup} focus={focus} />}
				{widget.type === 'tasks' && (
					<Toggle label="Carry unticked tasks to the next page" checked={setup.carryTasks} onChange={(carryTasks) => updateSetup((s) => ({ ...s, carryTasks }))} />
				)}
				{(widget.type === 'habits' || widget.type === 'numbers') && <TrackSection setup={setup} rows={widget.config.rows ?? []} onRows={(rows) => set({ rows })} />}
				{widget.type === 'creative' && (
					<Field label="Areas">
						<Picks options={setup.areas.map((a) => ({ id: a.id, label: a.name }))} selected={widget.config.areaIds ?? setup.areas.map((a) => a.id)} onChange={(areaIds) => set({ areaIds })} />
					</Field>
				)}
				{widget.type === 'logs' && (
					<Field label="Lists">
						<Picks options={setup.logLists.map((l) => ({ id: l.id, label: l.name }))} selected={widget.config.listIds ?? setup.logLists.map((l) => l.id)} onChange={(listIds) => set({ listIds })} />
					</Field>
				)}
				{widget.type === 'reflection' && (
					<Field label="Questions">
						<TextList items={widget.config.prompts ?? []} placeholder="A question for the week" onChange={(prompts) => set({ prompts })} />
					</Field>
				)}
				{widget.type === 'rotation' && (
					<Field label="Weeks to look back over">
						<input className="lb-daily-input lb-daily-input--number" type="number" min={1} max={12} value={widget.config.weeks ?? 4} onChange={(e) => set({ weeks: Math.max(1, Math.min(12, Number(e.target.value) || 4)) })} />
					</Field>
				)}
				{widget.type === 'nextWeek' && <Toggle label="A note under each evening" checked={widget.config.notes !== false} onChange={(notes) => set({ notes })} />}

				<button type="button" className="lb-daily-danger" onClick={() => onRemove(widget.id)}>
					<X size={14} aria-hidden="true" /> Remove from {mode === 'daily' ? 'layout' : 'review'}
				</button>
			</div>
		</aside>
	)
}

function updateTemplate(id: string, change: Partial<BlockTemplate>): void {
	updateSetup((s) => ({ ...s, templates: s.templates.map((t) => (t.id === id ? { ...t, ...change } : t)) }))
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="lb-daily-field">
			<span className="lb-daily-label">{label}</span>
			{children}
		</div>
	)
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
	return (
		<label className="lb-daily-toggle">
			<span>{label}</span>
			<input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
		</label>
	)
}

/** Several of a list, as chips that switch on and off. */
function Picks({ options, selected, onChange }: { options: { id: string; label: string }[]; selected: readonly string[]; onChange: (ids: string[]) => void }) {
	return (
		<div className="lb-daily-chips">
			{options.map((o) => (
				<button
					key={o.id}
					type="button"
					className="lb-daily-chip"
					aria-pressed={selected.includes(o.id)}
					onClick={() => onChange(selected.includes(o.id) ? selected.filter((id) => id !== o.id) : [...selected, o.id])}
				>
					{o.label}
				</button>
			))}
		</div>
	)
}

/** Lines of text to edit, reorder and add to. */
function TextList({ items, placeholder, onChange }: { items: readonly TaskText[]; placeholder: string; onChange: (items: TaskText[]) => void }) {
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

function move<T>(items: readonly T[], from: number, to: number): T[] {
	const out = [...items]
	const [item] = out.splice(from, 1)
	out.splice(to, 0, item!)
	return out
}

function Reorder({ i, n, onMove }: { i: number; n: number; onMove: (to: number) => void }) {
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

/* ------------------------------------------------------------------------------------- templates */

function TemplateSection({ setup, widget, template, onTemplate }: { setup: DailySetup; widget: Widget; template: BlockTemplate | undefined; onTemplate: (id: string) => void }) {
	const used = template ? setup.layouts.filter((l) => l.widgets.some((w) => w.config.templateId === template.id)).length : 0
	return (
		<>
			<Field label="Source template">
				<select className="lb-daily-select" value={widget.config.templateId ?? ''} onChange={(e) => onTemplate(e.target.value)}>
					{widget.type === 'physical' && <option value="">No icon tasks</option>}
					{!template && widget.type === 'block' && <option value="">Choose a template</option>}
					{setup.templates.map((t) => (
						<option key={t.id} value={t.id}>
							{t.name || 'Untitled'}
						</option>
					))}
				</select>
				{template && (
					<div className="lb-daily-row">
						<span className="lb-daily-faint">
							In {used} layout{used === 1 ? '' : 's'} · changes reach every page using it
						</span>
						<button
							type="button"
							className="lb-daily-linkbtn"
							title="Make a copy of the template for this block alone"
							onClick={() => {
								const id = newId('b')
								updateSetup((s) => ({ ...s, templates: [...s.templates, { ...template, id, name: `${template.name} copy` }] }))
								onTemplate(id)
							}}
						>
							<Copy size={12} aria-hidden="true" /> Detach
						</button>
					</div>
				)}
			</Field>
			{template && (
				<>
					<Field label="Type">
						<div className="lb-daily-seg">
							<button type="button" aria-pressed={template.kind === 'icons'} onClick={() => updateTemplate(template.id, { kind: 'icons' })}>
								Icon tasks
							</button>
							<button type="button" aria-pressed={template.kind === 'checklist'} onClick={() => updateTemplate(template.id, { kind: 'checklist' })}>
								Checklist
							</button>
						</div>
					</Field>
					{template.kind === 'icons' ? (
						<Field label={`Icon tasks · ${template.iconTaskIds.length}`}>
							<div className="lb-daily-textlist">
								{template.iconTaskIds.map((id, i) => {
									const task = setup.iconTasks.find((t) => t.id === id)
									return (
										<div key={id} className="lb-daily-textlist__row">
											<span className="lb-daily-tile lb-daily-tile--small" aria-hidden="true">
												<span className="lb-daily-tile__icon">{task?.icon ? <CatalogueIcon name={task.icon} size={14} /> : null}</span>
											</span>
											<span className="lb-daily-textlist__name">{task?.name ?? 'Deleted'}</span>
											<Reorder i={i} n={template.iconTaskIds.length} onMove={(to) => updateTemplate(template.id, { iconTaskIds: move(template.iconTaskIds, i, to) })} />
											<button type="button" className="lb-daily-iconbtn" aria-label={`Take ${task?.name ?? 'it'} out`} onClick={() => updateTemplate(template.id, { iconTaskIds: template.iconTaskIds.filter((x) => x !== id) })}>
												<X size={12} aria-hidden="true" />
											</button>
										</div>
									)
								})}
								<select
									className="lb-daily-select"
									value=""
									aria-label="Add an icon task"
									onChange={(e) => e.target.value && updateTemplate(template.id, { iconTaskIds: [...template.iconTaskIds, e.target.value] })}
								>
									<option value="">+ Add icon task</option>
									{setup.iconTasks
										.filter((t) => !template.iconTaskIds.includes(t.id))
										.map((t) => (
											<option key={t.id} value={t.id}>
												{t.name}
											</option>
										))}
								</select>
								<span className="lb-daily-faint">Make new icon tasks in the Library’s Icon tasks tab.</span>
							</div>
						</Field>
					) : (
						<Field label={`Items · ${template.items.length}`}>
							<TextList items={template.items} placeholder="A checklist item" onChange={(items) => updateTemplate(template.id, { items })} />
						</Field>
					)}
				</>
			)}
		</>
	)
}

/* --------------------------------------------------------------------------------- the others' */

function PhysicalSection({ setup, widget, set }: { setup: DailySetup; widget: Widget; set: (config: Partial<Widget['config']>) => void }) {
	return (
		<>
			<Field label="Numbers to write down">
				<Picks options={setup.metrics.map((m) => ({ id: m.id, label: m.name }))} selected={widget.config.metricIds ?? []} onChange={(metricIds) => set({ metricIds })} />
			</Field>
			<Toggle label="Fasting" checked={widget.config.fasting !== false} onChange={(fasting) => set({ fasting })} />
			<Toggle label="Food log" checked={widget.config.food !== false} onChange={(food) => set({ food })} />
		</>
	)
}

function PickSection({ widget, boards, set }: { widget: Widget; boards: readonly BoardMeta[]; set: (config: Partial<Widget['config']>) => void }) {
	// Every list any board offers, under its board's name: a source's lists can belong to boards (DARK-14).
	const groups = useValue(
		'lifeboard:daily-pick-lists',
		() => {
			const seen = new Set<string>()
			const out: { board: string; options: { key: string; label: string }[] }[] = []
			for (const board of [{ id: '', name: 'Anywhere' }, ...boards]) {
				const options: { key: string; label: string }[] = []
				for (const source of offeredItemSources()) {
					for (const choice of source.choices(board.id)) {
						const key = sourceKey(source.id, choice.id)
						if (seen.has(key)) continue
						seen.add(key)
						options.push({ key, label: `${source.label}: ${choice.label}` })
					}
				}
				if (options.length) out.push({ board: board.name, options })
			}
			return out
		},
		[boards]
	)
	return (
		<>
			<Field label="Draw from">
				<select className="lb-daily-select" value={widget.config.source ?? ''} onChange={(e) => set({ source: e.target.value })}>
					<option value="">Choose a list</option>
					{groups.map((g) => (
						<optgroup key={g.board} label={g.board}>
							{g.options.map((o) => (
								<option key={o.key} value={o.key}>
									{o.label}
								</option>
							))}
						</optgroup>
					))}
				</select>
				<span className="lb-daily-faint">A new draw each day. Another one never repeats a draw from the last 30 days, and skips what the board below has stamped.</span>
			</Field>
			<Field label="Save stamps to">
				<select className="lb-daily-select" value={widget.config.board ?? ''} onChange={(e) => set({ board: e.target.value })}>
					<option value="">Choose a board</option>
					{boards.map((b) => (
						<option key={b.id} value={b.id}>
							{b.name}
						</option>
					))}
				</select>
				<span className="lb-daily-faint">Liked, Disliked and Unsure are filed on this board, as a randomizer’s stamps there are.</span>
			</Field>
		</>
	)
}

function FocusSection({ setup, focus }: { setup: DailySetup; focus: string }) {
	const area = setup.areas.find((a) => a.id === focus)
	if (!area) return <p className="lb-daily-faint">No focus today. Set the week’s cycle from the week strip, or the day’s focus in the header.</p>
	return (
		<Field label={`${area.name} tasks, every ${area.name} day`}>
			<TextList
				items={area.tasks}
				placeholder={`A ${area.name} task`}
				onChange={(tasks) => updateSetup((s) => ({ ...s, areas: s.areas.map((a) => (a.id === area.id ? { ...a, tasks } : a)) }))}
			/>
		</Field>
	)
}

/** What a habit row or a number can count, as options. */
function refOptions(setup: DailySetup): { value: string; label: string; ref: TrackRef }[] {
	return [
		...setup.iconTasks.map((t) => ({ value: `tick:${t.id}`, label: `Ticked: ${t.name}`, ref: { kind: 'tick', id: t.id } as TrackRef })),
		...setup.templates.flatMap((t) => t.items.map((i) => ({ value: `tick:${i.id}`, label: `Ticked: ${i.text || 'item'} (${t.name})`, ref: { kind: 'tick', id: i.id } as TrackRef }))),
		...setup.metrics.map((m) => ({ value: `metric:${m.id}`, label: `Number: ${m.name}`, ref: { kind: 'metric', id: m.id } as TrackRef })),
		{ value: 'fasting', label: 'Fasted', ref: { kind: 'fasting' } },
		{ value: 'pick', label: 'Daily pick stamped or noted', ref: { kind: 'pick' } },
	]
}

const refValue = (ref: TrackRef) => (ref.kind === 'tick' || ref.kind === 'metric' ? `${ref.kind}:${ref.id}` : ref.kind)

function TrackSection({ setup, rows, onRows }: { setup: DailySetup; rows: readonly TrackRow[]; onRows: (rows: TrackRow[]) => void }) {
	const options = refOptions(setup)
	const update = (id: string, change: Partial<TrackRow>) => onRows(rows.map((r) => (r.id === id ? { ...r, ...change } : r)))
	return (
		<Field label={`Rows · ${rows.length}`}>
			<div className="lb-daily-tracks">
				{rows.map((row, i) => (
					<div key={row.id} className="lb-daily-track">
						<div className="lb-daily-textlist__row">
							<input className="lb-daily-input" value={row.label} placeholder={rowName(setup, row)} aria-label="Row name" onChange={(e) => update(row.id, { label: e.target.value })} />
							<Reorder i={i} n={rows.length} onMove={(to) => onRows(move(rows, i, to))} />
							<button type="button" className="lb-daily-iconbtn" aria-label={`Remove ${row.label || rowName(setup, row)}`} onClick={() => onRows(rows.filter((r) => r.id !== row.id))}>
								<X size={12} aria-hidden="true" />
							</button>
						</div>
						<div className="lb-daily-textlist__row">
							<select className="lb-daily-select" aria-label="What it counts" value={refValue(row.ref)} onChange={(e) => update(row.id, { ref: options.find((o) => o.value === e.target.value)?.ref ?? row.ref })}>
								{options.map((o) => (
									<option key={o.value} value={o.value}>
										{o.label}
									</option>
								))}
							</select>
							<input
								className="lb-daily-input lb-daily-input--number"
								type="number"
								min={0}
								placeholder="Target"
								aria-label="Weekly target"
								title="Out of how many: Swim /5"
								value={row.target ?? ''}
								onChange={(e) => {
									const { target: _, ...rest } = row
									const n = Number(e.target.value)
									onRows(rows.map((r) => (r.id === row.id ? (e.target.value && n > 0 ? { ...rest, target: n } : rest) : r)))
								}}
							/>
						</div>
					</div>
				))}
				<button type="button" className="lb-daily-dashed" disabled={!options.length} onClick={() => onRows([...rows, { id: newId('r'), label: '', ref: options[0]!.ref }])}>
					<Plus size={13} aria-hidden="true" /> Add row
				</button>
			</div>
		</Field>
	)
}

/* -------------------------------------------------------------------------------- page settings */

const AREA_COLORS = ['#6c8cff', '#3dd68c', '#e5484d', '#f5c451', '#b06cff', '#ff8c42', '#4cc9f0', '#9a9aa4']

function PageSettings({ setup }: { setup: DailySetup }) {
	const set = (change: Partial<DailySetup>) => updateSetup((s) => ({ ...s, ...change }))
	return (
		<>
			<Field label="Areas you rotate through">
				<div className="lb-daily-textlist">
					{setup.areas.map((a, i) => (
						<div key={a.id} className="lb-daily-textlist__row">
							<input
								type="color"
								className="lb-daily-color"
								value={a.color}
								aria-label={`${a.name}'s colour`}
								onChange={(e) => set({ areas: setup.areas.map((x) => (x.id === a.id ? { ...x, color: e.target.value } : x)) })}
							/>
							<input className="lb-daily-input" value={a.name} aria-label="Area name" onChange={(e) => set({ areas: setup.areas.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)) })} />
							<Reorder i={i} n={setup.areas.length} onMove={(to) => set({ areas: move(setup.areas, i, to) })} />
							<button
								type="button"
								className="lb-daily-iconbtn"
								aria-label={`Delete ${a.name}`}
								onClick={() => set({ areas: setup.areas.filter((x) => x.id !== a.id), cycles: setup.cycles.map((c) => ({ ...c, areaIds: c.areaIds.filter((id) => id !== a.id) })) })}
							>
								<X size={12} aria-hidden="true" />
							</button>
						</div>
					))}
					<button
						type="button"
						className="lb-daily-dashed"
						onClick={() => set({ areas: [...setup.areas, { id: newId('a'), name: 'New area', color: AREA_COLORS[setup.areas.length % AREA_COLORS.length]!, tasks: [] }] })}
					>
						<Plus size={13} aria-hidden="true" /> Add area
					</button>
				</div>
			</Field>

			<Field label="Week cycles, chosen by hand each week">
				<div className="lb-daily-textlist">
					{setup.cycles.map((c, i) => (
						<div key={c.id} className="lb-daily-track">
							<div className="lb-daily-textlist__row">
								<input className="lb-daily-input" value={c.name} aria-label="Cycle name" onChange={(e) => set({ cycles: setup.cycles.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)) })} />
								<Reorder i={i} n={setup.cycles.length} onMove={(to) => set({ cycles: move(setup.cycles, i, to) })} />
								<button type="button" className="lb-daily-iconbtn" aria-label={`Delete ${c.name}`} onClick={() => set({ cycles: setup.cycles.filter((x) => x.id !== c.id) })}>
									<X size={12} aria-hidden="true" />
								</button>
							</div>
							<Picks
								options={setup.areas.map((a) => ({ id: a.id, label: a.name }))}
								selected={c.areaIds}
								onChange={(areaIds) => set({ cycles: setup.cycles.map((x) => (x.id === c.id ? { ...x, areaIds: setup.areas.map((a) => a.id).filter((id) => areaIds.includes(id)) } : x)) })}
							/>
						</div>
					))}
					<span className="lb-daily-faint">A week’s days take its areas in turn, unless its evenings are planned in the review.</span>
					<button type="button" className="lb-daily-dashed" onClick={() => set({ cycles: [...setup.cycles, { id: newId('c'), name: `W${setup.cycles.length + 1}`, areaIds: [] }] })}>
						<Plus size={13} aria-hidden="true" /> Add cycle
					</button>
				</div>
			</Field>

			<Field label="Numbers you track">
				<div className="lb-daily-textlist">
					{setup.metrics.map((m) => (
						<div key={m.id} className="lb-daily-textlist__row">
							<input className="lb-daily-input" value={m.name} aria-label="Number name" onChange={(e) => set({ metrics: setup.metrics.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)) })} />
							<input className="lb-daily-input lb-daily-input--unit" value={m.unit} placeholder="unit" aria-label="Unit" onChange={(e) => set({ metrics: setup.metrics.map((x) => (x.id === m.id ? { ...x, unit: e.target.value } : x)) })} />
							<select className="lb-daily-select lb-daily-select--tiny" aria-label="Weekly total" value={m.total} onChange={(e) => set({ metrics: setup.metrics.map((x) => (x.id === m.id ? { ...x, total: e.target.value === 'sum' ? 'sum' : 'avg' } : x)) })}>
								<option value="avg">avg</option>
								<option value="sum">sum</option>
							</select>
							<button type="button" className="lb-daily-iconbtn" aria-label={`Delete ${m.name}`} onClick={() => set({ metrics: setup.metrics.filter((x) => x.id !== m.id) })}>
								<X size={12} aria-hidden="true" />
							</button>
						</div>
					))}
					<button type="button" className="lb-daily-dashed" onClick={() => set({ metrics: [...setup.metrics, { id: newId('m'), name: 'New number', unit: '', total: 'sum' }] })}>
						<Plus size={13} aria-hidden="true" /> Add number
					</button>
				</div>
			</Field>

			<Field label="Kinds of fast">
				<TextList
					items={setup.fasting.map((f) => ({ id: f.id, text: f.name }))}
					placeholder="IF 16:8"
					onChange={(items) => set({ fasting: items.map((i) => ({ id: i.id, name: i.text })) })}
				/>
			</Field>

			<Field label="Log lists for the review">
				<div className="lb-daily-textlist">
					{setup.logLists.map((l) => (
						<div key={l.id} className="lb-daily-track">
							<div className="lb-daily-textlist__row">
								<input className="lb-daily-input" value={l.name} aria-label="List name" onChange={(e) => set({ logLists: setup.logLists.map((x) => (x.id === l.id ? { ...x, name: e.target.value } : x)) })} />
								<button type="button" className="lb-daily-iconbtn" aria-label={`Delete ${l.name}`} onClick={() => set({ logLists: setup.logLists.filter((x) => x.id !== l.id) })}>
									<X size={12} aria-hidden="true" />
								</button>
							</div>
							<Picks
								options={(['rating', 'pages', 'done'] as LogColumn[]).map((c) => ({ id: c, label: c[0]!.toUpperCase() + c.slice(1) }))}
								selected={l.columns}
								onChange={(columns) => set({ logLists: setup.logLists.map((x) => (x.id === l.id ? { ...x, columns: columns as LogColumn[] } : x)) })}
							/>
						</div>
					))}
					<button type="button" className="lb-daily-dashed" onClick={() => set({ logLists: [...setup.logLists, { id: newId('l'), name: 'New list', columns: ['rating'] }] })}>
						<Plus size={13} aria-hidden="true" /> Add list
					</button>
				</div>
			</Field>

			<Field label="Review day">
				<select className="lb-daily-select" value={setup.reviewDay} onChange={(e) => set({ reviewDay: Number(e.target.value) })}>
					{WEEKDAYS.map((d, i) => (
						<option key={d} value={i}>
							{d}
						</option>
					))}
				</select>
			</Field>
			<Toggle label="Carry unticked tasks to the next page" checked={setup.carryTasks} onChange={(carryTasks) => set({ carryTasks })} />
		</>
	)
}
