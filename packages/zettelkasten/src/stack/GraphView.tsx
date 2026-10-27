import { atom, stopEventPropagation, useEditor, useValue, type Editor } from '@lifeboard/canvas'
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { boxOrder, INDEX_ZID, isCard, isSource, shapeByZid } from '../box'
import { CardFace } from '../card/CardFace'
import { sourceLabel } from '../card/Foot'
import { SourceFace } from '../card/SourceFace'
import { nameOf } from '../card/text'
import { buildGraph, DEFAULT_LAYERS, type GraphEdgeKind, type GraphLayers, type GraphNode, type GraphNote } from '../graph'
import { tableLayout } from '../layout'
import { outgoingLinks } from '../links'
import { getStack, setGraphOpen, showCard } from './state'
import { onScreen, typingIn } from './surface'

/** Which layers are shown: a way of looking, kept for the session and for every box, not board data. */
const layersAtom = atom<GraphLayers>('lifeboard:zettel-graph-layers', DEFAULT_LAYERS)

/** The editor counts this as an open menu while the graph is up, as it does for the stack. */
const GRAPH_MENU = 'lifeboard.zettelkasten.graph'

/** Past this zoom every dot is labelled; below it only the one pointed at and its neighbours. */
const LABEL_ZOOM = 1.6
const MIN_ZOOM = 0.08
const MAX_ZOOM = 6
/** The table's positions, shrunk, are where each dot starts: so the graph opens the same way each time. */
const SEED_SCALE = 0.12
/** How far a press may move and still be a click. */
const CLICK_SLOP = 4

type SimNode = GraphNode & SimulationNodeDatum
type SimEdge = SimulationLinkDatum<SimNode> & { kind: GraphEdgeKind }

interface Camera {
	x: number
	y: number
	k: number
}

/** The board's own colours, read from the theme each frame. */
interface Palette {
	ink: string
	dim: string
	faint: string
	accent: string
	dot: string
	keyword: string
	cite: string
	font: string
}

function readPalette(element: HTMLElement): Palette {
	const style = getComputedStyle(element)
	const css = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
	return {
		ink: css('--lb-text', '#ddd'),
		dim: css('--lb-text-dim', '#999'),
		faint: css('--lb-text-faint', '#666'),
		accent: css('--lb-accent', '#4a7dff'),
		dot: css('--lb-dot', '#444'),
		keyword: 'hsl(152 42% 45%)',
		cite: 'hsl(28 58% 52%)',
		font: css('--lb-font', 'system-ui, sans-serif'),
	}
}

/** What the box is, as the graph wants it: its notes with their ties, and its sources. */
function readBox(editor: Editor): { notes: GraphNote[]; sources: { zid: string; label: string }[]; order: string[] } {
	const notes: GraphNote[] = []
	const sources: { zid: string; label: string }[] = []
	const order: string[] = []
	for (const entry of boxOrder(editor)) {
		if (!entry.id) continue
		order.push(entry.zid)
		const shape = editor.getShape(entry.id)
		if (isCard(shape)) {
			const { zid, richText, links = [], keywords = [], cites = [] } = shape.props
			notes.push({ zid, name: nameOf(richText), links: outgoingLinks({ zid, richText, links, keywords, cites }), keywords, cites })
		} else if (isSource(shape)) {
			sources.push({ zid: shape.props.zid, label: sourceLabel(shape.props.author, shape.props.title, shape.props.year) })
		}
	}
	return { notes, sources, order }
}

/** Goes where a dot stands for: a note or a source in the stack, a keyword on the index. */
function openNode(editor: Editor, node: GraphNode): void {
	if (node.kind === 'keyword') showCard(editor, INDEX_ZID, node.key)
	else showCard(editor, node.key)
}

/** Draws the box as a graph over the stack or the table while asked to (`StackState.graph`). */
export function GraphView() {
	const editor = useEditor()
	const open = useValue('lifeboard:zettel-graph-open', () => getStack(editor).graph, [editor])
	if (!open) return null
	return createPortal(<Graph editor={editor} />, editor.getContainer())
}

/**
 * The box as a graph (docs/zettelkasten-plan.md, "Graph"; the model is graph.ts): a dot per note, a
 * solid line to the note each was written behind, a dashed one for each link. Laid out by a force
 * simulation (d3-force, loaded the first time the graph opens) that settles in about a second, from
 * the table's positions so it opens the same way each time. Drawn on a 2D canvas, with its own pan and
 * zoom, so a box of thousands of notes stays cheap.
 *
 * Pointing at a dot lights it and its neighbours and names them; clicking opens it in the stack;
 * dragging one moves it, and the rest give way. Space shows the card over the graph.
 */
function Graph({ editor }: { editor: Editor }) {
	const layers = useValue('lifeboard:zettel-graph-layers', () => layersAtom.get(), [])
	const box = useValue('lifeboard:zettel-graph-box', () => readBox(editor), [editor])
	const dark = useValue('lifeboard:zettel-graph-dark', () => editor.user.getIsDarkMode(), [editor])
	const model = useMemo(() => buildGraph(box.notes, box.sources, layers), [box, layers])

	const wrap = useRef<HTMLDivElement>(null)
	const canvas = useRef<HTMLCanvasElement>(null)
	const sim = useRef<{ simulation: Simulation<SimNode, SimEdge>; nodes: SimNode[]; edges: SimEdge[]; byId: Map<string, SimNode> } | null>(null)
	const neighbours = useRef(new Map<string, Set<string>>())
	const camera = useRef<Camera>({ x: 0, y: 0, k: 1 })
	/** Once the person has moved the camera, the graph stops framing itself as it settles. */
	const steered = useRef(false)
	const hover = useRef<string | null>(null)
	const frame = useRef<number | null>(null)
	const [peek, setPeek] = useState<string | null>(null)
	const [hovered, setHovered] = useState<string | null>(null)
	const [empty, setEmpty] = useState(false)

	const fit = () => {
		const nodes = sim.current?.nodes
		const element = canvas.current
		if (!nodes?.length || !element) return
		let minX = Infinity
		let minY = Infinity
		let maxX = -Infinity
		let maxY = -Infinity
		for (const node of nodes) {
			minX = Math.min(minX, node.x ?? 0)
			maxX = Math.max(maxX, node.x ?? 0)
			minY = Math.min(minY, node.y ?? 0)
			maxY = Math.max(maxY, node.y ?? 0)
		}
		const w = element.clientWidth
		const h = element.clientHeight
		// Room round the edge for the labels, the bar above and the dock below; less on a small screen.
		const padX = Math.min(160, w * 0.12)
		const padY = Math.min(240, h * 0.26)
		const k = Math.max(MIN_ZOOM, Math.min(2.5, (w - padX) / Math.max(1, maxX - minX), (h - padY) / Math.max(1, maxY - minY)))
		camera.current = { k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - 10 - ((minY + maxY) / 2) * k }
	}

	const draw = () => {
		const element = canvas.current
		const state = sim.current
		if (!element || !state) return
		const ctx = element.getContext('2d')
		if (!ctx) return
		const dpr = window.devicePixelRatio || 1
		const w = element.clientWidth
		const h = element.clientHeight
		if (element.width !== Math.round(w * dpr) || element.height !== Math.round(h * dpr)) {
			element.width = Math.round(w * dpr)
			element.height = Math.round(h * dpr)
		}
		const colors = readPalette(element)
		const { x: cx, y: cy, k } = camera.current
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
		ctx.clearRect(0, 0, w, h)

		// The board's dotted paper, moving with the camera as the board's does.
		let step = 24
		while (step * k < 14) step *= 2
		while (step * k > 40) step /= 2
		const screenStep = step * k
		ctx.fillStyle = colors.dot
		for (let sx = ((cx % screenStep) + screenStep) % screenStep; sx < w; sx += screenStep) {
			for (let sy = ((cy % screenStep) + screenStep) % screenStep; sy < h; sy += screenStep) {
				ctx.fillRect(sx - 0.5, sy - 0.5, 1.2, 1.2)
			}
		}

		const lit = hover.current
		const near = lit ? neighbours.current.get(lit) : undefined
		const isLit = (id: string) => !lit || id === lit || near?.has(id) === true
		const screen = (node: SimNode) => [(node.x ?? 0) * k + cx, (node.y ?? 0) * k + cy] as const

		// Lines, a kind at a time, in screen space so they stay a pixel wide at any zoom.
		const style: Record<GraphEdgeKind, { color: string; dash: number[]; width: number }> = {
			order: { color: colors.faint, dash: [], width: 1.2 },
			link: { color: colors.accent, dash: [5, 4], width: 1.2 },
			keyword: { color: colors.keyword, dash: [2, 3], width: 1 },
			cite: { color: colors.cite, dash: [2, 3], width: 1 },
		}
		for (const kind of ['order', 'keyword', 'cite', 'link'] as GraphEdgeKind[]) {
			for (const pass of lit ? ['dim', 'lit'] : ['all']) {
				ctx.beginPath()
				let any = false
				for (const edge of state.edges) {
					if (edge.kind !== kind) continue
					const a = edge.source as SimNode
					const b = edge.target as SimNode
					const touches = lit !== null && (a.id === lit || b.id === lit)
					if ((pass === 'dim' && touches) || (pass === 'lit' && !touches)) continue
					const [ax, ay] = screen(a)
					const [bx, by] = screen(b)
					ctx.moveTo(ax, ay)
					ctx.lineTo(bx, by)
					any = true
				}
				if (!any) continue
				const s = style[kind]
				ctx.globalAlpha = pass === 'dim' ? 0.18 : pass === 'lit' ? 1 : kind === 'order' ? 0.9 : 0.7
				ctx.strokeStyle = s.color
				ctx.lineWidth = pass === 'lit' ? s.width + 0.8 : s.width
				ctx.setLineDash(s.dash)
				ctx.stroke()
			}
		}
		ctx.setLineDash([])
		ctx.globalAlpha = 1

		// Dots, then names: every one when close enough to read, else only what is pointed at.
		const radius = (node: SimNode) => Math.max(2.5, Math.min(9, (node.head ? 5.5 : 4) * Math.sqrt(k)))
		for (const node of state.nodes) {
			const [x, y] = screen(node)
			if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue
			ctx.globalAlpha = isLit(node.id) ? 1 : 0.22
			ctx.fillStyle = node.kind === 'keyword' ? colors.keyword : node.kind === 'source' ? colors.cite : colors.ink
			ctx.beginPath()
			const r = radius(node)
			if (node.kind === 'keyword') ctx.rect(x - r, y - r, r * 2, r * 2)
			else ctx.arc(x, y, r, 0, Math.PI * 2)
			ctx.fill()
			if (node.id === lit) {
				ctx.strokeStyle = colors.accent
				ctx.lineWidth = 2
				ctx.beginPath()
				ctx.arc(x, y, r + 3.5, 0, Math.PI * 2)
				ctx.stroke()
			}
		}
		ctx.font = `12px ${colors.font}`
		ctx.textBaseline = 'middle'
		for (const node of state.nodes) {
			const named = k >= LABEL_ZOOM ? isLit(node.id) : lit !== null && isLit(node.id)
			if (!named) continue
			const [x, y] = screen(node)
			if (x < -200 || y < -20 || x > w + 20 || y > h + 20) continue
			const text = node.label.length > 42 ? `${node.label.slice(0, 41)}…` : node.label
			ctx.globalAlpha = 1
			ctx.fillStyle = node.id === lit ? colors.ink : colors.dim
			ctx.fillText(text, x + radius(node) + 5, y)
		}
		ctx.globalAlpha = 1
	}

	/** Draws on the next frame; while the layout is settling, ticks it first, and frames it unless steered. */
	const request = () => {
		if (frame.current !== null) return
		frame.current = requestAnimationFrame(() => {
			frame.current = null
			const state = sim.current
			if (!state) return
			const { simulation } = state
			const moving = simulation.alpha() > simulation.alphaMin()
			if (moving) {
				simulation.tick(2)
				if (!steered.current) fit()
			}
			draw()
			if (moving) request()
		})
	}

	// The layout: rebuilt when the box or the layers change, keeping where each dot already was.
	useEffect(() => {
		let cancelled = false
		const before = sim.current?.byId
		const seeds = tableLayout(box.order)
		const nodes: SimNode[] = model.nodes.map((node) => {
			const old = before?.get(node.id)
			const seed = seeds.get(node.key)
			return { ...node, x: old?.x ?? (seed ? seed.x * SEED_SCALE : undefined), y: old?.y ?? (seed ? seed.y * SEED_SCALE : undefined) }
		})
		const edges: SimEdge[] = model.edges.map((edge) => ({ ...edge }))
		const map = new Map<string, Set<string>>()
		for (const edge of model.edges) {
			if (!map.has(edge.source)) map.set(edge.source, new Set())
			if (!map.has(edge.target)) map.set(edge.target, new Set())
			map.get(edge.source)!.add(edge.target)
			map.get(edge.target)!.add(edge.source)
		}
		neighbours.current = map
		setEmpty(nodes.length === 0)
		void import('d3-force').then((d3) => {
			if (cancelled) return
			sim.current?.simulation.stop()
			const simulation = d3
				.forceSimulation(nodes)
				.force(
					'link',
					d3
						.forceLink<SimNode, SimEdge>(edges)
						.id((node) => node.id)
						.distance((edge) => (edge.kind === 'order' ? 28 : 70))
						.strength((edge) => (edge.kind === 'order' ? 0.8 : 0.12))
				)
				.force('charge', d3.forceManyBody<SimNode>().strength(-80).distanceMax(500))
				.force('x', d3.forceX<SimNode>(0).strength(0.02))
				.force('y', d3.forceY<SimNode>(0).strength(0.02))
				.force('collide', d3.forceCollide<SimNode>(8))
				.alpha(before ? 0.4 : 1)
				// About sixty frames at two ticks each: settled in about a second.
				.alphaDecay(0.055)
				.stop()
			sim.current = { simulation, nodes, edges, byId: new Map(nodes.map((node) => [node.id, node])) }
			request()
		})
		return () => {
			cancelled = true
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [model, box.order])

	// A new theme is a new set of colours.
	useEffect(() => request(), [dark])

	useEffect(() => {
		const element = wrap.current
		if (!element) return
		const observer = new ResizeObserver(() => {
			if (!steered.current) fit()
			request()
		})
		observer.observe(element)
		return () => observer.disconnect()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	useEffect(
		() => () => {
			sim.current?.simulation.stop()
			// Cleared as well as cancelled: a frame still marked as asked for would turn every later
			// request away, and React may run this and then mount the graph again.
			if (frame.current !== null) cancelAnimationFrame(frame.current)
			frame.current = null
		},
		[]
	)

	const nodeAt = (sx: number, sy: number): SimNode | null => {
		const state = sim.current
		if (!state) return null
		const { x: cx, y: cy, k } = camera.current
		let best: SimNode | null = null
		let bestDistance = 14 * 14
		for (const node of state.nodes) {
			const dx = (node.x ?? 0) * k + cx - sx
			const dy = (node.y ?? 0) * k + cy - sy
			const distance = dx * dx + dy * dy
			if (distance < bestDistance) {
				best = node
				bestDistance = distance
			}
		}
		return best
	}

	const setHover = (id: string | null) => {
		if (hover.current === id) return
		hover.current = id
		setHovered(id)
		request()
	}

	const zoomAt = (sx: number, sy: number, factor: number) => {
		const cam = camera.current
		const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.k * factor))
		camera.current = { k, x: sx - ((sx - cam.x) / cam.k) * k, y: sy - ((sy - cam.y) / cam.k) * k }
		steered.current = true
		request()
	}

	// The wheel zooms at the pointer: the graph has nothing to scroll. Listened to directly, since React's
	// wheel listener can't stop the page from taking it.
	useEffect(() => {
		const element = canvas.current
		if (!element) return
		const onWheel = (event: WheelEvent) => {
			event.preventDefault()
			event.stopPropagation()
			const rect = element.getBoundingClientRect()
			const delta = event.deltaMode === 1 ? event.deltaY * 40 : event.deltaY
			zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015)))
		}
		element.addEventListener('wheel', onWheel, { passive: false })
		return () => element.removeEventListener('wheel', onWheel)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	// Pointers: a press on empty paper pans, on a dot drags it (or opens it, if it doesn't move), and two
	// fingers pinch.
	const pointers = useRef(new Map<number, { x: number; y: number }>())
	const gesture = useRef<
		| { kind: 'press'; id: number; x: number; y: number; node: SimNode | null; moved: boolean; cam: Camera }
		| { kind: 'pinch'; distance: number; cam: Camera; mid: { x: number; y: number } }
		| null
	>(null)
	const local = (event: { clientX: number; clientY: number }) => {
		const rect = canvas.current!.getBoundingClientRect()
		return { x: event.clientX - rect.left, y: event.clientY - rect.top }
	}

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		stopEventPropagation(event)
		event.currentTarget.setPointerCapture(event.pointerId)
		const at = local(event)
		pointers.current.set(event.pointerId, at)
		if (pointers.current.size === 2) {
			const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }]
			gesture.current = {
				kind: 'pinch',
				distance: Math.hypot(a.x - b.x, a.y - b.y),
				cam: { ...camera.current },
				mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
			}
			return
		}
		gesture.current = { kind: 'press', id: event.pointerId, x: at.x, y: at.y, node: nodeAt(at.x, at.y), moved: false, cam: { ...camera.current } }
	}

	const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const at = local(event)
		if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, at)
		const g = gesture.current
		if (!g) {
			if (event.pointerType === 'mouse') setHover(nodeAt(at.x, at.y)?.id ?? null)
			return
		}
		if (g.kind === 'pinch') {
			if (pointers.current.size < 2) return
			const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }]
			const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, g.cam.k * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, g.distance))))
			const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
			camera.current = { k, x: mid.x - ((g.mid.x - g.cam.x) / g.cam.k) * k, y: mid.y - ((g.mid.y - g.cam.y) / g.cam.k) * k }
			steered.current = true
			request()
			return
		}
		if (g.id !== event.pointerId) return
		if (!g.moved && Math.hypot(at.x - g.x, at.y - g.y) < CLICK_SLOP) return
		g.moved = true
		const state = sim.current
		if (g.node && state) {
			// Dragging a dot: it follows the pointer, and the layout wakes up to make room.
			const cam = camera.current
			g.node.fx = (at.x - cam.x) / cam.k
			g.node.fy = (at.y - cam.y) / cam.k
			state.simulation.alphaTarget(0.25)
			if (state.simulation.alpha() < 0.25) state.simulation.alpha(0.25)
			steered.current = true
			setHover(g.node.id)
		} else {
			camera.current = { ...g.cam, x: g.cam.x + at.x - g.x, y: g.cam.y + at.y - g.y }
			steered.current = true
		}
		request()
	}

	const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		pointers.current.delete(event.pointerId)
		const g = gesture.current
		if (g?.kind === 'pinch') {
			if (pointers.current.size === 0) gesture.current = null
			return
		}
		gesture.current = null
		if (!g || g.id !== event.pointerId) return
		const state = sim.current
		if (g.node && g.moved && state) {
			g.node.fx = null
			g.node.fy = null
			state.simulation.alphaTarget(0)
			request()
			return
		}
		if (g.node && !g.moved) openNode(editor, g.node)
	}

	// The graph's keys: Escape lets go of the card shown or leaves; Space shows the card pointed at; 0
	// frames the whole box; + and − zoom.
	useEffect(() => {
		editor.addOpenMenu(GRAPH_MENU)
		const container = editor.getContainer()
		container.classList.add('lb-zstack-open')
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.isComposing || !onScreen(editor) || typingIn(event.target)) return
			if (event.metaKey || event.ctrlKey || event.altKey) return
			// Enter and Space on a focused button (a layer, or a note in the list) are the button's.
			const onButton = event.target instanceof HTMLElement && event.target.closest('button') !== null
			if (onButton && (event.key === 'Enter' || event.key === ' ')) return
			const element = canvas.current
			let handled = true
			switch (event.key) {
				case 'Escape':
					if (peekRef.current) setPeek(null)
					else setGraphOpen(editor, false)
					break
				case ' ':
					setPeek((current) => (current ? null : hover.current))
					break
				case 'Enter': {
					const node = hover.current ? sim.current?.byId.get(hover.current) : undefined
					if (node) openNode(editor, node)
					break
				}
				case 'g':
					setGraphOpen(editor, false)
					break
				case '0':
					steered.current = false
					fit()
					request()
					break
				case '+':
				case '=':
					if (element) zoomAt(element.clientWidth / 2, element.clientHeight / 2, 1.25)
					break
				case '-':
					if (element) zoomAt(element.clientWidth / 2, element.clientHeight / 2, 0.8)
					break
				default:
					handled = false
			}
			if (handled) {
				event.preventDefault()
				event.stopPropagation()
			}
		}
		window.addEventListener('keydown', onKeyDown, { capture: true })
		return () => {
			window.removeEventListener('keydown', onKeyDown, { capture: true })
			editor.deleteOpenMenu(GRAPH_MENU)
			container.classList.remove('lb-zstack-open')
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor])
	const peekRef = useRef(peek)
	peekRef.current = peek

	const peekNode = peek ? sim.current?.byId.get(peek) : undefined
	const peekShape = peekNode && peekNode.kind !== 'keyword' ? shapeByZid(editor, peekNode.key) : undefined
	const hoveredNode = hovered ? sim.current?.byId.get(hovered) : undefined

	return (
		<div className="lb-zgraph" ref={wrap} onWheel={stopEventPropagation} onContextMenu={stopEventPropagation}>
			<canvas
				ref={canvas}
				className={hovered ? 'lb-zgraph__canvas lb-zgraph__canvas--on' : 'lb-zgraph__canvas'}
				role="img"
				aria-label={`A graph of this box's ${box.notes.length} notes`}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onPointerLeave={(event) => {
					if (event.pointerType === 'mouse' && !gesture.current) setHover(null)
				}}
			/>
			<div className="lb-zgraph__bar" role="toolbar" aria-label="What the graph shows" onPointerDown={stopEventPropagation}>
				{(
					[
						['order', 'Order', 'lb-zgraph__key--order'],
						['links', 'Links', 'lb-zgraph__key--links'],
						['keywords', 'Keywords', 'lb-zgraph__key--keywords'],
						['sources', 'Sources', 'lb-zgraph__key--sources'],
					] as [keyof GraphLayers, string, string][]
				).map(([layer, label, key]) => (
					<button
						key={layer}
						type="button"
						className="lb-zgraph__layer"
						aria-pressed={layers[layer]}
						onClick={() => layersAtom.set({ ...layersAtom.get(), [layer]: !layersAtom.get()[layer] })}
					>
						<span className={`lb-zgraph__key ${key}`} aria-hidden="true" />
						{label}
					</button>
				))}
				<button type="button" className="lb-zgraph__close" aria-label="Leave the graph (Esc)" title="Leave the graph (Esc)" onClick={() => setGraphOpen(editor, false)}>
					<X aria-hidden="true" />
				</button>
			</div>
			{empty && <p className="lb-zgraph__empty">No notes yet. The graph draws itself as you write them.</p>}
			{hoveredNode && !peek && (
				<p className="lb-zgraph__hint" aria-hidden="true">
					Click to open {hoveredNode.kind === 'keyword' ? 'the index' : hoveredNode.key} · Space to look at it
				</p>
			)}
			{peekNode && (
				<div className="lb-zgraph__peek" onPointerDown={stopEventPropagation}>
					{isCard(peekShape) ? (
						<CardFace shape={peekShape} live={false} />
					) : isSource(peekShape) ? (
						<SourceFace shape={peekShape} />
					) : (
						<p className="lb-zgraph__peekword">{peekNode.label}</p>
					)}
				</div>
			)}
			{/* The graph for a screen reader or the keyboard: every dot as a button. */}
			<ul className="lb-zgraph__list" aria-label="Notes in the graph">
				{model.nodes.map((node) => (
					<li key={node.id}>
						<button type="button" onClick={() => openNode(editor, node)}>
							{node.label}
						</button>
					</li>
				))}
			</ul>
		</div>
	)
}
