import { Compass, Keyboard, NotepadText, Sigma, Spline, Table, Tags } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SectionProps } from './kit'
import { Asking } from './sections/Asking'
import { Notes } from './sections/Notes'
import { Overview } from './sections/Overview'
import { Properties } from './sections/Properties'
import { Relations } from './sections/Relations'
import { Shortcuts } from './sections/Shortcuts'
import { Tables } from './sections/Tables'

/**
 * The help page's contents, and the only place that decides what the inner sidebar says.
 *
 * Grouped rather than flat because the groups carry information a flat list can't: **Core ideas** are
 * the app itself and are true of every board, while an **Extension** is one node type you may never
 * place. Someone who has not understood properties cannot get anything out of the Tables page, and the
 * order says so.
 *
 * `id` is also the URL (`#/help/properties`), so it is part of the app's surface: rename one and old
 * links land on the overview rather than on nothing.
 */
export interface HelpSection {
	id: string
	/** The sidebar entry. */
	label: string
	/** The page heading — longer than the label, which has a rail's width to live in. */
	title: string
	/** The paragraph under the heading: what this page is for, before any detail. */
	lede: string
	group: (typeof HELP_GROUPS)[number]
	icon: ReactNode
	Component: (props: SectionProps) => ReactNode
}

export const HELP_GROUPS = ['Start here', 'Core ideas', 'Extensions', 'Reference'] as const

export const HELP_SECTIONS: HelpSection[] = [
	{
		id: 'overview',
		label: 'Overview',
		title: 'What this is',
		lede: 'An endless canvas where the shapes carry data. Notes, stickies, photos and drawings share one sheet of paper — and any of them can hold a price, a date or a rating, be joined to another by an arrow, and be counted without being copied anywhere.',
		group: 'Start here',
		icon: <Compass size={15} />,
		Component: Overview,
	},
	{
		id: 'properties',
		label: 'Properties',
		title: 'Properties',
		lede: 'The one idea everything else is built on: a property is defined once for the board, and then any shape at all can carry a value for it. This is the long page — the rest are shorter.',
		group: 'Core ideas',
		icon: <Tags size={15} />,
		Component: Properties,
	},
	{
		id: 'relations',
		label: 'Arrows & relations',
		title: 'Arrows are relations',
		lede: 'An arrow with both ends snapped to a shape stops being a drawing and becomes something the board can follow, count and read data off.',
		group: 'Core ideas',
		icon: <Spline size={15} />,
		Component: Relations,
	},
	{
		id: 'asking',
		label: 'Asking the board',
		title: 'Asking the board',
		lede: 'Two ways to get a live number back without leaving the canvas: inside a sentence, and hung on any shape you like. Both are the same engine.',
		group: 'Core ideas',
		icon: <Sigma size={15} />,
		Component: Asking,
	},
	{
		id: 'notes',
		label: 'Notes (Markdown)',
		title: 'Notes are markdown',
		lede: 'The note is one of the node types the canvas has been extended with. Its content is a markdown string — that is the whole design, and everything below follows from it.',
		group: 'Extensions',
		icon: <NotepadText size={15} />,
		Component: Notes,
	},
	{
		id: 'tables',
		label: 'Tables',
		title: 'Tables',
		lede: 'The other node type: a live, read-only view of the board. Filters, groups and summaries — or one big number, which is often all you wanted.',
		group: 'Extensions',
		icon: <Table size={15} />,
		Component: Tables,
	},
	{
		id: 'shortcuts',
		label: 'Keyboard shortcuts',
		title: 'Keyboard shortcuts',
		lede: 'Every key the app binds, in one place.',
		group: 'Reference',
		icon: <Keyboard size={15} />,
		Component: Shortcuts,
	},
]

/** The section a route names, falling back to the overview for an unknown or missing id. */
export function sectionFor(id: string | undefined): HelpSection {
	return HELP_SECTIONS.find((s) => s.id === id) ?? HELP_SECTIONS[0]!
}
