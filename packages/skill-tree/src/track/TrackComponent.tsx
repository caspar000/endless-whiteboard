import { NodeEditorPopover, type NodeComponentProps } from '@lifeboard/node-kit'
import { stopEventPropagation, useValue, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { memo, type KeyboardEvent, type ReactNode, type SyntheticEvent } from 'react'
import { TRACK_TYPE, type TrackProps, type TrackShape } from '../board'
import { Tick } from '../item/ItemComponent'
import { formatProgress, parseOrder } from '../model'
import { putCard, tickNext } from '../ops'
import {
	cycleTrackState,
	getItems,
	getSkillIndex,
	getTracks,
	isItemDone,
	moveInTrack,
	nextLeafOf,
	progressOf,
	removeFromTrack,
	updateTrack,
	type ItemDef,
} from '../syllabus'

const swallow = (e: SyntheticEvent) => e.stopPropagation()
const keepKeys = (e: KeyboardEvent) => e.stopPropagation()

const STATE_LABEL: Record<string, string> = { active: 'Active', paused: 'Paused', notStarted: 'Not started' }

/** Folds or unfolds one row on this card. How a list is folded is the board's view, not anyone's data. */
function toggleOpen(editor: Editor, shape: TrackShape, itemId: string): void {
	const open = new Set(parseOrder(shape.props.open))
	if (open.has(itemId)) open.delete(itemId)
	else open.add(itemId)
	editor.run(() => editor.updateShape({ id: shape.id, type: TRACK_TYPE, props: { open: [...open].join('\n') } } as never), { history: 'ignore' })
}

interface RowProps {
	item: ItemDef
	editor: Editor
	shape: TrackShape
	open: Set<string>
	next: string | null
	depth: number
	number?: number
	/** Controls at the end of the line (moving an entry, while editing). */
	extra?: ReactNode
}

/** One entry of the outline, and its works below it when it is unfolded. */
function Row({ item, editor, shape, open, next, depth, number, extra }: RowProps) {
	const all = getItems()
	const anchor = shape.id as TLShapeId
	const works = item.children.map((id) => all[id]).filter((w): w is ItemDef => !!w)
	const done = isItemDone(item.itemId)
	const progress = works.length ? progressOf(item.itemId) : null
	const unfolded = works.length > 0 && open.has(item.itemId)
	const step = works.length && !done ? nextLeafOf(item.itemId) : null
	return (
		<li className={['lb-track__row', done && 'lb-track__row--done', item.itemId === next && 'lb-track__row--next', item.draft && 'lb-draft'].filter(Boolean).join(' ')}>
			<div className="lb-track__line" style={{ paddingLeft: depth * 16 }}>
				{number !== undefined && <span className="lb-track__num">{number}</span>}
				{works.length > 0 ? (
					<button
						type="button"
						className="lb-track__fold"
						aria-label={unfolded ? 'Fold' : 'Unfold'}
						onPointerDown={swallow}
						onClick={(e) => {
							e.stopPropagation()
							toggleOpen(editor, shape, item.itemId)
						}}
					>
						{unfolded ? '▾' : '▸'}
					</button>
				) : (
					<span className="lb-track__fold" aria-hidden />
				)}
				{works.length > 0 ? (
					// A parent's box ticks its next work, so an entry is worked through from the list.
					<input
						type="checkbox"
						className="lb-skill__check"
						checked={done}
						disabled={done || !step}
						title={step ? `Ticks "${step.title}"` : undefined}
						onPointerDown={swallow}
						onClick={swallow}
						onChange={() => tickNext(editor, item.itemId, anchor)}
					/>
				) : (
					<Tick item={item} editor={editor} anchor={anchor} />
				)}
				<span className="lb-track__title">
					{item.title || 'Untitled'}
					{step && !unfolded && <span className="lb-track__step">next: {step.title}</span>}
				</span>
				<span className="lb-track__aside">{done && !progress ? item.doneAt : progress ? formatProgress(progress) : ''}</span>
				<button
					type="button"
					className="lb-track__card"
					title="Put a card on the board"
					aria-label={`Put a card for ${item.title} on the board`}
					onPointerDown={swallow}
					onClick={(e) => {
						e.stopPropagation()
						putCard(editor, item.itemId, { beside: anchor })
					}}
				>
					↗
				</button>
				{extra}
			</div>
			{unfolded && (
				<ol className="lb-track__works">
					{works.map((work) => (
						<Row key={work.itemId} item={work} editor={editor} shape={shape} open={open} next={next} depth={depth + 1} />
					))}
				</ol>
			)}
		</li>
	)
}

/**
 * A track as a list: the whole outline in reading order, every entry folding to its works. The first
 * undone entry is lit. Ticks go to the vault, so the tree and every other list follow.
 */
function TrackComponentImpl({ shape, isEditing, editor }: NodeComponentProps<TrackProps>) {
	const track = shape as unknown as TrackShape
	// A fresh object per change of the vault or the index: a tick changes an item, not the track.
	const { track: view } = useValue(
		'lifeboard:skill-track',
		() => ({ track: getTracks()[shape.props.trackId], items: getItems(), index: getSkillIndex() }),
		[shape.props.trackId]
	)
	if (!view) {
		return (
			<div className="lb-track lb-track--missing">
				<span className="lb-track__name">Not in the vault</span>
				<span className="lb-track__sub">{shape.props.trackId || 'No track'}</span>
			</div>
		)
	}
	const all = getItems()
	const entries = view.order.map((id) => all[id]).filter((i): i is ItemDef => !!i)
	const doneCount = entries.filter((e) => isItemDone(e.itemId)).length
	const next = entries.find((e) => !isItemDone(e.itemId))?.itemId ?? null
	const open = new Set(parseOrder(shape.props.open))

	const body = (
		<div className={`lb-track lb-track--${view.state}${view.draft ? ' lb-draft' : ''}`}>
			<header className="lb-track__head">
				<span className="lb-track__name">{view.name || 'Untitled track'}</span>
				<button
					type="button"
					className="lb-track__state"
					title="Active tracks feed Up next. Click to change."
					onPointerDown={swallow}
					onClick={(e) => {
						e.stopPropagation()
						cycleTrackState(view.trackId)
					}}
				>
					{STATE_LABEL[view.state] ?? view.state}
				</button>
			</header>
			<div className="lb-track__sub">
				{view.goal && <span>{view.goal}</span>}
				<span>
					{doneCount}/{entries.length} done
				</span>
				{!isEditing && entries.length > 12 && <span>double-click to scroll</span>}
			</div>
			{entries.length === 0 ? (
				<p className="lb-track__empty">This track has no entries yet.</p>
			) : (
				<ol className="lb-track__list">
					{entries.map((item, i) => (
						<Row
							key={item.itemId}
							item={item}
							editor={editor}
							shape={track}
							open={open}
							next={next}
							depth={0}
							number={i + 1}
							extra={
								isEditing && (
									<span className="lb-track__move">
										<button type="button" aria-label="Move up" onClick={() => moveInTrack(view.trackId, item.itemId, -1)}>
											↑
										</button>
										<button type="button" aria-label="Move down" onClick={() => moveInTrack(view.trackId, item.itemId, 1)}>
											↓
										</button>
										<button type="button" aria-label="Remove from track" onClick={() => removeFromTrack(view.trackId, item.itemId)}>
											×
										</button>
									</span>
								)
							}
						/>
					))}
				</ol>
			)}
		</div>
	)

	if (!isEditing) return body

	return (
		<div
			className="lb-track__editing"
			onPointerDown={stopEventPropagation}
			onTouchStart={stopEventPropagation}
			onWheel={stopEventPropagation}
			style={{ pointerEvents: 'all' }}
		>
			{body}
			<NodeEditorPopover shape={shape} editor={editor} width={300}>
				<div className="lb-skill-editor">
					<label>
						<span>Name</span>
						<input autoFocus value={view.name} onKeyDown={keepKeys} onChange={(e) => updateTrack(view.trackId, { name: e.target.value })} />
					</label>
					<label>
						<span>Goal</span>
						<input value={view.goal} placeholder="Game director, Western canon…" onKeyDown={keepKeys} onChange={(e) => updateTrack(view.trackId, { goal: e.target.value })} />
					</label>
					<p className="lb-skill-editor__id">{view.trackId}</p>
				</div>
			</NodeEditorPopover>
		</div>
	)
}

export const TrackComponent = memo(
	TrackComponentImpl,
	(prev, next) => prev.shape === next.shape && prev.isEditing === next.isEditing
)
