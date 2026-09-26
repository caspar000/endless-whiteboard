import {
	chordFromEvent,
	getCommand,
	matchChord,
	subscribeToKeymap,
	type CommandContext,
} from '@lifeboard/node-kit'
import { useEffect } from 'react'
import { isAppChromeGroup } from './paletteItems'

/**
 * The app's one keyboard dispatcher: a chord in, a command out.
 *
 * **Capture phase on `window`, which is what makes this possible at all.** tldraw registers its
 * shortcuts on `document.body` in the bubble phase, so a capture listener here sees every keystroke
 * first and `stopPropagation()` means tldraw never sees the ones we claim. Nothing has to be deleted
 * from tldraw's action map and no editor has to be remounted for a rebinding to take effect — which
 * was the trap the other design walked into, since tldraw builds its action map once per mount and
 * remounting a board discards the pending write along with the camera and the undo history.
 *
 * A chord the keymap does not claim is left entirely alone, so every tldraw shortcut that is not in
 * the command table — group, align, select-all — keeps working exactly as before. Those are not
 * rebindable yet; making one so is a matter of adding a delegating command for it, not of changing
 * anything here.
 */
export function useKeymap(options: {
	/** Built fresh per keystroke, never stored — the same rule the palette follows. */
	getContext: () => CommandContext
}): void {
	const { getContext } = options

	useEffect(() => {
		// A `trigger: 'tap'` command whose key is down, waiting to see whether it is a tap or a hold.
		let pendingTap: { commandId: string; key: string; at: number } | null = null

		const onKeyDown = (event: KeyboardEvent) => {
			// Anything but the first press of the same key means it was not a tap: a repeat is a hold,
			// and another key is a chord.
			if (pendingTap && (event.repeat || event.key !== pendingTap.key)) pendingTap = null

			// Mid-composition keystrokes belong to the IME, whatever they look like.
			if (event.isComposing) return

			const chord = chordFromEvent(event)
			if (!chord) return
			const match = matchChord(chord)
			if (!match) return

			const ctx = getContext()
			const command = match.commandId === null ? null : getCommand(match.commandId)
			// A chord claimed by a command that has since become unavailable (`when` says no, or its
			// extension was switched off) is left to fall through rather than eaten: the alternative is
			// a key that silently stops working with no explanation.
			if (match.commandId !== null && (!command || command.when?.(ctx) === false)) return

			if (!mayFireNow(command?.group, ctx, event)) return

			// Left for tldraw on purpose: until the key comes up, this may be the start of a hold.
			if (command?.trigger === 'tap') {
				if (!event.repeat) pendingTap = { commandId: command.id, key: event.key, at: event.timeStamp }
				return
			}

			/*
			 * Taken only now, *after* every guard. Doing it earlier — the obvious way to write this —
			 * is a bug with teeth: `edit.delete` is bound to Backspace, so preventing default before
			 * deciding not to act would stop Backspace deleting a character in the palette's own input.
			 */
			event.preventDefault()
			event.stopPropagation()

			// `commandId: null` is a default the user rebound away from. Swallowed on purpose: tldraw
			// still has its own binding for it, and letting it through would keep the old key working.
			if (!command) return
			void command.run(ctx)
		}

		// Not stopped: tldraw needs this keyup to end the pan it started on keydown.
		const onKeyUp = (event: KeyboardEvent) => {
			const tap = pendingTap
			if (!tap || event.key !== tap.key) return
			pendingTap = null
			if (event.timeStamp - tap.at > TAP_MS) return
			const command = getCommand(tap.commandId)
			const ctx = getContext()
			if (!command || command.when?.(ctx) === false) return
			void command.run(ctx)
		}

		// Pressing the pointer while the key is down is Space-drag panning, not a tap.
		const cancelTap = () => {
			pendingTap = null
		}

		window.addEventListener('keydown', onKeyDown, { capture: true })
		window.addEventListener('keyup', onKeyUp, { capture: true })
		window.addEventListener('pointerdown', cancelTap, { capture: true })
		window.addEventListener('blur', cancelTap)
		return () => {
			window.removeEventListener('keydown', onKeyDown, { capture: true })
			window.removeEventListener('keyup', onKeyUp, { capture: true })
			window.removeEventListener('pointerdown', cancelTap, { capture: true })
			window.removeEventListener('blur', cancelTap)
		}
	}, [getContext])
}

/** How long a key may be held and still count as a tap. */
const TAP_MS = 300

/**
 * Whether a command may fire given what currently has the keyboard.
 *
 * The same question tldraw asks itself before running a shortcut, and mostly the same answers — but
 * one of them differs on purpose. tldraw refuses *everything* while a shape is being edited; this
 * refuses only what is about the board. ⌘K over a half-written note is the whole reason the palette
 * is worth having, and the app's own chrome is never in competition with the caret.
 */
function mayFireNow(
	group: string | undefined,
	ctx: CommandContext,
	event: KeyboardEvent
): boolean {
	if (isAppChromeGroup(group)) return true

	if (isTypingTarget(event.target)) return false

	const editor = ctx.editor
	if (!editor) return true
	// tldraw's own `areShortcutsDisabled`, minus `getCrashingError` — which is not in its public
	// types, and a board already showing a crash screen has bigger problems than a live shortcut.
	if (editor.getEditingShapeId() !== null) return false
	if (editor.menus.hasAnyOpenMenus()) return false
	if (!editor.user.getAreKeyboardShortcutsEnabled()) return false
	return true
}

/**
 * Whether the event landed somewhere text is being typed. Follows tldraw's own rule, including its
 * exception for the input types that cannot hold text — a checkbox with focus must not swallow the
 * board's keys.
 */
const NON_TEXT_INPUTS = ['checkbox', 'radio', 'range', 'button', 'file', 'reset', 'submit', 'color']

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable) return true
	if (target.tagName === 'SELECT') return true
	if (target instanceof HTMLTextAreaElement) return !target.readOnly
	if (target instanceof HTMLInputElement) {
		if (NON_TEXT_INPUTS.includes(target.type)) return false
		return !target.readOnly
	}
	return false
}

/** Re-exported so a consumer can re-render when the keymap changes. */
export { subscribeToKeymap }
