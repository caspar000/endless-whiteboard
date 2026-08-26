import { READER_HOTKEYS, VIEW_MODE_LABELS, VIEW_MODES, viewModeKey } from '@lifeboard/book-reader'
import { chordsFor, getVisibleCommands, subscribeToCommands, subscribeToKeymap } from '@lifeboard/node-kit'
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
			// ⌘K itself is a command now (`view.palette`) and so appears in the generated group below.
			// What stays written out is the *prefixes*, which are not keys anything is bound to.
			[['⌘K', '>'], 'Every command, with its binding'],
			[['⌘K', '@'], 'Find something on the open board by name, and go to it'],
			[['⌘K', '='], 'Ask the board a question — the answer, or the question to leave on it'],
			[['Esc', '⌫'], 'In the palette: back one step — a question, then the command, then closed'],
			[['⌘/'], "The canvas's own shortcut list, on a board"],
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
		// The dice tray's gestures are commands for *loading* and keys for nothing else: picking up, putting
		// back and throwing are all pointer work, and the one key involved is bound by the overlay rather
		// than registered, so none of it can generate itself.
		title: 'Holding dice',
		rows: [
			[['click'], 'A die in the tray: pick one up. Click again for another'],
			[['right-click', '⇧click'], 'A die in the tray: put one back'],
			[['click'], 'The board: throw what you are holding, there'],
			[['right-click'], 'The board: put the whole hand down'],
			[['Esc'], 'Put the whole hand down'],
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
		// The reader is a full-screen surface of its own, so these are not commands and cannot be
		// rebound — they come from `book-reader`'s own table, which is also what draws the tooltips.
		title: 'Reading a book',
		rows: [
			[['→', 'PageDown', 'Space'], 'Next page'],
			[['←', 'PageUp'], 'Previous page'],
			[[READER_HOTKEYS.contents], 'Contents'],
			[
				VIEW_MODES.map(viewModeKey),
				`Layout: ${VIEW_MODES.map((mode) => VIEW_MODE_LABELS[mode].toLowerCase()).join(', ')}`,
			],
			[[READER_HOTKEYS.clipRegion], 'Clip a region of the page — PDFs, which have pages to cut'],
			[[READER_HOTKEYS.clipPage], 'Clip the whole page'],
			[[READER_HOTKEYS.settings], 'Reading settings'],
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
	// Subscribed to the keymap as well, so this page shows what the keys *are* rather than what they
	// were shipped as. A reference that kept advertising a default the user moved would be worse than
	// no reference at all.
	useSyncExternalStore(subscribeToKeymap, getVisibleCommands)
	const mac = isMacPlatform()
	// `flatMap` rather than `filter`, so an unbound command drops out instead of needing an assertion.
	const bound = commands.flatMap((command) => {
		const chords = chordsFor(command.id)
		return chords.length
			? [{ group: command.group ?? OTHER_GROUP, chords, title: command.title }]
			: []
	})

	const groups: ShortcutGroup[] = []
	for (const command of groupInOrder(bound)) {
		const title = HELP_TITLES[command.group] ?? command.group
		let group = groups.at(-1)
		// `groupInOrder` guarantees each group is one contiguous run, so a change of title starts a section.
		if (group?.title !== title) {
			group = { title, rows: [] }
			groups.push(group)
		}
		// Every chord it answers to, as separate keycaps — which is how a tool's letter *and* its digit
		// ended up on one row when this group was written by hand.
		group.rows.push([command.chords.map((chord) => formatKbd(chord, mac)), command.title])
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
					binding is also in the palette, on <kbd className="lb-kbd">⌘K</kbd> — and every one of
					them can be moved, in <em>Settings → Keyboard</em>. This page shows what they are now,
					not what they shipped as.
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
