import { NodeEditorPopover, type NodeComponentProps } from '@lifeboard/node-kit'
import { stopEventPropagation, useValue, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { memo, type PointerEvent, type SyntheticEvent } from 'react'
import type { SkillItemProps } from '../board'
import { formatProgress } from '../model'
import { tick } from '../ops'
import { getItems, getSkillIndex, isItemDone, progressOf, type ItemDef } from '../syllabus'
import { ItemEditor } from './ItemEditor'

/** Stops a click on a control from also selecting or dragging the shape. */
const swallow = (e: SyntheticEvent | PointerEvent) => e.stopPropagation()

/** A tick box for a leaf: hollow when done but not yet written up. */
export function Tick({ item, editor, anchor }: { item: ItemDef; editor: Editor; anchor: TLShapeId }) {
	const done = isItemDone(item.itemId)
	const written = !!getSkillIndex()[item.itemId]?.evidence
	const parent = item.children.length > 0
	return (
		<input
			type="checkbox"
			className={`lb-skill__check${done && !parent && !written ? ' lb-skill__check--hollow' : ''}`}
			checked={done}
			disabled={parent}
			title={parent ? 'Done when its works are' : done && !written ? 'Done, no write-up yet: write in its note to count it' : undefined}
			onPointerDown={swallow}
			onClick={swallow}
			onChange={() => tick(editor, item.itemId, !done, anchor)}
		/>
	)
}

/** Works under an item, each with its tick, and their own works indented below. */
function Works({ item, editor, anchor, depth = 0 }: { item: ItemDef; editor: Editor; anchor: TLShapeId; depth?: number }) {
	const all = getItems()
	const works = item.children.map((id) => all[id]).filter((w): w is ItemDef => !!w)
	if (!works.length || depth > 4) return null
	return (
		<ul className="lb-skill__list">
			{works.map((work) => (
				<li key={work.itemId} className={isItemDone(work.itemId) ? 'lb-skill__li--done' : undefined}>
					<span className="lb-skill__li-row">
						<Tick item={work} editor={editor} anchor={anchor} />
						<span>{work.title || 'Untitled'}</span>
						{work.core && <span className="lb-skill__core">core</span>}
					</span>
					<Works item={work} editor={editor} anchor={anchor} depth={depth + 1} />
				</li>
			))}
		</ul>
	)
}

/**
 * A card for one vault item. Display mode swallows pointer events only on its tick boxes, so the card
 * still drags and marquee-selects like any shape. Double-click opens the editor.
 */
function ItemComponentImpl({ shape, isEditing, editor }: NodeComponentProps<SkillItemProps>) {
	// A fresh object per change of the vault or the index, so the card redraws when a work changes too,
	// not only the item itself.
	const { item } = useValue('lifeboard:skill-item', () => ({ item: getItems()[shape.props.itemId], index: getSkillIndex() }), [shape.props.itemId])
	const anchor = shape.id as TLShapeId

	if (!item) {
		return (
			<div className="lb-skill lb-skill--missing">
				<span className="lb-skill__title">Not in the vault</span>
				<span className="lb-skill__meta">{shape.props.itemId || 'No item'}</span>
			</div>
		)
	}
	const progress = item.children.length ? progressOf(item.itemId) : null
	const done = isItemDone(item.itemId)

	const body = (
		<div className={`lb-skill${done ? ' lb-skill--done' : ''}${item.draft ? ' lb-draft' : ''}`}>
			<div className="lb-skill__row">
				<Tick item={item} editor={editor} anchor={anchor} />
				<span className="lb-skill__title">{item.title || 'Untitled item'}</span>
			</div>
			<div className="lb-skill__meta">
				{item.kind && <span className={`lb-skill__kind lb-skill__kind--${item.kind.toLowerCase()}`}>{item.kind}</span>}
				{item.medium && <span>{item.medium}</span>}
				{progress && <span className="lb-skill__progress">{formatProgress(progress)}</span>}
				{done && !progress && item.doneAt && <span className="lb-skill__date">{item.doneAt}</span>}
			</div>
			{progress && (
				<div className="lb-skill__bar" aria-hidden>
					<span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
				</div>
			)}
			<Works item={item} editor={editor} anchor={anchor} />
		</div>
	)

	if (!isEditing) return body

	return (
		<div onPointerDown={stopEventPropagation} onTouchStart={stopEventPropagation} style={{ pointerEvents: 'all' }}>
			{body}
			<NodeEditorPopover shape={shape} editor={editor} width={300}>
				<ItemEditor item={item} />
			</NodeEditorPopover>
		</div>
	)
}

export const ItemComponent = memo(
	ItemComponentImpl,
	(prev, next) => prev.shape === next.shape && prev.isEditing === next.isEditing
)
