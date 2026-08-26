import {
	chordsFor,
	conflictsFor,
	getCommand,
	getVisibleCommands,
	hasUserBinding,
	normalizeChord,
	subscribeToCommands,
	subscribeToKeymap,
	type Command,
} from '@lifeboard/node-kit'
import { RotateCcw } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { bindCommand, resetAllBindings, resetCommandBinding } from '../keymapStore'
import { OTHER_GROUP, formatKbd, groupInOrder, isMacPlatform } from '../paletteItems'

/**
 * Settings → Keyboard: every command, and what reaches it.
 *
 * A view over the command table like the palette and the Help page, grouped by `groupInOrder` so all
 * three read it in the same order — a third arrangement of one table would be a third answer to
 * "where is Undo".
 *
 * Every command is listed, not only the bound ones. A shortcut you want usually does not have one
 * yet, and a page that hid those would be a page you cannot use for the thing you came to do.
 */
export function KeymapPanel() {
	// Both stores: the table changes when an extension is toggled, the keymap when a binding is set.
	const commands = useSyncExternalStore(subscribeToCommands, getVisibleCommands)
	const keymapVersion = useSyncExternalStore(subscribeToKeymap, getKeymapVersion)
	const [recording, setRecording] = useState<string | null>(null)
	const mac = isMacPlatform()

	const rows = groupInOrder(
		commands.map((command) => ({ command, group: command.group ?? OTHER_GROUP }))
	)

	return (
		<section className="lb-settings" data-keymap-version={keymapVersion}>
			<h2>Shortcuts</h2>
			<p className="lb-settings__hint">
				Press <em>Change</em> and then the keys you want. Anything the app does not claim is left to
				the canvas, so tldraw&rsquo;s own editing shortcuts keep working.
			</p>

			<div className="lb-keymap">
				{rows.map(({ command, group }, index) => (
					<div key={command.id}>
						{(index === 0 || rows[index - 1]?.group !== group) && (
							<div className="lb-keymap__section">{group}</div>
						)}
						<KeymapRow
							command={command}
							mac={mac}
							recording={recording === command.id}
							onRecord={() => setRecording(command.id)}
							onDone={() => setRecording(null)}
						/>
					</div>
				))}
			</div>

			<button type="button" className="lb-btn lb-keymap__reset-all" onClick={resetAllBindings}>
				<RotateCcw size={14} /> Reset every shortcut
			</button>
		</section>
	)
}

function KeymapRow({
	command,
	mac,
	recording,
	onRecord,
	onDone,
}: {
	command: Command
	mac: boolean
	recording: boolean
	onRecord: () => void
	onDone: () => void
}) {
	const chords = chordsFor(command.id)
	const conflicts = chords.flatMap((chord) => conflictsFor(chord, command.id))

	/**
	 * Captures the next chord.
	 *
	 * On the button rather than on the window: the recorder must not be able to hear a keystroke
	 * meant for something else, and a focused button is the smallest surface that can promise that.
	 * A bare modifier is ignored rather than recorded, so you can hold ⌘ and then choose the letter.
	 */
	const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
		event.preventDefault()
		event.stopPropagation()
		if (event.key === 'Escape') {
			onDone()
			return
		}
		if (event.key === 'Backspace' || event.key === 'Delete') {
			// Unbinding is a real choice, distinct from resetting to the default — hence a separate
			// gesture rather than a second button.
			bindCommand(command.id, null)
			onDone()
			return
		}
		const chord = normalizeChord(
			[
				event.metaKey || event.ctrlKey ? 'cmd' : '',
				event.altKey ? 'alt' : '',
				event.shiftKey ? 'shift' : '',
				event.key,
			]
				.filter(Boolean)
				.join('+')
		)
		if (!chord) return
		bindCommand(command.id, chord)
		onDone()
	}

	return (
		<div className="lb-keymap__row">
			<span className="lb-keymap__name">{command.title}</span>

			<span className="lb-keymap__keys">
				{recording ? (
					<span className="lb-keymap__listening">Press the keys…</span>
				) : chords.length ? (
					chords.map((chord) => (
						<kbd key={chord} className="lb-kbd">
							{formatKbd(chord, mac)}
						</kbd>
					))
				) : (
					<span className="lb-keymap__unbound">Not bound</span>
				)}
			</span>

			<button
				type="button"
				className="lb-btn lb-btn--ghost"
				onClick={onRecord}
				onKeyDown={recording ? onKeyDown : undefined}
				onBlur={recording ? onDone : undefined}
				aria-label={`Change the shortcut for ${command.title}`}
			>
				{recording ? 'Listening' : 'Change'}
			</button>

			{hasUserBinding(command.id) ? (
				<button
					type="button"
					className="lb-btn lb-btn--ghost"
					onClick={() => resetCommandBinding(command.id)}
					aria-label={`Reset the shortcut for ${command.title}`}
				>
					Reset
				</button>
			) : (
				<span />
			)}

			{conflicts.length > 0 && (
				<span className="lb-keymap__conflict">
					{/* Named, not just flagged: "there is a conflict" is not something anyone can act on. */}
					Also {conflicts.map((id) => getCommand(id)?.title ?? id).join(', ')} — the first one
					registered wins
				</span>
			)}
		</div>
	)
}

/**
 * A counter that changes whenever the keymap does.
 *
 * `useSyncExternalStore` needs a snapshot that is `===` between changes, and the keymap's own state
 * is a plain object rebuilt on every write — so the version is what is subscribed to, and the row
 * bodies read the live values during render.
 */
let version = 0
subscribeToKeymap(() => {
	version += 1
})
function getKeymapVersion(): number {
	return version
}
