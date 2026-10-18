import type { NodeComponentProps } from '@lifeboard/node-kit'
import { useValue, type TLShapeId } from '@lifeboard/canvas'
import { memo } from 'react'
import type { EntryProps } from '../board'
import { Tick } from '../item/ItemComponent'
import { getItems, getSkillIndex, isItemDone, progressOf } from '../syllabus'

const RING = 2 * Math.PI * 46

/**
 * An entry or a work in a tree view (docs/skill-tree-plan.md, "Rebuild"): a view of a vault item.
 * An entry is a small disc whose ring is how many of its works are done; a work is a tick dot with
 * its title. Ticking either is the same tick as in the list.
 */
function EntryComponentImpl({ shape, editor }: NodeComponentProps<EntryProps>) {
	const { item } = useValue('lifeboard:skill-entry', () => ({ item: getItems()[shape.props.itemId], index: getSkillIndex() }), [shape.props.itemId])
	const anchor = shape.id as TLShapeId
	if (!item) return <div className="lb-entry lb-entry--missing">{shape.props.itemId}</div>
	const done = isItemDone(item.itemId)
	const draft = item.draft ? ' lb-draft' : ''

	if (shape.props.variant === 'work') {
		return (
			<div className={`lb-work${done ? ' lb-work--done' : ''}${draft}`} title={item.title}>
				<Tick item={item} editor={editor} anchor={anchor} />
				<span className="lb-work__title">{item.title || 'Untitled'}</span>
			</div>
		)
	}

	const progress = item.children.length ? progressOf(item.itemId) : null
	const fraction = progress ? (progress.total ? progress.done / progress.total : 0) : done ? 1 : 0
	return (
		<div className={`lb-entry${done ? ' lb-entry--done' : ''}${draft}`} title={item.title}>
			<svg className="lb-entry__ring" viewBox="0 0 100 100" aria-hidden>
				<circle className="lb-entry__track" cx="50" cy="50" r="46" />
				<circle className="lb-entry__fill" cx="50" cy="50" r="46" strokeDasharray={`${RING * fraction} ${RING}`} transform="rotate(-90 50 50)" />
			</svg>
			<div className="lb-entry__disc">
				<span className="lb-entry__title">{item.title || 'Untitled'}</span>
				{progress ? <span className="lb-entry__count">{progress.done}/{progress.total}</span> : <Tick item={item} editor={editor} anchor={anchor} />}
			</div>
		</div>
	)
}

export const EntryComponent = memo(EntryComponentImpl, (prev, next) => prev.shape === next.shape)
