// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useState, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cardPopupMenuId, hasCardPopup, useCardPopup } from './cardPopup'
import { emptyPropsMigrations } from './migrations'
import { createNodeShapeUtil, type NodeComponentProps, type NodeDefinition } from './registry'

/** The editor as far as a card's menu needs it: the open menus it keeps. */
function fakeEditor() {
	const menus = new Set<string>()
	return {
		menus,
		addOpenMenu: (id: string) => void menus.add(id),
		deleteOpenMenu: (id: string) => void menus.delete(id),
	}
}

function Card({ editor, open }: { editor: ReturnType<typeof fakeEditor>; open: boolean }) {
	useCardPopup(editor as never, 'shape:card', open)
	return null
}

beforeEach(() => {
	// jsdom has none; auto-height, which the factory always wires, asks for one.
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	)
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe('a menu open over a card (DARK-13)', () => {
	it('marks the card while it is open, and tells the editor so its keys stand aside', () => {
		const editor = fakeEditor()
		const { rerender, unmount } = render(<Card editor={editor} open={false} />)
		expect(hasCardPopup('shape:card')).toBe(false)
		rerender(<Card editor={editor} open />)
		expect(hasCardPopup('shape:card')).toBe(true)
		expect(editor.menus.has(cardPopupMenuId('shape:card'))).toBe(true)
		rerender(<Card editor={editor} open={false} />)
		expect(hasCardPopup('shape:card')).toBe(false)
		expect(editor.menus.size).toBe(0)
		rerender(<Card editor={editor} open />)
		unmount()
		expect(hasCardPopup('shape:card')).toBe(false)
	})
})

/** A node whose component has a menu, as a ranking card has. */
function MenuCard({ shape, editor }: NodeComponentProps<Record<string, never>>) {
	const [open, setOpen] = useState(false)
	useCardPopup(editor, shape.id, open)
	return (
		<button type="button" onClick={() => setOpen(!open)}>
			Menu
		</button>
	)
}

describe('a node with a menu open over it', () => {
	const def = {
		type: 'node.menu-card',
		label: 'Menu card',
		icon: 'M',
		props: {},
		migrations: emptyPropsMigrations,
		defaultProps: () => ({}),
		defaultSize: { w: 200, h: 100 },
		component: MenuCard,
	} as unknown as NodeDefinition<Record<string, never>>
	const shape = { id: 'shape:menu', type: 'node.menu-card', x: 0, y: 0, rotation: 0, props: { w: 200, h: 100 }, meta: {} }

	it('draws past its box while the menu is open, and is clipped to it again once it closes', () => {
		const editor = { ...fakeEditor(), isShapeBeingEdited: () => false }
		const Util = createNodeShapeUtil(def) as unknown as new (editor: unknown) => { component(shape: unknown): ReactElement }
		const util = new Util(editor)
		const Host = () => util.component(shape)
		const { container, getByRole } = render(<Host />)
		const box = container.querySelector<HTMLElement>('.tl-html-container')!
		expect(box.style.overflow).toBe('hidden')
		act(() => void fireEvent.click(getByRole('button', { name: 'Menu' })))
		expect(box.style.overflow).toBe('visible')
		expect(box.hasAttribute('data-lb-popup')).toBe(true)
		act(() => void fireEvent.click(getByRole('button', { name: 'Menu' })))
		expect(box.style.overflow).toBe('hidden')
		expect(box.hasAttribute('data-lb-popup')).toBe(false)
	})
})
