import { getVisibleNodeDefinitions, subscribeToNodeDefinitions } from '@lifeboard/node-kit'
import { useSyncExternalStore } from 'react'
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
	StickyNote,
	Triangle,
	Type,
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
import { toolIdForNodeType } from './nodeTools'

/**
 * The bottom dock — replaces tldraw's toolbar with an Affine-style one.
 *
 * Rendering our own component in the `Toolbar` slot changes *presentation only*: tool keyboard
 * shortcuts (1–9 by dock position, `b` for draw, `t` for text, and the node tools' letters) are
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

/** Shape kind and colour — the Affine shape expansion. */
function ShapeSettings() {
	const editor = useEditor()
	const currentKind = useValue(
		'lb:next-geo',
		() => editor.getStyleForNextShape(GeoShapeGeoStyle),
		[editor]
	)
	return (
		<div className="lb-expand">
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
			<ColorSwatches />
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

export function CanvasToolbar() {
	const editor = useEditor()
	const currentToolId = useValue('lb:current-tool', () => editor.getCurrentToolId(), [editor])
	// Subscribed to the registry's own store, so flipping a toggle in Settings adds/removes dock
	// buttons on the spot. Not tldraw's `useValue`: the registry deliberately owns its reactivity
	// (see node-kit's registry.tsx for the dual-signal-instance bug that forced this).
	const nodeDefs = useSyncExternalStore(subscribeToNodeDefinitions, getVisibleNodeDefinitions)

	return (
		<div className="lb-dock-wrap">
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
				<ToolButton
					toolId="arrow"
					icon={<Spline size={ICON_SIZE} aria-hidden="true" />}
					isActive={currentToolId === 'arrow'}
				/>
				{/* tldraw's sticky note. On this side of the separator because it is one of tldraw's own
				    shapes, not a registry node type — keeping the group below purely registry-driven. */}
				<ToolButton
					toolId="note"
					icon={<StickyNote size={ICON_SIZE} aria-hidden="true" />}
					isActive={currentToolId === 'note'}
				/>

				<div className="lb-dock__sep" />

				{/* The node types — registry-driven, so a new type (or a plugin's) appears for free.
				    A definition brings its own lucide-style icon (`toolbarIcon`) so the dock reads as
				    one set; without one it falls back to the registry glyph, so the icon never gates
				    what can appear here. */}
				{nodeDefs.map((def) => {
					const toolId = toolIdForNodeType(def.type)
					const Icon = def.toolbarIcon
					return (
						<ToolButton
							key={def.type}
							toolId={toolId}
							icon={
								Icon ? (
									<Icon size={ICON_SIZE} aria-hidden="true" />
								) : (
									<span className="lb-tool-icon">{def.icon}</span>
								)
							}
							isActive={currentToolId === toolId}
						/>
					)
				})}

				<div className="lb-dock__sep" />

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
			</div>
		</div>
	)
}
