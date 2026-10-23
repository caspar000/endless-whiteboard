import {
	createShapePropsMigrationIds,
	createShapePropsMigrationSequence,
	NodeEditorPopover,
	type NodeComponentProps,
	type NodeDefinition,
} from '@lifeboard/node-kit'
import { stopEventPropagation, T, useValue, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { ListTodo } from 'lucide-react'
import { memo, type SyntheticEvent } from 'react'
import { isHabit, UP_NEXT_TYPE, type UpNextProps } from '../board'
import { parseFilter, parseLog, periodKey, PERIOD_NOUN, type Period } from '../habits'
import { todayIso } from '../model'
import { tick } from '../ops'
import { boardIdOf, getHabitIndex, getSkillIndex, type HabitEntry } from '../skillIndex'
import { getItems, getTracks } from '../syllabus'
import { upcomingSteps, upNext } from '../upNext'

const swallow = (e: SyntheticEvent) => e.stopPropagation()

const WEEKS = 12

const versions = createShapePropsMigrationIds(UP_NEXT_TYPE, { PerTrack: 1 })

/** Whether a shape the index points at is on the board this editor shows. */
function onThisBoard(editor: Editor, boardId: string, shapeId: string): boolean {
	return boardIdOf(editor) === boardId && !!editor.getShape(shapeId as TLShapeId)
}

function tickHabit(editor: Editor, habit: HabitEntry): void {
	const shape = editor.getShape(habit.shapeId as TLShapeId)
	if (!isHabit(shape)) return
	const key = periodKey(todayIso(), (habit.period || 'week') as Period)
	const log = parseLog(shape.props.log)
	log[key] = (log[key] ?? 0) + 1
	editor.run(() => {
		editor.markHistoryStoppingPoint('tick habit')
		editor.updateShape({ id: shape.id, type: shape.type, props: { log: JSON.stringify(log) } } as never)
	})
}

/** Monday-started weeks ending with this one, as rows of seven ISO days. */
function heatmapWeeks(today: string): string[][] {
	const end = new Date(`${today}T12:00:00`)
	const monday = new Date(end)
	monday.setDate(end.getDate() - ((end.getDay() + 6) % 7) - 7 * (WEEKS - 1))
	const weeks: string[][] = []
	for (let w = 0; w < WEEKS; w++) {
		const week: string[] = []
		for (let d = 0; d < 7; d++) {
			const day = new Date(monday)
			day.setDate(monday.getDate() + w * 7 + d)
			week.push(todayIso(day))
		}
		weeks.push(week)
	}
	return weeks
}

const UPCOMING = 5

/**
 * The card to work from, for one track (docs/skill-tree-plan.md, "Rebuild"): its current step, lit and
 * ready to tick, the next five greyed so you can see what is coming, then the habits of its goal still
 * due this period and twelve weeks of the days you did something. It follows the first active track
 * unless you pick one (double-click it).
 */
function UpNextComponentImpl({ shape, isEditing, editor }: NodeComponentProps<UpNextProps>) {
	const today = todayIso()
	const data = useValue(
		'lifeboard:up-next',
		() => {
			const tracks = Object.values(getTracks()).filter((t) => !t.draft)
			const track = shape.props.trackId ? tracks.find((t) => t.trackId === shape.props.trackId) : tracks.find((t) => t.state === 'active')
			const items = getItems()
			const live = Object.fromEntries(Object.entries(items).filter(([, i]) => !i.draft))
			const steps = track ? upcomingSteps(track.order, live, UPCOMING + 1) : []
			const habits = Object.values(getHabitIndex())
			// Habits and days are this track's goal's; the heatmap counts what this track's entries finished.
			const rest = track ? upNext([track], getSkillIndex(), habits, today, track.goal) : { habits: [], days: new Map<string, number>() }
			return { track, tracks, steps, habits: rest.habits, days: rest.days }
		},
		[shape.props.trackId, today]
	)
	const weeks = heatmapWeeks(today)
	const total = [...data.days.values()].reduce((a, b) => a + b, 0)
	const [current, ...later] = data.steps

	const body = (
		<div className="lb-upnext">
			<header className="lb-upnext__head">
				<span className="lb-upnext__title">Up next</span>
				<span className="lb-upnext__goal">{data.track ? data.track.name : 'No active track'}</span>
			</header>
			{!current ? (
				<p className="lb-upnext__empty">{data.track ? 'Everything on this track is done.' : 'Set a track to Active, or pick one: double-click this card.'}</p>
			) : (
				<ul className="lb-upnext__list">
					<li className="lb-upnext__row lb-upnext__row--current">
						<input
							type="checkbox"
							className="lb-skill__check"
							checked={false}
							onPointerDown={swallow}
							onClick={swallow}
							onChange={() => tick(editor, current.step.itemId, true, shape.id as TLShapeId)}
						/>
						<span className="lb-upnext__item">
							<span>{current.step.title}</span>
							<span className="lb-upnext__meta">
								{[current.entry !== current.step ? current.entry.title : '', current.step.kind, current.step.medium].filter(Boolean).join(' · ')}
							</span>
						</span>
					</li>
					{later.map(({ step, entry }) => (
						<li key={step.itemId} className="lb-upnext__row lb-upnext__row--later">
							<span className="lb-upnext__dot" aria-hidden />
							<span className="lb-upnext__item">
								<span>{step.title}</span>
								{entry !== step && <span className="lb-upnext__meta">{entry.title}</span>}
							</span>
						</li>
					))}
				</ul>
			)}
			{data.habits.length > 0 && (
				<ul className="lb-upnext__list">
					{data.habits.map(({ habit, count, target, period }) => {
						const here = onThisBoard(editor, habit.boardId, habit.shapeId)
						const manual = !parseFilter(habit.counts)
						return (
							<li key={habit.habitId} className="lb-upnext__row lb-upnext__row--habit">
								<span className="lb-upnext__count">
									{count}/{target}
								</span>
								<span className="lb-upnext__item">
									<span>{habit.name}</span>
									<span className="lb-upnext__meta">this {PERIOD_NOUN[period]}</span>
								</span>
								{here && manual && (
									<button
										type="button"
										className="lb-upnext__plus"
										aria-label={`Tick ${habit.name}`}
										onPointerDown={swallow}
										onClick={(e) => {
											e.stopPropagation()
											tickHabit(editor, habit)
										}}
									>
										+
									</button>
								)}
							</li>
						)
					})}
				</ul>
			)}
			<div className="lb-upnext__heat" aria-label={`${total} things done in the last ${WEEKS} weeks`}>
				{weeks.map((week) => (
					<div key={week[0]} className="lb-upnext__week">
						{week.map((day) => {
							const n = data.days.get(day) ?? 0
							return <span key={day} title={`${day}: ${n}`} className={`lb-upnext__day lb-upnext__day--${Math.min(n, 3)}${day > today ? ' lb-upnext__day--future' : ''}`} />
						})}
					</div>
				))}
			</div>
			<span className="lb-upnext__total">{total} done in the last {WEEKS} weeks</span>
		</div>
	)

	if (!isEditing) return body
	return (
		<div onPointerDown={stopEventPropagation} onTouchStart={stopEventPropagation} style={{ pointerEvents: 'all' }}>
			{body}
			<NodeEditorPopover shape={shape} editor={editor} width={260}>
				<div className="lb-skill-editor">
					<label>
						<span>Track</span>
						<select
							value={shape.props.trackId}
							onChange={(e) => editor.updateShape({ id: shape.id, type: UP_NEXT_TYPE, props: { trackId: e.target.value } } as never)}
						>
							<option value="">Follow the first active track</option>
							{data.tracks.map((t) => (
								<option key={t.trackId} value={t.trackId}>
									{t.name}
								</option>
							))}
						</select>
					</label>
				</div>
			</NodeEditorPopover>
		</div>
	)
}

const UpNextComponent = memo(UpNextComponentImpl, (prev, next) => prev.shape === next.shape && prev.isEditing === next.isEditing)

export const upNextNodeDefinition: NodeDefinition<UpNextProps> = {
	type: UP_NEXT_TYPE,
	label: 'Up next',
	icon: '▶',
	toolbarIcon: ListTodo,
	props: { trackId: T.string, autoHeight: T.boolean },
	migrations: createShapePropsMigrationSequence({
		sequence: [
			{
				// One card per track now, instead of one for every track of a goal.
				id: versions.PerTrack,
				up(props) {
					delete props.goal
					props.trackId = ''
				},
			},
		],
	}),
	defaultProps: () => ({ trackId: '', autoHeight: true }),
	defaultSize: { w: 340, h: 160 },
	autoHeight: { minHeight: 160 },
	component: UpNextComponent,
	canEdit: true,
	getLabel: () => 'Up next',
}
