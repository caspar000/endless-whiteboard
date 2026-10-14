import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { yaml } from '@codemirror/lang-yaml'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, keymap, lineNumbers, type DecorationSet } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { stopEventPropagation, useValue, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { shapeLabel } from './labels'
import { layoutFromAuto, readPropertyLayout, type PropertyLayout } from './layout'
import { setPropertyLayouts } from './layoutEdit'
import { layoutFromYaml, layoutToYaml, type LayoutYamlError } from './layoutYaml'
import { findProperty, readPropertyRegistry } from './schema'
import { orderedPropertyIds, readHiddenPropertyIds, type ShapeWithMeta } from './values'
import { setPropertyView } from './view'

/** How long typing pauses before the card is updated. Short enough to feel live. */
const PARSE_DELAY_MS = 150

/**
 * The YAML editor for a card layout (docs/property-display-plan.md). Given several shapes (a selection
 * whose layouts match), every edit goes to all of them; the first is the one shown.
 *
 * Opens beside the board while the node's real card updates as you type: every edit that parses is
 * written to the shape. An edit that doesn't parse writes nothing, so the card keeps the last good
 * layout while the errors show here with their lines.
 *
 * The whole session is one undo step (a history mark at open), and Cancel goes back to that mark.
 */
export function LayoutYamlEditor({
	editor,
	shapeIds,
	onClose,
}: {
	editor: Editor
	shapeIds: readonly TLShapeId[]
	onClose: () => void
}) {
	const shapeId = shapeIds[0]!
	const key = shapeIds.join(',')
	const host = useRef<HTMLDivElement>(null)
	const [errors, setErrors] = useState<LayoutYamlError[]>([])
	const shape = useValue('lifeboard:layout-editor-shape', () => editor.getShape(shapeId) ?? null, [
		editor,
		shapeId,
	])
	const label = shape ? shapeLabel(editor, shape) : ''
	const gone = shape === null

	// Closes on its own when the node is deleted (or undone out of existence).
	useEffect(() => {
		if (gone) onClose()
	}, [gone, onClose])

	const close = useRef(onClose)
	close.current = onClose
	const mark = useRef<string | null>(null)

	useEffect(() => {
		const start = editor.getShape(shapeId)
		if (!start || !host.current) return
		mark.current = editor.markHistoryStoppingPoint('lifeboard:layout-yaml')
		const targets = () => shapeIds.flatMap((id) => editor.getShape(id) ?? [])
		// A layout only shows in display mode, so editing one in source would look like nothing happens.
		setPropertyView(editor, shapeIds, 'display')

		const defs = readPropertyRegistry(editor)
		const initial = layoutToYaml(readPropertyLayout(start) ?? automaticLayout(editor, start), defs)

		let timer: ReturnType<typeof setTimeout> | undefined
		const apply = (text: string) => {
			const current = editor.getShape(shapeId)
			if (!current) return
			const result = layoutFromYaml(text, readPropertyRegistry(editor))
			if (!result.ok) {
				setErrors(result.errors)
				view.dispatch({ effects: setErrorLines.of(result.errors.map((e) => e.line)) })
				return
			}
			setErrors([])
			view.dispatch({ effects: setErrorLines.of([]) })
			if (!sameLayout(readPropertyLayout(current), result.layout)) {
				setPropertyLayouts(editor, targets(), result.layout)
			}
		}

		const view = new EditorView({
			parent: host.current,
			state: EditorState.create({
				doc: initial,
				extensions: [
					lineNumbers(),
					EditorView.lineWrapping,
					history(),
					yaml(),
					syntaxHighlighting(defaultHighlightStyle),
					errorLines,
					EditorState.tabSize.of(2),
					keymap.of([
						{ key: 'Escape', run: () => (close.current(), true) },
						{ key: 'Mod-Enter', run: () => (close.current(), true) },
						indentWithTab,
						...defaultKeymap,
						...historyKeymap,
					]),
					EditorView.updateListener.of((update) => {
						if (!update.docChanged) return
						clearTimeout(timer)
						const text = update.state.doc.toString()
						timer = setTimeout(() => apply(text), PARSE_DELAY_MS)
					}),
				],
			}),
		})
		view.focus()
		return () => {
			clearTimeout(timer)
			view.destroy()
		}
		// `key` stands in for `shapeIds`, whose identity changes on every render of the caller.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor, key])

	if (!shape) return null

	const cancel = () => {
		if (mark.current) editor.bailToMark(mark.current)
		onClose()
	}
	const resetToAutomatic = () => {
		setPropertyLayouts(
			editor,
			shapeIds.flatMap((id) => editor.getShape(id) ?? []),
			null
		)
		onClose()
	}

	return createPortal(
		<div
			className="lb-layout-editor"
			role="dialog"
			aria-label="Card layout"
			// Over the canvas but not part of it, so canvas gestures must not start here.
			onPointerDown={stopEventPropagation}
			onTouchStart={stopEventPropagation}
			onWheel={stopEventPropagation}
		>
			<div className="lb-layout-editor__header">
				<span className="lb-layout-editor__title" title={label}>
					Card layout{shapeIds.length > 1 ? ` · ${shapeIds.length} cards` : label ? ` · ${label}` : ''}
				</span>
				<button className="lb-props__close" aria-label="Close the layout editor" onClick={onClose}>
					×
				</button>
			</div>
			<div className="lb-layout-editor__code" ref={host} />
			<div className="lb-layout-editor__status" role="status">
				{errors.length ? (
					errors.slice(0, 3).map((error, i) => (
						<div key={i} className="lb-layout-editor__error">
							Line {error.line}: {error.message}
						</div>
					))
				) : (
					<span className="lb-layout-editor__ok">Live on the card</span>
				)}
				{errors.length > 3 && <div className="lb-layout-editor__error">…and {errors.length - 3} more</div>}
			</div>
			<details className="lb-layout-editor__help">
				<summary>Reference</summary>
				<dl>
					<dt>width</dt>
					<dd>a number, `fit` or `full`</dd>
					<dt>rows</dt>
					<dd>
						each row has `left`, `center`, `right` slots and `align` (top, middle, bottom, baseline). A row
						can also be `separator` or `table: [A, B]`
					</dd>
					<dt>property</dt>
					<dd>
						`{'{ property: Price }'}` with `as` (text, badge, chip, icon, bar, stars, checkbox), `size` (s, m,
						l, xl), `weight` (regular, bold), `showName`, `decimals`, `symbol`, `date` (short, medium, long)
					</dd>
					<dt>text</dt>
					<dd>`{'{ text: Notes, size: s }'}`, a fixed label</dd>
				</dl>
			</details>
			<div className="lb-layout-editor__actions">
				<button className="lb-layout-editor__secondary" onClick={resetToAutomatic}>
					Use automatic
				</button>
				<span className="lb-layout-editor__spacer" />
				<button className="lb-layout-editor__secondary" onClick={cancel}>
					Cancel
				</button>
				<button className="lb-layout-editor__primary" onClick={onClose}>
					Done
				</button>
			</div>
		</div>,
		editor.getContainer()
	)
}

/** The automatic layout for this shape, as a starting point: its visible properties in panel order. */
function automaticLayout(editor: Editor, shape: ShapeWithMeta): PropertyLayout {
	const registry = readPropertyRegistry(editor)
	const hidden = readHiddenPropertyIds(shape)
	const defs = orderedPropertyIds(shape)
		.filter((id) => !hidden.has(id))
		.flatMap((id) => findProperty(registry, id) ?? [])
	return layoutFromAuto(defs)
}

function sameLayout(a: PropertyLayout | null, b: PropertyLayout): boolean {
	return JSON.stringify(a) === JSON.stringify(b)
}

/** Marks the lines an error points at. */
const setErrorLines = StateEffect.define<number[]>()

const errorLineMark = Decoration.line({ class: 'lb-layout-editor__error-line' })

const errorLines = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(decorations, transaction) {
		for (const effect of transaction.effects) {
			if (!effect.is(setErrorLines)) continue
			const builder = new RangeSetBuilder<Decoration>()
			const doc = transaction.state.doc
			for (const line of [...new Set(effect.value)].sort((a, b) => a - b)) {
				if (line >= 1 && line <= doc.lines) builder.add(doc.line(line).from, doc.line(line).from, errorLineMark)
			}
			return builder.finish()
		}
		return decorations.map(transaction.changes)
	},
	provide: (field) => EditorView.decorations.from(field),
})
