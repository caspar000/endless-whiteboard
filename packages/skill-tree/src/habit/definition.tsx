import {
	createShapePropsMigrationSequence,
	NodeEditorPopover,
	type NodeComponentProps,
	type NodeDefinition,
} from '@lifeboard/node-kit'
import { stopEventPropagation, T, useValue, type Editor } from '@lifeboard/canvas'
import { Repeat } from 'lucide-react'
import { memo, type KeyboardEvent, type SyntheticEvent } from 'react'
import { draftClass, HABIT_TYPE, type HabitProps, type HabitShape } from '../board'
import {
	currentStreak,
	habitHistory,
	habitStart,
	parseFilter,
	parseLog,
	periodKey,
	PERIOD_NOUN,
	PERIODS,
	type Period,
	type PeriodResult,
} from '../habits'
import { makeItemId, todayIso } from '../model'
import { getSkillIndex } from '../skillIndex'

const swallow = (e: SyntheticEvent) => e.stopPropagation()
const keepKeys = (e: KeyboardEvent) => e.stopPropagation()

/** How many periods the card draws as dots: the last eight, the current one last. */
const SHOWN = 8

interface HabitView {
	started: boolean
	waitingFor: string
	history: PeriodResult[]
	current: PeriodResult
	streak: number
	auto: boolean
}

function readView(habit: HabitShape): HabitView {
	const today = todayIso()
	const index = getSkillIndex()
	const period = (habit.props.period || 'week') as Period
	const start = habitStart(habit.props, index)
	const key = periodKey(today, period)
	const empty = { key, count: 0, met: false }
	if (!start) {
		return {
			started: false,
			waitingFor: index[habit.props.startedBy]?.title || habit.props.startedBy,
			history: [],
			current: empty,
			streak: 0,
			auto: !!parseFilter(habit.props.counts),
		}
	}
	const history = habitHistory({ ...habit.props, period, startedAt: start }, Object.values(index), today)
	return {
		started: true,
		waitingFor: '',
		history,
		current: history[history.length - 1] ?? empty,
		streak: currentStreak(history),
		auto: !!parseFilter(habit.props.counts),
	}
}

/** Adds or takes back one hand tick in the current period. One undo entry. */
function tick(editor: Editor, habit: HabitShape, delta: 1 | -1): void {
	const key = periodKey(todayIso(), (habit.props.period || 'week') as Period)
	const log = parseLog(habit.props.log)
	const next = Math.max(0, (log[key] ?? 0) + delta)
	if (next === 0) delete log[key]
	else log[key] = next
	editor.run(() => {
		editor.markHistoryStoppingPoint(delta > 0 ? 'tick habit' : 'untick habit')
		editor.updateShape({ id: habit.id, type: HABIT_TYPE, props: { log: JSON.stringify(log) } } as never)
	})
}

/**
 * A habit card: what it asks for this period, ticks for the last few, and the current streak. A
 * missed period is a hollow dot, never red; the card only ever counts up.
 */
function HabitComponentImpl({ shape, isEditing, editor }: NodeComponentProps<HabitProps>) {
	const habit = shape as unknown as HabitShape
	const view = useValue('lifeboard:habit', () => readView(habit), [habit])
	const period = (shape.props.period || 'week') as Period
	const paused = shape.props.state === 'paused'
	const shown = view.history.slice(-SHOWN)

	const body = (
		<div className={`lb-habit${view.current.met ? ' lb-habit--met' : ''}${paused || !view.started ? ' lb-habit--idle' : ''}${draftClass(shape as never)}`}>
			<div className="lb-habit__head">
				<span className="lb-habit__name">{shape.props.name || 'Untitled Habit'}</span>
				<span className="lb-habit__count">
					{view.current.count}/{Math.max(1, shape.props.target)}
				</span>
				{view.started && !paused && (
					<span className="lb-habit__buttons">
						<button type="button" aria-label="Take back a tick" onPointerDown={swallow} onClick={(e) => (e.stopPropagation(), tick(editor, habit, -1))}>
							−
						</button>
						<button type="button" aria-label="Tick" onPointerDown={swallow} onClick={(e) => (e.stopPropagation(), tick(editor, habit, 1))}>
							+
						</button>
					</span>
				)}
			</div>
			<div className="lb-habit__sub">
				{!view.started
					? `Starts when "${view.waitingFor}" is done`
					: paused
						? 'Paused'
						: `${view.auto ? 'Counts itself' : 'By hand'} · every ${PERIOD_NOUN[period]}${view.streak > 1 ? ` · ${view.streak} ${PERIOD_NOUN[period]}s in a row` : ''}`}
			</div>
			{view.started && (
				<div className="lb-habit__dots" aria-label={`Last ${shown.length} ${PERIOD_NOUN[period]}s`}>
					{shown.map((p, i) => (
						<span
							key={p.key}
							title={`${p.key}: ${p.count}`}
							className={`lb-habit__dot${p.met ? ' lb-habit__dot--met' : ''}${i === shown.length - 1 ? ' lb-habit__dot--now' : ''}`}
						/>
					))}
				</div>
			)}
		</div>
	)

	if (!isEditing) return body

	const set = (props: Partial<HabitProps>) => editor.updateShape({ id: shape.id, type: HABIT_TYPE, props } as never)
	const filter = parseFilter(shape.props.counts) ?? {}
	const setFilter = (key: 'kind' | 'medium' | 'method' | 'tag', value: string) => {
		const next = { ...filter, [key]: value.trim() || undefined }
		const lines = Object.entries(next)
			.filter(([, v]) => v)
			.map(([k, v]) => `${k}: ${v}`)
		set({ counts: lines.join('\n') })
	}

	return (
		<div onPointerDown={stopEventPropagation} onTouchStart={stopEventPropagation} style={{ pointerEvents: 'all' }}>
			{body}
			<NodeEditorPopover shape={shape} editor={editor} width={300}>
				<div className="lb-skill-editor">
					<label>
						<span>Name</span>
						<input autoFocus value={shape.props.name} onKeyDown={keepKeys} onChange={(e) => set({ name: e.target.value })} />
					</label>
					<div className="lb-skill-editor__pair">
						<label>
							<span>Every</span>
							<select value={period} onChange={(e) => set({ period: e.target.value })}>
								{PERIODS.map((p) => (
									<option key={p} value={p}>
										{PERIOD_NOUN[p]}
									</option>
								))}
							</select>
						</label>
						<label>
							<span>Target</span>
							<input
								type="number"
								min={1}
								value={shape.props.target}
								onKeyDown={keepKeys}
								onChange={(e) => set({ target: Math.max(1, Number(e.target.value) || 1) })}
							/>
						</label>
					</div>
					<div className="lb-skill-editor__block">
						<span>Counts written-up items with (leave empty to tick by hand)</span>
						<div className="lb-skill-editor__pair">
							{(['kind', 'medium', 'method', 'tag'] as const).map((key) => (
								<label key={key}>
									<span>{key}</span>
									<input value={filter[key] ?? ''} onKeyDown={keepKeys} onChange={(e) => setFilter(key, e.target.value)} />
								</label>
							))}
						</div>
					</div>
					<label>
						<span>Starts after</span>
						<input
							value={shape.props.startedBy}
							placeholder="item id, or empty"
							onKeyDown={keepKeys}
							onChange={(e) => set({ startedBy: e.target.value.trim() })}
						/>
					</label>
					<label>
						<span>State</span>
						<select value={shape.props.state} onChange={(e) => set({ state: e.target.value })}>
							<option value="active">Active</option>
							<option value="paused">Paused</option>
						</select>
					</label>
					<p className="lb-skill-editor__id">{shape.props.habitId}</p>
				</div>
			</NodeEditorPopover>
		</div>
	)
}

const HabitComponent = memo(HabitComponentImpl, (prev, next) => prev.shape === next.shape && prev.isEditing === next.isEditing)

export const habitNodeDefinition: NodeDefinition<HabitProps> = {
	type: HABIT_TYPE,
	label: 'Habit',
	icon: '↻',
	toolbarIcon: Repeat,
	props: {
		habitId: T.string,
		name: T.string,
		goal: T.string,
		period: T.string,
		target: T.number,
		counts: T.string,
		startedBy: T.string,
		startedAt: T.string,
		log: T.string,
		state: T.string,
		autoHeight: T.boolean,
	},
	// Empty for now; the sequence exists from day one so the first migration is a one-line change.
	migrations: createShapePropsMigrationSequence({ sequence: [] }),
	defaultProps: () => ({
		habitId: '',
		name: '',
		goal: '',
		period: 'week',
		target: 1,
		counts: '',
		startedBy: '',
		startedAt: '',
		log: '{}',
		state: 'active',
		autoHeight: true,
	}),
	// Fills in what a new habit hasn't chosen: an id, and today as the first day that counts.
	onCreate: ({ shape }) => {
		const patch: Partial<HabitProps> = {}
		if (!shape.props.habitId) patch.habitId = makeItemId(shape.props.name || 'habit', 'habit/')
		if (!shape.props.startedAt) patch.startedAt = todayIso()
		return Object.keys(patch).length ? patch : null
	},
	defaultSize: { w: 260, h: 84 },
	autoHeight: { minHeight: 84 },
	component: HabitComponent,
	canEdit: true,
	getLabel: (shape) => shape.props.name || undefined,
}
