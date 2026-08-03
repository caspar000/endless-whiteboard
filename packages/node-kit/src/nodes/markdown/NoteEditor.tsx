import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { stopEventPropagation } from 'tldraw'
import {
	joinWithNext,
	joinWithPrevious,
	lineIndexAtOffset,
	lineStyle,
	splitLines,
	surroundingMarkdown,
	type Line,
} from './lines'
import { indentLine, toggleInline, toggleLinePrefix, type LineEdit } from './lineEdits'
import { decideEnter } from './listContinuation'
import { MarkdownView } from './MarkdownView'
import { crossedLineEdge, decideNavigation } from './navigation'
import { SessionHistory } from './sessionHistory'
import { findTasks, lineIsTask, toggleTaskAt, toggleTaskOnLine } from './tasks'

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
	const historyRef = useRef(
		new SessionHistory({ source: initial, caret: initialCaret ?? initial.length })
	)

	/**
	 * Bumped on every structural change, and part of the textarea's `key`.
	 *
	 * The textarea is uncontrolled, so `defaultValue` is only read when it mounts. Keying on the line
	 * index alone meant a change that *replaced the current line's text without moving to a different
	 * line* — leaving a list does exactly that — left the old text in the DOM. The next flush then
	 * spliced that stale text back in, resurrecting the marker that had just been removed.
	 */
	const [generation, setGeneration] = useState(0)
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
	/**
	 * A selection to restore after a remount, for the edits that produce one.
	 *
	 * Separate from `pendingCaretRef` because almost every edit collapses the selection; only formatting
	 * (⌘B on a selected word) needs to hand one back, and folding that into the caret path would mean
	 * every caller thinking about ranges.
	 */
	const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null)
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
			setGeneration((n) => n + 1)
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
		const selection = pendingSelectionRef.current
		if (selection) {
			target.setSelectionRange(selection.start, selection.end)
			pendingSelectionRef.current = null
		} else {
			target.setSelectionRange(offset, offset)
		}
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
			atLineEnd: el.selectionStart === el.value.length && el.selectionEnd === el.value.length,
			index: activeIndex,
			lineCount: lines.length,
			onTaskLine: lineIsTask(el.value),
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
				const caretInLine = el.selectionStart
				const outcome = decideEnter(el.value, caretInLine)

				if (outcome.kind === 'exitList') {
					// Enter on an empty marker leaves the list, replacing the marker with a blank line so
					// that what comes next is a new paragraph rather than a continuation of the last item.
					const next =
						source.slice(0, lineStart) +
						outcome.insert +
						source.slice(lineStart + outcome.prefixLength)
					apply(next, lineStart + outcome.insert.length)
					return
				}

				const at = lineStart + caretInLine
				const next = source.slice(0, at) + outcome.text + source.slice(at)
				apply(next, at + outcome.text.length)
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
				const { direction, caret } = action
				// The native move happens first, then its result is inspected: whether a long line wraps —
				// and so whether ArrowUp stays inside it — cannot be answered without letting the browser
				// try. See `crossedLineEdge`.
				requestAnimationFrame(() => {
					const target = textareaRef.current
					if (!target) return
					if (crossedLineEdge(direction, target.selectionStart, target.value.length)) {
						moveToLine(direction, caret)
					}
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

			case 'indent': {
				e.preventDefault()
				const { source, lineStart } = flush()
				const edited = indentLine(
					{ text: el.value, selStart: el.selectionStart, selEnd: el.selectionEnd },
					action.direction
				)
				// `null` means there was nothing to outdent — don't spend an undo entry on a no-op.
				if (!edited) return
				replaceLine(source, lineStart, el.value, edited)
				return
			}

			case 'inline': {
				e.preventDefault()
				const { source, lineStart } = flush()
				const edited = toggleInline(
					{ text: el.value, selStart: el.selectionStart, selEnd: el.selectionEnd },
					action.marker
				)
				replaceLine(source, lineStart, el.value, edited)
				return
			}

			case 'linePrefix': {
				e.preventDefault()
				const { source, lineStart } = flush()
				const edited = toggleLinePrefix(
					{ text: el.value, selStart: el.selectionStart, selEnd: el.selectionEnd },
					action.prefix
				)
				replaceLine(source, lineStart, el.value, edited)
				return
			}

			case 'toggleTask': {
				e.preventDefault()
				const { source, lineStart } = flush()
				const caretInLine = el.selectionStart
				const next = toggleTaskOnLine(source, lineIndexAtOffset(splitLines(source), lineStart))
				if (next !== null) apply(next, lineStart + caretInLine)
				return
			}

			default:
				// Anything else stays in the textarea rather than reaching the canvas as a shortcut
				// (`d` would pick the draw tool, space would pan, and so on).
				e.stopPropagation()
		}
	}

	/**
	 * Swaps the active line's text for an edited version, restoring the selection the edit asked for.
	 *
	 * Goes through `apply` like every other structural change, so the session history sees it as one
	 * step and ⌘Z undoes an indent or a bold in one press rather than character by character.
	 */
	function replaceLine(source: string, lineStart: number, oldText: string, edited: LineEdit): void {
		const next = source.slice(0, lineStart) + edited.text + source.slice(lineStart + oldText.length)
		apply(next, lineStart + edited.selStart)
		// A selection, rather than a bare caret, has to be restored after the remount — `apply` only
		// carries a caret, because every other edit collapses the selection.
		if (edited.selEnd !== edited.selStart) {
			pendingSelectionRef.current = {
				start: edited.selStart,
				end: edited.selEnd,
			}
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

	/**
	 * Ticking a box in the preview regions, while editing.
	 *
	 * The regions above and below the caret are previews of the same document, so a checkbox there should
	 * behave like one in display mode. They are rendered from *slices*, though, so the second slice's
	 * first checkbox is not the document's first — hence the offset. Without it, clicking a box below the
	 * caret would tick one above it.
	 */
	const toggleTaskFromPreview = (index: number) => {
		const { source: current } = flush()
		const next = toggleTaskAt(current, index)
		if (next !== null)
			apply(next, extentRef.current.start + (textareaRef.current?.selectionStart ?? 0))
	}
	const tasksBefore =
		findTasks(before).length + (lineIsTask(source.slice(activeLine.start, activeLine.end)) ? 1 : 0)

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
					<MarkdownView md={before} bare onToggleTask={toggleTaskFromPreview} />
				</div>
			)}

			<textarea
				// Keyed by line *and* generation: an uncontrolled textarea only reads `defaultValue` on
				// mount, so a structural change that keeps the same line index must still remount it.
				key={`line-${activeIndex}-${generation}`}
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
					<MarkdownView
						md={after}
						bare
						onToggleTask={toggleTaskFromPreview}
						taskIndexOffset={tasksBefore}
					/>
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
