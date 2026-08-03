import { syntaxTree } from '@codemirror/language'
import type { Range } from '@codemirror/state'
import {
	Decoration,
	EditorView,
	ViewPlugin,
	WidgetType,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view'

/**
 * Obsidian-style live preview: markdown renders in place, and the raw syntax appears only on the line
 * the caret is on.
 *
 * ### How it works
 *
 * The document is never transformed — it stays the markdown string, byte for byte, which is what the
 * whole app depends on. Instead the *view* is decorated: marker characters are `Decoration.replace`d with
 * nothing so they take no space, the spans they delimited get a class, and a task's `[ ]` becomes a real
 * checkbox widget. Nothing here can change the text; a decoration is presentation only.
 *
 * ### Why the caret's line is different
 *
 * Hiding the markers on the line you are editing would make editing them impossible — you would be
 * typing into characters you cannot see, and the caret would jump over hidden text. So every line the
 * selection touches renders raw. That is the whole trick behind live preview, and it is why this is
 * driven by the selection as well as the document.
 */

/** Line-level constructs get a class so the line's typography can change (heading sizes, quotes). */
const LINE_CLASSES: Record<string, string> = {
	ATXHeading1: 'lb-cm-h1',
	ATXHeading2: 'lb-cm-h2',
	ATXHeading3: 'lb-cm-h3',
	ATXHeading4: 'lb-cm-h4',
	ATXHeading5: 'lb-cm-h5',
	ATXHeading6: 'lb-cm-h6',
	SetextHeading1: 'lb-cm-h1',
	SetextHeading2: 'lb-cm-h2',
}

/** Inline constructs: the span gets a class, and its delimiters are hidden. */
const INLINE_CLASSES: Record<string, string> = {
	StrongEmphasis: 'lb-cm-strong',
	Emphasis: 'lb-cm-em',
	Strikethrough: 'lb-cm-strike',
	InlineCode: 'lb-cm-code',
}

/** The delimiter node types that are hidden when their parent is rendered. */
const MARK_TYPES = new Set([
	'HeaderMark',
	'EmphasisMark',
	'StrikethroughMark',
	'CodeMark',
	'QuoteMark',
	'LinkMark',
	'URL',
])

const hidden = Decoration.replace({})

/**
 * A task's checkbox.
 *
 * `toDOM` builds a real `<input>` rather than a styled span so it is focusable and announced as a
 * checkbox. `ignoreEvent` returns false for change events specifically, because CodeMirror otherwise
 * swallows them as "events inside a widget the editor doesn't care about".
 */
class TaskWidget extends WidgetType {
	constructor(
		readonly checked: boolean,
		readonly pos: number
	) {
		super()
	}

	override eq(other: TaskWidget): boolean {
		return other.checked === this.checked && other.pos === this.pos
	}

	override toDOM(view: EditorView): HTMLElement {
		const box = document.createElement('input')
		box.type = 'checkbox'
		box.className = 'lb-cm-task'
		box.checked = this.checked
		box.addEventListener('mousedown', (e) => e.preventDefault())
		box.addEventListener('change', () => {
			// The marker is exactly `[ ]` or `[x]`; only its middle character changes, which keeps the
			// line's spacing and bullet untouched.
			view.dispatch({
				changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? ' ' : 'x' },
				userEvent: 'input.toggleTask',
			})
		})
		return box
	}

	override ignoreEvent(event: Event): boolean {
		return event.type !== 'change' && event.type !== 'mousedown'
	}
}

function buildDecorations(view: EditorView): DecorationSet {
	const { state } = view
	const tree = syntaxTree(state)

	// Every line the selection touches renders raw. Computed once as a set of line numbers because a
	// construct can span lines and each of its pieces needs the same answer.
	const active = new Set<number>()
	for (const range of state.selection.ranges) {
		const first = state.doc.lineAt(range.from).number
		const last = state.doc.lineAt(range.to).number
		for (let n = first; n <= last; n++) active.add(n)
	}
	const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number)

	const decorations: Range<Decoration>[] = []

	for (const { from, to } of view.visibleRanges) {
		tree.iterate({
			from,
			to,
			enter: (node) => {
				const lineClass = LINE_CLASSES[node.name]
				if (lineClass) {
					// A heading's *typography* applies even while it is being edited — otherwise the note
					// jumps every time the caret enters or leaves the line, which reads as a bug.
					decorations.push(
						Decoration.line({ class: lineClass }).range(state.doc.lineAt(node.from).from)
					)
					return
				}

				if (node.name === 'ListMark' && !isActive(node.from)) {
					const text = state.sliceDoc(node.from, node.to)
					// Ordered markers keep their number — it carries meaning. Bullets become a real bullet
					// glyph, which is what the rendered preview shows.
					//
					// Except on a task, where the checkbox *is* the marker: a bullet beside it reads as two
					// markers for one item, which is the same thing that had to be fixed in the rendered view.
					const isTask = /^\s*\[[ xX]\]\s/.test(state.sliceDoc(node.to, node.to + 5))
					if (/^[-*+]$/.test(text) && !isTask) {
						decorations.push(
							Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to)
						)
					} else if (isTask) {
						// Hidden rather than replaced: the checkbox widget that follows supplies the marker.
						decorations.push(hidden.range(node.from, node.to))
					}
					return
				}

				if (node.name === 'TaskMarker') {
					// The checkbox replaces `[ ]` even on the active line: it is the one construct where the
					// rendered form is *more* editable than the source, and hiding it while you type in the
					// item would make ticking it impossible without leaving the line.
					const checked = /[xX]/.test(state.sliceDoc(node.from, node.to))
					decorations.push(
						Decoration.replace({ widget: new TaskWidget(checked, node.from) }).range(
							node.from,
							node.to
						)
					)
					return
				}

				const inlineClass = INLINE_CLASSES[node.name]
				if (inlineClass) {
					decorations.push(Decoration.mark({ class: inlineClass }).range(node.from, node.to))
					return
				}

				if (MARK_TYPES.has(node.name) && !isActive(node.from)) {
					// `URL` is hidden entirely so a link shows as its text; the surrounding `LinkMark`s go too.
					decorations.push(hidden.range(node.from, node.to))
				}
			},
		})
	}

	// Sorted on construction rather than added in order: a parent's mark and its children's hidden
	// delimiters share a start position, and `RangeSetBuilder` rejects that.
	return Decoration.set(decorations, true)
}

/** The bullet a `-` becomes when its line isn't being edited. */
class BulletWidget extends WidgetType {
	override eq(): boolean {
		return true
	}

	override toDOM(): HTMLElement {
		const span = document.createElement('span')
		span.className = 'lb-cm-bullet'
		span.textContent = '•'
		return span
	}

	override ignoreEvent(): boolean {
		return false
	}
}

export function livePreview() {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view)
			}

			update(update: ViewUpdate) {
				// Selection changes matter as much as document changes: moving the caret onto a line is what
				// reveals its source.
				if (update.docChanged || update.selectionSet || update.viewportChanged) {
					this.decorations = buildDecorations(update.view)
				}
			}
		},
		{ decorations: (plugin) => plugin.decorations }
	)
}
