import { NodeStrips, hasCollection, readPropertyLayout, setPropertyCardHeight } from '@lifeboard/node-kit'
import {
	atom,
	getGpuScene,
	getPointerInfo,
	react,
	useEditor,
	useValue,
	type Editor,
	type TLArrowShape,
	type TLShape,
} from '@lifeboard/canvas'
import { useEffect, useLayoutEffect, useRef, type PointerEvent } from 'react'
import { arrowStripAnchor } from './arrowAnchor'

/**
 * The property card: every shape's properties, drawn as a separate card *below* the shape.
 *
 * Always outside the shape, ours and tldraw's alike, never inside a node's own card
 * (docs/property-display-plan.md). The card belongs to its shape and follows it, but it is not part of
 * the shape's geometry: arrows, snapping, the selection box and zoom-to-fit see the shape alone. The
 * one place the card counts is a kanban or calendar lane, which reserves its measured height
 * (`propertyCardSpace`).
 *
 * **An arrow is placed differently from everything else** (see `arrowAnchor.ts`): under the middle of
 * the line, not under its bounding box, because a line does not pass through the box that contains it.
 *
 * Rendered through `OnTheCanvas`, which is inside the camera transform — so a card pans, zooms and
 * moves with its shape without any of it being computed here.
 *
 * This is a *view* concern and deliberately outside the facts pipeline (§4.3): it is expected to
 * re-render when shapes move, which is precisely what rollups must not do.
 */

interface CardTarget {
	id: string
	/** Where the card hangs from: the middle of its top edge, in page coordinates. */
	x: number
	y: number
	/** The shape's width, for a layout that asks for `full`. */
	w: number
	arrow: boolean
}

/** The default card width in page units. An arrow's card hugs its content unless its layout says otherwise. */
const CARD_WIDTH = 240

/**
 * Under the middle of the arrow, in page coordinates.
 *
 * The anchor is in the shape's own space — geometry always is — so it has to go through the shape's
 * page transform, which is also what makes a rotated or scaled arrow come out right.
 */
function arrowTarget(editor: Editor, shape: TLArrowShape): CardTarget | null {
	const geometry = editor.getShapeGeometry(shape)
	if (!geometry) return null
	const anchor = arrowStripAnchor(geometry, shape.props.labelPosition)
	const page = editor.getShapePageTransform(shape.id)?.applyToPoint(anchor)
	if (!page) return null
	return { id: shape.id, x: page.x, y: page.y, w: 0, arrow: true }
}

function boundsTarget(editor: Editor, shape: TLShape): CardTarget | null {
	const bounds = editor.getShapePageBounds(shape.id)
	if (!bounds) return null
	return { id: shape.id, x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h, w: bounds.w, arrow: false }
}

/** Each card's box in page space, as it last laid out. */
const cardBoxes = atom<ReadonlyMap<string, { x: number; y: number; w: number; h: number }>>('lifeboard:property-card-boxes', new Map())

function setCardBox(id: string, box: { x: number; y: number; w: number; h: number } | null) {
	const next = new Map(cardBoxes.get())
	if (box) next.set(id, box)
	else next.delete(id)
	cardBoxes.set(next)
}

export function PropertyCards() {
	const editor = useEditor()

	const targets = useValue(
		'lifeboard:property-cards',
		() => {
			const out: CardTarget[] = []
			for (const shape of editor.getCurrentPageShapes()) {
				// Cheap pre-filter before asking for bounds, which is the expensive part: the
				// overwhelming majority of shapes on a board carry neither.
				if (!shape.meta['lifeboard:props'] && !hasCollection(shape)) continue
				// A hidden relation takes its properties with it. `getCurrentPageShapes` still returns a
				// hidden shape — that is exactly what keeps a hidden relation an edge — so this layer
				// has to ask, or hiding an arrow would leave its `200 g` stranded on the canvas with no
				// line under it.
				if (editor.isShapeHidden(shape)) continue
				const target =
					shape.type === 'arrow'
						? arrowTarget(editor, shape as TLArrowShape)
						: boundsTarget(editor, shape)
				if (target) out.push(target)
			}
			return out
		},
		[editor]
	)

	// Where the cards are, for the GPU layer: they're drawn over every shape, by the page.
	useEffect(() => react('lifeboard:property-card-boxes', () => getGpuScene(editor).above.set([...cardBoxes.get().values()])), [editor])

	if (!targets.length) return null

	return (
		<>
			{targets.map((target) => (
				<PropertyCard key={target.id} editor={editor} target={target} />
			))}
		</>
	)
}

function PropertyCard({ editor, target }: { editor: Editor; target: CardTarget }) {
	// Read the shape rather than closing over it, so a property edit re-renders just this card.
	const shape = useValue(
		`lifeboard:property-card-${target.id}`,
		() => editor.getShape(target.id as never),
		[editor, target.id]
	)
	const ref = useRef<HTMLDivElement>(null)

	// Lanes stack nodes by their height plus this, so the card reports its own. `offsetHeight` is in
	// page units: the card sits inside the camera transform, which scales it without changing layout.
	// Its box goes to the GPU layer too, which mustn't draw a shape over it (cardBoxes below).
	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		const report = () => {
			setPropertyCardHeight(target.id, el.offsetHeight || null)
			setCardBox(target.id, { x: target.x - el.offsetWidth / 2, y: target.y + el.offsetTop, w: el.offsetWidth, h: el.offsetHeight })
		}
		report()
		const observer = new ResizeObserver(report)
		observer.observe(el)
		return () => {
			observer.disconnect()
			setPropertyCardHeight(target.id, null)
			setCardBox(target.id, null)
		}
	}, [target.id, target.x, target.y])

	if (!shape) return null

	// The layout's width holds in both modes, so switching to source doesn't make the card jump.
	const width = readPropertyLayout(shape)?.width ?? (target.arrow ? 'fit' : CARD_WIDTH)
	const fit = width === 'fit' || (width === 'full' && target.arrow)

	/*
	 * The card acts as part of its shape: pressing on it is pressing on the shape, so a click selects
	 * it, a drag moves it, a double-click edits it and a right-click opens its menu. Only the press is
	 * ours. It is marked handled so the canvas does not also start a brush, and the card captures the
	 * pointer so the moves and the release still bubble to the canvas's own handlers.
	 */
	const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
		if (editor.wasEventAlreadyHandled(e)) return
		if (e.button !== 0 && e.button !== 2) return
		editor.markEventAsHandled(e)
		if (e.button === 0) e.currentTarget.setPointerCapture(e.pointerId)
		editor.dispatch({
			type: 'pointer',
			target: 'shape',
			shape,
			name: e.button === 2 ? 'right_click' : 'pointer_down',
			...getPointerInfo(e),
		})
	}

	return (
		<div
			ref={ref}
			className={`lb-prop-card${target.arrow ? ' lb-prop-card--arrow' : ''}${fit ? ' lb-prop-card--fit' : ''}`}
			data-shape-id={target.id}
			onPointerDown={onPointerDown}
			style={{
				// Page coordinates: `OnTheCanvas` already sits inside the camera transform. The card is
				// pulled back by half its own width so it hangs centred under its anchor.
				transform: `translate(${target.x}px, ${target.y}px) translateX(-50%)`,
				...(fit ? {} : { width: width === 'full' ? target.w : width }),
				/*
				 * In front of the shapes. `OnTheCanvas` is painted *before* tldraw's shapes, so by
				 * default a card would sit under any shape below its node, and under its own arrow.
				 *
				 * The number is tldraw's, not a guess: shapes are given z-indices starting at
				 * `maxShapesPerPage * 2` and counting up, so one page of them cannot reach `* 3`. Both
				 * layers live inside `.tl-shapes`, which is itself a stacking context, so this cannot
				 * climb over the selection overlays or the UI however large it is.
				 */
				zIndex: editor.options.maxShapesPerPage * 3,
			}}
		>
			<NodeStrips shape={shape} editor={editor} />
		</div>
	)
}
