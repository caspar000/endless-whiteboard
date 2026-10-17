import {
	createShapePropsMigrationSequence,
	getBoardBridge,
	NodeEditorPopover,
	type NodeComponentProps,
	type NodeDefinition,
} from '@lifeboard/node-kit'
import { stopEventPropagation, T, useValue, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { ListTodo } from 'lucide-react'
import { memo, type SyntheticEvent } from 'react'
import { isHabit, isItem, UP_NEXT_TYPE, type UpNextProps } from '../board'
import { parseFilter, parseLog, periodKey, PERIOD_NOUN, type Period } from '../habits'
import { todayIso } from '../model'
import { revealItem, toggleItemDone } from '../ops'
import { boardIdOf, getHabitIndex, getSkillIndex, getTrackIndex, type HabitEntry } from '../skillIndex'
import { goalsOf, upNext } from '../upNext'

const swallow = (e: SyntheticEvent) => e.stopPropagation()

const WEEKS = 12

/** Whether a shape the index points at is on the board this editor shows. */
function onThisBoard(editor: Editor, boardId: string, shapeId: string): boolean {
	return boardIdOf(editor) === boardId && !!editor.getShape(shapeId as TLShapeId)
}

/** Goes to an item wherever it is: this board, or another one opened for it. */
async function goTo(editor: Editor, boardId: string, shapeId: string): Promise<void> {
	let target: Editor | null = editor
	if (boardIdOf(editor) !== boardId) target = (await getBoardBridge()?.open(boardId)) ?? null
	const shape = target?.getShape(shapeId as TLShapeId)
	if (target && isItem(shape)) revealItem(target, shape)
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

/**
 * The list to work from: one row per active track (its next step), the habits still due this
 * period, and twelve weeks of days you did something. Ticks in place for what is on this board;
 * anything else opens its board and goes to it.
 */
function UpNextComponentImpl({ shape, isEditing, editor }: NodeComponentProps<UpNextProps>) {
	const goal = shape.props.goal
	const today = todayIso()
	const data = useValue(
		'lifeboard:up-next',
		() => {
			const tracks = Object.values(getTrackIndex())
			const habits = Object.values(getHabitIndex())
			return { ...upNext(tracks, getSkillIndex(), habits, today, goal), goals: goalsOf(tracks, habits) }
		},
		[goal, today]
	)
	const weeks = heatmapWeeks(today)
	const total = [...data.days.values()].reduce((a, b) => a + b, 0)

	const body = (
		<div className="lb-upnext">
			<header className="lb-upnext__head">
				<span className="lb-upnext__title">Up next</span>
				<span className="lb-upnext__goal">{goal || 'All goals'}</span>
			</header>
			{data.steps.length === 0 && data.habits.length === 0 ? (
				<p className="lb-upnext__empty">Nothing due. Set a track to Active to see its next step here.</p>
			) : (
				<ul className="lb-upnext__list">
					{data.steps.map(({ track, step, parent }) => {
						const here = onThisBoard(editor, step.boardId, step.shapeId)
						return (
							<li key={track.trackId} className="lb-upnext__row">
								{here ? (
									<input
										type="checkbox"
										className="lb-skill__check"
										checked={false}
										onPointerDown={swallow}
										onClick={swallow}
										onChange={() => toggleItemDone(editor, step.shapeId as TLShapeId)}
									/>
								) : (
									<span className="lb-upnext__dot" aria-hidden />
								)}
								<button
									type="button"
									className="lb-upnext__item"
									onPointerDown={swallow}
									onClick={(e) => {
										e.stopPropagation()
										void goTo(editor, step.boardId, step.shapeId)
									}}
								>
									<span>{step.title}</span>
									<span className="lb-upnext__meta">
										{[track.name, parent?.title, step.kind, step.medium].filter(Boolean).join(' · ')}
										{here ? '' : ' · on another board'}
									</span>
								</button>
							</li>
						)
					})}
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
						<span>Goal</span>
						<select
							value={goal}
							onChange={(e) => editor.updateShape({ id: shape.id, type: UP_NEXT_TYPE, props: { goal: e.target.value } } as never)}
						>
							<option value="">All goals</option>
							{data.goals.map((g) => (
								<option key={g}>{g}</option>
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
	props: { goal: T.string, autoHeight: T.boolean },
	// Empty for now; the sequence exists from day one so the first migration is a one-line change.
	migrations: createShapePropsMigrationSequence({ sequence: [] }),
	defaultProps: () => ({ goal: '', autoHeight: true }),
	defaultSize: { w: 340, h: 160 },
	autoHeight: { minHeight: 160 },
	component: UpNextComponent,
	canEdit: true,
	getLabel: () => 'Up next',
}
