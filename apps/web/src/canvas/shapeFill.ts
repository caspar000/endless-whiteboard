import {
	DefaultColorStyle,
	DefaultFillStyle,
	atom,
	type Editor,
	type TLDefaultColorStyle,
	type TLShape,
} from 'tldraw'

/**
 * A shape's fill colour, independent of its border colour.
 *
 * **Why this needs writing at all.** tldraw gives a geo shape one colour and derives everything from
 * it: `props.color` paints the stroke, and `props.fill` chooses how strongly that *same* colour is
 * used inside. So "black outline, blue inside" is not expressible in the shape's own props — you can
 * have a blue rectangle or a black one, filled or not.
 *
 * **Where the second colour lives.** In `shape.meta`, which is a free-form JSON bag on every record
 * and needs no schema change or migration — the same door `relations.ts` uses for its hidden flag. The
 * alternative was adding a real style prop to a built-in shape's props schema, which means owning a
 * migration appended to tldraw's own `geoShapeMigrations`; a version number we chose would eventually
 * collide with one tldraw ships, and the price of that collision is a board that will not load.
 *
 * **How it reaches the picture.** `GeoShapeUtil` resolves its paints through
 * `options.getCustomDisplayValues`, so returning a `fillColor` from there is a supported override
 * rather than a re-implementation — the fill and the stroke are already separate arguments to
 * `GeoShapeBody`. See `expressionShapeUtils.tsx`; the frame util next door does the same thing to make
 * frames transparent.
 *
 * Geo shapes only, deliberately. A pen stroke and an arrowhead have a `fill` prop too, but there the
 * colour is ink either way — `SelectionToolbar` makes the same distinction for the same reason.
 */
export const FILL_COLOR_META = 'lifeboard:fillColor'

/**
 * "Transparent", written out rather than left absent.
 *
 * Two reasons it is a value and not a missing key. tldraw merges `meta` entry by entry, so a partial
 * cannot *delete* one (`relations.ts` records the same finding) — and a shape that has been explicitly
 * set to transparent must be distinguishable from one nobody has ever touched, or `onBeforeCreate`
 * would helpfully fill in a pasted transparent rectangle.
 */
const NO_FILL = 'none'

/** The fill colour recorded on a shape, or `null` for transparent — including "never set". */
export function readFillColor(
	shape: Pick<TLShape, 'meta'> | undefined
): TLDefaultColorStyle | null {
	const value = shape?.meta[FILL_COLOR_META]
	if (typeof value !== 'string' || value === NO_FILL) return null
	// Validated against tldraw's own list rather than trusted: this came out of a JSON bag, and a
	// value from an older or newer board must not reach `getColorValue` as a colour name it will not
	// recognise.
	return (DefaultColorStyle.values as readonly string[]).includes(value)
		? (value as TLDefaultColorStyle)
		: null
}

/**
 * Whether a shape is one whose fill colour can be set — that is, one whose interior is an area rather
 * than an artefact of its stroke.
 */
export function canHaveFillColor(shape: Pick<TLShape, 'type'> | undefined): boolean {
	return shape?.type === 'geo'
}

/**
 * The fill style that carries a chosen colour.
 *
 * `'fill'` rather than tldraw's `'solid'`, which is a *tint* (`semi` in the theme). With one colour
 * that made sense — a wash of the stroke's own hue. With a colour of its own, the swatch you clicked
 * has to be the colour that appears, or the control is lying about what it does.
 */
const FILLED = 'fill'

/**
 * Paints the selection's interior, or clears it.
 *
 * One history entry for both halves — the style prop and the meta — because they are one change as
 * far as the user is concerned, and an undo that took the colour back but left the shape opaque would
 * be a puzzle.
 */
export function setSelectionFillColor(editor: Editor, value: TLDefaultColorStyle | null): void {
	const shapes = editor.getSelectedShapes().filter(canHaveFillColor)
	if (shapes.length === 0) return
	editor.run(() => {
		editor.markHistoryStoppingPoint('lifeboard:fill-colour')
		editor.setStyleForSelectedShapes(DefaultFillStyle, value ? FILLED : 'none')
		editor.updateShapes(
			shapes.map((shape) => ({
				id: shape.id,
				type: shape.type,
				meta: { [FILL_COLOR_META]: value ?? NO_FILL },
			}))
		)
	})
}

/**
 * The fill colour the *next* shape gets, and the reason this module has state at all.
 *
 * tldraw's `setStyleForNextShapes` is the mechanism for "and the one after that", and it only knows
 * about style props — a meta value cannot use it. So the pending choice is kept here and applied by
 * the geo util's `onBeforeCreate` (see `expressionShapeUtils.tsx`), which is the same shape of answer:
 * a preference read at creation time rather than a value copied onto every tool.
 *
 * Not persisted. It is the drawing state of this session, like the pen size, and tldraw does not
 * persist that either.
 */
const nextFill = atom<TLDefaultColorStyle | null>('lifeboard:next-fill', null)

export function getNextFillColor(): TLDefaultColorStyle | null {
	return nextFill.get()
}

/**
 * Sets what the next shape will be filled with — and repaints the selection to match, which is what
 * every other control in the dock's settings row does (see `setStyle` in CanvasToolbar).
 */
export function setNextFillColor(editor: Editor, value: TLDefaultColorStyle | null): void {
	editor.run(() => {
		nextFill.set(value)
		editor.setStyleForNextShapes(DefaultFillStyle, value ? FILLED : 'none')
		setSelectionFillColor(editor, value)
	})
}
