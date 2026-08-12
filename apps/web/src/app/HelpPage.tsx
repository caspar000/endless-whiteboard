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
import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * The help page — one looping demonstration per idea, built from the app's own tokens and classes
 * rather than screenshots or a mounted editor. A screenshot bakes in one theme and goes stale the
 * moment the UI moves; a real tldraw editor is most of the bundle and would need demo-data plumbing
 * that doesn't exist. Mock-ups follow the theme for free and weigh nothing.
 */

/**
 * Drives a demo through numbered steps: hold `durations[step]` ms, advance, wrap around.
 *
 * Runs only while the demo is actually on screen — six timers ticking under the fold would be pure
 * waste — and not at all under `prefers-reduced-motion`, where the demo sits on its final step so
 * the outcome is still shown, just without the ride there.
 */
function useDemo(durations: readonly number[]) {
	const [step, setStep] = useState(0)
	const [visible, setVisible] = useState(false)
	const [reduced, setReduced] = useState(
		() => window.matchMedia('(prefers-reduced-motion: reduce)').matches
	)
	const ref = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		const query = window.matchMedia('(prefers-reduced-motion: reduce)')
		const onChange = () => setReduced(query.matches)
		query.addEventListener('change', onChange)
		return () => query.removeEventListener('change', onChange)
	}, [])

	useEffect(() => {
		const el = ref.current
		if (!el) return
		const io = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false))
		io.observe(el)
		return () => io.disconnect()
	}, [])

	useEffect(() => {
		if (reduced || !visible) return
		const timer = setTimeout(
			() => setStep((s) => (s + 1) % durations.length),
			durations[step] ?? 1000
		)
		return () => clearTimeout(timer)
	}, [reduced, visible, step, durations])

	return { step: reduced ? durations.length - 1 : step, ref }
}

/** The mock pointer every animated demo moves around. */
function Cursor({ x, y, shown = true }: { x: number; y: number; shown?: boolean }) {
	return (
		<span
			className="lb-demo__cursor"
			style={{ left: x, top: y, opacity: shown ? 1 : 0 }}
			aria-hidden="true"
		>
			<MousePointer2 size={16} fill="currentColor" />
		</span>
	)
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="lb-help__section">
			<h2>{title}</h2>
			{children}
		</section>
	)
}

function Keys({ keys }: { keys: string[] }) {
	return (
		<span className="lb-help__keys">
			{keys.map((k, i) => (
				<span key={k}>
					{i > 0 && <span className="lb-help__keysep"> · </span>}
					<kbd className="lb-kbd">{k}</kbd>
				</span>
			))}
		</span>
	)
}

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
				'Connects shapes. Snapped to a shape at both ends, an arrow becomes a relation the board can count and sum — see below.',
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

/* ------------------------------------------------------------------ notes */

const NOTE_STEPS = [1600, 1400, 1600, 900, 2600] as const

function NoteDemo() {
	const { step, ref } = useDemo(NOTE_STEPS)
	const editing = step < 2
	const ticked = step >= 4

	return (
		<div className="lb-demo" ref={ref} role="img" aria-label="Writing a checklist in a note, then ticking a task from the rendered card">
			<div className="lb-demo__scene">
			<div className={editing ? 'lb-demo__note lb-demo__note--editing' : 'lb-demo__note'}>
				{editing ? (
					<div className="lb-demo__source">
						<div>
							- [ ] Order the desk
							{step === 0 && <span className="lb-demo__caret" />}
						</div>
						{step >= 1 && (
							<div>
								- [ ] Pick a chair
								<span className="lb-demo__caret" />
							</div>
						)}
					</div>
				) : (
					<div className="lb-demo__tasks">
						<div className={ticked ? 'lb-demo__task lb-demo__task--done' : 'lb-demo__task'}>
							<span className="lb-demo__box" aria-hidden="true">
								{ticked ? '✓' : ''}
							</span>
							Order the desk
						</div>
						<div className="lb-demo__task">
							<span className="lb-demo__box" aria-hidden="true" />
							Pick a chair
						</div>
					</div>
				)}
			</div>
			<Cursor x={step >= 3 ? 54 : 320} y={step >= 3 ? 50 : 185} shown={step >= 2} />
			</div>
			<div className="lb-demo__hint">
				{editing ? (
					<>
						markdown source — <kbd className="lb-kbd">⇧⌘9</kbd> makes a checklist
					</>
				) : (
					'the rendered card — tasks tick without entering the editor'
				)}
			</div>
		</div>
	)
}

/* ------------------------------------------------------------------ properties */

const PROPS_STEPS = [1100, 700, 1100, 1100, 900, 2400] as const

function PropertiesDemo() {
	const { step, ref } = useDemo(PROPS_STEPS)
	const panelOpen = step >= 2 && step <= 3

	return (
		<div className="lb-demo" ref={ref} role="img" aria-label="Opening the properties panel on a sticky note and giving it a price">
			<div className="lb-demo__scene">
			<div className="lb-demo__stickywrap">
				<div className="lb-demo__sticky">Standing desk</div>
				<div className={step >= 4 ? 'lb-demo__strip lb-demo__pop--in' : 'lb-demo__strip'}>
					<span className="lb-demo__stripname">Price</span>
					<span className="lb-demo__stripvalue">₾450</span>
				</div>
			</div>
			<div className={panelOpen ? 'lb-demo__panel lb-demo__panel--open' : 'lb-demo__panel'}>
				<div className="lb-demo__panelhead">
					Properties <Keys keys={['⌥P']} />
				</div>
				<div className="lb-demo__panelrow">
					<span>Price</span>
					<span className="lb-demo__panelvalue">
						{step >= 3 ? '₾450' : ''}
						{step === 2 && <span className="lb-demo__caret" />}
					</span>
				</div>
				<div className="lb-demo__panelrow lb-demo__panelrow--faint">+ Add property</div>
			</div>
			<Cursor x={step >= 1 ? 252 : 430} y={step >= 1 ? 82 : 190} />
			</div>
			<div className="lb-demo__hint">
				{step >= 4
					? 'the value now lives on the sticky itself'
					: 'right-click any shape → Properties, or press ⌥P'}
			</div>
		</div>
	)
}

/* ------------------------------------------------------------------ arrows */

const ARROW_STEPS = [1200, 700, 900, 1500, 2400] as const

function ArrowsDemo() {
	const { step, ref } = useDemo(ARROW_STEPS)
	const drawn = step >= 2
	const bound = step >= 3

	return (
		<div className="lb-demo" ref={ref} role="img" aria-label="Drawing an arrow from a priced sticky into a collector, which adds it to the total">
			<div className="lb-demo__scene">
			<div className="lb-demo__stickywrap lb-demo__stickywrap--left">
				<div className="lb-demo__sticky">Desk</div>
				<div className="lb-demo__strip lb-demo__pop--in">
					<span className="lb-demo__stripname">Price</span>
					<span className="lb-demo__stripvalue">₾450</span>
				</div>
			</div>
			<svg className="lb-demo__wire" viewBox="0 0 640 240" preserveAspectRatio="none" aria-hidden="true">
				<path
					className={
						bound
							? 'lb-demo__wirepath lb-demo__wirepath--bound'
							: drawn
								? 'lb-demo__wirepath lb-demo__wirepath--drawn'
								: 'lb-demo__wirepath'
					}
					d="M 218 104 C 290 66, 350 66, 416 98"
					pathLength={1}
				/>
				<path
					className={bound ? 'lb-demo__wirehead lb-demo__wirehead--on' : 'lb-demo__wirehead'}
					d="M 416 98 l -14 -8 m 14 8 l -16 4"
				/>
				<circle
					className={bound ? 'lb-demo__bindring lb-demo__bindring--on' : 'lb-demo__bindring'}
					cx="419"
					cy="99"
					r="9"
				/>
			</svg>
			<div className="lb-demo__collector">
				<div className="lb-demo__collectortitle">Spending</div>
				<div className={bound ? 'lb-demo__collect lb-demo__bump' : 'lb-demo__collect'}>
					<span className="lb-demo__collectvalue">{bound ? '₾1,540' : '₾1,090'}</span>
					<span className="lb-demo__collectcount">{bound ? '3 items' : '2 items'}</span>
				</div>
			</div>
			<Cursor x={drawn ? 408 : step >= 1 ? 214 : 320} y={drawn ? 92 : step >= 1 ? 98 : 200} />
			</div>
			<div className="lb-demo__hint">
				{bound
					? 'both ends bound — the arrow is a relation, and the total already knows'
					: 'an arrow across empty space is just a drawing'}
			</div>
		</div>
	)
}

/* ------------------------------------------------------------------ expressions */

const EXPR_STEPS = [1300, 1100, 1100, 1000, 2800] as const

const EXPR_TEXT = ['Office total: ', 'Office total: {', 'Office total: {sum ', 'Office total: {sum price}'] as const

function ExpressionsDemo() {
	const { step, ref } = useDemo(EXPR_STEPS)
	const rendered = step >= 4
	const menu =
		step === 1
			? ([
					['sum', 'add them up'],
					['count', 'how many'],
					['avg', 'the average'],
				] as const)
			: step === 2
				? ([
						['price', 'financial'],
						['rating', 'rating'],
					] as const)
				: null

	return (
		<div className="lb-demo lb-demo--short" ref={ref} role="img" aria-label="Typing the expression sum price into a note, which renders as the live total">
			<div className="lb-demo__scene">
			<div className={rendered ? 'lb-demo__note lb-demo__note--wide' : 'lb-demo__note lb-demo__note--wide lb-demo__note--editing'}>
				{rendered ? (
					<div>
						Office total: <strong className="lb-demo__money">₾1,540</strong>
					</div>
				) : (
					<div className="lb-demo__source">
						{EXPR_TEXT[step] ?? EXPR_TEXT[0]}
						<span className="lb-demo__caret" />
					</div>
				)}
			</div>
			{menu && (
				<div className="lb-demo__suggest">
					{menu.map(([label, detail], i) => (
						<div key={label} className={i === 0 ? 'lb-demo__row lb-demo__row--on' : 'lb-demo__row'}>
							<span>{label}</span>
							<span className="lb-demo__rowdetail">{detail}</span>
						</div>
					))}
				</div>
			)}
			</div>
			<div className="lb-demo__hint">
				{rendered
					? 'you edit {sum price}, you read ₾1,540 — the source keeps the expression'
					: 'type { and the menu builds the expression with you'}
			</div>
		</div>
	)
}

/* ------------------------------------------------------------------ tables */

const TABLE_STEPS = [1500, 800, 1700, 2600] as const

function TableDemo() {
	const { step, ref } = useDemo(TABLE_STEPS)
	const added = step >= 1
	const counted = step >= 2

	return (
		<div className="lb-demo" ref={ref} role="img" aria-label="A new priced card appearing on the board, and the table picking it up by itself">
			<div className="lb-demo__scene">
			<div className="lb-demo__minis">
				<div className="lb-demo__mini">
					Desk <span className="lb-demo__minivalue">₾450</span>
				</div>
				<div className="lb-demo__mini">
					Chair <span className="lb-demo__minivalue">₾640</span>
				</div>
				<div className={added ? 'lb-demo__mini lb-demo__pop lb-demo__pop--in' : 'lb-demo__mini lb-demo__pop'}>
					Lamp <span className="lb-demo__minivalue">₾85</span>
				</div>
			</div>
			<div className="lb-demo__table">
				<div className="lb-demo__tablehead">Everything priced</div>
				<div className="lb-demo__tablerow">
					<span>Desk</span>
					<span>450</span>
				</div>
				<div className="lb-demo__tablerow">
					<span>Chair</span>
					<span>640</span>
				</div>
				<div className={counted ? 'lb-demo__tablerow lb-demo__pop lb-demo__pop--in' : 'lb-demo__tablerow lb-demo__pop'}>
					<span>Lamp</span>
					<span>85</span>
				</div>
				<div className={counted ? 'lb-demo__tablesum lb-demo__bump' : 'lb-demo__tablesum'}>
					<span>Sum</span>
					<span>{counted ? '₾1,175' : '₾1,090'}</span>
				</div>
			</div>
			</div>
			<div className="lb-demo__hint">
				{counted ? 'no refresh, no import — the table watches the board' : 'a table is a saved question, not copied data'}
			</div>
		</div>
	)
}

/* ------------------------------------------------------------------ shortcuts */

const SHORTCUT_GROUPS: { title: string; rows: [string[], string][] }[] = [
	{
		title: 'On the canvas',
		rows: [
			[['⌘Z'], 'Undo'],
			[['⇧⌘Z'], 'Redo'],
			[['⌥P'], 'Properties of the selected shape'],
			[['⌘D'], 'Duplicate'],
			[['⌫'], 'Delete'],
			[['⌘', 'drag'], 'Ignore grid snapping'],
			[['Esc'], 'Stop editing, then deselect'],
		],
	},
	{
		title: 'Writing in a note',
		rows: [
			[['⌘Enter'], 'Tick the task under the caret — or exit the note'],
			[['⌘B'], 'Bold'],
			[['⌘I'], 'Italic'],
			[['⌘E'], 'Inline code'],
			[['⇧⌘8'], 'Bullet list'],
			[['⇧⌘9'], 'Checklist'],
			[['Tab', '⇧Tab'], 'Indent and outdent list items'],
		],
	},
]

function Shortcuts() {
	return (
		<div className="lb-help__keygroups">
			{SHORTCUT_GROUPS.map((group) => (
				<div key={group.title} className="lb-help__keygroup">
					<h3>{group.title}</h3>
					{group.rows.map(([keys, what]) => (
						<div key={what} className="lb-help__keyrow">
							<Keys keys={keys} />
							<span>{what}</span>
						</div>
					))}
				</div>
			))}
		</div>
	)
}

/* ------------------------------------------------------------------ the page */

export function HelpPage() {
	return (
		<div className="lb-help">
			<p className="lb-help__intro">
				Lifeboard is an endless canvas where shapes carry data. Notes, stickies, images and
				drawings live on the same paper — and any of them can hold a price, a date or a rating.
				Arrows between shapes are relations; tables and inline expressions read the board live.
				The examples below loop; the dock one is yours to click.
			</p>

			<Section title="The dock">
				<p>
					Every tool lives in the dock at the bottom of the canvas. Click one below to see what it
					does and the keys that reach it — <strong>letters and digits both work</strong>, so your
					hand never has to leave either side of the keyboard.
				</p>
				<DockTour />
			</Section>

			<Section title="Notes are markdown">
				<p>
					A note's source text is the truth and the card is its rendering. Double-click to write;
					press <kbd className="lb-kbd">Esc</kbd> to step back out. Lists continue themselves,{' '}
					<kbd className="lb-kbd">⇧⌘9</kbd> turns every selected line into a checklist at once, and
					finished tasks tick straight from the card — no need to enter the editor.
				</p>
				<NoteDemo />
			</Section>

			<Section title="Properties on anything">
				<p>
					A property is defined once per board, and then <strong>any shape can carry a value</strong>{' '}
					— a sticky, a photo, a rectangle, not just a note. Right-click a shape and choose
					Properties (or press <kbd className="lb-kbd">⌥P</kbd>); double-click stays reserved for
					editing content. Values render on the shape itself, so a priced sticky looks priced.
				</p>
				<PropertiesDemo />
			</Section>

			<Section title="Arrows are relations">
				<p>
					There is no linking mode. Sketch an arrow across empty space and it stays a drawing —
					snap <strong>both ends</strong> to shapes and it becomes a relation the board understands.
					Anything that gathers (a collector, a table, an expression) can follow arrows in, out, or
					both ways at once, where incoming adds and outgoing subtracts: a running balance.
				</p>
				<ArrowsDemo />
			</Section>

			<Section title="Ask the board, inline">
				<p>
					A number belongs in the sentence that explains it. Inside any text — notes, stickies,
					shape labels, even arrow labels — type <code>{'{'}</code> and build an expression:{' '}
					<code>{'{sum price}'}</code> totals the shapes pointing at this one,{' '}
					<code>{'{count}'}</code> counts them, <code>{'{avg rating page}'}</code> averages the
					whole board. Anything unrecognised is left exactly as typed, and code blocks are exempt.
				</p>
				<ExpressionsDemo />
			</Section>

			<Section title="Tables are live views">
				<p>
					A table doesn't hold rows — it <strong>watches the board</strong> and shows whatever
					matches: everything with a price, one frame, or whatever the arrows point at. Filter,
					group, sort, sum; or collapse the whole thing to a single headline number. Double-click a
					table to change the question it asks.
				</p>
				<TableDemo />
			</Section>

			<Section title="Keyboard shortcuts">
				<p>
					Undo and redo have no button anywhere — they are{' '}
					<kbd className="lb-kbd">⌘Z</kbd> and <kbd className="lb-kbd">⇧⌘Z</kbd>, deliberately. The
					rest of the keys worth knowing:
				</p>
				<Shortcuts />
			</Section>
		</div>
	)
}
