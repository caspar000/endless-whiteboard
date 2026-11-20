// @vitest-environment jsdom
import { T } from '@lifeboard/canvas'
import { cleanup, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyPropsMigrations } from './migrations'
import { SCALE_META_KEY } from './nodeScale'
import { createNodeShapeUtil, type NodeDefinition } from './registry'

/*
 * Shift-scaling as the editor drives it (DARK-7): the real shape util a definition becomes, asked to
 * resize by a select tool that is or isn't resizing with Shift held, and the content it then draws.
 */

interface Util {
	onResize(shape: unknown, info: unknown): { x?: number; y?: number; props: { w: number; h: number; autoHeight?: boolean }; meta?: Record<string, unknown> }
	component(shape: unknown): ReactElement
}

function definition(over: Partial<NodeDefinition<{ autoHeight: boolean }>> = {}): NodeDefinition<{ autoHeight: boolean }> {
	return {
		type: 'node.test',
		label: 'Test',
		icon: 'T',
		props: { autoHeight: T.boolean },
		migrations: emptyPropsMigrations,
		defaultProps: () => ({ autoHeight: false }),
		defaultSize: { w: 400, h: 300 },
		component: () => <div className="test-content">content</div>,
		...over,
	} as NodeDefinition<{ autoHeight: boolean }>
}

const shapeOf = (props: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
	id: 'shape:a',
	type: 'node.test',
	x: 100,
	y: 100,
	rotation: 0,
	props: { w: 400, h: 300, autoHeight: false, ...props },
	meta,
})

/** The editor as the shape util sees it: which keys are held, what the select tool is doing, the live shape. */
function editorWith({ shift, state = 'select.resizing', live }: { shift: boolean; state?: string; live?: unknown }) {
	return {
		inputs: { shiftKey: shift },
		isIn: (path: string) => path === state,
		getShape: () => live,
		isShapeBeingEdited: () => false,
		run: (fn: () => void) => fn(),
		updateShape: vi.fn(),
	}
}

function utilFor(def: NodeDefinition<{ autoHeight: boolean }>, editor: unknown): Util {
	const Util = createNodeShapeUtil(def) as unknown as new (editor: unknown) => Util
	return new Util(editor)
}

/** A corner drag that doubles the box, from the bottom right. */
const doubling = (shape: ReturnType<typeof shapeOf>) => ({
	newPoint: { x: shape.x, y: shape.y },
	handle: 'bottom_right',
	mode: 'resize_bounds',
	scaleX: 2,
	scaleY: 2,
	initialBounds: { x: 0, y: 0, w: shape.props.w, h: shape.props.h },
	initialShape: shape,
})

describe('a corner drag with Shift held', () => {
	it('scales the node: box and scale grow together', () => {
		const shape = shapeOf()
		const out = utilFor(definition(), editorWith({ shift: true, live: shape })).onResize(shape, doubling(shape))
		expect(out.props).toMatchObject({ w: 800, h: 600 })
		expect(out.meta?.[SCALE_META_KEY]).toBe(2)
	})

	it('scales on from the scale a node already has', () => {
		const shape = shapeOf({}, { [SCALE_META_KEY]: 1.5 })
		const out = utilFor(definition(), editorWith({ shift: true, live: shape })).onResize(shape, { ...doubling(shape), scaleX: 1.2, scaleY: 1.2 })
		expect(out.meta?.[SCALE_META_KEY]).toBeCloseTo(1.8)
	})

	it('scales an auto-height node both ways, leaving its height following its content', () => {
		const shape = shapeOf({ autoHeight: true })
		const def = definition({ autoHeight: { minHeight: 100 }, defaultProps: () => ({ autoHeight: true }) })
		const out = utilFor(def, editorWith({ shift: true, live: shape })).onResize(shape, doubling(shape))
		// Not pinned: `autoHeight` is left as it was, so the height goes on following the content.
		expect(out.props).toEqual({ w: 800, h: 600 })
		expect(out.meta?.[SCALE_META_KEY]).toBe(2)
	})

	it('only resizes a node type that opts out, as the table does', () => {
		const shape = shapeOf()
		const out = utilFor(definition({ scalable: false }), editorWith({ shift: true, live: shape })).onResize(shape, { ...doubling(shape), scaleY: 1 })
		expect(out.props).toMatchObject({ w: 800, h: 300 })
		expect(out.meta).toBeUndefined()
	})

	it("doesn't scale when the editor resizes for another reason (a flip, a stretch) with Shift down by chance", () => {
		const shape = shapeOf()
		const out = utilFor(definition(), editorWith({ shift: true, state: 'select.idle', live: shape })).onResize(shape, { ...doubling(shape), scaleY: 1 })
		expect(out.props).toMatchObject({ w: 800, h: 300 })
		expect(out.meta).toBeUndefined()
	})
})

describe('a corner drag without Shift', () => {
	it('resizes: the box changes on its own and the scale stays', () => {
		const shape = shapeOf({}, { [SCALE_META_KEY]: 1.5 })
		const out = utilFor(definition(), editorWith({ shift: false, live: shape })).onResize(shape, { ...doubling(shape), scaleY: 1 })
		expect(out.props).toMatchObject({ w: 800, h: 300 })
		expect(out.meta).toBeUndefined()
	})

	it('puts back the scale the drag started at when Shift was let go part-way', () => {
		const start = shapeOf({}, { [SCALE_META_KEY]: 1.5 })
		// The frames with Shift held wrote 3; the drag goes on without it.
		const live = { ...start, meta: { [SCALE_META_KEY]: 3 } }
		const out = utilFor(definition(), editorWith({ shift: false, live })).onResize(start, { ...doubling(start), scaleY: 1 })
		expect(out.props).toMatchObject({ w: 800, h: 300 })
		expect(out.meta?.[SCALE_META_KEY]).toBe(1.5)
	})
})

describe('what a scaled node draws', () => {
	let observed: ResizeObserverCallback | null = null
	beforeEach(() => {
		observed = null
		vi.stubGlobal(
			'ResizeObserver',
			class {
				constructor(callback: ResizeObserverCallback) {
					observed = callback
				}
				observe() {}
				disconnect() {}
			}
		)
		vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
			fn(0)
			return 1
		})
	})
	afterEach(() => {
		cleanup()
		vi.unstubAllGlobals()
	})

	const contentOf = (container: HTMLElement) => container.querySelector<HTMLElement>('.lb-node__content')!
	/** The util draws a shape as tldraw draws it: inside a component of its own, since it uses hooks. */
	const Host = ({ util, shape }: { util: Util; shape: unknown }) => util.component(shape)

	it('lays the content out at its unscaled size and draws it scaled, from the corner', () => {
		const shape = shapeOf({ w: 800, h: 600 }, { [SCALE_META_KEY]: 2 })
		const util = utilFor(definition(), editorWith({ shift: false, live: shape }))
		const { container } = render(<Host util={util} shape={shape} />)
		const content = contentOf(container)
		expect(content.style.width).toBe('400px')
		expect(content.style.height).toBe('300px')
		expect(content.style.transform).toBe('scale(2)')
		expect(content.style.transformOrigin).toMatch(/^0(px)? 0(px)?$/)
		expect(container.querySelector('.test-content')).not.toBeNull()
	})

	it('draws an unscaled node exactly as before scaling existed', () => {
		const shape = shapeOf()
		const { container } = render(<Host util={utilFor(definition(), editorWith({ shift: false, live: shape }))} shape={shape} />)
		const content = contentOf(container)
		expect(content.style.width).toBe('100%')
		expect(content.style.transform).toBe('')
	})

	it("ignores a scale on a node type that can't be scaled", () => {
		const shape = shapeOf({}, { [SCALE_META_KEY]: 2 })
		const { container } = render(<Host util={utilFor(definition({ scalable: false }), editorWith({ shift: false, live: shape }))} shape={shape} />)
		expect(contentOf(container).style.transform).toBe('')
	})

	it("gives an auto-height node the height of its content times its scale, and no less than the minimum's", () => {
		const shape = shapeOf({ w: 800, h: 600, autoHeight: true }, { [SCALE_META_KEY]: 2 })
		const editor = editorWith({ shift: false, live: shape })
		const def = definition({ autoHeight: { minHeight: 100 }, defaultProps: () => ({ autoHeight: true }) })
		render(<Host util={utilFor(def, editor)} shape={shape} />)
		const measure = (blockSize: number) => observed!([{ borderBoxSize: [{ blockSize, inlineSize: 400 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver)
		measure(350)
		expect(editor.updateShape).toHaveBeenLastCalledWith(expect.objectContaining({ props: { h: 700 } }))
		measure(40)
		expect(editor.updateShape).toHaveBeenLastCalledWith(expect.objectContaining({ props: { h: 200 } }))
	})
})
