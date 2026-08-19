import { describe, expect, it } from 'vitest'
import {
	KANBAN_METRICS,
	contentTop,
	kanbanSlots,
	laneAt,
	laneBoxes,
	type LaneMember,
} from './kanbanLayout'

const { pad, laneGap, cardGap, emptyLaneHeight } = KANBAN_METRICS

describe('laneBoxes', () => {
	it('divides the card between its lanes', () => {
		const boxes = laneBoxes(['a', 'b'], 400)
		const width = (400 - pad * 2 - laneGap) / 2
		expect(boxes).toEqual([
			{ key: 'a', x: pad, width },
			{ key: 'b', x: pad + width + laneGap, width },
		])
	})

	/** Width is derived, never stored — so a wider card means wider lanes, which is what a side handle
	 * looks like it should do. */
	it('widens every lane when the card is widened', () => {
		const [narrow] = laneBoxes(['a', 'b', 'c'], 600)
		const [wide] = laneBoxes(['a', 'b', 'c'], 900)
		expect(wide!.width).toBeGreaterThan(narrow!.width)
	})

	it('is empty with no lanes', () => {
		expect(laneBoxes([], 400)).toEqual([])
	})

	/** A card too narrow for its lanes is a card to widen; NaN or negative geometry would take the
	 * board's rendering down instead of merely looking cramped. */
	it('never goes to zero or below on an impossibly narrow card', () => {
		for (const box of laneBoxes(['a', 'b', 'c', 'd'], 10)) {
			expect(box.width).toBeGreaterThan(0)
			expect(Number.isFinite(box.x)).toBe(true)
		}
	})
})

describe('laneAt', () => {
	const boxes = laneBoxes(['todo', 'doing', 'done'], 620)
	const below = contentTop()

	it('finds the lane a point is inside', () => {
		for (const box of boxes) {
			expect(laneAt(boxes, { x: box.x + box.width / 2, y: below })).toBe(box.key)
		}
	})

	/**
	 * The gutters are eight pixels wide. A drop that landed in one and did nothing would read as the
	 * gesture being unreliable, so every x inside the card belongs to a lane.
	 */
	it('gives a gutter to the lane beside it', () => {
		const gap = boxes[0]!.x + boxes[0]!.width + KANBAN_METRICS.laneGap / 2
		expect(laneAt(boxes, { x: gap, y: below })).toBe('todo')
		expect(laneAt(boxes, { x: KANBAN_METRICS.pad / 2, y: below })).toBe('todo')
		const past = boxes[2]!.x + boxes[2]!.width + KANBAN_METRICS.pad / 2
		expect(laneAt(boxes, { x: past, y: below })).toBe('done')
	})

	/** The title strip is the card's own name, not a column: a drop there is a miss, not a guess. */
	it('is nothing at all on the title strip', () => {
		expect(laneAt(boxes, { x: boxes[1]!.x, y: KANBAN_METRICS.titleHeight - 1 })).toBeNull()
		expect(laneAt(boxes, { x: boxes[1]!.x, y: KANBAN_METRICS.titleHeight })).toBe('doing')
	})

	it('is nothing when there are no lanes', () => {
		expect(laneAt([], { x: 10, y: below })).toBeNull()
	})
})

describe('kanbanSlots', () => {
	const member = (id: string, height: number): LaneMember => ({ id, height })

	it('stacks a lane top to bottom, each card below the last', () => {
		const boxes = laneBoxes(['todo'], 300)
		const { slots } = kanbanSlots(boxes, new Map([['todo', [member('a', 40), member('b', 60)]]]))
		expect(slots.get('a')).toEqual({ x: pad, y: contentTop() })
		expect(slots.get('b')).toEqual({ x: pad, y: contentTop() + 40 + cardGap })
	})

	it('puts each lane at its own left edge', () => {
		const boxes = laneBoxes(['todo', 'done'], 400)
		const { slots } = kanbanSlots(
			boxes,
			new Map([
				['todo', [member('a', 40)]],
				['done', [member('b', 40)]],
			])
		)
		expect(slots.get('a')!.x).toBe(boxes[0]!.x)
		expect(slots.get('b')!.x).toBe(boxes[1]!.x)
	})

	it('is as tall as its tallest lane', () => {
		const boxes = laneBoxes(['a', 'b'], 400)
		const { height } = kanbanSlots(
			boxes,
			new Map([
				['a', [member('1', 100), member('2', 100)]],
				['b', [member('3', 40)]],
			])
		)
		// Two 100px cards and the gap between them — not a third gap after the last one, which would
		// leave a lane looking like it was waiting for another card.
		expect(height).toBe(contentTop() + 100 + cardGap + 100 + pad)
	})

	it('gives an empty kanban a body to drop into', () => {
		const { slots, height } = kanbanSlots(laneBoxes(['a'], 300), new Map())
		expect(slots.size).toBe(0)
		expect(height).toBe(contentTop() + emptyLaneHeight + pad)
	})

	/** A tall card pushes the ones under it down; the lane grows rather than the card shrinking, because
	 * a shape's size belongs to whoever made it. */
	it('lets a tall card push the rest of its lane down', () => {
		const boxes = laneBoxes(['a'], 300)
		const short = kanbanSlots(boxes, new Map([['a', [member('1', 40), member('2', 40)]]]))
		const tall = kanbanSlots(boxes, new Map([['a', [member('1', 400), member('2', 40)]]]))
		expect(tall.slots.get('2')!.y - short.slots.get('2')!.y).toBe(360)
		expect(tall.height).toBeGreaterThan(short.height)
	})

	it('ignores lanes it has no members for', () => {
		const boxes = laneBoxes(['a', 'b', 'c'], 600)
		const { slots } = kanbanSlots(boxes, new Map([['b', [member('1', 40)]]]))
		expect([...slots.keys()]).toEqual(['1'])
		expect(slots.get('1')!.x).toBe(boxes[1]!.x)
	})
})
