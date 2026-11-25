import { useValue } from '@lifeboard/canvas'
import { getItemStamps, offeredItemSources, resolveItemSource, sourceEntries, sourceKey } from '@lifeboard/node-kit'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookmarkPlus, Minus, Pencil, Plus, RotateCcw, X } from 'lucide-react'
import type { BoardMeta } from '../boards/boardIndex'
import { ContentsEditor, Field, Reorder, TextList, Toggle, move } from './fields'
import { sentence } from './Library'
import {
	GRID_MAX,
	WEEKDAYS,
	checklistItems,
	longDay,
	newId,
	templateOf,
	templateUse,
	type DailySetup,
	type LogColumn,
	type TrackRef,
	type TrackRow,
	type Widget,
} from './model'
import { rowName } from './reviewWidgets'
import { updateSetup } from './store'
import { useDaily } from './context'
import { PickSearch, WIDGET_NAMES, widgetTitle } from './widgets'

export function Inspector({
	mode,
	setup,
	widget,
	focus,
	boards,
	grid,
	onChange,
	onMove,
	onRemove,
	onClose,
	onEditTemplate,
}: {
	mode: 'daily' | 'review'
	setup: DailySetup
	widget: Widget | null
	/** The day's focus, for a focus widget's tasks. */
	focus: string
	boards: readonly BoardMeta[]
	grid: { cols: number; rows: number }
	onChange: (widget: Widget) => void
	/** Moves a widget to another cell, if it fits there. */
	onMove: (id: string, cell: { col: number; row: number }) => void
	onRemove: (id: string) => void
	onClose: () => void
	/** Opens a template in the Library, where it is edited for every block that follows it. */
	onEditTemplate: (id: string) => void
}) {
	if (!widget) {
		return (
			<aside className="lb-daily-panel lb-daily-inspector" aria-label="Inspector">
				<header className="lb-daily-panel__head">
					<h2>Inspector</h2>
					<span className="lb-daily-faint">Page settings</span>
				</header>
				<div className="lb-daily-panel__body">
					<p className="lb-daily-faint">Select a widget on the page to change it. These settings are every page’s, and apply straight away.</p>
					<PageSettings setup={setup} />
				</div>
			</aside>
		)
	}
	const template = templateOf(setup, widget)
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

				{widget.type !== 'header' && (
					<Field label={widget.type === 'block' ? 'Name' : 'Title'}>
						<input
							className="lb-daily-input"
							value={widget.title ?? ''}
							placeholder={widget.type === 'block' && template ? template.name : title}
							onChange={(e) => {
								const { title: _, ...rest } = widget
								onChange(e.target.value ? { ...rest, title: e.target.value } : rest)
							}}
						/>
					</Field>
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

				{/* Dragging the grip needs a mouse; these work under a finger too. */}
				<Field label="Move">
					<div className="lb-daily-stepper">
						{(
							[
								['Left', ArrowLeft, -1, 0, widget.col <= 0],
								['Right', ArrowRight, 1, 0, widget.col + widget.w >= grid.cols],
								['Up', ArrowUp, 0, -1, widget.row <= 0],
								['Down', ArrowDown, 0, 1, widget.row + widget.h >= grid.rows],
							] as const
						).map(([name, Icon, dc, dr, edge]) => (
							<button key={name} type="button" className="lb-daily-iconbtn" aria-label={`Move ${name.toLowerCase()} one cell`} disabled={edge} onClick={() => onMove(widget.id, { col: widget.col + dc, row: widget.row + dr })}>
								<Icon size={14} aria-hidden="true" />
							</button>
						))}
						<span className="lb-daily-faint">or drag its grip</span>
					</div>
				</Field>

				{(widget.type === 'block' || widget.type === 'physical') && (
					<ContentsSection setup={setup} widget={widget} onChange={onChange} onEditTemplate={onEditTemplate} />
				)}
				{widget.type === 'block' && <BlockLookSection widget={widget} set={set} />}
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

/* ------------------------------------------------------------------------------------- templates */

/**
 * A block's template and what it holds. Changed here, the contents are this block's own and its
 * template stays as it was; the template itself is changed in the Library.
 */
function ContentsSection({ setup, widget, onChange, onEditTemplate }: { setup: DailySetup; widget: Widget; onChange: (widget: Widget) => void; onEditTemplate: (id: string) => void }) {
	const template = templateOf(setup, widget)
	const own = widget.config.contents
	const contents = own ?? template ?? { iconTaskIds: [], items: [] }
	const used = template ? templateUse(setup, template.id) : 0
	const setConfig = (config: Widget['config']) => onChange({ ...widget, config })
	const { contents: _, templateId: __, ...rest } = widget.config
	const editTemplate = template && (
		<button type="button" className="lb-daily-linkbtn" title="Change the template, for every block that follows it" onClick={() => onEditTemplate(template.id)}>
			<Pencil size={12} aria-hidden="true" /> Edit template
		</button>
	)
	return (
		<>
			<Field label="Template">
				<select
					className="lb-daily-select"
					value={widget.config.templateId ?? ''}
					// Picking a template starts following it; picking none keeps what the block shows, as its own.
					onChange={(e) => setConfig(e.target.value ? { ...rest, templateId: e.target.value } : contents.iconTaskIds.length || contents.items.length ? { ...rest, contents } : rest)}
				>
					<option value="">{widget.type === 'physical' && !own ? 'None' : 'None: its own tasks'}</option>
					{setup.templates.map((t) => (
						<option key={t.id} value={t.id}>
							{t.name || 'Untitled'}
						</option>
					))}
				</select>
				{template && !own && (
					<div className="lb-daily-row">
						<span className="lb-daily-faint">
							Follows {template.name || 'its template'} · in {used} layout{used === 1 ? '' : 's'}. Changes below are this block’s own.
						</span>
						{editTemplate}
					</div>
				)}
				{template && own && (
					<div className="lb-daily-row">
						<span className="lb-daily-faint">Changed from {template.name || 'its template'} on this page.</span>
						<button type="button" className="lb-daily-linkbtn" title="Show the template’s tasks again" onClick={() => setConfig({ ...rest, templateId: template.id })}>
							<RotateCcw size={12} aria-hidden="true" /> Reset to template
						</button>
						{editTemplate}
					</div>
				)}
				{!template && own && (own.iconTaskIds.length > 0 || own.items.length > 0) && (
					<div className="lb-daily-row">
						<span className="lb-daily-faint">From no template.</span>
						<button
							type="button"
							className="lb-daily-linkbtn"
							title="Make a template of these tasks, to put on other pages"
							onClick={() => {
								const id = newId('b')
								const name = widget.title || (widget.type === 'physical' ? 'PHYSICAL' : 'NEW BLOCK')
								updateSetup((s) => ({ ...s, templates: [...s.templates, { id, name, iconTaskIds: [...own.iconTaskIds], items: own.items.map((i) => ({ ...i })) }] }))
								setConfig({ ...rest, templateId: id })
							}}
						>
							<BookmarkPlus size={12} aria-hidden="true" /> Save as template
						</button>
					</div>
				)}
			</Field>
			<ContentsEditor setup={setup} contents={contents} onChange={(next) => setConfig({ ...widget.config, contents: next })} />
		</>
	)
}

/** A block's icon grid and heading. */
function BlockLookSection({ widget, set }: { widget: Widget; set: (config: Partial<Widget['config']>) => void }) {
	const side = (value: number | undefined, label: string, onPick: (n: number | undefined) => void) => (
		<select className="lb-daily-select lb-daily-select--tiny" aria-label={label} value={value ?? ''} onChange={(e) => onPick(e.target.value ? Number(e.target.value) : undefined)}>
			<option value="">Auto</option>
			{Array.from({ length: GRID_MAX }, (_, i) => i + 1).map((n) => (
				<option key={n} value={n}>
					{n}
				</option>
			))}
		</select>
	)
	return (
		<>
			<Field label="Icon grid">
				<div className="lb-daily-row">
					{side(widget.config.iconRows, 'Rows', (iconRows) => set({ iconRows }))}
					<span className="lb-daily-faint">rows ×</span>
					{side(widget.config.iconCols, 'Columns', (iconCols) => set({ iconCols }))}
					<span className="lb-daily-faint">columns</span>
				</div>
				<span className="lb-daily-faint">The icons grow or shrink to fill the grid. The checklist takes the room under it.</span>
			</Field>
			<Toggle label="Show the heading" checked={!widget.config.hideTitle} onChange={(shown) => set({ hideTitle: !shown })} />
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
			const out: { board: string; boardId: string; options: { key: string; label: string }[] }[] = []
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
				if (options.length) out.push({ board: board.name, boardId: board.id, options })
			}
			return out
		},
		[boards]
	)
	return (
		<>
			<Field label="Draw from">
				<select
					className="lb-daily-select"
					value={widget.config.source ?? ''}
					onChange={(e) => {
						const source = e.target.value
						// A list of one board's: its stamps go to that board unless another was chosen.
						const boardId = groups.find((g) => g.options.some((o) => o.key === source))?.boardId
						set(!widget.config.board && boardId ? { source, board: boardId } : { source })
					}}
				>
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
				<PickBoardStatus widget={widget} boards={boards} />
			</Field>
			<PickChooser widget={widget} />
		</>
	)
}

/** Where the pick's stamps end up, and the way to the board they are filed on. */
function PickBoardStatus({ widget, boards }: { widget: Widget; boards: readonly BoardMeta[] }) {
	const { openBoard } = useDaily()
	const stamps = useValue('lifeboard:daily-pick-stamps', () => getItemStamps(), [])
	const board = boards.find((b) => b.id === widget.config.board)
	if (!stamps?.stamp) return <span className="lb-daily-faint">The Randomizer is off, so stamps stay on the page.</span>
	if (!widget.config.board) return <span className="lb-daily-faint">With no board chosen, stamps stay on the page.</span>
	if (!board) return <span className="lb-daily-faint">That board is gone: stamps stay on the page until another is chosen.</span>
	return (
		<button type="button" className="lb-daily-linkbtn" onClick={() => openBoard(board)}>
			Open {board.name} <ArrowRight size={12} aria-hidden="true" />
		</button>
	)
}

/** The day's pick chosen by hand from its list, say an album heard apart from the draw. */
function PickChooser({ widget }: { widget: Widget }) {
	const { day, page, updatePage } = useDaily()
	const source = widget.config.source ?? ''
	const resolved = useValue('lifeboard:daily-pick-source', () => resolveItemSource(source), [source])
	const entries = useValue('lifeboard:daily-pick-entries', () => (source ? sourceEntries(source) : []), [source])
	if (!source || resolved.type !== 'source' || !entries.length) return null
	const current = page.picks[widget.id]
	return (
		<Field label={`Pick for ${longDay(day)}`}>
			{current && <span className="lb-daily-faint">Now: {[current.title, current.creator].filter(Boolean).join(' · ')}</span>}
			<PickSearch
				entries={entries}
				listName={resolved.name}
				onChoose={({ id, title, creator, year, cover, url }) =>
					updatePage((p) => ({
						...p,
						picks: { ...p.picks, [widget.id]: { source, id, title, creator, year, cover, url, draws: current?.draws ?? 0, stamp: '', impression: '' } },
					}))
				}
			/>
			<span className="lb-daily-faint">Choose one to make it this day’s pick instead of the draw.</span>
		</Field>
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
		...checklistItems(setup).map((i) => ({ value: `tick:${i.id}`, label: `Ticked: ${i.text || 'item'}${itemTemplateName(setup, i.id)}`, ref: { kind: 'tick', id: i.id } as TrackRef })),
		...setup.metrics.map((m) => ({ value: `metric:${m.id}`, label: `Number: ${m.name}`, ref: { kind: 'metric', id: m.id } as TrackRef })),
		{ value: 'fasting', label: 'Fasted', ref: { kind: 'fasting' } },
		{ value: 'pick', label: 'Daily pick stamped or noted', ref: { kind: 'pick' } },
	]
}

const itemTemplateName = (setup: DailySetup, id: string) => {
	const t = setup.templates.find((x) => x.items.some((i) => i.id === id))
	return t ? ` (${t.name})` : ''
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
