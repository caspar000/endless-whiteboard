import { ITEM_NODE_TYPE, MARKDOWN_NODE_TYPE, ROLLUP_NODE_TYPE, type ItemNodeProps, type NodeField, type RollupNodeProps } from '@lifeboard/node-kit'
import type { Editor, TLShapeId, TLShapePartial } from 'tldraw'
import { createShapeId } from 'tldraw'

/**
 * The first-run demo board (milestone 10): the user's real shopping use case, reproduced so the
 * product explains itself on open — item nodes with ₾ prices and categories, plus two rollups that
 * update live as items are edited.
 */
interface DemoItem {
	title: string
	price: number
	category: string
	tags: string[]
	x: number
	y: number
}

const DEMO_ITEMS: DemoItem[] = [
	{ title: 'Standing desk', price: 2399, category: 'desk', tags: ['furniture'], x: 80, y: 140 },
	{ title: 'Desk chair', price: 850, category: 'desk', tags: ['furniture'], x: 330, y: 140 },
	{ title: 'Monitor arm', price: 240, category: 'desk', tags: ['furniture'], x: 580, y: 140 },
	{ title: 'Floor lamp', price: 320, category: 'lighting', tags: ['decor'], x: 80, y: 440 },
	{ title: 'Desk lamp', price: 120, category: 'lighting', tags: ['decor'], x: 330, y: 440 },
	{ title: 'Rug', price: 480, category: 'soft', tags: ['decor'], x: 580, y: 440 },
]

function itemFields(price: number, category: string): NodeField[] {
	return [
		{ key: 'price', type: 'currency', value: price, unit: 'GEL' },
		{ key: 'category', type: 'select', value: category },
	]
}

export function seedDemoBoard(editor: Editor): void {
	const shapes: TLShapePartial[] = []

	const noteId: TLShapeId = createShapeId()
	shapes.push({
		id: noteId,
		type: MARKDOWN_NODE_TYPE,
		x: 80,
		y: -120,
		props: {
			w: 480,
			h: 200,
			md: [
				'# Home office shopping',
				'',
				'Every card below is an **item node** — a record with typed fields, not just a picture.',
				'',
				'- Double-click an item to edit its title, fields and tags',
				'- The **Σ rollup** nodes on the right total them live',
				'- Delete an impulse buy and the totals follow',
			].join('\n'),
		} satisfies Record<string, unknown> as never,
	})

	for (const item of DEMO_ITEMS) {
		const props: ItemNodeProps & { w: number; h: number } = {
			w: 220,
			h: 260,
			title: item.title,
			imageAssetId: null,
			tags: item.tags,
			fields: itemFields(item.price, item.category),
		}
		shapes.push({
			id: createShapeId(),
			type: ITEM_NODE_TYPE,
			x: item.x,
			y: item.y,
			props: props as never,
		})
	}

	const totalProps: RollupNodeProps & { w: number; h: number } = {
		w: 280,
		h: 150,
		title: 'Total spend',
		source: { scope: 'page', frameId: null, tags: [], nodeType: ITEM_NODE_TYPE },
		agg: { op: 'sum', fieldKey: 'price', groupBy: null },
		format: { style: 'currency', unit: 'GEL' },
	}
	shapes.push({ id: createShapeId(), type: ROLLUP_NODE_TYPE, x: 880, y: 140, props: totalProps as never })

	const byCategoryProps: RollupNodeProps & { w: number; h: number } = {
		w: 280,
		h: 230,
		title: 'By category',
		source: { scope: 'page', frameId: null, tags: [], nodeType: ITEM_NODE_TYPE },
		agg: { op: 'sum', fieldKey: 'price', groupBy: 'category' },
		format: { style: 'currency', unit: 'GEL' },
	}
	shapes.push({
		id: createShapeId(),
		type: ROLLUP_NODE_TYPE,
		x: 880,
		y: 330,
		props: byCategoryProps as never,
	})

	// One history entry, so a user who doesn't want the demo can undo it in a single step.
	editor.run(() => {
		editor.createShapes(shapes)
	})
	editor.zoomToFit({ animation: { duration: 0 } })
}
