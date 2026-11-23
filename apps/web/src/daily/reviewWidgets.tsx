import { Star, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import { useDaily } from './context'
import {
	WEEKDAYS,
	WEEKDAY_LETTERS,
	addDays,
	cycleOf,
	daysOfWeek,
	eveningCounts,
	metricTotal,
	newId,
	shortDay,
	squeezed,
	trackCell,
	trackTotal,
	weekNumber,
	weekOf,
	weekRange,
	type LogRow,
	type TrackRow,
	type WeekPlan,
	type WeekTask,
	type Widget,
} from './model'
import { updateWeek } from './store'
import { Block, Cover, widgetTitle } from './widgets'

/** The review's widgets, by type. The review is of the week its day is in; it plans the week after. */
export function ReviewWidget({ widget }: { widget: Widget }) {
	switch (widget.type) {
		case 'nextWeek':
			return <NextWeek widget={widget} />
		case 'weeklyTasks':
			return <WeeklyTasks widget={widget} />
		case 'rotation':
			return <Rotation widget={widget} />
		case 'logs':
			return <Logs widget={widget} />
		case 'habits':
			return <Habits widget={widget} />
		case 'numbers':
			return <Numbers widget={widget} />
		case 'creative':
			return <Creative widget={widget} />
		case 'reflection':
			return <Reflection widget={widget} />
		case 'picks':
			return <Picks widget={widget} />
		default:
			return null
	}
}

function useWeeks() {
	const { day, plans } = useDaily()
	const week = weekOf(day)
	const next = addDays(week, 7)
	return { week, next, plan: plans[week], nextPlan: plans[next] }
}

/* ------------------------------------------------------------------------------------ next week */

function NextWeek({ widget }: { widget: Widget }) {
	const { setup } = useDaily()
	const { next, nextPlan } = useWeeks()
	const cycle = cycleOf(setup, nextPlan)
	const set = (change: (w: WeekPlan) => WeekPlan) => updateWeek(next, change)
	// A click moves an evening on to the next area, and past the last back to nothing planned.
	const cycleEvening = (i: number) =>
		set((w) => {
			const ids = ['', ...setup.areas.map((a) => a.id)]
			const evenings = [...w.evenings]
			evenings[i] = ids[(ids.indexOf(evenings[i] ?? '') + 1) % ids.length]!
			return { ...w, evenings }
		})
	return (
		<Block title={widgetTitle(widget, setup.templates)} meta={`Week ${weekNumber(next)} · ${weekRange(next)}`}>
			<div className="lb-review-next">
				<div className="lb-review-next__cycle">
					<span className="lb-daily-label">Cycle focus</span>
					<div className="lb-daily-chips" role="group" aria-label="Next week's cycle">
						{setup.cycles.map((c) => (
							<button key={c.id} type="button" className="lb-daily-chip" aria-pressed={nextPlan?.cycleId === c.id} onClick={() => set((w) => ({ ...w, cycleId: w.cycleId === c.id ? '' : c.id }))}>
								{c.name}
							</button>
						))}
					</div>
					<div className="lb-daily-chips">
						{cycle?.areaIds.map((id) => {
							const area = setup.areas.find((a) => a.id === id)
							return area ? <AreaChip key={id} name={area.name} color={area.color} /> : null
						})}
					</div>
				</div>
				<div className="lb-review-next__evenings">
					<span className="lb-daily-label">Evenings · click one to change it</span>
					<div className="lb-review-next__days">
						{daysOfWeek(next).map((d, i) => {
							const area = setup.areas.find((a) => a.id === nextPlan?.evenings[i])
							return (
								<div key={d} className="lb-review-next__day">
									<span className="lb-daily-faint">
										{WEEKDAY_LETTERS[i]} {shortDay(d).split(' ')[1]}
									</span>
									<button
										type="button"
										className="lb-daily-chip"
										style={area ? ({ '--chip': area.color } as React.CSSProperties) : undefined}
										aria-pressed={!!area}
										aria-label={`${WEEKDAYS[i]} evening: ${area?.name ?? 'nothing planned'}. Change it`}
										onClick={() => cycleEvening(i)}
									>
										{area?.name ?? '—'}
									</button>
									{widget.config.notes !== false && (
										<input
											className="lb-daily-input lb-review-next__note"
											aria-label={`${WEEKDAYS[i]} note`}
											placeholder="Note"
											value={nextPlan?.eveningNotes[i] ?? ''}
											onChange={(e) =>
												set((w) => {
													const eveningNotes = [...w.eveningNotes]
													eveningNotes[i] = e.target.value
													return { ...w, eveningNotes }
												})
											}
										/>
									)}
								</div>
							)
						})}
					</div>
				</div>
			</div>
		</Block>
	)
}

function AreaChip({ name, color }: { name: string; color: string }) {
	return (
		<span className="lb-daily-chip lb-daily-chip--static" style={{ '--chip': color } as React.CSSProperties} aria-pressed="true">
			{name}
		</span>
	)
}

/* ---------------------------------------------------------------------------------- weekly tasks */

function WeeklyTasks({ widget }: { widget: Widget }) {
	const { setup } = useDaily()
	const { week, next, plan, nextPlan } = useWeeks()
	const tasks = nextPlan?.tasks ?? []
	const left = (plan?.tasks ?? []).filter((t) => !t.done)
	const [text, setText] = useState('')
	const set = (change: (tasks: WeekTask[]) => WeekTask[]) => updateWeek(next, (w) => ({ ...w, tasks: change(w.tasks) }))
	const add = () => {
		if (!text.trim()) return
		set((list) => [...list, { id: newId('w'), text: text.trim(), done: false }])
		setText('')
	}
	return (
		<Block title={widgetTitle(widget, setup.templates)} meta={`${tasks.filter((t) => t.done).length}/${tasks.length} done · ${tasks.filter((t) => t.day).length} put on a day`}>
			<ul className="lb-daily-checks">
				{tasks.map((t) => (
					<li key={t.id} className="lb-daily-check" data-done={t.done || undefined}>
						<label>
							<input type="checkbox" checked={t.done} onChange={() => set((list) => list.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))} />
							<span className="lb-daily-check__text">{t.text}</span>
						</label>
						<select
							className="lb-daily-select lb-daily-select--tiny"
							aria-label={`Day for ${t.text}`}
							value={t.day ?? ''}
							onChange={(e) =>
								set((list) =>
									list.map((x) => {
										if (x.id !== t.id) return x
										const { day: _, ...rest } = x
										return e.target.value ? { ...rest, day: e.target.value } : rest
									})
								)
							}
						>
							<option value="">→ day</option>
							{daysOfWeek(next).map((d, i) => (
								<option key={d} value={d}>
									{WEEKDAYS[i]!.slice(0, 3)}
								</option>
							))}
						</select>
						<button type="button" className="lb-daily-iconbtn lb-daily-check__remove lb-daily-noprint" aria-label={`Remove ${t.text}`} onClick={() => set((list) => list.filter((x) => x.id !== t.id))}>
							<X size={12} aria-hidden="true" />
						</button>
					</li>
				))}
			</ul>
			<div className="lb-daily-addrow lb-daily-noprint">
				<input className="lb-daily-input" placeholder="New weekly task, press Enter" aria-label="New weekly task" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
			</div>
			{left.length > 0 && (
				<p className="lb-daily-faint lb-daily-noprint">
					{left.length} left from this week.{' '}
					<button
						type="button"
						className="lb-daily-linkbtn"
						onClick={() => {
							const moved = left.map(({ day: _, ...t }) => ({ ...t, id: newId('w') }))
							set((list) => [...list, ...moved])
							updateWeek(week, (w) => ({ ...w, tasks: w.tasks.filter((t) => t.done) }))
						}}
					>
						Move them to next week
					</button>
				</p>
			)}
		</Block>
	)
}

/* -------------------------------------------------------------------------------------- rotation */

function Rotation({ widget }: { widget: Widget }) {
	const { setup, plans } = useDaily()
	const { week, next, plan } = useWeeks()
	const weeks = widget.config.weeks ?? 4
	const span = Array.from({ length: weeks }, (_, i) => plans[addDays(week, -7 * (weeks - 1 - i))])
	const counts = eveningCounts([...span, plans[next]])
	const max = Math.max(1, ...setup.areas.map((a) => counts.get(a.id) ?? 0))
	const thin = squeezed(setup.areas, counts)
	const answer = (key: string, value: string) => updateWeek(week, (w) => ({ ...w, answers: { ...w.answers, [key]: w.answers[key] === value ? '' : value } }))
	const first = addDays(week, -7 * (weeks - 1))
	return (
		<Block title={widgetTitle(widget, setup.templates)} meta={`W${weekNumber(first)}–W${weekNumber(week)} + next week`}>
			<ul className="lb-review-bars">
				{setup.areas.map((a) => {
					const n = counts.get(a.id) ?? 0
					return (
						<li key={a.id}>
							<span>{a.name}</span>
							<span className="lb-review-bars__track">
								<span style={{ width: `${(n / max) * 100}%`, background: a.color }} />
							</span>
							<span className="lb-review-bars__n">{n}</span>
						</li>
					)
				})}
			</ul>
			{thin.map((a) => (
				<p key={a.id} className="lb-review-warn">
					<TriangleAlert size={12} aria-hidden="true" /> {a.name} is getting squeezed: {counts.get(a.id) ?? 0} evening{counts.get(a.id) === 1 ? '' : 's'} in {weeks} week{weeks === 1 ? '' : 's'} and next.
				</p>
			))}
			<div className="lb-review-q">
				<span>Is the rotation working?</span>
				<div className="lb-daily-seg">
					{['Yes', 'Mostly', 'No'].map((v) => (
						<button key={v} type="button" aria-pressed={plan?.answers.working === v} onClick={() => answer('working', v)}>
							{v}
						</button>
					))}
				</div>
			</div>
			<div className="lb-review-q">
				<span>Is an area getting squeezed out?</span>
				<div className="lb-daily-seg">
					{['None', ...setup.areas.map((a) => a.name)].map((v) => (
						<button key={v} type="button" aria-pressed={plan?.answers.squeezed === v} onClick={() => answer('squeezed', v)}>
							{v}
						</button>
					))}
				</div>
			</div>
		</Block>
	)
}

/* ------------------------------------------------------------------------------------------ logs */

function Logs({ widget }: { widget: Widget }) {
	const { setup } = useDaily()
	const { week, plan } = useWeeks()
	const lists = (widget.config.listIds ?? setup.logLists.map((l) => l.id)).flatMap((id) => setup.logLists.find((l) => l.id === id) ?? [])
	const set = (listId: string, change: (rows: LogRow[]) => LogRow[]) => updateWeek(week, (w) => ({ ...w, logs: { ...w.logs, [listId]: change(w.logs[listId] ?? []) } }))
	return (
		<Block title={widgetTitle(widget, setup.templates)}>
			{!lists.length && <p className="lb-daily-empty">No log lists: add one in the page settings.</p>}
			<div className="lb-review-logs">
				{lists.map((list) => {
					const rows = plan?.logs[list.id] ?? []
					return (
						<div key={list.id} className="lb-review-log">
							<span className="lb-daily-label">{list.name}</span>
							<ul>
								{rows.map((row) => (
									<li key={row.id}>
										<span className="lb-review-log__title">{row.title}</span>
										{list.columns.includes('rating') && <Stars value={row.rating ?? 0} onChange={(rating) => set(list.id, (r) => r.map((x) => (x.id === row.id ? { ...x, rating } : x)))} />}
										{list.columns.includes('pages') && (
											<input
												className="lb-daily-input lb-daily-input--number"
												type="number"
												aria-label={`Pages of ${row.title}`}
												placeholder="pp"
												value={row.pages ?? ''}
												onChange={(e) => set(list.id, (r) => r.map((x) => (x.id === row.id ? { ...x, pages: e.target.value === '' ? undefined : Number(e.target.value) } : x)))}
											/>
										)}
										{list.columns.includes('done') && (
											<label className="lb-daily-faint">
												<input type="checkbox" checked={!!row.done} onChange={() => set(list.id, (r) => r.map((x) => (x.id === row.id ? { ...x, done: !x.done } : x)))} /> Done
											</label>
										)}
										<button type="button" className="lb-daily-iconbtn lb-daily-noprint" aria-label={`Remove ${row.title}`} onClick={() => set(list.id, (r) => r.filter((x) => x.id !== row.id))}>
											<X size={11} aria-hidden="true" />
										</button>
									</li>
								))}
							</ul>
							<LogAdd name={list.name} onAdd={(title) => set(list.id, (r) => [...r, { id: newId('l'), title }])} />
						</div>
					)
				})}
			</div>
		</Block>
	)
}

function LogAdd({ name, onAdd }: { name: string; onAdd: (title: string) => void }) {
	const [text, setText] = useState('')
	return (
		<input
			className="lb-daily-input lb-daily-noprint"
			placeholder={`Add to ${name}, press Enter`}
			aria-label={`Add to ${name}`}
			value={text}
			onChange={(e) => setText(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' && text.trim()) {
					onAdd(text.trim())
					setText('')
				}
			}}
		/>
	)
}

function Stars({ value, onChange }: { value: number; onChange: (value: number) => void }) {
	return (
		<span className="lb-review-stars" role="group" aria-label="Rating">
			{[1, 2, 3, 4, 5].map((n) => (
				<button key={n} type="button" aria-label={`${n} star${n === 1 ? '' : 's'}`} aria-pressed={value >= n} onClick={() => onChange(value === n ? 0 : n)}>
					<Star size={11} aria-hidden="true" fill={value >= n ? 'currentColor' : 'none'} />
				</button>
			))}
		</span>
	)
}

/* -------------------------------------------------------------------------------- habits, numbers */

function Habits({ widget }: { widget: Widget }) {
	const { setup, pages, day } = useDaily()
	const { week } = useWeeks()
	const days = daysOfWeek(week)
	const rows = widget.config.rows ?? []
	const written = days.filter((d) => pages[d]).length
	return (
		<Block title={widgetTitle(widget, setup.templates)} meta={`${written} of 7 days from daily pages`}>
			{!rows.length ? (
				<p className="lb-daily-empty">No rows yet: add them in the Inspector.</p>
			) : (
				<table className="lb-review-grid">
					<thead>
						<tr>
							<th scope="col">Habit</th>
							{days.map((d, i) => (
								<th key={d} scope="col" aria-current={d === day ? 'date' : undefined}>
									{WEEKDAY_LETTERS[i]} {shortDay(d).split(' ')[1]}
								</th>
							))}
							<th scope="col">Total</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => {
							const cells = days.map((d) => trackCell(row, pages[d]))
							return (
								<tr key={row.id}>
									<th scope="row">{row.label || rowName(setup, row)}</th>
									{cells.map((c, i) => (
										<td key={days[i]}>{c.kind === 'tick' ? (c.done ? '✓' : '·') : c.kind === 'number' ? c.value : '·'}</td>
									))}
									<td className="lb-review-grid__total">{trackTotal(setup, row, cells).text}</td>
								</tr>
							)
						})}
					</tbody>
				</table>
			)}
		</Block>
	)
}

/** A row's name from what it counts, when it has no label of its own. */
export function rowName(setup: ReturnType<typeof useDaily>['setup'], row: TrackRow): string {
	switch (row.ref.kind) {
		case 'tick': {
			const id = row.ref.id
			return setup.iconTasks.find((t) => t.id === id)?.name ?? setup.templates.flatMap((t) => t.items).find((i) => i.id === id)?.text ?? 'A task that is gone'
		}
		case 'metric': {
			const id = row.ref.id
			return setup.metrics.find((m) => m.id === id)?.name ?? 'A number that is gone'
		}
		case 'fasting':
			return 'Fasted'
		case 'pick':
			return 'Daily pick'
	}
}

function Numbers({ widget }: { widget: Widget }) {
	const { setup, pages } = useDaily()
	const { week } = useWeeks()
	const days = daysOfWeek(week)
	const lastWeek = daysOfWeek(addDays(week, -7))
	const rows = widget.config.rows ?? []
	return (
		<Block title={widgetTitle(widget, setup.templates)} meta="from the daily pages">
			{!rows.length && <p className="lb-daily-empty">No numbers yet: add them in the Inspector.</p>}
			<ul className="lb-review-numbers">
				{rows.map((row) => {
					const label = row.label || rowName(setup, row)
					if (row.ref.kind === 'metric') {
						const id = row.ref.id
						const metric = setup.metrics.find((m) => m.id === id)
						if (!metric) return null
						const now = metricTotal(metric, days.map((d) => pages[d]))
						const before = metricTotal(metric, lastWeek.map((d) => pages[d]))
						const change = now !== null && before !== null ? Math.round((now - before) * 10) / 10 : null
						return (
							<li key={row.id}>
								<strong>
									{now ?? '—'} <small>{metric.unit}</small>
									{metric.total === 'avg' && <small> avg</small>}
								</strong>
								<span>
									{label}
									{change !== null && (
										<span className="lb-daily-faint">
											{' '}
											{change > 0 ? '↑' : change < 0 ? '↓' : '='}
											{Math.abs(change)} vs {before} last week
										</span>
									)}
								</span>
							</li>
						)
					}
					const total = trackTotal(setup, row, days.map((d) => trackCell(row, pages[d])))
					return (
						<li key={row.id}>
							<strong>{total.text}</strong>
							<span>{label}</span>
						</li>
					)
				})}
			</ul>
		</Block>
	)
}

/* ----------------------------------------------------------------------------- creative, reflection */

function Creative({ widget }: { widget: Widget }) {
	const { setup } = useDaily()
	const { week, plan } = useWeeks()
	const areas = (widget.config.areaIds ?? setup.areas.map((a) => a.id)).flatMap((id) => setup.areas.find((a) => a.id === id) ?? [])
	const cycle = cycleOf(setup, plan)
	return (
		<Block title={widgetTitle(widget, setup.templates)}>
			<div className="lb-review-creative">
				{areas.map((area) => {
					const note = plan?.creative[area.id] ?? { goal: '', done: '', next: '' }
					return (
						<div key={area.id} className="lb-review-creative__card">
							<span className="lb-daily-label" style={{ color: area.color }}>
								{area.name}
								{cycle?.areaIds.includes(area.id) && <span className="lb-daily-faint"> · this week</span>}
							</span>
							{(['goal', 'done', 'next'] as const).map((field) => (
								<label key={field} className="lb-review-creative__line">
									<span>{field[0]!.toUpperCase() + field.slice(1)}</span>
									<input
										className="lb-daily-input"
										value={note[field]}
										aria-label={`${area.name} ${field}`}
										onChange={(e) => updateWeek(week, (w) => ({ ...w, creative: { ...w.creative, [area.id]: { ...note, ...w.creative[area.id], [field]: e.target.value } } }))}
									/>
								</label>
							))}
						</div>
					)
				})}
			</div>
		</Block>
	)
}

function Reflection({ widget }: { widget: Widget }) {
	const { setup } = useDaily()
	const { week, plan } = useWeeks()
	const prompts = widget.config.prompts ?? []
	return (
		<Block title={widgetTitle(widget, setup.templates)}>
			<div className="lb-review-reflection">
				{prompts.map((p) => (
					<label key={p.id}>
						<span className="lb-daily-label">{p.text}</span>
						<textarea className="lb-daily-notes" value={plan?.reflection[p.id] ?? ''} onChange={(e) => updateWeek(week, (w) => ({ ...w, reflection: { ...w.reflection, [p.id]: e.target.value } }))} />
					</label>
				))}
			</div>
		</Block>
	)
}

/* ----------------------------------------------------------------------------------------- picks */

function Picks({ widget }: { widget: Widget }) {
	const { setup, pages, openDay } = useDaily()
	const { week } = useWeeks()
	const days = daysOfWeek(week)
	const drawn = days.filter((d) => Object.keys(pages[d]?.picks ?? {}).length).length
	return (
		<Block title={widgetTitle(widget, setup.templates)} meta={`${drawn} of 7 drawn`}>
			<ol className="lb-review-picks">
				{days.map((d, i) => {
					const pick = Object.values(pages[d]?.picks ?? {})[0]
					return (
						<li key={d}>
							<button type="button" className="lb-review-picks__day" onClick={() => openDay(d)} aria-label={`Open ${WEEKDAYS[i]}'s page`}>
								{pick ? <Cover src={pick.cover} alt="" /> : <span className="lb-daily-cover lb-daily-cover--empty" />}
							</button>
							<span className="lb-review-picks__text">
								<span className="lb-daily-faint">
									{WEEKDAY_LETTERS[i]} {shortDay(d).split(' ')[1]}
								</span>
								{pick ? (
									<>
										<strong>{pick.title}</strong>
										<span className="lb-daily-faint">{[pick.creator, pick.year].filter(Boolean).join(' · ')}</span>
										{pick.stamp && <span className={`lb-review-stamp lb-review-stamp--${pick.stamp}`}>{pick.stamp}</span>}
										<span className="lb-review-picks__impression">{pick.impression || 'No impression yet'}</span>
									</>
								) : (
									<span className="lb-daily-faint">Not drawn</span>
								)}
							</span>
						</li>
					)
				})}
			</ol>
		</Block>
	)
}
