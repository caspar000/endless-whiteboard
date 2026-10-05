import {
	Editor,
	TLArrowShape,
	TLArrowShapeTerminal,
	getArrowTerminals,
	richTextToPlainText,
} from '@lifeboard/canvas-editor'

/**
 * An arrow with its ends as the 2023 arrow code expects them: free points or attachments.
 *
 * Boards store an arrow's ends as plain points, with attachments as separate binding records
 * (docs/fork-parity.md D2). The arrow code reads through {@link withTerminals} and returns shapes in
 * this form; `updateShapes` and `createShapes` store them back as points plus bindings.
 */
export type TLArrowShapeWithTerminals = Omit<TLArrowShape, 'props'> & {
	props: Omit<TLArrowShape['props'], 'start' | 'end'> & {
		start: TLArrowShapeTerminal
		end: TLArrowShapeTerminal
	}
}

export function withTerminals(editor: Editor, shape: TLArrowShape): TLArrowShapeWithTerminals {
	return { ...shape, props: { ...shape.props, ...getArrowTerminals(editor, shape) } }
}

/** Typed as a stored arrow again, for handing to the editor, which translates the terminals. */
export function asArrowShape<T extends object>(value: T): T extends TLArrowShapeWithTerminals ? TLArrowShape : T {
	return value as never
}

/** The arrow's label as plain text, for hit-testing and measuring. */
export function arrowLabelText(shape: TLArrowShape): string {
	return richTextToPlainText(shape.props.richText)
}
