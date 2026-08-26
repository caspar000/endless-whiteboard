import { beforeEach, describe, expect, it } from 'vitest'
import { clearCommandRegistry, registerCommand, type Command } from './commands'
import { clearNodeRegistry } from './registry'
import {
	bindingFor,
	chordFromEvent,
	chordsFor,
	conflictsFor,
	hasUserBinding,
	matchChord,
	normalizeChord,
	parseKbd,
	setUserBindings,
} from './keymap'

const command = (over: Partial<Command>): Command => ({
	id: 'test.cmd',
	title: 'Test',
	run: () => {},
	...over,
})

const press = (over: Partial<Parameters<typeof chordFromEvent>[0]>) =>
	chordFromEvent({
		key: 'a',
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		...over,
	})

beforeEach(() => {
	clearCommandRegistry()
	clearNodeRegistry()
	setUserBindings({})
})

describe('normalizeChord', () => {
	it('reduces every spelling of a chord to one string', () => {
		expect(normalizeChord('cmd+shift+z')).toBe('cmd+shift+z')
		expect(normalizeChord('Shift+CMD+Z')).toBe('cmd+shift+z')
		// One modifier named twice, not two — which is how `formatKbd` already reads it.
		expect(normalizeChord('cmd+ctrl+k')).toBe('cmd+k')
		expect(normalizeChord('option+p')).toBe('alt+p')
		expect(normalizeChord('⌫')).toBe('backspace')
	})

	it('has nothing to say about modifiers on their own', () => {
		expect(normalizeChord('cmd+shift')).toBeNull()
		expect(normalizeChord('')).toBeNull()
	})

	it('expands the alternates a tool key legitimately has', () => {
		expect(parseKbd('v,1')).toEqual(['v', '1'])
		expect(parseKbd('cmd+z')).toEqual(['cmd+z'])
	})
})

describe('chordFromEvent', () => {
	it('reads a digit off the physical key, because shift+1 arrives as “!”', () => {
		// The reason this matters: `view.zoom-fit` is bound to shift+1, and matching on `key` would
		// have made it unreachable.
		expect(press({ key: '!', code: 'Digit1', shiftKey: true })).toBe('shift+1')
		expect(press({ key: '1', code: 'Digit1' })).toBe('1')
	})

	it('reads a letter off the logical key, which is what keeps other layouts working', () => {
		expect(press({ key: 'D', code: 'KeyE' })).toBe('d')
	})

	it('treats Meta and Control as the same modifier', () => {
		expect(press({ key: 'k', metaKey: true })).toBe('cmd+k')
		expect(press({ key: 'k', ctrlKey: true })).toBe('cmd+k')
	})

	it('ignores a bare modifier press', () => {
		expect(press({ key: 'Shift', shiftKey: true })).toBeNull()
	})

	it('names the keys a table writes out', () => {
		expect(press({ key: 'Backspace' })).toBe('backspace')
		expect(press({ key: 'ArrowUp' })).toBe('up')
	})
})

describe('bindings', () => {
	it('falls back to the command’s own kbd, and reports whose answer it is', () => {
		registerCommand(command({ id: 'edit.undo', kbd: 'cmd+z' }))
		expect(bindingFor('edit.undo')).toBe('cmd+z')
		expect(hasUserBinding('edit.undo')).toBe(false)

		setUserBindings({ 'edit.undo': 'cmd+u' })
		expect(bindingFor('edit.undo')).toBe('cmd+u')
		expect(hasUserBinding('edit.undo')).toBe(true)
	})

	it('tells “never touched” apart from “deliberately unbound”', () => {
		registerCommand(command({ id: 'edit.undo', kbd: 'cmd+z' }))
		setUserBindings({ 'edit.undo': null })
		expect(bindingFor('edit.undo')).toBeNull()
		expect(chordsFor('edit.undo')).toEqual([])
		// And the key it used to be on now does nothing at all, rather than falling through.
		expect(matchChord('cmd+z')).toEqual({ commandId: null })
	})
})

describe('matchChord', () => {
	it('does not claim a chord nothing is bound to', () => {
		registerCommand(command({ id: 'edit.undo', kbd: 'cmd+z' }))
		// Falls through to whoever else is listening — which is how tldraw keeps every shortcut that
		// is not in the table.
		expect(matchChord('cmd+shift+g')).toBeUndefined()
	})

	it('swallows a default the user moved away from', () => {
		registerCommand(command({ id: 'edit.undo', kbd: 'cmd+z' }))
		setUserBindings({ 'edit.undo': 'cmd+u' })
		expect(matchChord('cmd+u')).toEqual({ commandId: 'edit.undo' })
		// The point of the second state: tldraw still has ⌘Z, and the app runs first, so leaving it
		// unclaimed would keep the old key working and make the rebinding look ignored.
		expect(matchChord('cmd+z')).toEqual({ commandId: null })
	})

	it('lets a live binding reclaim another command’s retired default', () => {
		registerCommand(command({ id: 'edit.undo', kbd: 'cmd+z' }))
		registerCommand(command({ id: 'view.help', title: 'Help' }))
		setUserBindings({ 'edit.undo': 'cmd+u', 'view.help': 'cmd+z' })
		expect(matchChord('cmd+z')).toEqual({ commandId: 'view.help' })
	})

	it('resolves a conflict by registration order, and says there was one', () => {
		registerCommand(command({ id: 'first', kbd: 'cmd+j' }))
		registerCommand(command({ id: 'second', kbd: 'cmd+j' }))
		expect(matchChord('cmd+j')).toEqual({ commandId: 'first' })
		expect(conflictsFor('cmd+j', 'second')).toEqual(['first'])
		expect(conflictsFor('CMD+J')).toEqual(['first', 'second'])
	})

	it('follows the table it is a view of', () => {
		expect(matchChord('cmd+z')).toBeUndefined()
		registerCommand(command({ id: 'edit.undo', kbd: 'cmd+z' }))
		expect(matchChord('cmd+z')).toEqual({ commandId: 'edit.undo' })
	})
})
