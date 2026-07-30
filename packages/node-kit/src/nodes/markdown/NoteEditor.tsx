import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { stopEventPropagation } from 'tldraw'
import {
	blockIndexAtOffset,
	blockText,
	mergeWithPrevious,
	splitBlockAt,
	splitBlocks,
	type Block,
} from './blocks'
import { MarkdownView } from './MarkdownView'
import { decideNavigation } from './navigation'
import { SessionHistory } from './sessionHistory'

/**
 * The live-preview editor: the block holding the caret is a raw `<textarea>`, every other block is
 * rendered markdown. Pressing Enter therefore renders what you just wrote — the Obsidian "Live
 * Preview" model.
 *
 * Mounted only while the shape is in tldraw's editing state, so **this component's lifetime is the
 * editing session**. That is what makes "commit exactly once, at the end" fall out of `useEffect`
 * cleanup rather than needing to be orchestrated.
 *
 * The source of truth during a session is `sourceRef`, not props. Deriving state from props with
 * effects is what caused a real "Maximum update depth exceeded" crash in the previous editor; the
 * rule here is the same — the session owns the text, and props are written once on exit.
 */

/** Keys whose meaning depends on block structure. Everything else is just typing. */
const STRUCTURAL_KEYS = new Set([
	'Enter',
	'Backspace',
	'Delete',
	'ArrowLeft',
	'ArrowRight',
	'ArrowUp',
	'ArrowDown',
	'Escape',
])

export function NoteEditor({
	initial,
	onCommit,
	onExit,
}: {
	initial: string
	onCommit: (next: string) => void
	onExit: () => void
}) {
	const sourceRef = useRef(initial)
	const historyRef = useRef(new SessionHistory({ source: initial, caret: initial.length }))

	const [blocks, setBlocks] = useState<Block[]>(() => splitBlocks(initial))
	const [activeIndex, setActiveIndex] = useState(() => splitBlocks(initial).length - 1)

	/**
	 * The active block's *live* extent in `sourceRef`.
	 *
	 * This has to be tracked separately from `blocks[activeIndex]`, because blocks are deliberately
	 * not re-derived on every keystroke (that would re-render the textarea mid-typing). As soon as the
	 * user types, the stored block's `end` is stale — splicing against it duplicated the old text and
	 * corrupted the document. The extent is advanced on every change instead.
	 */
	const extentRef = useRef({ start: 0, end: 0 })

	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const pendingCaretRef = useRef<number | 'start' | 'end' | null>('end')
	const isFirstFocusRef = useRef(true)
	const composingRef = useRef(false)

	const commitRef = useRef(onCommit)
	commitRef.current = onCommit

	// The one commit path: one `updateShape` per session, so the board sees one undo entry.
	useEffect(() => {
		return () => commitRef.current(sourceRef.current)
	}, [])

	const activeBlock = blocks[activeIndex] ?? blocks[0]!

	// Whenever the rendered layout or the active block changes, the extent is re-anchored to it.
	useLayoutEffect(() => {
		extentRef.current = { start: activeBlock.start, end: activeBlock.end }
	}, [activeBlock])

	/** Splice the textarea's current value into the source, keeping the extent current. */
	const flush = useCallback((): { source: string; caretBase: number } => {
		const el = textareaRef.current
		const { start, end } = extentRef.current
		if (!el) return { source: sourceRef.current, caretBase: start }
		const source = sourceRef.current.slice(0, start) + el.value + sourceRef.current.slice(end)
		sourceRef.current = source
		extentRef.current = { start, end: start + el.value.length }
		return { source, caretBase: start }
	}, [])

	/** Adopt a new source, re-derive the layout, and place the caret at an absolute offset. */
	const apply = useCallback(
		(nextSource: string, caretAbsolute: number, opts: { coalesce?: boolean } = {}) => {
			sourceRef.current = nextSource
			historyRef.current.push({ source: nextSource, caret: caretAbsolute }, opts)

			const nextBlocks = splitBlocks(nextSource)
			const index = blockIndexAtOffset(nextBlocks, caretAbsolute)
			const block = nextBlocks[index]!
			extentRef.current = { start: block.start, end: block.end }
			pendingCaretRef.current = Math.max(0, caretAbsolute - block.start)
			setBlocks(nextBlocks)
			setActiveIndex(index)
		},
		[]
	)

	/**
	 * Focus and caret placement. A layout effect for block switches so the caret is in place before
	 * paint — but the first focus of a session is deferred one frame, because tldraw takes focus back
	 * to its canvas container while entering the editing state and would otherwise win the race.
	 */
	useLayoutEffect(() => {
		if (!textareaRef.current) return

		const place = () => {
			const target = textareaRef.current
			if (!target) return
			const pending = pendingCaretRef.current
			const offset =
				pending === 'end' || pending === null
					? target.value.length
					: pending === 'start'
						? 0
						: Math.min(pending, target.value.length)
			target.focus()
			target.setSelectionRange(offset, offset)
			pendingCaretRef.current = null
			autoSizeTextarea(target)
		}

		if (isFirstFocusRef.current) {
			isFirstFocusRef.current = false
			const frame = requestAnimationFrame(place)
			return () => cancelAnimationFrame(frame)
		}
		place()
		return
	}, [activeIndex, blocks])

	const moveToBlock = useCallback(
		(direction: -1 | 1, caret: 'start' | 'end') => {
			// Re-derive from the flushed source: typing may have changed how many blocks there are.
			const { source } = flush()
			const nextBlocks = splitBlocks(source)
			const next = activeIndex + direction
			if (next < 0 || next >= nextBlocks.length) return
			pendingCaretRef.current = caret
			setBlocks(nextBlocks)
			setActiveIndex(next)
		},
		[activeIndex, flush]
	)

	const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		const el = e.currentTarget
		const isUndoRedo = (e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')

		// Plain typing can't change what any key means, so skip the re-parse for it. Only structural
		// keys need to know the block's *current* type — which, mid-typing, the stored layout does not
		// have: typing "- " into an empty paragraph makes it a list, and Enter must then continue the
		// list rather than split the block.
		if (!STRUCTURAL_KEYS.has(e.key) && !isUndoRedo) {
			e.stopPropagation()
			return
		}

		const { source, caretBase } = flush()
		const caretAbsolute = caretBase + el.selectionStart
		const liveBlocks = splitBlocks(source)
		const liveIndex = blockIndexAtOffset(liveBlocks, caretAbsolute)
		const liveBlock = liveBlocks[liveIndex]!

		const action = decideNavigation({
			key: e.key,
			mod: e.metaKey || e.ctrlKey,
			shift: e.shiftKey,
			composing: composingRef.current || e.nativeEvent.isComposing,
			blockType: liveBlock.type,
			caret: el.selectionStart,
			length: el.value.length,
			hasSelection: el.selectionStart !== el.selectionEnd,
			index: liveIndex,
			blockCount: liveBlocks.length,
		})

		switch (action.kind) {
			case 'exit':
				e.preventDefault()
				onExit()
				return

			case 'split': {
				e.preventDefault()
				const result = splitBlockAt(source, liveBlock, caretAbsolute - liveBlock.start)
				apply(result.source, result.caret)
				return
			}

			case 'mergeBack': {
				e.preventDefault()
				const merged = mergeWithPrevious(source, liveBlocks, liveIndex)
				if (merged) apply(merged.source, merged.caret)
				return
			}

			case 'mergeForward': {
				e.preventDefault()
				const merged = mergeWithPrevious(source, liveBlocks, liveIndex + 1)
				if (merged) apply(merged.source, merged.caret)
				return
			}

			case 'focusBlock':
				e.preventDefault()
				moveToBlock(action.direction, action.caret)
				return

			case 'maybeFocusBlock': {
				// Whether the caret is on the first/last *visual* line depends on wrapping. Rather than
				// measure line boxes, let the browser move it and check afterwards whether it did.
				const before = el.selectionStart
				const { direction, caret } = action
				requestAnimationFrame(() => {
					const target = textareaRef.current
					if (target && target.selectionStart === before) moveToBlock(direction, caret)
				})
				return
			}

			case 'undo':
			case 'redo': {
				e.preventDefault()
				historyRef.current.push({ source, caret: caretAbsolute }, { coalesce: true })
				const snapshot =
					action.kind === 'undo' ? historyRef.current.undo() : historyRef.current.redo()
				if (!snapshot) return
				apply(snapshot.source, snapshot.caret)
				return
			}

			default:
				// Anything else stays in the textarea rather than reaching the canvas as a shortcut
				// (`d` would select the draw tool, space would pan, and so on).
				e.stopPropagation()
		}
	}

	const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const el = e.currentTarget
		const { source, caretBase } = flush()
		historyRef.current.push(
			{ source, caret: caretBase + el.selectionStart },
			{ coalesce: true }
		)
		// No `setBlocks` here on purpose: re-splitting per keystroke would re-render the textarea
		// mid-typing. The layout is re-derived on structural changes and on block switches instead.
		autoSizeTextarea(el)
	}

	return (
		<div
			className="lb-note lb-note--editing"
			onPointerDown={stopEventPropagation}
			onTouchStart={stopEventPropagation}
			onWheel={stopEventPropagation}
			style={{ pointerEvents: 'all' }}
		>
			{blocks.map((block, i) =>
				i === activeIndex ? (
					<textarea
						// Keyed by index so switching blocks remounts with a fresh `defaultValue`.
						key={`editor-${i}`}
						ref={textareaRef}
						className={`lb-note__input ${typographyClass(block)}`}
						defaultValue={blockText(sourceRef.current, block)}
						spellCheck={false}
						rows={1}
						placeholder={blocks.length === 1 ? 'Write something…' : undefined}
						onChange={onChange}
						onKeyDown={onKeyDown}
						onCompositionStart={() => {
							composingRef.current = true
						}}
						onCompositionEnd={() => {
							composingRef.current = false
						}}
					/>
				) : (
					<div
						key={`block-${i}`}
						className="lb-note__block"
						onPointerDown={(e) => {
							// Clicking a rendered block moves the caret into it. Which half was clicked
							// decides which end — a cheap stand-in for a real hit test.
							const rect = e.currentTarget.getBoundingClientRect()
							const caret = e.clientY < rect.top + rect.height / 2 ? 'start' : 'end'
							const { source } = flush()
							const nextBlocks = splitBlocks(source)
							pendingCaretRef.current = caret
							setBlocks(nextBlocks)
							setActiveIndex(Math.min(i, nextBlocks.length - 1))
						}}
					>
						<MarkdownView md={blockText(sourceRef.current, block)} bare />
					</div>
				)
			)}
		</div>
	)
}

/**
 * The active textarea has to match the typography of the block it replaces — heading sizes included.
 * Without this the note visibly jumps every time the caret crosses a block boundary, which reads as
 * the editor being broken rather than as a mode change.
 */
function typographyClass(block: Block): string {
	if (block.type === 'heading') return `lb-note__input--h${block.depth ?? 1}`
	if (block.type === 'code') return 'lb-note__input--code'
	return 'lb-note__input--body'
}

/** Grow the textarea to its content so the note's own auto-height measures the true size. */
function autoSizeTextarea(el: HTMLTextAreaElement): void {
	el.style.height = 'auto'
	el.style.height = `${el.scrollHeight}px`
}
