import {
	RELATION_VIEW_LABELS,
	RELATION_VIEW_NOTES,
	nextRelationView,
	readRelationView,
	setRelationView,
} from '@lifeboard/node-kit'
import {
	Circle,
	Diamond,
	Eraser,
	Frame,
	Hand,
	Hexagon,
	Highlighter,
	Image,
	MousePointer2,
	Pen,
	Shapes,
	Spline,
	Square,
	Radar,
	StickyNote,
	Triangle,
	Type,
	Waypoints,
	type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import {
	DefaultColorStyle,
	DefaultSizeStyle,
	GeoShapeGeoStyle,
	getColorValue,
	useEditor,
	useTools,
	useValue,
	type Editor,
	type StyleProp,
} from 'tldraw'
import { NodeMenuButton } from './NodeMenu'
import { getNextFillColor, setNextFillColor } from './shapeFill'
import { isTracing, toggleTracing } from './tracing'

/**
 * The bottom dock — replaces tldraw's toolbar with an Affine-style one.
 *
 * Four groups, and the grouping is the argument:
 *
 * 1. **Getting around and around things** — select, hand, frame, relation. Nothing here makes a mark.
 * 2. **Making marks** — sticky, pen, eraser, shapes, text, image. tldraw's own drawing surface.
 * 3. **Looking** — the relation view and the tracing lens. They change what the board *shows*, never
 *    what the next click does, which is why they are not tools and not next to any.
 * 4. **Nodes** — one button that opens the searchable picker (`NodeMenu.tsx`).
 *
 * The node types used to be a fifth group of their own, one button each in registry order. They are
 * behind the picker now: the list is open-ended — an extension adds to it — and a dock that grows a
 * button per installed extension is a dock with no fixed shape. See NodeMenu.tsx for the rest of that
 * reasoning; the registry-driven rule is unchanged, it just renders somewhere with room.
 *
 * Rendering our own component in the `Toolbar` slot changes *presentation only*: tool keyboard
 * shortcuts (1–9 by dock position, `d` for draw, `t` for text, and the node tools' letters) are
 * registered by tldraw from the tools map, not by the toolbar that happens to render the buttons,
 * so they all keep working — including for tools this dock doesn't show.
 *
 * When the active tool draws something styleable (pen, shapes, text, arrow), a second row expands
 * above the dock with that tool's settings, mapped onto tldraw's style props so they apply to the
 * next shapes drawn.
 *
 * Icons are lucide throughout — the one icon set the whole app chrome uses.
 */

type ColorValue = (typeof DefaultColorStyle)['defaultValue']
type SizeValue = (typeof DefaultSizeStyle)['defaultValue']
type GeoValue = (typeof GeoShapeGeoStyle)['defaultValue']

/**
 * Swatch colours come from tldraw's own theme rather than being hardcoded here, so each one is exactly
 * what the shape will be drawn in — in either theme. That matters most at the ends of the row: `black`
 * renders near-white on a dark canvas and near-black on a light one, so a fixed hex is wrong half the
 * time.
 */
const COLORS: ColorValue[] = [
	'red',
	'orange',
	'yellow',
	'green',
	'light-blue',
	'blue',
	'violet',
	'light-violet',
	'grey',
	'black',
]

const SIZES: { value: SizeValue; dot: number }[] = [
	{ value: 's', dot: 4 },
	{ value: 'm', dot: 6 },
	{ value: 'l', dot: 9 },
	{ value: 'xl', dot: 12 },
]

const GEO_KINDS: { value: GeoValue; icon: LucideIcon }[] = [
	{ value: 'rectangle', icon: Square },
	{ value: 'ellipse', icon: Circle },
	{ value: 'diamond', icon: Diamond },
	{ value: 'triangle', icon: Triangle },
	{ value: 'hexagon', icon: Hexagon },
]

const ICON_SIZE = 19

/** "v,1" → "V · 1", for tooltips. */
function formatKbd(kbd?: string): string {
	if (!kbd) return ''
	return kbd
		.split(',')
		.map((k) => k.replace('$', '⌘').toUpperCase())
		.join(' · ')
}

function ToolButton({
	toolId,
	icon,
	isActive,
}: {
	toolId: string
	icon: ReactNode
	isActive: boolean
}) {
	const tools = useTools()
	const tool = tools[toolId]
	if (!tool) return null
	const kbd = formatKbd(tool.kbd)
	return (
		<button
			className={isActive ? 'lb-dock__tool lb-dock__tool--active' : 'lb-dock__tool'}
			// Same testid scheme as tldraw's own toolbar, which the e2e suite already targets.
			data-testid={`tools.${toolId}`}
			// Keep focus on the canvas so keyboard shortcuts keep flowing to the editor.
			onPointerDown={(e) => e.preventDefault()}
			onClick={() => tool.onSelect('toolbar')}
			title={kbd ? `${tool.label} (${kbd})` : String(tool.label)}
			aria-label={String(tool.label)}
			aria-pressed={isActive}
		>
			{icon}
		</button>
	)
}

function setStyle<T>(editor: Editor, style: StyleProp<T>, value: T) {
	editor.run(() => {
		editor.setStyleForSelectedShapes(style, value)
		editor.setStyleForNextShapes(style, value)
	})
}

function ColorSwatches() {
	const editor = useEditor()
	const current = useValue(
		'lb:next-color',
		() => editor.getStyleForNextShape(DefaultColorStyle),
		[editor]
	)
	// Tracked through `useValue` so the row repaints when the theme changes under it — `getColorMode()`
	// follows the user's colour-scheme preference, which app/useTheme.ts drives.
	const colors = useValue(
		'lb:theme-colors',
		() => editor.getCurrentTheme().colors[editor.getColorMode()],
		[editor]
	)
	return (
		<div className="lb-expand__group" role="group" aria-label="Colour">
			{COLORS.map((value) => (
				<button
					key={value}
					className={
						current === value ? 'lb-expand__swatch lb-expand__swatch--active' : 'lb-expand__swatch'
					}
					style={{ backgroundColor: getColorValue(colors, value, 'solid') }}
					onPointerDown={(e) => e.preventDefault()}
					onClick={() => setStyle(editor, DefaultColorStyle, value)}
					title={value}
					aria-label={`Colour ${value}`}
				/>
			))}
		</div>
	)
}

function SizeDots() {
	const editor = useEditor()
	const current = useValue(
		'lb:next-size',
		() => editor.getStyleForNextShape(DefaultSizeStyle),
		[editor]
	)
	return (
		<div className="lb-expand__group" role="group" aria-label="Stroke size">
			{SIZES.map(({ value, dot }) => (
				<button
					key={value}
					className={current === value ? 'lb-expand__size lb-expand__size--active' : 'lb-expand__size'}
					onPointerDown={(e) => e.preventDefault()}
					onClick={() => setStyle(editor, DefaultSizeStyle, value)}
					title={`Size ${value.toUpperCase()}`}
					aria-label={`Size ${value.toUpperCase()}`}
				>
					<span className="lb-expand__dot" style={{ width: dot, height: dot }} />
				</button>
			))}
		</div>
	)
}

/** Pen ↔ highlighter pair, plus stroke size and colour — the Affine pen expansion. */
function PenSettings({ currentToolId }: { currentToolId: string }) {
	const editor = useEditor()
	return (
		<div className="lb-expand">
			<div className="lb-expand__group" role="group" aria-label="Pen kind">
				<button
					className={
						currentToolId === 'draw' ? 'lb-dock__tool lb-dock__tool--active' : 'lb-dock__tool'
					}
					onPointerDown={(e) => e.preventDefault()}
					onClick={() => editor.setCurrentTool('draw')}
					title="Pen"
					aria-label="Pen"
				>
					<Pen size={ICON_SIZE} aria-hidden="true" />
				</button>
				<button
					className={
						currentToolId === 'highlight' ? 'lb-dock__tool lb-dock__tool--active' : 'lb-dock__tool'
					}
					onPointerDown={(e) => e.preventDefault()}
					onClick={() => editor.setCurrentTool('highlight')}
					title="Highlighter"
					aria-label="Highlighter"
				>
					<Highlighter size={ICON_SIZE} aria-hidden="true" />
				</button>
			</div>
			<div className="lb-expand__sep" />
			<SizeDots />
			<div className="lb-expand__sep" />
			<ColorSwatches />
		</div>
	)
}

/**
 * The fill colour for the next shape, transparent included.
 *
 * A second row of the *same* swatches as the border, plus a "no fill" chip at the front — because
 * "which colour" is the same question in both places, and answering it twice with two different
 * controls would be the thing that makes people think one of them means something else.
 *
 * Transparent leads because it is the default and the state you come back to. See `shapeFill.ts` for
 * why a fill colour is not simply a style prop.
 */
function FillSwatches() {
	const editor = useEditor()
	const current = useValue('lb:next-fill', () => getNextFillColor(), [])
	const colors = useValue(
		'lb:theme-colors-fill',
		() => editor.getCurrentTheme().colors[editor.getColorMode()],
		[editor]
	)
	return (
		<div className="lb-expand__group" role="group" aria-label="Fill">
			<button
				className={
					current === null
						? 'lb-expand__swatch lb-expand__swatch--none lb-expand__swatch--active'
						: 'lb-expand__swatch lb-expand__swatch--none'
				}
				data-testid="lb.fill-none"
				onPointerDown={(e) => e.preventDefault()}
				onClick={() => setNextFillColor(editor, null)}
				title="No fill"
				aria-label="No fill"
				aria-pressed={current === null}
			/>
			{COLORS.map((value) => (
				<button
					key={value}
					className={
						current === value ? 'lb-expand__swatch lb-expand__swatch--active' : 'lb-expand__swatch'
					}
					// `fill`, not `solid`: the swatch has to be painted in the colour the shape's inside
					// will actually be, and the inside uses the theme's full-strength fill variant.
					style={{ backgroundColor: getColorValue(colors, value, 'fill') }}
					onPointerDown={(e) => e.preventDefault()}
					onClick={() => setNextFillColor(editor, value)}
					title={`Fill ${value}`}
					aria-label={`Fill ${value}`}
					aria-pressed={current === value}
				/>
			))}
		</div>
	)
}

/**
 * Shape kind, border colour and fill colour — the Affine shape expansion, in two rows.
 *
 * Two rows rather than one because a single row of five kinds and twenty-two swatches is wider than
 * the dock it is meant to sit above. Stacked inside one panel rather than as two panels, so it still
 * reads as one thing: the settings for the shape you are about to draw.
 */
function ShapeSettings() {
	const editor = useEditor()
	const currentKind = useValue(
		'lb:next-geo',
		() => editor.getStyleForNextShape(GeoShapeGeoStyle),
		[editor]
	)
	return (
		<div className="lb-expand lb-expand--stack">
			<div className="lb-expand__row">
				<div className="lb-expand__group" role="group" aria-label="Shape">
					{GEO_KINDS.map(({ value, icon: Icon }) => (
						<button
							key={value}
							className={
								currentKind === value ? 'lb-dock__tool lb-dock__tool--active' : 'lb-dock__tool'
							}
							onPointerDown={(e) => e.preventDefault()}
							onClick={() =>
								editor.run(() => {
									editor.setStyleForNextShapes(GeoShapeGeoStyle, value)
									editor.setCurrentTool('geo')
								})
							}
							title={value}
							aria-label={`Shape ${value}`}
						>
							<Icon size={ICON_SIZE} aria-hidden="true" />
						</button>
					))}
				</div>
				<div className="lb-expand__sep" />
				<span className="lb-expand__tag">Border</span>
				<ColorSwatches />
			</div>
			<div className="lb-expand__row">
				<span className="lb-expand__tag">Fill</span>
				<FillSwatches />
			</div>
		</div>
	)
}

/** Text size and colour. */
function TextSettings() {
	const editor = useEditor()
	const current = useValue(
		'lb:next-size',
		() => editor.getStyleForNextShape(DefaultSizeStyle),
		[editor]
	)
	return (
		<div className="lb-expand">
			<div className="lb-expand__group" role="group" aria-label="Text size">
				{SIZES.map(({ value }) => (
					<button
						key={value}
						className={
							current === value ? 'lb-expand__label lb-expand__label--active' : 'lb-expand__label'
						}
						onPointerDown={(e) => e.preventDefault()}
						onClick={() => setStyle(editor, DefaultSizeStyle, value)}
						title={`Size ${value.toUpperCase()}`}
					>
						{value.toUpperCase()}
					</button>
				))}
			</div>
			<div className="lb-expand__sep" />
			<ColorSwatches />
		</div>
	)
}

/**
 * How much of the board's wiring is drawn: none → as set → all, cycling on click.
 *
 * One button rather than three, because it is one dial with a position, and the dock has no room for
 * a segmented control. The glyph stays the same in all three states — it is always "relations" — and
 * the *state* is carried by the dock's own vocabulary: the accent background it already uses for an
 * active tool means "all", and a struck-through glyph means "none". Between them, plain, is the
 * default, which is what a board looks like unless you have said otherwise.
 *
 * A view control rather than a tool, so it sits in its own group after the drawing tools and never
 * changes what the next click on the canvas does.
 */
function RelationViewButton() {
	const editor = useEditor()
	const view = useValue('lb:relation-view', () => readRelationView(editor), [editor])

	return (
		<button
			className={
				view === 'all'
					? 'lb-dock__tool lb-dock__tool--active'
					: view === 'none'
						? 'lb-dock__tool lb-dock__tool--struck'
						: 'lb-dock__tool'
			}
			data-testid="lb.relation-view"
			data-state={view}
			// Keep focus on the canvas, so keyboard shortcuts keep flowing to the editor.
			onPointerDown={(e) => e.preventDefault()}
			onClick={() => setRelationView(editor, nextRelationView(view))}
			title={`${RELATION_VIEW_LABELS[view]} — ${RELATION_VIEW_NOTES[view]}`}
			aria-label={`Relation view: ${RELATION_VIEW_LABELS[view]}`}
		>
			<Waypoints size={ICON_SIZE} aria-hidden="true" />
		</button>
	)
}

/**
 * The tracing lens, on or off.
 *
 * Next to the relation-view button because they are two halves of the same idea — how much wiring you
 * want to see, and which wiring you want to see *now*.
 */
function TracingButton() {
	const tracing = useValue('lb:tracing-on', () => isTracing(), [])
	return (
		<button
			className={tracing ? 'lb-dock__tool lb-dock__tool--active' : 'lb-dock__tool'}
			data-testid="lb.tracing"
			data-state={tracing ? 'on' : 'off'}
			onPointerDown={(e) => e.preventDefault()}
			onClick={() => toggleTracing()}
			title="Trace relations (⌥⇧T) — click a shape to light up what it is connected to"
			aria-label="Trace relations"
			aria-pressed={tracing}
		>
			<Radar size={ICON_SIZE} aria-hidden="true" />
		</button>
	)
}

/**
 * A mode with nothing on screen to say so is a trap, and this one changes what a click does to the
 * board's appearance. The hint sits where the tool settings row sits, so it reads as part of the same
 * chrome rather than as a notification.
 */
function TracingHint() {
	const tracing = useValue('lb:tracing-hint', () => isTracing(), [])
	if (!tracing) return null
	return (
		<div className="lb-trace-hint" role="status">
			<Radar size={14} aria-hidden="true" />
			<span>Tracing — click a shape to light up its relations</span>
			<kbd className="lb-trace-hint__kbd">Esc</kbd>
		</div>
	)
}

export function CanvasToolbar() {
	const editor = useEditor()
	const currentToolId = useValue('lb:current-tool', () => editor.getCurrentToolId(), [editor])

	return (
		<div className="lb-dock-wrap">
			<TracingHint />
			{(currentToolId === 'draw' || currentToolId === 'highlight') && (
				<PenSettings currentToolId={currentToolId} />
			)}
			{currentToolId === 'geo' && <ShapeSettings />}
			{currentToolId === 'text' && <TextSettings />}
			{currentToolId === 'arrow' && (
				<div className="lb-expand">
					<ColorSwatches />
				</div>
			)}

			<div className="lb-dock">
				{/* Getting around, and around things. */}
				<ToolButton
					toolId="select"
					icon={<MousePointer2 size={ICON_SIZE} aria-hidden="true" />}
					isActive={currentToolId === 'select'}
				/>
				<ToolButton
					toolId="hand"
					icon={<Hand size={ICON_SIZE} aria-hidden="true" />}
					isActive={currentToolId === 'hand'}
				/>
				<ToolButton
					toolId="frame"
					icon={<Frame size={ICON_SIZE} aria-hidden="true" />}
					isActive={currentToolId === 'frame'}
				/>
				{/* tldraw's arrow. Snapped at both ends it becomes a relation, which is what it is for
				    here and why it reads as one of the structural tools rather than a drawing one. */}
				<ToolButton
					toolId="arrow"
					icon={<Spline size={ICON_SIZE} aria-hidden="true" />}
					isActive={currentToolId === 'arrow'}
				/>

				<div className="lb-dock__sep" />

				{/* Making marks. */}
				<ToolButton
					toolId="note"
					icon={<StickyNote size={ICON_SIZE} aria-hidden="true" />}
					isActive={currentToolId === 'note'}
				/>
				<ToolButton
					toolId="draw"
					icon={<Pen size={ICON_SIZE} aria-hidden="true" />}
					isActive={currentToolId === 'draw' || currentToolId === 'highlight'}
				/>
				<ToolButton
					toolId="eraser"
					icon={<Eraser size={ICON_SIZE} aria-hidden="true" />}
					isActive={currentToolId === 'eraser'}
				/>
				{/* Not a ToolButton: tldraw's tools map has one entry per geo *kind*, not a single
				    "geo" tool, so the shapes button activates the geo tool with the current kind. */}
				<button
					className={
						currentToolId === 'geo' ? 'lb-dock__tool lb-dock__tool--active' : 'lb-dock__tool'
					}
					onPointerDown={(e) => e.preventDefault()}
					onClick={() => editor.setCurrentTool('geo')}
					title="Shapes"
					aria-label="Shapes"
					aria-pressed={currentToolId === 'geo'}
				>
					<Shapes size={ICON_SIZE} aria-hidden="true" />
				</button>
				<ToolButton
					toolId="text"
					icon={<Type size={ICON_SIZE} aria-hidden="true" />}
					isActive={currentToolId === 'text'}
				/>
				<ToolButton
					toolId="asset"
					icon={<Image size={ICON_SIZE} aria-hidden="true" />}
					isActive={false}
				/>

				<div className="lb-dock__sep" />

				{/* Not tools: these change what the board *shows*, not what the next click draws. */}
				<RelationViewButton />
				<TracingButton />

				<div className="lb-dock__sep" />

				{/* Every node type, ours and every extension's, behind one button. */}
				<NodeMenuButton />
			</div>
		</div>
	)
}
