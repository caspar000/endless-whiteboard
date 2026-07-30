import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { stopEventPropagation } from 'tldraw'
import {
	insertLineBreak,
	joinWithNext,
	joinWithPrevious,
	lineIndexAtOffset,
	lineStyle,
	splitLines,
	surroundingMarkdown,
	type Line,
} from './lines'
import { MarkdownView } from './MarkdownView'
import { decideNavigation } from './navigation'
import { SessionHistory } from './sessionHistory'

/**
 * The live-preview editor: the **line** holding the caret is a raw `<textarea>`; everything above and
 * below it is rendered markdown. Leaving a line renders it — so a heading formats as soon as you move
 * off it, without needing to start a new block first.
 *
 * The unit is a source line, not an mdast block. Block granularity meant that while your caret sat in
 * a heading, nothing you typed anywhere in that block rendered — you had to open a *new* block before
 * seeing any formatting. Per-line is what Obsidian and AFFiNE do, and it is what makes the preview feel
 * live rather than deferred.
 *
 * Mounted only while the shape is in tldraw's editing state, so **this component's lifetime is the
 * editing session** — which is what makes "commit exactly once, at the end" fall out of `useEffect`
 * cleanup rather than needing orchestration. The session owns the text in `sourceRef`; props are
 * written once on exit. (Deriving editor state from props with effects is what caused a real
 * "Maximum update depth exceeded" crash in an earlier version.)
 */
export function NoteEditor({
	initial,
	initialCaret,
	onCommit,
	onExit,
}: {
	initial: string
	/** Absolute offset to start editing at. Defaults to the end of the document. */
	initialCaret?: number
	onCommit: (next: string) => void
	onExit: () => void
}) {
	const sourceRef = useRef(initial)
	const historyRef = useRef(new SessionHistory({ source: initial, caret: initialCaret ?? initial.length }))

	const [lines, setLines] = useState<Line[]>(() => splitLines(initial))
	const [activeIndex, setActiveIndex] = useState(() =>
		lineIndexAtOffset(splitLines(initial), initialCaret ?? initial.length)
	)

	/**
	 * The active line's *live* extent in `sourceRef`.
	 *
	 * Tracked separately from `lines[activeIndex]` because the line array is deliberately not
	 * re-derived on every keystroke — that would re-render the textarea mid-typing. The stored line's
	 * `end` is stale the moment you type, and splicing against it corrupts the document.
	 */
	const extentRef = useRef({ start: 0, end: 0 })

	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const pendingCaretRef = useRef<number | 'start' | 'end' | null>(null)
	const composingRef = useRef(false)

	const commitRef = useRef(onCommit)
	commitRef.current = onCommit

	// The one commit path: one `updateShape` per session, so the board sees one undo entry.
	useEffect(() => {
		return () => commitRef.current(sourceRef.current)
	}, [])

	const activeLine = lines[activeIndex] ?? lines[0]!

	useLayoutEffect(() => {
		extentRef.current = { start: activeLine.start, end: activeLine.end }
	}, [activeLine])

	/** Splice the textarea's value into the source, keeping the tracked extent current. */
	const flush = useCallback((): { source: string; lineStart: number } => {
		const el = textareaRef.current
		const { start, end } = extentRef.current
		if (!el) return { source: sourceRef.current, lineStart: start }
		const source = sourceRef.current.slice(0, start) + el.value + sourceRef.current.slice(end)
		sourceRef.current = source
		extentRef.current = { start, end: start + el.value.length }
		return { source, lineStart: start }
	}, [])

	/** Adopt a new source, re-derive the lines, and place the caret at an absolute offset. */
	const apply = useCallback(
		(nextSource: string, caretAbsolute: number, opts: { coalesce?: boolean } = {}) => {
			sourceRef.current = nextSource
			historyRef.current.push({ source: nextSource, caret: caretAbsolute }, opts)

			const nextLines = splitLines(nextSource)
			const index = lineIndexAtOffset(nextLines, caretAbsolute)
			const line = nextLines[index]!
			extentRef.current = { start: line.start, end: line.end }
			pendingCaretRef.current = Math.max(0, caretAbsolute - line.start)
			setLines(nextLines)
			setActiveIndex(index)
		},
		[]
	)

	/**
	 * Focus and caret placement.
	 *
	 * Claimed **twice**: once synchronously in the layout effect, and again on the next frame. The two
	 * entry points into editing steal focus in different orders — creating a note calls
	 * `setEditingShape` and lands here with focus free, whereas double-clicking an existing note lets
	 * tldraw focus its own canvas container *after* React has mounted this component. With only the
	 * synchronous claim, double-clicking a note left it looking focused while keystrokes went to the
	 * canvas, so you had to click a second time to type. Re-asserting a frame later covers both, and
	 * is conditional so it never yanks focus back from something the user has since clicked.
	 */
	useLayoutEffect(() => {
		const target = textareaRef.current
		if (!target) return

		const pending = pendingCaretRef.current
		const offset =
			pending === 'end' || pending === null
				? target.value.length
				: pending === 'start'
					? 0
					: Math.min(pending, target.value.length)

		const claim = () => {
			const el = textareaRef.current
			if (!el || document.activeElement === el) return
			el.focus()
			el.setSelectionRange(offset, offset)
		}

		target.focus()
		target.setSelectionRange(offset, offset)
		pendingCaretRef.current = null
		autoSizeTextarea(target)

		const frame = requestAnimationFrame(claim)
		return () => cancelAnimationFrame(frame)
	}, [activeIndex, lines])

	const moveToLine = useCallback(
		(direction: -1 | 1, caret: 'start' | 'end') => {
			const { source } = flush()
			const nextLines = splitLines(source)
			const next = activeIndex + direction
			if (next < 0 || next >= nextLines.length) return
			pendingCaretRef.current = caret
			setLines(nextLines)
			setActiveIndex(next)
		},
		[activeIndex, flush]
	)

	const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		const el = e.currentTarget
		const action = decideNavigation({
			key: e.key,
			mod: e.metaKey || e.ctrlKey,
			shift: e.shiftKey,
			composing: composingRef.current || e.nativeEvent.isComposing,
			atLineStart: el.selectionStart === 0 && el.selectionEnd === 0,
			atLineEnd:
				el.selectionStart === el.value.length && el.selectionEnd === el.value.length,
			index: activeIndex,
			lineCount: lines.length,
		})

		switch (action.kind) {
			case 'exit':
				e.preventDefault()
				flush()
				onExit()
				return

			case 'newline': {
				e.preventDefault()
				const { source, lineStart } = flush()
				const result = insertLineBreak(source, lineStart + el.selectionStart)
				apply(result.source, result.caret)
				return
			}

			case 'joinBack': {
				e.preventDefault()
				const { source } = flush()
				const joined = joinWithPrevious(source, splitLines(source), activeIndex)
				if (joined) apply(joined.source, joined.caret)
				return
			}

			case 'joinForward': {
				e.preventDefault()
				const { source } = flush()
				const joined = joinWithNext(source, splitLines(source), activeIndex)
				if (joined) apply(joined.source, joined.caret)
				return
			}

			case 'focusLine':
				e.preventDefault()
				moveToLine(action.direction, action.caret)
				return

			case 'maybeFocusLine': {
				const before = el.selectionStart
				const { direction, caret } = action
				requestAnimationFrame(() => {
					const target = textareaRef.current
					if (target && target.selectionStart === before) moveToLine(direction, caret)
				})
				e.stopPropagation()
				return
			}

			case 'undo':
			case 'redo': {
				e.preventDefault()
				const { source, lineStart } = flush()
				historyRef.current.push(
					{ source, caret: lineStart + el.selectionStart },
					{ coalesce: true }
				)
				const snapshot =
					action.kind === 'undo' ? historyRef.current.undo() : historyRef.current.redo()
				if (snapshot) apply(snapshot.source, snapshot.caret)
				return
			}

			default:
				// Anything else stays in the textarea rather than reaching the canvas as a shortcut
				// (`d` would pick the draw tool, space would pan, and so on).
				e.stopPropagation()
		}
	}

	const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const el = e.currentTarget
		const { source, lineStart } = flush()
		historyRef.current.push({ source, caret: lineStart + el.selectionStart }, { coalesce: true })
		// No `setLines` here: re-deriving per keystroke would re-render the textarea mid-typing. Lines
		// are re-derived on structural changes and on line switches instead.
		autoSizeTextarea(el)
	}

	const source = sourceRef.current
	const { before, after } = surroundingMarkdown(source, activeLine)
	const style = lineStyle(source, activeLine)

	return (
		<div
			className="lb-note lb-note--editing"
			onPointerDown={stopEventPropagation}
			onTouchStart={stopEventPropagation}
			onWheel={stopEventPropagation}
			style={{ pointerEvents: 'all' }}
		>
			{before.trim() !== '' && (
				<div
					className="lb-note__rendered"
					// Clicking the rendered part above puts the caret at the end of the nearest line.
					onPointerDown={() => moveToLine(-1, 'end')}
				>
					<MarkdownView md={before} bare />
				</div>
			)}

			<textarea
				// Keyed by line so switching lines remounts with a fresh `defaultValue`.
				key={`line-${activeIndex}`}
				ref={textareaRef}
				className={`lb-note__input ${typographyClass(style)}`}
				defaultValue={source.slice(activeLine.start, activeLine.end)}
				spellCheck={false}
				rows={1}
				placeholder={source === '' ? 'Write something…' : undefined}
				onChange={onChange}
				onKeyDown={onKeyDown}
				onCompositionStart={() => {
					composingRef.current = true
				}}
				onCompositionEnd={() => {
					composingRef.current = false
				}}
			/>

			{after.trim() !== '' && (
				<div className="lb-note__rendered" onPointerDown={() => moveToLine(1, 'start')}>
					<MarkdownView md={after} bare />
				</div>
			)}
		</div>
	)
}

/**
 * The raw line must occupy the same space as the rendered line it replaces — heading sizes included —
 * or the note visibly jumps every time the caret crosses a line boundary, which reads as the editor
 * being broken rather than as a mode change.
 */
function typographyClass(style: ReturnType<typeof lineStyle>): string {
	if (style.kind === 'heading') return `lb-note__input--h${style.depth ?? 1}`
	if (style.kind === 'code') return 'lb-note__input--code'
	return 'lb-note__input--body'
}

/** Grow the textarea to its content so the note's own auto-height measures the true size. */
function autoSizeTextarea(el: HTMLTextAreaElement): void {
	el.style.height = 'auto'
	el.style.height = `${el.scrollHeight}px`
}
