import { memo, useEffect, useRef } from 'react'
import { stopEventPropagation } from 'tldraw'
import { updateNodeProps, type NodeComponentProps } from '../../registry'
import type { MarkdownNodeProps } from './definition'
import { MarkdownView } from './MarkdownView'

/**
 * Display and edit modes for the markdown node (§4.6).
 *
 * Display: rendered markdown. Pointer events are off (set by the factory's container), so the node
 * drags and marquee-selects like any other shape.
 *
 * Edit: a textarea over the markdown source. Two deliberate choices, both about correctness:
 *  - **Source editing, not WYSIWYG.** Markdown is the source of truth, so editing the string is
 *    lossless. A rich-text editor would round-trip through its own AST and quietly reformat or drop
 *    constructs it doesn't model, and it would reintroduce the failure mode §8 flags: two
 *    ProseMirror instances (tldraw's and the node's) contending for focus.
 *  - **Commit on edit end, not per keystroke.** One `updateShape` per editing session → one undo
 *    entry, instead of one per character.
 */
function MarkdownNodeComponentImpl({ shape, isEditing, editor }: NodeComponentProps<MarkdownNodeProps>) {
	const { md } = shape.props

	if (isEditing) {
		return (
			<MarkdownEditor
				initial={md}
				onCommit={(next) => {
					if (next !== shape.props.md) updateNodeProps(editor, shape, { md: next })
				}}
				onExit={() => {
					editor.setEditingShape(null)
					editor.setSelectedShapes([shape.id])
				}}
			/>
		)
	}

	return (
		<div className="lb-md">
			{md.trim() ? (
				<MarkdownView md={md} />
			) : (
				<p className="lb-md__placeholder">Double-click to write markdown</p>
			)}
		</div>
	)
}

/**
 * Mounted only while the node is being edited, so **this component's lifetime is the editing
 * session** — which is what makes "commit exactly once, at the end" fall out of `useEffect`
 * cleanup rather than needing to be orchestrated.
 *
 * The textarea is deliberately uncontrolled, with the current text mirrored into a ref. An earlier
 * version held the draft in `useState` and synced it from props with effects; that produced a
 * genuine "Maximum update depth exceeded" crash which unmounted the node on every edit. With no
 * state here there is no render triggered by typing, and no update loop is possible.
 */
function MarkdownEditor({
	initial,
	onCommit,
	onExit,
}: {
	initial: string
	onCommit: (next: string) => void
	onExit: () => void
}) {
	const areaRef = useRef<HTMLTextAreaElement>(null)
	const valueRef = useRef(initial)

	// Read through refs in the cleanup so it never closes over a stale callback or value.
	const commitRef = useRef(onCommit)
	commitRef.current = onCommit

	useEffect(() => {
		// Focus on the next frame, not synchronously: tldraw returns focus to its own canvas
		// container while entering the editing state, and a synchronous focus loses that race — the
		// user would double-click a node and then have to click again before they could type.
		const frame = requestAnimationFrame(() => {
			const el = areaRef.current
			if (!el) return
			el.focus()
			el.setSelectionRange(el.value.length, el.value.length)
		})
		return () => {
			cancelAnimationFrame(frame)
			commitRef.current(valueRef.current)
		}
	}, [])

	return (
		<div
			className="lb-md lb-md--editing"
			// Editing needs real pointer events, and the canvas must not pan or zoom underneath.
			onPointerDown={stopEventPropagation}
			onTouchStart={stopEventPropagation}
			onWheel={stopEventPropagation}
			style={{ pointerEvents: 'all' }}
		>
			<textarea
				ref={areaRef}
				className="lb-md__textarea"
				defaultValue={initial}
				spellCheck={false}
				placeholder={'# Heading\n\n- a list item\n- **bold** and `code`'}
				onChange={(e) => {
					valueRef.current = e.currentTarget.value
				}}
				onKeyDown={(e) => {
					// Escape leaves editing; every other key stays in the textarea instead of
					// reaching the canvas as a shortcut (e.g. `d` selecting the draw tool).
					if (e.key === 'Escape') {
						onExit()
						return
					}
					e.stopPropagation()
				}}
			/>
		</div>
	)
}

/**
 * Memoized on the props that affect rendering. tldraw re-renders shape components as the store
 * changes; without this, every unrelated board edit re-parses every markdown node (§9 perf pass).
 */
export const MarkdownNodeComponent = memo(
	MarkdownNodeComponentImpl,
	(prev, next) =>
		prev.shape.props.md === next.shape.props.md &&
		prev.shape.props.w === next.shape.props.w &&
		prev.shape.props.h === next.shape.props.h &&
		prev.isEditing === next.isEditing
)
