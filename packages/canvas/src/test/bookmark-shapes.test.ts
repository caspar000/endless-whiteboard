import { TLBookmarkShape, createShapeId } from '@lifeboard/canvas-editor'
import {
	BookmarkShapeUtil,
	getHumanReadableAddress,
} from '../lib/shapes/bookmark/BookmarkShapeUtil'
import { TestEditor } from './TestEditor'

let editor: TestEditor

beforeEach(() => {
	editor = new TestEditor()
})
afterEach(() => {
	editor?.dispose()
})

// An empty suite upstream; Vitest, unlike Jest, refuses one.
describe(BookmarkShapeUtil, () => {
	it.todo('has tests')
})

describe('The URL formatter', () => {
	it('Formats URLs as human-readable', () => {
		const ids = {
			a: createShapeId(),
			b: createShapeId(),
			c: createShapeId(),
			d: createShapeId(),
			e: createShapeId(),
			f: createShapeId(),
		}

		editor.createShapes([
			{
				id: ids.a,
				type: 'bookmark',
				props: {
					url: 'https://www.github.com',
				},
			},
			{
				id: ids.b,
				type: 'bookmark',
				props: {
					url: 'https://www.github.com/',
				},
			},
			{
				id: ids.c,
				type: 'bookmark',
				props: {
					url: 'https://www.github.com/TodePond',
				},
			},
			{
				id: ids.d,
				type: 'bookmark',
				props: {
					url: 'https://www.github.com/TodePond/',
				},
			},
			{
				id: ids.e,
				type: 'bookmark',
				props: {
					url: 'https://www.github.com//',
				},
			},
			{
				id: ids.f,
				type: 'bookmark',
				props: {
					url: 'https://www.github.com/TodePond/DreamBerd//',
				},
			},
		])

		const a = editor.getShape<TLBookmarkShape>(ids.a)!
		const b = editor.getShape<TLBookmarkShape>(ids.b)!
		const c = editor.getShape<TLBookmarkShape>(ids.c)!
		const d = editor.getShape<TLBookmarkShape>(ids.d)!
		const e = editor.getShape<TLBookmarkShape>(ids.e)!
		const f = editor.getShape<TLBookmarkShape>(ids.f)!

		expect(getHumanReadableAddress(a)).toBe('www.github.com')
		expect(getHumanReadableAddress(b)).toBe('www.github.com')
		expect(getHumanReadableAddress(c)).toBe('www.github.com/TodePond')
		expect(getHumanReadableAddress(d)).toBe('www.github.com/TodePond')
		expect(getHumanReadableAddress(e)).toBe('www.github.com')
		expect(getHumanReadableAddress(f)).toBe('www.github.com/TodePond/DreamBerd')
	})

	it('resizes bookmarks like any box, so a narrow card can sit beside others', () => {
		const id = createShapeId()
		editor.createShapes([{ id, type: 'bookmark', x: 0, y: 0, props: { url: 'https://www.github.com/TodePond' } }])
		const before = editor.getShape(id) as TLBookmarkShape
		expect(before.props.w).toBe(300)
		expect(before.props.h).toBe(320)

		editor.select(id)
		editor.pointerDown(300, 320, { target: 'selection', handle: 'bottom_right' })
		editor.pointerMove(150, 200)
		editor.pointerUp()

		const after = editor.getShape(id) as TLBookmarkShape
		expect(after.props.w).toBeCloseTo(150)
		expect(after.props.h).toBeCloseTo(200)
	})
})
