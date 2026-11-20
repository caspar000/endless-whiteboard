import { useValue, type Editor } from '@lifeboard/canvas'
import { NodeEditorPopover, isExtensionEnabled, updateNodeProps, type NodeShape } from '@lifeboard/node-kit'
import { useEffect, useRef, useState } from 'react'
import { NO_SOURCE, TYPED_KIND, TYPED_SOURCE, formatList, itemsOf, mergeList, sourceKey } from './model'
import type { RandomizerProps } from './props'
import { getRandomizerSources, resolveSource } from './sources'

/**
 * The card's editor (a double-click, or the source button in its header): what the card shuffles,
 * and, for the typed list, the list itself.
 *
 * A source is a plain choice from a menu rather than tabs on the card, because the card doesn't know
 * what sources there are: a typed list is its own, the rest are whatever the enabled extensions offer
 * (`sources.ts`). Changing the source is an ordinary edit, so ⌘Z puts the last one back.
 */
export function SourceEditor({ shape, editor }: { shape: NodeShape<RandomizerProps>; editor: Editor }) {
	const key = shape.props.source
	const offered = useValue(
		'lifeboard:randomizer-offered',
		() =>
			getRandomizerSources()
				.filter((s) => !s.extensionId || isExtensionEnabled(s.extensionId))
				.map((s) => ({ id: s.id, label: s.label, choices: s.choices() })),
		[]
	)
	const view = useValue(
		'lifeboard:randomizer-editing',
		() => {
			const resolved = resolveSource(key)
			return { ...resolved, count: resolved.type === 'source' ? (resolved.source?.entries(resolved.choiceId).length ?? 0) : 0 }
		},
		[key]
	)
	const listed = key === NO_SOURCE || key === TYPED_SOURCE || offered.some((s) => s.choices.some((c) => sourceKey(s.id, c.id) === key))

	const choose = (next: string) => {
		const live = editor.getShape(shape.id) as NodeShape<RandomizerProps> | undefined
		if (live && next !== live.props.source) updateNodeProps(editor, live, { source: next })
	}

	return (
		<NodeEditorPopover shape={shape} editor={editor} width={380} side="right">
			<div className="lb-rand-editor">
				<label className="lb-rand-editor__label" htmlFor={`${shape.id}-source`}>
					Shuffle from
				</label>
				<select id={`${shape.id}-source`} className="lb-rand-editor__source" value={key} autoFocus={key !== TYPED_SOURCE} onChange={(e) => choose(e.target.value)}>
					{key === NO_SOURCE && (
						<option value={NO_SOURCE} disabled>
							Choose a source…
						</option>
					)}
					{!listed && <option value={key}>{view.name}</option>}
					<option value={TYPED_SOURCE}>A list I type</option>
					{offered.flatMap((source) => {
						const groups = [...new Set(source.choices.map((c) => c.group))]
						return groups.map((group) => (
							<optgroup key={`${source.id}/${group}`} label={group ? `${source.label}: ${group}` : source.label}>
								{source.choices
									.filter((c) => c.group === group)
									.map((c) => (
										<option key={c.id} value={sourceKey(source.id, c.id)}>
											{c.label}
										</option>
									))}
							</optgroup>
						))
					})}
				</select>

				{key === TYPED_SOURCE ? (
					<TypedList shape={shape} editor={editor} />
				) : (
					<>
						<p className="lb-rand-editor__hint">
							{view.type === 'source'
								? `${view.count} ${view.count === 1 ? view.kind.one : view.kind.noun} from ${view.name}. Stamps you put on them stay with this card.`
								: view.type === 'missing'
									? 'What this card shuffled is gone. Choose another source.'
									: 'A list you type holds anything: albums, films, books, chores. Or pick one of your feeds, and the card shuffles its videos, or a syllabus, and it shuffles its works.'}
						</p>
						<div className="lb-rand-editor__foot">
							<span />
							<button type="button" className="lb-rand-editor__done" onClick={() => editor.setEditingShape(null)}>
								Done
							</button>
						</div>
					</>
				)}
			</div>
		</NodeEditorPopover>
	)
}

/**
 * The typed list, as text: one item per line, `Title — Creator — Year`.
 *
 * Written back when you press Done, and also when editing ends any other way (a click on the board,
 * Escape, another source chosen), because a list you typed and then clicked away from is a list you
 * meant to keep. Lines are matched to what was there by title and creator, so an item keeps its cover
 * and stamps through an edit (`mergeList`).
 */
function TypedList({ shape, editor }: { shape: NodeShape<RandomizerProps>; editor: Editor }) {
	const { items } = shape.props
	const kind = TYPED_KIND
	const [text, setText] = useState(() => formatList(items))
	const latest = useRef({ text, initial: text })
	latest.current.text = text

	const save = () => {
		const { text: now, initial } = latest.current
		if (now === initial) return
		latest.current.initial = now
		const live = editor.getShape(shape.id) as NodeShape<RandomizerProps> | undefined
		if (live) updateNodeProps(editor, live, { items: mergeList(live.props.items, now) })
	}

	// Leaving the editor any way at all keeps what was typed.
	useEffect(() => save, [])

	const lines = text.split('\n').filter((line) => line.trim()).length
	const stamped = itemsOf(items, TYPED_SOURCE).filter((item) => item.stamps.length > 0).length

	return (
		<>
			<p className="lb-rand-editor__hint">One per line: Title — {kind.creator} — Year. The {kind.creator.toLowerCase()} and year can be left out.</p>
			<textarea
				id={`${shape.id}-list`}
				aria-label="The list, one per line"
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
			<p className="lb-rand-editor__hint">Drop an image on the card to make it the cover of the item on show.</p>
		</>
	)
}
