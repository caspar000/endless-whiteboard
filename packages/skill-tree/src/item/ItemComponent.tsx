import { NodeEditorPopover, type NodeComponentProps } from '@lifeboard/node-kit'
import { stopEventPropagation, useValue, type Editor } from '@lifeboard/canvas'
import { memo, type PointerEvent, type SyntheticEvent } from 'react'
import { childrenOf, draftClass, evidenceNoteFor, progressOf, type ItemShape, type SkillItemProps } from '../board'
import { formatProgress, hasEvidence } from '../model'
import { addChildItem, setCollapsed, toggleItemDone } from '../ops'
import { isDone, readText } from '../properties'
import { templateFor } from '../templates'
import { ItemEditor } from './ItemEditor'

/** Stops a click on a control from also selecting or dragging the shape. */
const swallow = (e: SyntheticEvent | PointerEvent) => e.stopPropagation()

/**
 * The item card. Display mode swallows no pointer events except on its controls (the checkbox, the
 * collapse arrow, a collapsed parent's checklist), so the card still drags and marquee-selects like
 * any shape. Double-click opens the editor for the title and the structure.
 */
function ItemComponentImpl({ shape, isEditing, editor }: NodeComponentProps<SkillItemProps>) {
	const item = shape as unknown as ItemShape
	const view = useValue('lifeboard:skill-item', () => readItemView(editor, item), [editor, item])

	const body = (
		<div className={`lb-skill${view.done ? ' lb-skill--done' : ''}${draftClass(shape as never)}`}>
			<div className="lb-skill__row">
				<input
					type="checkbox"
					className={`lb-skill__check${view.done && !view.evidence ? ' lb-skill__check--hollow' : ''}`}
					checked={view.done}
					disabled={view.hasChildren}
					title={
						view.hasChildren
							? 'Done when its children are'
							: view.done && !view.evidence
								? 'Done, no notes yet: write in the evidence note to count it'
								: undefined
					}
					onPointerDown={swallow}
					onClick={swallow}
					onChange={() => toggleItemDone(editor, item.id)}
				/>
				<span className="lb-skill__title">{shape.props.title || 'Untitled item'}</span>
				{view.hasChildren && (
					<button
						type="button"
						className="lb-skill__fold"
						aria-label={shape.props.collapsed ? 'Expand children' : 'Collapse children'}
						onPointerDown={swallow}
						onClick={(e) => {
							e.stopPropagation()
							setCollapsed(editor, item.id, !shape.props.collapsed)
						}}
					>
						{shape.props.collapsed ? '▸' : '▾'}
					</button>
				)}
			</div>
			<div className="lb-skill__meta">
				{view.kind && <span className={`lb-skill__kind lb-skill__kind--${view.kind.toLowerCase()}`}>{view.kind}</span>}
				{view.medium && <span>{view.medium}</span>}
				{shape.props.core && <span className="lb-skill__core">core</span>}
				{view.progress && <span className="lb-skill__progress">{view.progress}</span>}
				{view.doneAt && <span className="lb-skill__date">{view.doneAt}</span>}
			</div>
			{view.hasChildren && (
				<div className="lb-skill__bar" aria-hidden>
					<span style={{ width: `${view.fraction * 100}%` }} />
				</div>
			)}
			{shape.props.collapsed && view.children.length > 0 && (
				<ul className="lb-skill__list">
					{view.children.map((child) => (
						<li key={child.id} className={child.done ? 'lb-skill__li--done' : undefined}>
							<input
								type="checkbox"
								className={`lb-skill__check${child.done && !child.evidence ? ' lb-skill__check--hollow' : ''}`}
								checked={child.done}
								disabled={child.hasChildren}
								title={child.done && !child.evidence ? 'Done, no notes yet' : undefined}
								onPointerDown={swallow}
								onClick={swallow}
								onChange={() => toggleItemDone(editor, child.id)}
							/>
							<span>{child.title || 'Untitled'}</span>
							{child.core && <span className="lb-skill__core">core</span>}
						</li>
					))}
				</ul>
			)}
		</div>
	)

	if (!isEditing) return body

	return (
		<div onPointerDown={stopEventPropagation} onTouchStart={stopEventPropagation} style={{ pointerEvents: 'all' }}>
			{body}
			<NodeEditorPopover shape={shape} editor={editor} width={300}>
				<ItemEditor
					item={item}
					editor={editor}
					onAddChild={(title) => addChildItem(editor, item.id, { title })}
				/>
			</NodeEditorPopover>
		</div>
	)
}

interface ItemView {
	done: boolean
	evidence: boolean
	kind: string
	medium: string
	doneAt: string
	hasChildren: boolean
	progress: string
	fraction: number
	children: { id: ItemShape['id']; title: string; done: boolean; evidence: boolean; core: boolean; hasChildren: boolean }[]
}

function readItemView(editor: Editor, item: ItemShape): ItemView {
	const fresh = (editor.getShape(item.id) as ItemShape | undefined) ?? item
	const children = childrenOf(editor, fresh.id)
	const done = isDone(fresh)
	const medium = readText(fresh, 'medium')
	const evidence = done && children.length === 0 && evidenceWritten(editor, fresh)
	const progress = children.length > 0 ? progressOf(editor, fresh) : null
	return {
		done,
		evidence,
		kind: readText(fresh, 'kind'),
		medium,
		doneAt: readText(fresh, 'doneAt'),
		hasChildren: children.length > 0,
		progress: progress ? formatProgress(progress) : '',
		fraction: progress && progress.total ? progress.done / progress.total : 0,
		children: children.map((child) => ({
			id: child.id,
			title: child.props.title,
			done: isDone(child),
			evidence: isDone(child) && evidenceWritten(editor, child),
			core: child.props.core,
			hasChildren: childrenOf(editor, child.id).length > 0,
		})),
	}
}

/** Whether the item's note holds anything beyond its title and template. */
function evidenceWritten(editor: Editor, item: ItemShape): boolean {
	const note = evidenceNoteFor(editor, item.props.itemId)
	const md = note ? String((note.props as { md?: unknown }).md ?? '') : ''
	return hasEvidence(md, templateFor(readText(item, 'medium')).md)
}

export const ItemComponent = memo(
	ItemComponentImpl,
	(prev, next) => prev.shape === next.shape && prev.isEditing === next.isEditing
)
