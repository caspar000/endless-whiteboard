import { atom, useEditor, useValue } from '@lifeboard/canvas'
import { Boxes, Dices, Ellipsis, Eraser, Frame, Hand, Image, MousePointer2, Pen, Shapes, Spline, StickyNote, Type } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useDockDrag } from './dockDrag'
import { CommentsButton, ICON_SIZE, RelationViewButton, ToolButton, TracingButton, TracingHint } from './CanvasToolbar'
import { NodeMenuPopover } from './NodeMenu'
import { toggleNodeMenu } from './nodeMenuState'
import { navModeOf, setNavMode } from './phoneMode'

/**
 * Whether the dice tray is out, on a phone. The tray is the dice extension's own and floats where the
 * More row would be; on a phone it is hidden until asked for from More (styles.css, `lb-phone-dice`).
 */
const diceOpen = atom('lb:phone-dice', false)

function useDiceClass(open: boolean) {
	useEffect(() => {
		document.documentElement.classList.toggle('lb-phone-dice', open)
		return () => document.documentElement.classList.remove('lb-phone-dice')
	}, [open])
}

/**
 * The icon of a tool that lives in More, which the More button wears while that tool is on; `null` for
 * the rest. A function, not a table: this module and CanvasToolbar import each other, and a table built
 * as the module loads could run before `ICON_SIZE` exists.
 */
function moreToolIcon(toolId: string): ReactNode {
	if (toolId === 'frame') return <Frame size={ICON_SIZE} aria-hidden="true" />
	if (toolId === 'arrow') return <Spline size={ICON_SIZE} aria-hidden="true" />
	if (toolId.startsWith('node-')) return <Boxes size={ICON_SIZE} aria-hidden="true" />
	return null
}

/**
 * The dock on a phone (docs/mobile-plan.md): Hand⇄Select, Sticky, Pen⇄Eraser, Shapes, Text, More.
 *
 * Everything else is one tap further, in the More row above the dock: Frame, Relation, Image, the node
 * picker, the two ways of looking at relations, comments and the dice. Above the dock there is one row
 * at a time: More while it is open, otherwise the active tool's settings.
 */
export function PhoneDock({ settings }: { settings: (toolId: string) => ReactNode }) {
	const editor = useEditor()
	const toolId = useValue('lb:current-tool', () => editor.getCurrentToolId(), [editor])
	const dice = useValue('lb:phone-dice', () => diceOpen.get(), [])
	const [moreOpen, setMoreOpen] = useState(false)
	const wrap = useRef<HTMLDivElement>(null)
	useDiceClass(dice)
	// The selection toolbar shares the row above the dock and gives way while More is open (styles.css).
	useEffect(() => {
		document.documentElement.classList.toggle('lb-phone-more', moreOpen)
		return () => document.documentElement.classList.remove('lb-phone-more')
	}, [moreOpen])

	// A press anywhere off the dock puts the More row away, like any menu.
	useEffect(() => {
		if (!moreOpen) return
		const onPointerDown = (e: PointerEvent) => {
			if (!wrap.current?.contains(e.target as Node)) setMoreOpen(false)
		}
		window.addEventListener('pointerdown', onPointerDown, { capture: true })
		return () => window.removeEventListener('pointerdown', onPointerDown, { capture: true })
	}, [moreOpen])

	const close = () => setMoreOpen(false)
	const moreTool = moreToolIcon(toolId)
	const moreIcon = dice ? <Dices size={ICON_SIZE} aria-hidden="true" /> : (moreTool ?? <Ellipsis size={ICON_SIZE} aria-hidden="true" />)

	return (
		<div className="lb-dock-wrap lb-dock-wrap--phone" ref={wrap}>
			<TracingHint />
			<NodeMenuPopover />
			{moreOpen ? (
				<div className="lb-expand lb-more" role="group" aria-label="More tools">
					{/* Tools close the row as they are picked; the views stay open to be tapped through. On the
					    way back up, not on the way down: closing first would remove the button before its
					    own click ran. */}
					<div className="lb-more__tools" onClick={close}>
						<ToolButton toolId="frame" icon={moreToolIcon('frame')} isActive={toolId === 'frame'} />
						<ToolButton toolId="arrow" icon={moreToolIcon('arrow')} isActive={toolId === 'arrow'} />
						<ToolButton toolId="asset" icon={<Image size={ICON_SIZE} aria-hidden="true" />} isActive={false} />
						<button
							type="button"
							className="lb-dock__tool"
							data-testid="lb.node-menu"
							onPointerDown={(e) => e.preventDefault()}
							onClick={() => toggleNodeMenu(editor)}
							aria-label="Node types"
						>
							<Boxes size={ICON_SIZE} aria-hidden="true" />
						</button>
					</div>
					<div className="lb-dock__sep" />
					<RelationViewButton />
					<TracingButton />
					<CommentsButton />
					<div className="lb-dock__sep" />
					<button
						type="button"
						className="lb-dock__tool"
						data-testid="lb.dice"
						onClick={() => {
							close()
							diceOpen.set(true)
						}}
						aria-label="Dice"
					>
						<Dices size={ICON_SIZE} aria-hidden="true" />
					</button>
				</div>
			) : (
				!dice && settings(toolId)
			)}

			<div className="lb-dock">
				<NavToggle toolId={toolId} />
				<ToolButton
					toolId="note"
					icon={<StickyNote size={ICON_SIZE} aria-hidden="true" />}
					isActive={toolId === 'note' || toolId === 'pinned-note'}
				/>
				<PenEraser toolId={toolId} />
				<ShapesButton active={toolId === 'geo'} />
				<ToolButton toolId="text" icon={<Type size={ICON_SIZE} aria-hidden="true" />} isActive={toolId === 'text'} />
				<button
					type="button"
					className={moreOpen || dice || moreTool ? 'lb-dock__tool lb-dock__tool--active' : 'lb-dock__tool'}
					data-testid="lb.more"
					onPointerDown={(e) => e.preventDefault()}
					onClick={() => {
						if (dice) diceOpen.set(false)
						else setMoreOpen((was) => !was)
					}}
					aria-label={dice ? 'Put the dice away' : 'More tools'}
					aria-expanded={moreOpen}
				>
					{moreIcon}
				</button>
			</div>
		</div>
	)
}

/**
 * Hand and Select on one button, showing the mode you are in. Tapped while it is the tool, it switches
 * mode; tapped from a drawing tool, it goes back to the mode you were in (phoneMode.ts).
 */
function NavToggle({ toolId }: { toolId: string }) {
	const editor = useEditor()
	const mode = useValue('lb:nav-mode', () => navModeOf(editor).get(), [editor])
	const active = toolId === mode
	const other = mode === 'hand' ? 'select' : 'hand'
	return (
		<button
			type="button"
			className={active ? 'lb-dock__tool lb-dock__tool--active' : 'lb-dock__tool'}
			data-testid="lb.nav-toggle"
			data-mode={mode}
			onPointerDown={(e) => e.preventDefault()}
			onClick={() => (active ? setNavMode(editor, other) : editor.setCurrentTool(mode))}
			aria-label={
				active
					? `${mode === 'hand' ? 'Hand' : 'Select'}: tap for ${other === 'hand' ? 'Hand' : 'Select'}`
					: `Back to ${mode === 'hand' ? 'Hand' : 'Select'}`
			}
		>
			{mode === 'hand' ? <Hand size={ICON_SIZE} aria-hidden="true" /> : <MousePointer2 size={ICON_SIZE} aria-hidden="true" />}
		</button>
	)
}

/** Pen and Eraser on one button: tapping the pen while drawing picks up the eraser, and back. */
function PenEraser({ toolId }: { toolId: string }) {
	const editor = useEditor()
	const drawing = toolId === 'draw' || toolId === 'highlight'
	const erasing = toolId === 'eraser'
	return (
		<button
			type="button"
			className={drawing || erasing ? 'lb-dock__tool lb-dock__tool--active' : 'lb-dock__tool'}
			data-testid="lb.pen-eraser"
			data-state={erasing ? 'eraser' : 'pen'}
			onPointerDown={(e) => e.preventDefault()}
			onClick={() => editor.setCurrentTool(drawing ? 'eraser' : 'draw')}
			aria-label={drawing ? 'Pen: tap for Eraser' : erasing ? 'Eraser: tap for Pen' : 'Pen'}
		>
			{erasing ? <Eraser size={ICON_SIZE} aria-hidden="true" /> : <Pen size={ICON_SIZE} aria-hidden="true" />}
		</button>
	)
}

/** The geo tool, with the kind last chosen: tldraw has a tool per kind, not a single "geo" one. */
function ShapesButton({ active }: { active: boolean }) {
	const editor = useEditor()
	const { wasDrag, ...dragHandlers } = useDockDrag(editor, 'geo')
	return (
		<button
			type="button"
			className={active ? 'lb-dock__tool lb-dock__tool--active' : 'lb-dock__tool'}
			data-testid="tools.geo"
			{...dragHandlers}
			onClick={() => {
				if (!wasDrag()) editor.setCurrentTool('geo')
			}}
			aria-label="Shapes"
			aria-pressed={active}
		>
			<Shapes size={ICON_SIZE} aria-hidden="true" />
		</button>
	)
}
