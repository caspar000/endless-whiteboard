import {
	BookOpen,
	Boxes,
	Dices,
	Eraser,
	Frame,
	Hand,
	Image as ImageIcon,
	MousePointer2,
	NotepadText,
	Pen,
	QuoteIcon,
	Radar,
	Shapes,
	Spline,
	StickyNote,
	Table,
	Type,
	Waypoints,
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
			label: 'Relation',
			icon: <Spline size={19} />,
			kbd: ['A', '4'],
			blurb:
				'Connects shapes. Snapped to a shape at both ends, an arrow becomes a relation the board can count and sum. Hold Shift while drawing one to make it hidden.',
		},
	],
	[
		{
			id: 'note',
			label: 'Sticky note',
			icon: <StickyNote size={19} />,
			kbd: ['N', '5'],
			blurb:
				'A quick coloured sticky. Like everything else on the board, it can carry properties — a priced sticky counts as much as a priced note.',
		},
		{
			id: 'draw',
			label: 'Pen',
			icon: <Pen size={19} />,
			kbd: ['D', '6'],
			blurb:
				'Freehand ink. While a drawing tool is active, a row above the dock offers the highlighter, stroke sizes and colours.',
		},
		{
			id: 'eraser',
			label: 'Eraser',
			icon: <Eraser size={19} />,
			kbd: ['E', '7'],
			blurb: 'Removes whatever you drag across — ink first, shapes if you insist.',
		},
		{
			id: 'geo',
			label: 'Shapes',
			icon: <Shapes size={19} />,
			kbd: [],
			blurb:
				'Rectangles, ellipses and friends. The row above the dock sets the kind, the border colour and the fill colour — fill is off until you pick one. Their labels are live text, so an expression like {sum price} works inside a shape too.',
		},
		{
			id: 'text',
			label: 'Text',
			icon: <Type size={19} />,
			kbd: ['T', '8'],
			blurb: 'Plain text straight on the paper.',
		},
		{
			id: 'asset',
			label: 'Image',
			icon: <ImageIcon size={19} />,
			kbd: ['9'],
			blurb:
				'Place an image — or just drag one in, or paste. Images can carry properties and be pointed at by arrows, same as any shape.',
		},
	],
	[
		{
			id: 'relation-view',
			label: 'Relation view',
			icon: <Waypoints size={19} />,
			kbd: ['⌥⇧R'],
			blurb:
				'How much of the board’s wiring is drawn: none, as you set it, or all. One button with three positions — click to cycle. It changes what you see, never what the next click does.',
		},
		{
			id: 'tracing',
			label: 'Trace relations',
			icon: <Radar size={19} />,
			kbd: ['⌥⇧T'],
			blurb:
				'A lens. While it is on, clicking a shape lights up everything it is connected to — hidden relations included — and dims the rest. Escape leaves.',
		},
	],
	[
		{
			id: 'nodes',
			label: 'Node types',
			icon: <Boxes size={19} />,
			kbd: ['0'],
			blurb:
				'Every node type, in a searchable grid: notes, tables, books, quotes, rolls, and whatever the extensions you have installed add. Start typing to filter, then Enter — or click a tile — to pick up that tool and draw one.',
		},
	],
]

/**
 * The node types the picker holds, as a preview of the grid.
 *
 * Retyped rather than read from the registry, on purpose: importing it would pull every node
 * definition — and the packages behind them — into the eagerly-loaded help chunk, which is the same
 * bargain the rest of this page makes for its demos. What is here is a *sample*, and the tour says so,
 * so it cannot go stale in the way a claimed-complete list would.
 */
const NODE_SAMPLE: { label: string; icon: ReactNode }[] = [
	{ label: 'Note', icon: <NotepadText size={20} /> },
	{ label: 'Table', icon: <Table size={20} /> },
	{ label: 'Book', icon: <BookOpen size={20} /> },
	{ label: 'Quote', icon: <QuoteIcon size={20} /> },
	{ label: 'Roll', icon: <Dices size={20} /> },
]

/** The picker's grid, as a still — the tour explains the button, this shows what opens. */
function NodeGridDemo() {
	return (
		<div className="lb-help-nodegrid">
			<div className="lb-help-nodegrid__search">Search node types</div>
			<div className="lb-help-nodegrid__grid">
				{NODE_SAMPLE.map((node) => (
					<span key={node.label} className="lb-help-nodegrid__tile">
						<span aria-hidden="true">{node.icon}</span>
						<span>{node.label}</span>
					</span>
				))}
				<span className="lb-help-nodegrid__tile lb-help-nodegrid__tile--more">…and any an extension adds</span>
			</div>
		</div>
	)
}

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
					Every tool lives in the dock at the bottom of the canvas, in four groups: getting around,
					making marks, looking, and the node types. Click one below to see what it does and the keys
					that reach it — <strong>letters and digits both work</strong>, and the digits run left to
					right along the dock, so your hand never has to leave either side of the keyboard.
				</p>
				<DockTour />
				<p>
					The last button is the odd one out: it opens a <strong>searchable grid</strong> rather than
					picking up a tool. Everything the app and its extensions can add lives there, so installing
					one does not make the dock any wider.
				</p>
				<NodeGridDemo />
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
							Snapping and the dotted paper are set once for the app, in Settings → Canvas. Hold{' '}
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
