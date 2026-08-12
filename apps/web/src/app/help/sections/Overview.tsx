import {
	Eraser,
	Frame,
	Hand,
	Image as ImageIcon,
	MousePointer2,
	NotepadText,
	Pen,
	Shapes,
	Spline,
	StickyNote,
	Table,
	Type,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Keys, Section, type SectionProps } from '../kit'

/* ------------------------------------------------------------------ the dock */

type DockTool = {
	id: string
	label: string
	icon: ReactNode
	kbd: string[]
	blurb: string
}

// Mirrors canvas/CanvasToolbar.tsx — same order, same icons, same shortcuts.
const DOCK_GROUPS: DockTool[][] = [
	[
		{
			id: 'select',
			label: 'Select',
			icon: <MousePointer2 size={19} />,
			kbd: ['V', '1'],
			blurb:
				'Click to select, drag to move or resize. Double-click a note to write in it — double-click always means "edit the content".',
		},
		{
			id: 'hand',
			label: 'Hand',
			icon: <Hand size={19} />,
			kbd: ['H', '2'],
			blurb:
				'Drag to pan. You rarely need it: two-finger scroll pans from any tool, and pinch or ⌘-scroll zooms.',
		},
		{
			id: 'frame',
			label: 'Frame',
			icon: <Frame size={19} />,
			kbd: ['F', '3'],
			blurb:
				'An outline that groups what sits inside it. Tables, collections and expressions can read a single frame instead of the whole board.',
		},
		{
			id: 'arrow',
			label: 'Arrow',
			icon: <Spline size={19} />,
			kbd: ['A', '4'],
			blurb:
				'Connects shapes. Snapped to a shape at both ends, an arrow becomes a relation the board can count and sum.',
		},
		{
			id: 'note',
			label: 'Sticky note',
			icon: <StickyNote size={19} />,
			kbd: ['N'],
			blurb:
				'A quick coloured sticky. Like everything else on the board, it can carry properties — a priced sticky counts as much as a priced note.',
		},
	],
	[
		{
			id: 'node-markdown',
			label: 'Note',
			icon: <NotepadText size={19} />,
			kbd: ['M', '5'],
			blurb:
				'A markdown note. The source text is the truth; the card renders it. Click to drop one at a default size, or drag out your own.',
		},
		{
			id: 'node-table',
			label: 'Table',
			icon: <Table size={19} />,
			kbd: ['6'],
			blurb:
				'A live, read-only view of the board — rows with filters, groups and sums, or one big number. Double-click it to configure.',
		},
	],
	[
		{
			id: 'draw',
			label: 'Pen',
			icon: <Pen size={19} />,
			kbd: ['D', '7'],
			blurb:
				'Freehand ink. While a drawing tool is active, a row above the dock offers the highlighter, stroke sizes and colours.',
		},
		{
			id: 'eraser',
			label: 'Eraser',
			icon: <Eraser size={19} />,
			kbd: ['E', '8'],
			blurb: 'Removes whatever you drag across — ink first, shapes if you insist.',
		},
		{
			id: 'geo',
			label: 'Shapes',
			icon: <Shapes size={19} />,
			kbd: [],
			blurb:
				'Rectangles, ellipses and friends. Their labels are live text, so an expression like {sum price} works inside a shape too.',
		},
		{
			id: 'text',
			label: 'Text',
			icon: <Type size={19} />,
			kbd: ['T', '9'],
			blurb: 'Plain text straight on the paper. Double-clicking empty canvas does the same thing.',
		},
		{
			id: 'asset',
			label: 'Image',
			icon: <ImageIcon size={19} />,
			kbd: [],
			blurb:
				'Place an image — or just drag one in, or paste. Images can carry properties and be pointed at by arrows, same as any shape.',
		},
	],
]

/** The dock, as an interactive replica: click a tool to read what it does. */
function DockTour() {
	const [activeId, setActiveId] = useState('select')
	const active =
		DOCK_GROUPS.flat().find((t) => t.id === activeId) ?? (DOCK_GROUPS[0]![0] as DockTool)

	return (
		<div className="lb-help-dockdemo">
			<div className="lb-dock lb-help-dockdemo__dock" role="group" aria-label="Dock tools">
				{DOCK_GROUPS.map((group, gi) => (
					<span key={gi} className="lb-help-dockdemo__group">
						{gi > 0 && <span className="lb-dock__sep" />}
						{group.map((tool) => (
							<button
								key={tool.id}
								className={
									tool.id === activeId ? 'lb-dock__tool lb-dock__tool--active' : 'lb-dock__tool'
								}
								aria-pressed={tool.id === activeId}
								title={tool.label}
								onClick={() => setActiveId(tool.id)}
							>
								<span aria-hidden="true">{tool.icon}</span>
								<span className="lb-sr-only">{tool.label}</span>
							</button>
						))}
					</span>
				))}
			</div>
			<div className="lb-help-dockdemo__info">
				<div className="lb-help-dockdemo__name">
					{active.label}
					{active.kbd.length > 0 && <Keys keys={active.kbd} />}
				</div>
				<p>{active.blurb}</p>
			</div>
		</div>
	)
}

/* ------------------------------------------------------------------ the ideas */

const IDEAS: { to: string; title: string; body: string }[] = [
	{
		to: 'properties',
		title: 'Shapes carry data',
		body: 'A price, a date, a status, a rating — on a note, a sticky, a photo or a rectangle. The definitions belong to the board; any shape can hold a value for one.',
	},
	{
		to: 'relations',
		title: 'Arrows are relations',
		body: 'Snap an arrow to a shape at both ends and it stops being a drawing: the board can now follow it, count it, and read the properties on the arrow itself.',
	},
	{
		to: 'asking',
		title: 'Answers are live',
		body: 'A total is never a copy. Ask inside a sentence, on any shape, or in a table — and it keeps up with the board on its own.',
	},
]

export function Overview({ go }: SectionProps) {
	return (
		<>
			<Section title="Three ideas hold the whole thing up">
				<p>
					Everything else in this help is detail on one of these. They are worth reading in order once,
					because each one only pays off given the one before it.
				</p>
				<div className="lb-help__ideas">
					{IDEAS.map((idea, i) => (
						<button key={idea.to} className="lb-help__idea" onClick={() => go(idea.to)}>
							<span className="lb-help__ideanum">{i + 1}</span>
							<span className="lb-help__ideatitle">{idea.title}</span>
							<span className="lb-help__ideabody">{idea.body}</span>
						</button>
					))}
				</div>
			</Section>

			<Section title="The dock">
				<p>
					Every tool lives in the dock at the bottom of the canvas. Click one below to see what it does
					and the keys that reach it — <strong>letters and digits both work</strong>, so your hand never
					has to leave either side of the keyboard.
				</p>
				<DockTour />
			</Section>

			<Section title="Getting around">
				<p>
					Two-finger scroll pans from any tool; pinch or <kbd className="lb-kbd">⌘</kbd>-scroll zooms.
					The board is endless in every direction and nothing has to be tidy — a corner nobody has
					visited costs nothing.
				</p>
				<div className="lb-help__facts">
					<div className="lb-help__fact">
						<h3>Boards and tabs</h3>
						<p>
							Boards are separate documents, listed under All boards and opened as tabs across the
							top. An open tab keeps its board alive, which is what makes switching instant — and
							why a keystroke only ever reaches the board you are looking at.
						</p>
					</div>
					<div className="lb-help__fact">
						<h3>Everything is local</h3>
						<p>
							Boards live in this browser, not on a server. Settings has the export that makes a
							backup file, and the import that puts one back.
						</p>
					</div>
					<div className="lb-help__fact">
						<h3>The grid</h3>
						<p>
							Snapping and the dotted paper are set once for the app, in Settings → Appearance. Hold{' '}
							<kbd className="lb-kbd">⌘</kbd> while dragging to ignore the grid for one move.
						</p>
					</div>
					<div className="lb-help__fact">
						<h3>Undo has no button</h3>
						<p>
							<kbd className="lb-kbd">⌘Z</kbd> and <kbd className="lb-kbd">⇧⌘Z</kbd>, deliberately.
							One user action is one step back, including a configuration change made in a panel.
						</p>
					</div>
				</div>
			</Section>
		</>
	)
}
