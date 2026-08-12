import { Keys, Section } from '../kit'

/**
 * The reference page. Deliberately the one place in this help that is a flat list rather than an
 * explanation — the sections that explain these keys are also the sections you have to *read*, and
 * someone who just needs the chord for a checklist should not have to.
 */
const GROUPS: { title: string; rows: [string[], string][] }[] = [
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
	{
		title: 'On the canvas',
		rows: [
			[['⌘Z'], 'Undo'],
			[['⇧⌘Z'], 'Redo'],
			[['⌥P'], 'Properties of the selected shape'],
			[['⌘D'], 'Duplicate'],
			[['⌫'], 'Delete'],
			[['⌘', 'drag'], 'Ignore grid snapping for this move'],
			[['Esc'], 'Stop editing, then deselect'],
			[['double-click'], 'Edit the content — or, on empty paper, start a note'],
			[['right-click'], 'Properties, and everything else about this shape'],
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
		title: 'Typing an answer',
		rows: [
			[['{'], 'Start an expression, anywhere text can be typed'],
			[['↑', '↓'], 'Move through the suggestions'],
			[['Enter', 'Tab'], 'Take the highlighted suggestion'],
			[['Esc'], 'Dismiss the menu and leave the text as typed'],
		],
	},
]

export function Shortcuts() {
	return (
		<>
			<Section title="Everything worth memorising">
				<p>
					Undo and redo have no button anywhere — they are <kbd className="lb-kbd">⌘Z</kbd> and{' '}
					<kbd className="lb-kbd">⇧⌘Z</kbd>, deliberately. Tool keys come in pairs, a letter and a
					digit, so your hand never has to leave either side of the keyboard.
				</p>
				<div className="lb-help__keygroups">
					{GROUPS.map((group) => (
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
