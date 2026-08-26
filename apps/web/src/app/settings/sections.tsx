import { Blocks, Bot, Grid2x2, HardDrive, Keyboard, Palette, SlidersHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * The settings page's contents, and the only place that decides what its rail says.
 *
 * The rail exists because a single scrolling column stopped being able to hold this: extensions are
 * a list that will grow — with other people's work, once there is a way to install it — and a growing
 * list at the bottom of a column of switches is a list nobody scrolls to. Obsidian's shape is the one
 * borrowed: options on the left, one page at a time on the right, plugins a destination of their own
 * rather than a section.
 *
 * `id` is also the URL (`#/settings/extensions`), so it is part of the app's surface: rename one and
 * old links land on General rather than on nothing.
 */
export interface SettingsTab {
	id: string
	/** The rail entry, and the page heading — short enough for both. */
	label: string
	group: (typeof SETTINGS_GROUPS)[number]
	icon: ReactNode
}

export const SETTINGS_GROUPS = ['Options', 'Add-ons'] as const

/** The extensions tab, named because the route nests extension pages under it. */
export const EXTENSIONS_TAB = 'extensions'

export const SETTINGS_TABS: SettingsTab[] = [
	{
		id: 'general',
		label: 'General',
		group: 'Options',
		icon: <SlidersHorizontal size={15} />,
	},
	{
		id: 'appearance',
		label: 'Appearance',
		group: 'Options',
		icon: <Palette size={15} />,
	},
	{
		id: 'canvas',
		label: 'Canvas',
		group: 'Options',
		icon: <Grid2x2 size={15} />,
	},
	{
		id: 'keyboard',
		label: 'Keyboard',
		group: 'Options',
		icon: <Keyboard size={15} />,
	},
	{
		id: 'storage',
		label: 'Storage',
		group: 'Options',
		icon: <HardDrive size={15} />,
	},
	{
		id: EXTENSIONS_TAB,
		label: 'Extensions',
		group: 'Add-ons',
		icon: <Blocks size={15} />,
	},
	{
		id: 'agents',
		label: 'Agents',
		group: 'Add-ons',
		icon: <Bot size={15} />,
	},
]

/** The tab a route names, falling back to General for an unknown or missing id. */
export function tabFor(id: string | undefined): SettingsTab {
	return SETTINGS_TABS.find((tab) => tab.id === id) ?? SETTINGS_TABS[0]!
}
