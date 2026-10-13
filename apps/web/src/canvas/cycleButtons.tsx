import { GeoShapeGeoStyle, useEditor, useTools, useValue } from '@lifeboard/canvas'
import {
	Circle,
	Diamond,
	Eraser,
	Hand,
	Heart,
	Hexagon,
	Highlighter,
	MousePointer2,
	Pen,
	Pin,
	Spline,
	Square,
	StickyNote,
	Triangle,
	type LucideIcon,
} from 'lucide-react'
import { usePhone } from '../app/usePhone'
import { useDockDrag, type DockShape } from './dockDrag'
import { navModeOf } from './phoneMode'
import { lastKindsOf, pressTool } from './toolCycles'

/**
 * The dock buttons that stand for a pair or a set (toolCycles.ts): one button each, showing the kind
 * the next click on the board makes, with a mark in the corner saying a second press switches it. The
 * desktop dock and the phone's share them, so a second press means the same on both.
 */

const ICON = 20
const SHAPE_ICONS: Record<string, LucideIcon> = {
	rectangle: Square,
	ellipse: Circle,
	diamond: Diamond,
	triangle: Triangle,
	hexagon: Hexagon,
	heart: Heart,
}
const LABELS: Record<string, string> = {
	select: 'Select',
	hand: 'Hand',
	note: 'Sticky note',
	'pinned-note': 'Pinned note',
	draw: 'Pen',
	highlight: 'Highlighter',
	eraser: 'Eraser',
}

function CycleButton({
	toolId,
	active,
	label,
	nextLabel,
	icon: Icon,
	testId = `tools.${toolId}`,
	drag,
	data,
}: {
	/** The tool a press is for (toolCycles.ts `pressTool`). */
	toolId: string
	active: boolean
	label: string
	/** What a press gives while this is on, for the tooltip. */
	nextLabel: string
	icon: LucideIcon
	testId?: string
	drag?: DockShape
	data?: Record<string, string>
}) {
	const editor = useEditor()
	const tools = useTools()
	const { wasDrag, ...dragHandlers } = useDockDrag(editor, drag)
	const kbd = toolId === 'geo' ? 'r' : tools[toolId]?.kbd
	const keys = kbd ? kbd.split(',').map((k) => k.toUpperCase()).join(' · ') : ''
	// The digit the dock assigns by position (toolKeys.ts), shown in the button's corner.
	const digit = kbd?.split(',').find((k) => /^\d$/.test(k))
	return (
		<button
			type="button"
			className={active ? 'lb-dock__tool lb-dock__tool--active' : 'lb-dock__tool'}
			data-testid={testId}
			data-cycles=""
			{...data}
			{...dragHandlers}
			onClick={() => {
				if (!wasDrag()) pressTool(editor, toolId)
			}}
			title={`${label}${keys ? ` (${keys})` : ''}. Press again for ${nextLabel}`}
			aria-label={label}
			aria-pressed={active}
		>
			<Icon size={ICON} aria-hidden="true" />
			{digit && (
				<span className="lb-dock__digit" aria-hidden="true">
					{digit}
				</span>
			)}
			<span className="lb-dock__cycle" aria-hidden="true" />
		</button>
	)
}

/** Select and Hand. On a phone the button shows the board's mode, which the board goes back to. */
export function NavCycleButton({ toolId, testId = 'tools.select' }: { toolId: string; testId?: string }) {
	const editor = useEditor()
	const phone = usePhone()
	const navMode = useValue('lb:nav-mode', () => navModeOf(editor).get(), [editor])
	const mode = phone ? navMode : toolId === 'hand' ? 'hand' : 'select'
	const other = mode === 'hand' ? 'select' : 'hand'
	return (
		<CycleButton
			toolId={mode}
			active={toolId === mode}
			label={LABELS[mode]!}
			nextLabel={LABELS[other]!}
			icon={mode === 'hand' ? Hand : MousePointer2}
			testId={testId}
			data={{ 'data-mode': mode }}
		/>
	)
}

export function NoteCycleButton({ toolId }: { toolId: string }) {
	const editor = useEditor()
	const lastNote = useValue('lb:last-note', () => lastKindsOf(editor).get().note, [editor])
	const kind = toolId === 'note' || toolId === 'pinned-note' ? toolId : lastNote
	return (
		<CycleButton
			toolId="note"
			active={toolId === 'note' || toolId === 'pinned-note'}
			label={LABELS[kind]!}
			nextLabel={LABELS[kind === 'note' ? 'pinned-note' : 'note']!}
			icon={kind === 'pinned-note' ? Pin : StickyNote}
			drag="note"
		/>
	)
}

export function PenCycleButton({ toolId, testId }: { toolId: string; testId?: string }) {
	const editor = useEditor()
	const lastPen = useValue('lb:last-pen', () => lastKindsOf(editor).get().pen, [editor])
	const erasing = toolId === 'eraser'
	const kind = erasing ? 'eraser' : toolId === 'draw' || toolId === 'highlight' ? toolId : lastPen
	return (
		<CycleButton
			toolId="draw"
			active={erasing || toolId === 'draw' || toolId === 'highlight'}
			label={LABELS[kind]!}
			nextLabel={erasing ? LABELS[lastPen]! : 'Eraser'}
			icon={erasing ? Eraser : kind === 'highlight' ? Highlighter : Pen}
			testId={testId}
			data={{ 'data-state': erasing ? 'eraser' : 'pen' }}
		/>
	)
}

export function ShapesCycleButton({ toolId }: { toolId: string }) {
	const editor = useEditor()
	const geo = useValue('lb:next-geo', () => editor.getStyleForNextShape(GeoShapeGeoStyle), [editor])
	return (
		<CycleButton
			toolId="geo"
			active={toolId === 'geo'}
			label="Shapes"
			nextLabel="the next shape"
			icon={SHAPE_ICONS[geo] ?? Square}
			drag="geo"
		/>
	)
}

/** One icon whatever the kind: the arrow's settings row is right there while it is on. */
export function ArrowCycleButton({ toolId }: { toolId: string }) {
	return (
		<CycleButton toolId="arrow" active={toolId === 'arrow'} label="Arrow" nextLabel="the other kind of arrow" icon={Spline} />
	)
}
