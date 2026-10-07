import {
	Editor,
	TLArrowShape,
	TLArrowShapeArrowheadStyle,
	TLArrowShapeTerminal,
	TLGeoShape,
	TLShapeId,
	TLShapePartial,
	VecLike,
	createShapeId,
	toRichText,
} from '@lifeboard/canvas-editor'
import { FONT_FAMILIES, LABEL_FONT_SIZES, TEXT_PROPS } from '../../shapes/shared/default-shape-constants'
import { FlowHead, FlowNodeShape, Flowchart, parseFlowchart } from './flowchart'

/**
 * A pasted Mermaid flowchart, drawn as shapes joined by arrows (docs/fork-parity.md B8).
 *
 * Laid out in layers along the chart's direction: each node one step past the furthest node leading
 * to it (a loop's way back is left out of that), and nodes in a layer ordered to sit near what leads
 * to them. Arrows are bound to the shapes, so moving one afterwards keeps them joined.
 *
 * Returns the new shapes' ids, or `null` if the text isn't a flowchart.
 */
export function pasteMermaid(editor: Editor, text: string, point?: VecLike): TLShapeId[] | null {
	const chart = parseFlowchart(text)
	if (!chart) return null

	const sizes = new Map(chart.nodes.map((node) => [node.id, sizeFor(editor, node.label, node.shape)]))
	const placed = layOut(chart, sizes)
	const centre = point ?? editor.getViewportPageCenter()
	const ids = new Map(chart.nodes.map((node) => [node.id, createShapeId()]))

	editor.mark('paste')
	editor.createShapes<TLGeoShape>(
		chart.nodes.map((node) => {
			const { w, h } = sizes.get(node.id)!
			const { x, y } = placed.get(node.id)!
			return {
				id: ids.get(node.id)!,
				type: 'geo',
				x: centre.x + x - w / 2,
				y: centre.y + y - h / 2,
				props: { geo: GEO[node.shape], w, h, richText: toRichText(node.label) },
			}
		})
	)

	const arrows = chart.edges
		.filter((edge) => edge.line !== 'invisible' && edge.from !== edge.to)
		.map((edge): TLShapePartial<TLArrowShape> & { id: TLShapeId } => {
			const end = (shapeId: TLShapeId): TLArrowShapeTerminal => ({
				type: 'binding',
				boundShapeId: shapeId,
				normalizedAnchor: { x: 0.5, y: 0.5 },
				isPrecise: false,
				isExact: false,
			})
			return {
				id: createShapeId(),
				type: 'arrow',
				x: 0,
				y: 0,
				props: {
					// 2023-style ends; creating the arrow turns them into bindings.
					start: end(ids.get(edge.from)!),
					end: end(ids.get(edge.to)!),
					richText: toRichText(edge.label),
					arrowheadStart: HEADS[edge.head.start],
					arrowheadEnd: HEADS[edge.head.end],
					dash: edge.line === 'dotted' ? 'dotted' : 'draw',
					size: edge.line === 'thick' ? 'l' : 'm',
				},
			}
		})
	if (arrows.length) editor.createShapes<TLArrowShape>(arrows)

	const all = [...ids.values(), ...arrows.map((arrow) => arrow.id)]
	editor.select(...all)
	return all
}

const GEO: Record<FlowNodeShape, TLGeoShape['props']['geo']> = {
	rectangle: 'rectangle',
	rounded: 'rectangle',
	stadium: 'oval',
	subroutine: 'rectangle',
	cylinder: 'rectangle',
	circle: 'ellipse',
	diamond: 'diamond',
	hexagon: 'hexagon',
	parallelogram: 'rhombus',
	trapezoid: 'trapezoid',
	flag: 'rectangle',
}

const HEADS: Record<FlowHead, TLArrowShapeArrowheadStyle> = {
	none: 'none',
	arrow: 'arrow',
	dot: 'dot',
	cross: 'bar',
}

/** Room between layers, and between nodes in one, in page units. */
const LAYER_GAP = 90
const NODE_GAP = 50

/** How much bigger a shape is than its label's box, where the label sits inside a slanted outline. */
const ROOMIER: Partial<Record<FlowNodeShape, number>> = {
	diamond: 1.5,
	circle: 1.25,
	hexagon: 1.2,
	parallelogram: 1.2,
	trapezoid: 1.2,
}

/** A node's size: its label on one line if it fits, wrapped if it's long; never smaller than a box. */
function sizeFor(editor: Editor, label: string, shape: FlowNodeShape) {
	const measure = (maxWidth: number | null) =>
		editor.textMeasure.measureText(label, {
			...TEXT_PROPS,
			fontFamily: FONT_FAMILIES.draw,
			fontSize: LABEL_FONT_SIZES.m,
			maxWidth,
		})
	let text = measure(null)
	if (text.w > 240) text = measure(240)
	const roomier = ROOMIER[shape] ?? 1
	return {
		w: Math.max(140, Math.ceil((text.w + 48) * roomier)),
		h: Math.max(76, Math.ceil((text.h + 40) * roomier)),
	}
}

/** Where each node's centre goes, relative to the chart's own centre. */
function layOut(chart: Flowchart, sizes: Map<string, { w: number; h: number }>) {
	const order = chart.nodes.map((node) => node.id)
	const forward = forwardEdges(chart, order)

	// Layers: one past the furthest node leading here.
	const layer = new Map(order.map((id) => [id, 0]))
	for (let pass = 0; pass < order.length; pass++) {
		let changed = false
		for (const { from, to } of forward) {
			if (layer.get(to)! < layer.get(from)! + 1) {
				layer.set(to, layer.get(from)! + 1)
				changed = true
			}
		}
		if (!changed) break
	}
	const layers: string[][] = []
	for (const id of order) (layers[layer.get(id)!] ??= []).push(id)

	// Within a layer, near what leads to each node: by the average place of those, in two sweeps.
	const across = chart.direction === 'TB' || chart.direction === 'BT' ? 'w' : 'h'
	const along = across === 'w' ? 'h' : 'w'
	const centres = new Map<string, number>()
	const place = (ids: string[]) => {
		const total = ids.reduce((sum, id) => sum + sizes.get(id)![across], 0) + NODE_GAP * (ids.length - 1)
		let at = -total / 2
		for (const id of ids) {
			const size = sizes.get(id)![across]
			centres.set(id, at + size / 2)
			at += size + NODE_GAP
		}
	}
	layers.forEach(place)
	for (let sweep = 0; sweep < 2; sweep++) {
		for (const ids of layers.slice(1)) {
			const wanted = (id: string) => {
				const from = forward.filter((edge) => edge.to === id).map((edge) => centres.get(edge.from)!)
				return from.length ? from.reduce((a, b) => a + b, 0) / from.length : centres.get(id)!
			}
			const keys = new Map(ids.map((id) => [id, wanted(id)]))
			ids.sort((a, b) => keys.get(a)! - keys.get(b)!)
			place(ids)
		}
	}

	// Layers one after another along the direction, each as deep as its deepest node.
	const depths = layers.map((ids) => Math.max(...ids.map((id) => sizes.get(id)![along])))
	const length = depths.reduce((a, b) => a + b, 0) + LAYER_GAP * (layers.length - 1)
	const flip = chart.direction === 'BT' || chart.direction === 'RL' ? -1 : 1
	const placed = new Map<string, { x: number; y: number }>()
	let at = -length / 2
	layers.forEach((ids, i) => {
		const middle = (at + depths[i]! / 2) * flip
		for (const id of ids) {
			const cross = centres.get(id)!
			placed.set(id, across === 'w' ? { x: cross, y: middle } : { x: middle, y: cross })
		}
		at += depths[i]! + LAYER_GAP
	})
	return placed
}

/** The edges that lead forward: a depth-first walk in the order nodes appear drops the ones back. */
function forwardEdges(chart: Flowchart, order: string[]) {
	const out = new Map(order.map((id) => [id, chart.edges.filter((edge) => edge.from === id && edge.to !== id)]))
	const state = new Map<string, 'open' | 'done'>()
	const forward: { from: string; to: string }[] = []
	const visit = (id: string) => {
		state.set(id, 'open')
		for (const edge of out.get(id)!) {
			const next = state.get(edge.to)
			if (next === 'open') continue // back to something still being walked: a loop
			forward.push(edge)
			if (!next) visit(edge.to)
		}
		state.set(id, 'done')
	}
	for (const id of order) if (!state.has(id)) visit(id)
	return forward
}
