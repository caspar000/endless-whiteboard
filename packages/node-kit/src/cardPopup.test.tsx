// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useState, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cardPopupMenuId, hasCardPopup, useCardPopup, watchLifted, type Box } from './cardPopup'
import { emptyPropsMigrations } from './migrations'
import { createNodeShapeUtil, type NodeComponentProps, type NodeDefinition } from './registry'

// The GPU scene, as far as a card with a menu open tells it anything: the boxes it lifts over the layer.
const lifted = vi.hoisted(() => ({ boxes: [] as Box[] }))
vi.mock('@lifeboard/canvas', async (importOriginal) => {
	const real = await importOriginal<typeof import('@lifeboard/canvas')>()
	return { ...real, getGpuScene: () => ({ lifted: { set: (boxes: Box[]) => void (lifted.boxes = boxes) } }) }
})

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

describe('what a card with a menu open lifts over the GPU layer (DARK-13)', () => {
	/** Animation frames run by hand. */
	let frames: Array<() => void> = []
	const runFrame = () => {
		const now = frames
		frames = []
		for (const f of now) f()
	}
	beforeEach(() => {
		frames = []
		vi.stubGlobal('requestAnimationFrame', (f: () => void) => frames.push(f))
		vi.stubGlobal('cancelAnimationFrame', () => void (frames = []))
	})

	it('is published when it changes, and only then, and cleared when the menu closes', () => {
		let boxes: Box[] = [{ x: 0, y: 0, w: 10, h: 10 }]
		const published: Array<Box[] | null> = []
		const stop = watchLifted(
			() => boxes,
			(b) => published.push(b)
		)
		runFrame()
		runFrame()
		expect(published).toEqual([[{ x: 0, y: 0, w: 10, h: 10 }]])
		boxes = [{ x: 0, y: 0, w: 10, h: 30 }]
		runFrame()
		expect(published.at(-1)).toEqual([{ x: 0, y: 0, w: 10, h: 30 }])
		stop()
		expect(published.at(-1)).toBeNull()
		expect(frames).toEqual([])
	})

	it('follows one tier menu swapped for another without the menu ever closing', () => {
		// Where each menu sits on screen: the bottom tier's hangs below the card.
		const RECTS: Record<string, DOMRect> = {
			top: { left: 50, top: 20, right: 150, bottom: 80 } as DOMRect,
			bottom: { left: 50, top: 180, right: 150, bottom: 300 } as DOMRect,
		}
		const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
			return RECTS[this.dataset.which ?? ''] ?? ({ left: 0, top: 0, right: 0, bottom: 0 } as DOMRect)
		})
		const editor = {
			...fakeEditor(),
			store: {},
			getShapePageBounds: () => ({ x: 0, y: 0, w: 200, h: 200 }),
			screenToPage: (p: { x: number; y: number }) => p,
		}
		function TierCard() {
			const [menu, setMenu] = useState<string | null>(null)
			useCardPopup(editor as never, 'shape:tiers', menu !== null)
			return (
				<div id="shape:tiers">
					<button type="button" onClick={() => setMenu('top')}>
						Top options
					</button>
					<button type="button" onClick={() => setMenu('bottom')}>
						Bottom options
					</button>
					{menu && <div data-card-popup data-which={menu} />}
				</div>
			)
		}
		const { getByRole } = render(<TierCard />)
		act(() => void fireEvent.click(getByRole('button', { name: 'Top options' })))
		act(runFrame)
		expect(lifted.boxes).toEqual([
			{ x: 0, y: 0, w: 200, h: 200 },
			{ x: 50, y: 20, w: 100, h: 60 },
		])
		act(() => void fireEvent.click(getByRole('button', { name: 'Bottom options' })))
		act(runFrame)
		expect(lifted.boxes).toEqual([
			{ x: 0, y: 0, w: 200, h: 200 },
			{ x: 50, y: 180, w: 100, h: 120 },
		])
		cleanup()
		expect(lifted.boxes).toEqual([])
		rect.mockRestore()
	})
})
