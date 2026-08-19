import { useValue } from 'tldraw'
import { choiceStyle } from '../../../properties/options'
import { EMPTY_GROUP_KEY } from '../query'
import { getDropHint } from './dropHint'
import { KANBAN_METRICS, contentTop, laneBoxes } from './kanbanLayout'
import { laneKeys, laneProperty, rowsByLane } from './lanes'
import type { ViewProps } from './shared'

/**
 * The kanban's chrome — and *only* its chrome.
 *
 * There are no cards in here. A kanban's cards are the shapes themselves, drawn by tldraw at the
 * positions `placement.ts` gave them, still carrying their own text and property strips. So this draws
 * the lanes those shapes are standing in: a title strip, a heading per lane, and a column behind each.
 *
 * That is the payoff of placing real shapes rather than mirroring them into rows. There is no card
 * component to design, nothing to keep in sync with the shape it depicts, and — the part that would
 * otherwise sink the whole idea — no need for HTML inside a node to be draggable. Dragging a card
 * between lanes is dragging a shape, which tldraw already does; a mirrored card would have needed the
 * node to be double-clicked into first, because a shape in display mode has `pointer-events: none`
 * (`docs/tldraw-api-notes.md`).
 *
 * Metrics come from `KANBAN_METRICS` and are applied inline, not from the stylesheet: these same numbers
 * position the cards, and a lane drawn from CSS while cards were placed from constants would drift
 * apart the first time either changed. CSS keeps the colours.
 */
export function KanbanView({ id, result, props, properties, width }: ViewProps) {
	// Which lane a hovering drag would file into. An atom rather than a shape prop: it changes on every
	// pointer move, and none of it is worth persisting — see `interaction.ts`.
	const hint = useValue('lifeboard:view-drop-hint', () => getDropHint(), [])
	const hinted = hint?.viewId === id ? hint.lane : null

	const laneProp = laneProperty(props)
	// The dispatcher renders `blockedReason` instead of this when there is no lane property, so this is
	// belt to those braces rather than a state anybody should see.
	if (!laneProp) return null

	const def = properties.get(laneProp) ?? null
	const keys = laneKeys(def, result.groups, props.layout.lanes)
	const boxes = laneBoxes(keys, width)
	const groups = rowsByLane(result.groups)
	const top = contentTop()
	const { pad, titleHeight, laneHeadHeight } = KANBAN_METRICS

	return (
		<div className="lb-kanban">
			<div className="lb-kanban__title" style={{ height: titleHeight, padding: `0 ${pad}px` }}>
				<span className="lb-table__title">{props.title || 'Kanban'}</span>
				<span className="lb-table__count">
					{result.matched} {result.matched === 1 ? 'card' : 'cards'}
				</span>
			</div>

			{boxes.length === 0 ? (
				<div className="lb-table__empty" style={{ padding: `0 ${pad}px` }}>
					Nothing carries {def?.name ?? laneProp} yet
				</div>
			) : (
				boxes.map((box) => {
					const count = groups.get(box.key)?.rows.length ?? 0
					/*
					 * An option's colour is its identity across the board, so a lane wears the *same chip* its
					 * cards do — `.lb-chip` itself, not a copy of its colour maths, which is where the hue and
					 * the stage saturation are turned into a background (`choiceStyle` only supplies the custom
					 * properties). The empty lane gets plain text: it is an absence, and a chip would make it
					 * look like a category.
					 */
					const chip = box.key === EMPTY_GROUP_KEY || !def ? undefined : choiceStyle(def, box.key)
					return (
						<div
							className={
								box.key === hinted ? 'lb-kanban__lane lb-kanban__lane--drop' : 'lb-kanban__lane'
							}
							key={box.key}
							style={{
								left: box.x,
								width: box.width,
								top: titleHeight,
								// Down to the bottom of the card, so a lane is a column rather than a label with
								// shapes loose beneath it — and so the whole of it is a target for a dropped card
								// once the drop gesture lands.
								bottom: pad,
							}}
						>
							<div className="lb-kanban__head" style={{ height: laneHeadHeight }}>
								<span
									className={chip ? 'lb-chip lb-kanban__key' : 'lb-kanban__key'}
									style={chip}
								>
									{box.key}
								</span>
								<span className="lb-kanban__count">{count}</span>
							</div>
						</div>
					)
				})
			)}

			{/* The line the cards start below, drawn once across the card rather than per lane, so the
			    lanes read as columns of one board. */}
			<div className="lb-kanban__rule" style={{ top: top - 1, left: pad, right: pad }} />
		</div>
	)
}
