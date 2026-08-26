import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearExtensionRegistry, registerExtension, type Extension } from './extensions'
import {
	clearHookRegistry,
	fireBoardOpen,
	firePropertyChange,
	fireShapeCreate,
	registerHooks,
} from './hooks'
import { clearNodeRegistry, setExtensionEnabled } from './registry'
import type { Editor, TLShape } from 'tldraw'

const EDITOR = {} as Editor
const SHAPE = { id: 'shape:a', type: 'node.markdown' } as unknown as TLShape

const extension = (over: Partial<Extension> = {}): Extension => ({
	id: 'vendor.test',
	name: 'Test',
	nodes: [],
	...over,
})

beforeEach(() => {
	clearHookRegistry()
	clearExtensionRegistry()
	clearNodeRegistry()
})

describe('registerHooks', () => {
	it('runs every set, rather than letting one claim the event', () => {
		const first = vi.fn()
		const second = vi.fn()
		registerHooks({ id: 'a', onShapeCreate: first })
		registerHooks({ id: 'b', onShapeCreate: second })

		fireShapeCreate({ editor: EDITOR, shape: SHAPE })
		// The difference from `fileImportFor`/`contentImportFor`, where the first match wins: a
		// reaction is not a claim, so there is nothing to win.
		expect(first).toHaveBeenCalledTimes(1)
		expect(second).toHaveBeenCalledTimes(1)
	})

	it('replaces by id, so a reloaded module does not leave dead closures behind', () => {
		const stale = vi.fn()
		const fresh = vi.fn()
		registerHooks({ id: 'a', onShapeCreate: stale })
		registerHooks({ id: 'a', onShapeCreate: fresh })

		fireShapeCreate({ editor: EDITOR, shape: SHAPE })
		expect(stale).not.toHaveBeenCalled()
		expect(fresh).toHaveBeenCalledTimes(1)
	})

	it('arrives through the extension manifest, and stops when it is switched off', () => {
		const onShapeCreate = vi.fn()
		registerExtension(extension({ hooks: { onShapeCreate } }))

		fireShapeCreate({ editor: EDITOR, shape: SHAPE })
		expect(onShapeCreate).toHaveBeenCalledTimes(1)

		// Checked at fire time, not registration: switching an extension off in Settings has to stop
		// its behaviour now, not at the next reload.
		setExtensionEnabled('vendor.test', false)
		fireShapeCreate({ editor: EDITOR, shape: SHAPE })
		expect(onShapeCreate).toHaveBeenCalledTimes(1)

		setExtensionEnabled('vendor.test', true)
		fireShapeCreate({ editor: EDITOR, shape: SHAPE })
		expect(onShapeCreate).toHaveBeenCalledTimes(2)
	})

	it('keeps a core hook when every extension is off', () => {
		const core = vi.fn()
		registerHooks({ id: 'lifeboard.core', onShapeCreate: core })
		registerExtension(extension({ hooks: { onShapeCreate: vi.fn() } }))
		setExtensionEnabled('vendor.test', false)

		fireShapeCreate({ editor: EDITOR, shape: SHAPE })
		expect(core).toHaveBeenCalledTimes(1)
	})

	it('survives a hook that throws, and runs the next one', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const after = vi.fn()
		registerHooks({
			id: 'bad',
			onShapeCreate() {
				throw new Error('boom')
			},
		})
		registerHooks({ id: 'good', onShapeCreate: after })

		expect(() => fireShapeCreate({ editor: EDITOR, shape: SHAPE })).not.toThrow()
		expect(after).toHaveBeenCalledTimes(1)
		expect(spy).toHaveBeenCalled()
		spy.mockRestore()
	})

	it('does not let a hook’s own writes re-enter any hook', () => {
		const inner = vi.fn()
		registerHooks({
			id: 'writer',
			onShapeCreate() {
				// Standing in for a hook that creates a shape or sets a property: whatever it writes,
				// the side effect that would fire from it must not come back round.
				fireShapeCreate({ editor: EDITOR, shape: SHAPE })
				firePropertyChange({
					editor: EDITOR,
					shape: SHAPE,
					propertyId: 'price',
					before: null,
					after: 1,
				})
			},
		})
		registerHooks({ id: 'counter', onShapeCreate: inner })

		fireShapeCreate({ editor: EDITOR, shape: SHAPE })
		// Once for the user's action, and not again for anything the hooks did.
		expect(inner).toHaveBeenCalledTimes(1)
	})

	it('fires each kind independently', () => {
		const onBoardOpen = vi.fn()
		const onPropertyChange = vi.fn()
		registerHooks({ id: 'a', onBoardOpen, onPropertyChange })

		fireBoardOpen({ editor: EDITOR, boardId: 'board-1' })
		expect(onBoardOpen).toHaveBeenCalledWith({ editor: EDITOR, boardId: 'board-1' })

		firePropertyChange({
			editor: EDITOR,
			shape: SHAPE,
			propertyId: 'price',
			before: null,
			after: 2399,
		})
		expect(onPropertyChange).toHaveBeenCalledWith(
			expect.objectContaining({ propertyId: 'price', before: null, after: 2399 })
		)
	})
})
