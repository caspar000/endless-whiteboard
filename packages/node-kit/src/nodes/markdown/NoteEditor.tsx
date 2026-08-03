import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { stopEventPropagation, type Editor as TldrawEditor } from 'tldraw'
import { editingKeymap } from './editingKeymap'
import { livePreview } from './livePreview'

/**
 * The note's editor: CodeMirror 6, with our own live-preview decorations.
 *
 * ### Why CodeMirror, and why not a higher-level editor
 *
 * The first version put a `<textarea>` on the caret's line and rendered the rest as markdown. That bought
 * live preview cheaply but capped the ceiling: **a selection could not span lines**, so there was no way
 * to indent a block of items, no single caret or undo model, and every line change remounted a textarea.
 * Those limits were architectural, not a matter of polish.
 *
 * CodeMirror is the one foundation that keeps our model intact, because it is *text-first*: the document
 * **is** the markdown string, so `props.md` stays the source of truth byte for byte. The property system,
 * the table's facts pipeline, backup export and the note's own props migration all read that string. The
 * alternatives replace it — AFFiNE's BlockSuite is a Yjs/CRDT block tree in web components with markdown
 * as import/export only, and Lexical/ProseMirror/Slate make markdown a lossy serialisation of a rich
 * document model.
 *
 * ### Why not the `@atomic-editor/editor` wrapper
 *
 * It was tried first, and its preview quality is genuinely good. Two things were fixable from outside (it
 * sizes to its container, and it auto-pairs `*` so hand-typing `**bold**` produced `a***`), but one was
 * not: it binds Enter at `Prec.highest` and registers before consumer extensions, so its list handling
 * cannot be overridden. That handling leaves a list without inserting the blank line markdown needs, so
 * `- [ ] rug` + Enter + Enter + `**Budget:**` produced a document where the Budget paragraph is a *lazy
 * continuation* — it renders inside the list item. Verified in the browser, not assumed. A wrong document
 * we cannot correct is a different class of problem from a rough edge we can.
 *
 * ### What stays ours
 *
 * The session owns the text and commits **once**, which is what keeps one editing session equal to one
 * board-level undo entry. CodeMirror's own history serves undo *within* the session.
 */
export function NoteEditor({
	initial,
	initialCaret,
	editor,
	onCommit,
	onExit,
}: {
	initial: string
	/** Absolute offset to start editing at. Defaults to the end of the document. */
	initialCaret?: number
	/** The tldraw editor, needed only to claim keyboard events — see `swallowKeys` below. */
	editor: TldrawEditor
	onCommit: (next: string) => void
	onExit: () => void
}) {
	const hostRef = useRef<HTMLDivElement>(null)
	const viewRef = useRef<EditorView | null>(null)
	const sourceRef = useRef(initial)

	const commitRef = useRef(onCommit)
	commitRef.current = onCommit
	const exitRef = useRef(onExit)
	exitRef.current = onExit

	/**
	 * Commit the text, then leave editing.
	 *
	 * The order matters. Leaving editing state first pushes a history stopping point, and the commit then
	 * lands *after* it — so the top of the undo stack is an entry containing nothing, and the first ⌘Z
	 * appears to do nothing at all. Committing first keeps one editing session equal to one undo entry,
	 * which is what "⌘Z undoes what I just wrote" means.
	 */
	const commitAndExit = useRef(() => {})
	commitAndExit.current = () => {
		const view = viewRef.current
		if (view) sourceRef.current = view.state.doc.toString()
		commitRef.current(sourceRef.current)
		exitRef.current()
	}

	/**
	 * The safety net for the exit routes that don't go through Escape — clicking another shape, switching
	 * board, deleting the note. Idempotent with the commit above: tldraw's `updateShape` returns the same
	 * record when nothing changed, so a second write of identical text costs no history entry.
	 */
	useEffect(() => {
		return () => commitRef.current(sourceRef.current)
	}, [])

	/**
	 * The view is built once, imperatively, and never rebuilt.
	 *
	 * Deliberately not driven by props: CodeMirror owns the document once it exists, and re-syncing it from
	 * a prop is what produced a "Maximum update depth exceeded" crash in an earlier React-controlled
	 * version of this editor. The session is the component's lifetime.
	 */
	useLayoutEffect(() => {
		const host = hostRef.current
		if (!host) return

		const caret = Math.max(0, Math.min(initialCaret ?? initial.length, initial.length))
		const view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: initial,
				selection: { anchor: caret },
				extensions: [
					// GFM: task lists, strikethrough and tables are what real notes contain.
					markdown({ base: markdownLanguage }),
					livePreview(),
					history(),
					EditorView.lineWrapping,
					// Ours first so Enter, Tab and the formatting chords beat the defaults.
					editingKeymap(() => commitAndExit.current()),
					keymap.of([...historyKeymap, ...defaultKeymap]),
					EditorView.updateListener.of((update) => {
						if (update.docChanged) sourceRef.current = update.state.doc.toString()
					}),
					theme,
				],
			}),
		})
		viewRef.current = view

		/**
		 * Focus, claimed twice.
		 *
		 * The two entry points into editing steal focus in different orders: creating a note calls
		 * `setEditingShape` and lands here with focus free, whereas double-clicking an existing note lets
		 * tldraw focus its own canvas container *after* React has mounted this component. With only the
		 * synchronous claim, double-clicking a note left it looking focused while keystrokes went to the
		 * canvas, so you had to click a second time to type.
		 */
		view.focus()
		const frame = requestAnimationFrame(() => {
			if (!view.hasFocus) view.focus()
		})

		/**
		 * Keys typed in the editor belong to the editor, and tldraw must not act on them too.
		 *
		 * `markEventAsHandled` is tldraw's own mechanism for saying so, and it is the only one that works
		 * from here: tldraw listens on its container, an *ancestor* of this element, and React's `onKeyDown`
		 * is attached even higher — at the React root — so stopping propagation there is always too late.
		 *
		 * **Capture phase, and Escape is handled here rather than in the keymap.** React flushes discrete
		 * events like keydown synchronously, so exiting from inside CodeMirror's handler unmounted this
		 * component *during* the event — taking this listener out of the DOM before it ever ran. tldraw then
		 * saw an unclaimed Escape and treated it as "clear selection", which marks a history stopping point.
		 * That empty entry sat on top of the undo stack, so the first ⌘Z after writing a note did nothing.
		 *
		 * Every other key falls through to CodeMirror untouched; only the one that tears the editor down is
		 * taken early.
		 */
		const onKeyDownCapture = (event: KeyboardEvent) => {
			editor.markEventAsHandled(event)
			if (event.key !== 'Escape') return
			event.preventDefault()
			event.stopPropagation()
			commitAndExit.current()
		}
		host.addEventListener('keydown', onKeyDownCapture, { capture: true })

		return () => {
			host.removeEventListener('keydown', onKeyDownCapture, { capture: true })
			cancelAnimationFrame(frame)
			// Read the text out before destroying: the commit effect above runs after this one's cleanup on
			// some React versions, and a destroyed view's state is still readable but its DOM is not.
			sourceRef.current = view.state.doc.toString()
			view.destroy()
			viewRef.current = null
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	return (
		<div
			className="lb-note lb-note--editing lb-note--cm"
			ref={hostRef}
			// The editor lives inside a shape: its gestures are its own, and must not reach the canvas as
			// pans, marquees or single-letter tool shortcuts.
			onPointerDown={stopEventPropagation}
			onTouchStart={stopEventPropagation}
			onWheel={stopEventPropagation}
			style={{ pointerEvents: 'all' }}
		/>
	)
}

/**
 * The editor's own styling.
 *
 * Heights and overflow are the load-bearing part: CodeMirror is built to be a viewport onto a long
 * document, and a note is the opposite — the shape's `useAutoHeight` measures the rendered content, so
 * the editor must *have* a height rather than clip to one. Left at CodeMirror's defaults, a note collapses
 * to a few lines with an inner scrollbar.
 */
const theme = EditorView.theme({
	'&': { height: 'auto', backgroundColor: 'transparent', color: 'inherit' },
	'&.cm-focused': { outline: 'none' },
	'.cm-scroller': {
		overflow: 'visible',
		// Inherited so editing text matches the rendered preview: a different family or line height makes
		// the note jump the moment the editor opens.
		fontFamily: 'inherit',
		lineHeight: 'inherit',
		fontSize: 'inherit',
	},
	'.cm-content': { padding: '0', caretColor: 'currentColor' },
	'.cm-line': { padding: '0' },
	'.cm-gutters': { display: 'none' },
	// The shape already paints a surface; the editor must not paint a second one over it.
	'.cm-activeLine': { backgroundColor: 'transparent' },
	'.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(96, 165, 250, 0.35)' },
	'&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(96, 165, 250, 0.35)' },
})

export type { Extension }
