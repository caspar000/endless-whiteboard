import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	clearCommandRegistry,
	getCommand,
	getCommands,
	getVisibleCommands,
	registerCommand,
	subscribeToCommands,
	type Command,
} from './commands'
import { clearExtensionRegistry, registerExtension, type Extension } from './extensions'
import { clearNodeRegistry, setExtensionEnabled } from './registry'

function command(over: Partial<Command> = {}): Command {
	return {
		id: 'test.noop',
		title: 'Noop',
		run: () => {},
		...over,
	}
}

function extension(over: Partial<Extension> = {}): Extension {
	return {
		id: 'vendor.test',
		name: 'Test extension',
		nodes: [],
		...over,
	}
}

beforeEach(() => {
	clearCommandRegistry()
	clearExtensionRegistry()
	// Also resets the disabled-extension set, which getVisibleCommands consults.
	clearNodeRegistry()
})

describe('registerCommand', () => {
	it('lists commands in registration order', () => {
		registerCommand(command({ id: 'b.two' }))
		registerCommand(command({ id: 'a.one' }))
		expect(getCommands().map((c) => c.id)).toEqual(['b.two', 'a.one'])
	})

	it('replaces on re-registration by id, keeping a single entry', () => {
		registerCommand(command({ id: 'test.dup', title: 'Old' }))
		registerCommand(command({ id: 'test.dup', title: 'New' }))
		expect(getCommands()).toHaveLength(1)
		expect(getCommand('test.dup')?.title).toBe('New')
	})
})

describe('getVisibleCommands', () => {
	it('is a stable snapshot between changes', () => {
		registerCommand(command())
		const first = getVisibleCommands()
		expect(getVisibleCommands()).toBe(first)
		registerCommand(command({ id: 'test.other' }))
		expect(getVisibleCommands()).not.toBe(first)
	})

	it('hides an extension-owned command when the extension is disabled', () => {
		registerExtension(extension({ commands: [command({ id: 'vendor.test.cmd' })] }))
		expect(getVisibleCommands().map((c) => c.id)).toEqual(['vendor.test.cmd'])

		setExtensionEnabled('vendor.test', false)
		expect(getVisibleCommands()).toEqual([])
		// "Stop offering, never stop working": the command itself stays registered.
		expect(getCommand('vendor.test.cmd')).toBeDefined()

		setExtensionEnabled('vendor.test', true)
		expect(getVisibleCommands().map((c) => c.id)).toEqual(['vendor.test.cmd'])
	})

	it('always offers ownerless (core) commands', () => {
		registerCommand(command({ id: 'core.cmd' }))
		setExtensionEnabled('vendor.test', false)
		expect(getVisibleCommands().map((c) => c.id)).toEqual(['core.cmd'])
	})
})

describe('subscribeToCommands', () => {
	it('notifies on registration and on enablement flips, until unsubscribed', () => {
		const listener = vi.fn()
		const unsubscribe = subscribeToCommands(listener)

		registerCommand(command())
		expect(listener).toHaveBeenCalledTimes(1)

		setExtensionEnabled('vendor.test', false)
		expect(listener).toHaveBeenCalledTimes(2)

		unsubscribe()
		registerCommand(command({ id: 'test.other' }))
		expect(listener).toHaveBeenCalledTimes(2)
	})
})
