import type { Editor } from '@lifeboard/canvas'
import { NodeEditorPopover, updateNodeProps, type NodeShape } from '@lifeboard/node-kit'
import { useEffect, useRef, useState } from 'react'
import { LISTS, formatList, itemsOf, mergeList } from './model'
import type { RandomizerProps } from './props'

/**
 * The list behind the card, as text: one item per line, `Title — Artist — Year`. Opens on a
 * double-click, for whichever list the switch is on.
 *
 * Written back when you press Done, and also when editing ends any other way (a click on the board,
 * Escape), because a list you typed and then clicked away from is a list you meant to keep. Lines are
 * matched to what was there by title and creator, so an item keeps its cover and stamps through an
 * edit (`mergeList`).
 */
export function ListEditor({ shape, editor }: { shape: NodeShape<RandomizerProps>; editor: Editor }) {
	// Fixed for the editor's life: the card keys it by list, so a switch makes a new editor rather than
	// moving this one's text to another list.
	const [list] = useState(shape.props.list)
	const { items } = shape.props
	const kind = LISTS[list]
	const [text, setText] = useState(() => formatList(items, list))
	const latest = useRef({ text, initial: text })
	latest.current.text = text

	const save = () => {
		const { text: now, initial } = latest.current
		if (now === initial) return
		latest.current.initial = now
		const live = editor.getShape(shape.id) as NodeShape<RandomizerProps> | undefined
		if (live) updateNodeProps(editor, live, { items: mergeList(live.props.items, list, now) })
	}

	// Leaving the editor any way at all keeps what was typed.
	useEffect(() => save, [])

	const lines = text.split('\n').filter((line) => line.trim()).length
	const stamped = itemsOf(items, list).filter((item) => item.stamps.length > 0).length

	return (
		<NodeEditorPopover shape={shape} editor={editor} width={380} side="right">
			<div className="lb-rand-editor">
				<label className="lb-rand-editor__label" htmlFor={`${shape.id}-list`}>
					{kind.label}, one per line
				</label>
				<p className="lb-rand-editor__hint">
					Title — {kind.creator} — Year. The {kind.creator.toLowerCase()} and year can be left out.
				</p>
				<textarea
					id={`${shape.id}-list`}
					className="lb-rand-editor__text"
					value={text}
					spellCheck={false}
					autoFocus
					rows={12}
					placeholder={`Low Tide Radio — Marlow Vance — 1978`}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Escape') {
							e.preventDefault()
							editor.setEditingShape(null)
						}
					}}
				/>
				<div className="lb-rand-editor__foot">
					<span className="lb-rand-editor__count">
						{lines} {lines === 1 ? kind.one : kind.noun}
						{stamped > 0 ? ` · ${stamped} stamped` : ''}
					</span>
					<button type="button" className="lb-rand-editor__done" onClick={() => editor.setEditingShape(null)}>
						Done
					</button>
				</div>
				<p className="lb-rand-editor__hint">Drop an image on the card to make it the cover of the {kind.one} on show.</p>
			</div>
		</NodeEditorPopover>
	)
}
