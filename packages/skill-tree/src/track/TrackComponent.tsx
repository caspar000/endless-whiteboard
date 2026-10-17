import { NodeEditorPopover, type NodeComponentProps } from '@lifeboard/node-kit'
import { stopEventPropagation, useValue, type Editor } from '@lifeboard/canvas'
import { memo, type KeyboardEvent, type SyntheticEvent } from 'react'
import { childrenOf, draftClass, itemByItemId, progressOf, TRACK_TYPE, type ItemShape, type TrackProps, type TrackShape } from '../board'
import { formatProgress, nextInOrder, parseOrder } from '../model'
import { cycleTrackState, moveInTrack, nextStep, removeFromTrack, revealItem, toggleItemDone } from '../ops'
import { isDone, readText } from '../properties'
import { getSkillIndex } from '../skillIndex'

const swallow = (e: SyntheticEvent) => e.stopPropagation()
const keepKeys = (e: KeyboardEvent) => e.stopPropagation()

const STATE_LABEL: Record<string, string> = { active: 'Active', paused: 'Paused', notStarted: 'Not started' }

interface Row {
	itemId: string
	item: ItemShape | null
	title: string
	done: boolean
	doneAt: string
	/** For a parent: its progress, and the step a tick would finish. */
	progress: string
	step: ItemShape | null
	hasChildren: boolean
	/** On another board: what the index last heard about it. */
	elsewhere: boolean
}

/**
 * The syllabus as a list. Done rows are struck through with their date; the first undone row is the
 * next thing to do. Ticking a parent's row ticks its next step, so a unit is worked through from here
 * without opening it. A row whose item is on another board says so (the index of step 2 fills it in).
 */
function TrackComponentImpl({ shape, isEditing, editor }: NodeComponentProps<TrackProps>) {
	const track = shape as unknown as TrackShape
	const rows = useValue('lifeboard:skill-track', () => readRows(editor, shape.props.order), [editor, shape.props.order])
	const doneCount = rows.filter((row) => row.done).length
	const next = nextInOrder(
		rows.map((row) => row.itemId),
		(id) => {
			const row = rows.find((r) => r.itemId === id)
			return row?.item || row?.elsewhere ? row.done : undefined
		}
	)

	const body = (
		<div className={`lb-track lb-track--${shape.props.state}${draftClass(shape as never)}`}>
			<header className="lb-track__head">
				<span className="lb-track__name">{shape.props.name || 'Untitled track'}</span>
				<button
					type="button"
					className="lb-track__state"
					title="Active tracks feed Up next. Click to change."
					onPointerDown={swallow}
					onClick={(e) => {
						e.stopPropagation()
						cycleTrackState(editor, track)
					}}
				>
					{STATE_LABEL[shape.props.state] ?? shape.props.state}
				</button>
			</header>
			<div className="lb-track__sub">
				{shape.props.goal && <span>{shape.props.goal}</span>}
				<span>
					{doneCount}/{rows.length} done
				</span>
			</div>
			{rows.length === 0 ? (
				<p className="lb-track__empty">Select items and this track, then run "Add selection to track" from ⌘K.</p>
			) : (
				<ol className="lb-track__list">
					{rows.map((row, index) => (
						<li
							key={row.itemId}
							className={[
								'lb-track__row',
								row.done && 'lb-track__row--done',
								row.itemId === next && 'lb-track__row--next',
								!row.item && 'lb-track__row--missing',
							]
								.filter(Boolean)
								.join(' ')}
						>
							<span className="lb-track__num">{index + 1}</span>
							<input
								type="checkbox"
								className="lb-skill__check"
								checked={row.done}
								disabled={!row.item || (row.done ? row.hasChildren : !row.step)}
								title={row.step && row.step.id !== row.item?.id ? `Ticks "${row.step.props.title}"` : undefined}
								onPointerDown={swallow}
								onClick={swallow}
								onChange={() => {
									if (row.step) toggleItemDone(editor, row.step.id)
									else if (row.item && row.done && !row.hasChildren) toggleItemDone(editor, row.item.id)
								}}
							/>
							<button
								type="button"
								className="lb-track__title"
								disabled={!row.item}
								onPointerDown={swallow}
								onClick={(e) => {
									e.stopPropagation()
									if (row.item) revealItem(editor, row.item)
								}}
							>
								{row.title}
								{row.step && row.step.id !== row.item?.id && (
									<span className="lb-track__step">next: {row.step.props.title}</span>
								)}
								{!row.item && <span className="lb-track__step">{row.elsewhere ? 'on another board' : 'not found on any board yet'}</span>}
							</button>
							<span className="lb-track__aside">{row.done ? row.doneAt : row.progress}</span>
							{isEditing && (
								<span className="lb-track__move">
									<button type="button" aria-label="Move up" onClick={() => moveInTrack(editor, track, row.itemId, -1)}>
										↑
									</button>
									<button type="button" aria-label="Move down" onClick={() => moveInTrack(editor, track, row.itemId, 1)}>
										↓
									</button>
									<button type="button" aria-label="Remove from track" onClick={() => removeFromTrack(editor, track, row.itemId)}>
										×
									</button>
								</span>
							)}
						</li>
					))}
				</ol>
			)}
		</div>
	)

	if (!isEditing) return body

	return (
		<div onPointerDown={stopEventPropagation} onTouchStart={stopEventPropagation} style={{ pointerEvents: 'all' }}>
			{body}
			<NodeEditorPopover shape={shape} editor={editor} width={300}>
				<div className="lb-skill-editor">
					<label>
						<span>Name</span>
						<input
							autoFocus
							value={shape.props.name}
							onKeyDown={keepKeys}
							onChange={(e) => editor.updateShape({ id: shape.id, type: TRACK_TYPE, props: { name: e.target.value } } as never)}
						/>
					</label>
					<label>
						<span>Goal</span>
						<input
							value={shape.props.goal}
							placeholder="Game director, Western canon…"
							onKeyDown={keepKeys}
							onChange={(e) => editor.updateShape({ id: shape.id, type: TRACK_TYPE, props: { goal: e.target.value } } as never)}
						/>
					</label>
					<label>
						<span>Tags for every item</span>
						<input
							value={shape.props.defaultTags}
							placeholder="skill node ids, comma-separated"
							onKeyDown={keepKeys}
							onChange={(e) =>
								editor.updateShape({ id: shape.id, type: TRACK_TYPE, props: { defaultTags: e.target.value } } as never)
							}
						/>
					</label>
					<p className="lb-skill-editor__id">{shape.props.trackId}</p>
				</div>
			</NodeEditorPopover>
		</div>
	)
}

function readRows(editor: Editor, order: string): Row[] {
	return parseOrder(order).map((itemId) => {
		const item = itemByItemId(editor, itemId) ?? null
		if (!item) {
			const entry = getSkillIndex()[itemId]
			return {
				itemId,
				item,
				title: entry?.title || itemId,
				done: entry?.done ?? false,
				doneAt: entry?.doneAt ?? '',
				progress: '',
				step: null,
				hasChildren: entry?.hasChildren ?? false,
				elsewhere: !!entry,
			}
		}
		const hasChildren = childrenOf(editor, item.id).length > 0
		return {
			itemId,
			item,
			title: item.props.title || 'Untitled item',
			done: isDone(item),
			doneAt: readText(item, 'doneAt'),
			progress: hasChildren ? formatProgress(progressOf(editor, item)) : '',
			// A finished row has no next step: what is left under it is optional depth, ticked on the card.
			step: isDone(item) ? null : nextStep(editor, item),
			hasChildren,
			elsewhere: false,
		}
	})
}

export const TrackComponent = memo(
	TrackComponentImpl,
	(prev, next) => prev.shape === next.shape && prev.isEditing === next.isEditing
)
