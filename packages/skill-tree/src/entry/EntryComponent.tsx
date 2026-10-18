import type { NodeComponentProps } from '@lifeboard/node-kit'
import { useValue } from '@lifeboard/canvas'
import { memo } from 'react'
import type { EntryProps } from '../board'
import { getItems, getSkillIndex, isItemDone, progressOf } from '../syllabus'
import { mediumIcon } from './mediumIcon'

const RING = 2 * Math.PI * 46

/**
 * An entry or a work in a tree view (docs/skill-tree-plan.md, "Rebuild"): a view of a vault item.
 * An entry is a disc with its name inside and a ring for how many of its works are done; a work is a
 * smaller disc with the icon of its medium and its title below. Right-click › Mark as done ticks
 * either, the same tick as in the list. A tick still waiting for its write-up shows as an outline.
 */
function EntryComponentImpl({ shape }: NodeComponentProps<EntryProps>) {
	const { item } = useValue('lifeboard:skill-entry', () => ({ item: getItems()[shape.props.itemId], index: getSkillIndex() }), [shape.props.itemId])
	if (!item) return <div className="lb-entry lb-entry--missing">{shape.props.itemId}</div>
	const done = isItemDone(item.itemId)
	const draft = item.draft ? ' lb-draft' : ''
	// Done but no write-up yet: done, not yet evidence.
	const hollow = done && !item.children.length && !getSkillIndex()[item.itemId]?.evidence
	const Icon = mediumIcon(item)

	if (shape.props.variant === 'work') {
		return (
			<div className={`lb-work${done ? ' lb-work--done' : ''}${hollow ? ' lb-work--hollow' : ''}${draft}`} title={item.title}>
				<span className="lb-work__disc">
					<Icon size={22} strokeWidth={1.75} aria-hidden />
				</span>
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
				{progress ? <span className="lb-entry__count">{progress.done}/{progress.total}</span> : <Icon className={hollow ? 'lb-entry__icon lb-entry__icon--hollow' : 'lb-entry__icon'} size={16} strokeWidth={1.75} aria-hidden />}
			</div>
		</div>
	)
}

export const EntryComponent = memo(EntryComponentImpl, (prev, next) => prev.shape === next.shape)
