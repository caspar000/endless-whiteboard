import { getVisibleCommands, subscribeToCommands } from '@lifeboard/node-kit'
import { useSyncExternalStore } from 'react'
import { OTHER_GROUP, formatKbd, groupInOrder, isMacPlatform } from '../../paletteItems'
import { Keys, Section } from '../kit'

type ShortcutGroup = { title: string; rows: [string[], string][] }

/**
 * The reference page. Deliberately the one place in this help that is a flat list rather than an
 * explanation — the sections that explain these keys are also the sections you have to *read*, and
 * someone who just needs the chord for a checklist should not have to.
 *
 * The bound *commands* are not listed here; they come from the command registry below, so a binding
 * is documented by the command existing rather than by someone remembering to add a row. What stays
 * written out is everything that genuinely is not a command: tool keys (tldraw's), gestures, and the
 * two editors' own keymaps.
 */
const GROUPS: ShortcutGroup[] = [
	{
		title: 'Anywhere',
		rows: [
			[['⌘K'], 'The command palette — jump to a board, or type > for commands'],
			[['⌘/'], "The canvas's own shortcut list, on a board"],
		],
	},
	{
		title: 'Reaching a tool',
		rows: [
			[['V', '1'], 'Select'],
			[['H', '2'], 'Hand'],
			[['F', '3'], 'Frame'],
			[['A', '4'], 'Arrow'],
			[['N'], 'Sticky note'],
			[['M', '5'], 'Note'],
			[['6'], 'Table'],
			[['D', '7'], 'Pen'],
			[['E', '8'], 'Eraser'],
			[['T', '9'], 'Text'],
		],
	},
]

/** Everything after the generated section: gestures, then the two editors' own keymaps. */
const GROUPS_AFTER: ShortcutGroup[] = [
	{
		title: 'With the pointer',
		rows: [
			[['⌘', 'drag'], 'Ignore grid snapping for this move'],
			[['Esc'], 'Stop editing, then deselect'],
			[['double-click'], 'Edit the content — or, on empty paper, start a note'],
			[['right-click'], 'Properties, and everything else about this shape'],
		],
	},
	{
		// Not commands and not keys: the whole interaction with a kanban or a calendar is a drag, and a
		// reference that lists every keystroke but none of the gestures would be missing the feature.
		title: 'On a kanban or a calendar',
		rows: [
			[['drag'], 'Drop a card in a lane or on a day — it takes that status, or that date'],
			[['drag'], 'Drag a card out of the view to remove the property, and leave the board'],
			[['⌘Z'], 'Take back the decision; the card walks out of the lane by itself'],
		],
	},
	{
		title: 'Writing in a note',
		rows: [
			[['⌘Enter'], 'Tick the task under the caret — or finish editing'],
			[['Enter'], 'Continue the list; on an empty item, leave it'],
			[['Tab', '⇧Tab'], 'Nest and un-nest'],
			[['⌘B', '⌘I'], 'Bold, italic'],
			[['⌘E'], 'Inline code'],
			[['⇧⌘X'], 'Strikethrough'],
			[['⇧⌘7'], 'Numbered list'],
			[['⇧⌘8'], 'Bullet list'],
			[['⇧⌘9'], 'Checklist'],
			[['⇧⌘.'], 'Quote'],
		],
	},
	{
		title: 'Reading a book',
		rows: [
			[['→', 'PageDown', 'Space'], 'Next page'],
			[['←', 'PageUp'], 'Previous page'],
			[['Esc'], 'Close the contents or the settings, then the reader'],
		],
	},
	{
		title: 'Typing an answer',
		rows: [
			[['{'], 'Start an expression, anywhere text can be typed'],
			[['↑', '↓'], 'Move through the suggestions'],
			[['Enter', 'Tab'], 'Take the highlighted suggestion'],
			[['Esc'], 'Dismiss the menu and leave the text as typed'],
		],
	},
]

/**
 * Section titles for the generated groups. The palette wants short headers in a narrow list; this
 * page reads as prose, so `Canvas` becomes the sentence fragment the rest of the page is written in.
 * An unmapped group (an extension's own) simply keeps its name.
 */
const HELP_TITLES: Record<string, string> = { Canvas: 'On the canvas' }

/**
 * The bound commands, straight from the registry.
 *
 * `when` is deliberately not applied. It answers "can this run right now", and this is a reference —
 * Undo belongs on the page even though you are reading it from a screen with no board open.
 */
function useCommandShortcuts(): ShortcutGroup[] {
	const commands = useSyncExternalStore(subscribeToCommands, getVisibleCommands)
	const mac = isMacPlatform()
	// `flatMap` rather than `filter`, so `kbd` narrows to a string instead of needing an assertion.
	const bound = commands.flatMap((command) =>
		command.kbd
			? [{ group: command.group ?? OTHER_GROUP, kbd: command.kbd, title: command.title }]
			: []
	)

	const groups: ShortcutGroup[] = []
	for (const command of groupInOrder(bound)) {
		const title = HELP_TITLES[command.group] ?? command.group
		let group = groups.at(-1)
		// `groupInOrder` guarantees each group is one contiguous run, so a change of title starts a section.
		if (group?.title !== title) {
			group = { title, rows: [] }
			groups.push(group)
		}
		group.rows.push([[formatKbd(command.kbd, mac)], command.title])
	}
	return groups
}

export function Shortcuts() {
	const generated = useCommandShortcuts()
	const groups = [...GROUPS, ...generated, ...GROUPS_AFTER]
	return (
		<>
			<Section title="Everything worth memorising">
				<p>
					Undo and redo have no button anywhere — they are <kbd className="lb-kbd">⌘Z</kbd> and{' '}
					<kbd className="lb-kbd">⇧⌘Z</kbd>, deliberately. Tool keys come in pairs, a letter and a
					digit, so your hand never has to leave either side of the keyboard. Anything with a
					binding is also in the palette, on <kbd className="lb-kbd">⌘K</kbd>.
				</p>
				<div className="lb-help__keygroups">
					{groups.map((group) => (
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
				<p className="lb-help__aside">
					On Windows and Linux, read <kbd className="lb-kbd">⌘</kbd> as Ctrl and{' '}
					<kbd className="lb-kbd">⌥</kbd> as Alt. The canvas's own menu carries the complete list of
					editor shortcuts underneath these.
				</p>
			</Section>
		</>
	)
}
