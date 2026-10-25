import type { NodeComponentProps } from '@lifeboard/node-kit'
import { useValue } from '@lifeboard/canvas'
import { memo } from 'react'
import type { EntryProps } from '../board'
import { lookOf } from '../sources'

const RING = 2 * Math.PI * 46

/**
 * An entry or a work in a tree view (docs/skill-tree-plan.md, "Rebuild"): a view of an item a source
 * puts in the tree (sources.ts), the syllabus's entries and works. An entry is a disc with its name
 * inside and a ring for how many of its works are done; a work is a smaller disc with its icon and its
 * title below. A tick still waiting for its write-up shows as an outline.
 */
function EntryComponentImpl({ shape }: NodeComponentProps<EntryProps>) {
	const look = useValue('lifeboard:skill-entry', () => lookOf(shape.props.itemId), [shape.props.itemId])
	if (!look) return <div className="lb-entry lb-entry--missing">{shape.props.itemId}</div>
	const { title, done, hollow, progress, icon: Icon } = look
	const draft = look.draft ? ' lb-draft' : ''

	if (shape.props.variant === 'work') {
		return (
			<div className={`lb-work${done ? ' lb-work--done' : ''}${hollow ? ' lb-work--hollow' : ''}${draft}`} title={title}>
				<span className="lb-work__disc">
					<Icon size={22} strokeWidth={1.75} aria-hidden />
				</span>
				<span className="lb-work__title">{title || 'Untitled'}</span>
			</div>
		)
	}

	const fraction = progress ? (progress.total ? progress.done / progress.total : 0) : done ? 1 : 0
	return (
		<div className={`lb-entry${done ? ' lb-entry--done' : ''}${draft}`} title={title}>
			<svg className="lb-entry__ring" viewBox="0 0 100 100" aria-hidden>
				<circle className="lb-entry__track" cx="50" cy="50" r="46" />
				<circle className="lb-entry__fill" cx="50" cy="50" r="46" strokeDasharray={`${RING * fraction} ${RING}`} transform="rotate(-90 50 50)" />
			</svg>
			<div className="lb-entry__disc">
				<span className="lb-entry__title">{title || 'Untitled'}</span>
				{progress ? <span className="lb-entry__count">{progress.done}/{progress.total}</span> : <Icon className={hollow ? 'lb-entry__icon lb-entry__icon--hollow' : 'lb-entry__icon'} size={16} strokeWidth={1.75} aria-hidden />}
			</div>
		</div>
	)
}

export const EntryComponent = memo(EntryComponentImpl, (prev, next) => prev.shape === next.shape)
