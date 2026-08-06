import {
	DEFAULT_MAX_ROWS,
	LABEL_COLUMN,
	NOTE_NODE_TYPE,
	TABLE_NODE_TYPE,
	TAGS_PROPERTY_ID,
	createProperty,
	updateShapeProperties,
	type PropertyValue,
	type TableNodeProps,
} from '@lifeboard/node-kit'
import type { Editor, TLShapeId, TLShapePartial } from 'tldraw'
import { createShapeId } from 'tldraw'

/**
 * The first-run demo board: the user's real shopping use case, reproduced so the product explains
 * itself on open.
 *
 * Rebuilt on notes + properties in Phase 2. The visible result is nearly identical to the item-card
 * version it replaces, which is the point — the card was never the valuable part. What changed is that
 * the price on a note is the *same kind of thing* as a price on a photo or a sticky, so the rollup no
 * longer filters by node type at all.
 */
interface DemoThing {
	title: string
	price: number
	category: string
	tags: string[]
	x: number
	y: number
}

const DEMO_THINGS: DemoThing[] = [
	{ title: 'Standing desk', price: 2399, category: 'desk', tags: ['furniture'], x: 80, y: 140 },
	{ title: 'Desk chair', price: 850, category: 'desk', tags: ['furniture'], x: 330, y: 140 },
	{ title: 'Monitor arm', price: 240, category: 'desk', tags: ['furniture'], x: 580, y: 140 },
	{ title: 'Floor lamp', price: 320, category: 'lighting', tags: ['decor'], x: 80, y: 440 },
	{ title: 'Desk lamp', price: 120, category: 'lighting', tags: ['decor'], x: 330, y: 440 },
	{ title: 'Rug', price: 480, category: 'soft', tags: ['decor'], x: 580, y: 440 },
]

/**
 * Starting height of a demo note. Auto-height corrects it on first paint; this is just close enough
 * that the cards don't visibly jump.
 */
const THING_HEIGHT = 132

export function seedDemoBoard(editor: Editor): void {
	// One history entry for the whole demo, so a user who doesn't want it can undo it in one step —
	// registry writes included, since `createProperty` writes to the document record.
	editor.run(() => {
		// The registry first: `updateShapeProperties` builds each shape's definition sidecar from it, so
		// creating shapes before the definitions exist would leave them with empty sidecars.
		const price = createProperty(editor, { name: 'Price', type: 'financial', unit: 'GEL' })
		const category = createProperty(editor, {
			name: 'Category',
			type: 'select',
			options: ['desk', 'lighting', 'soft'],
		})
		const tags = createProperty(editor, {
			id: TAGS_PROPERTY_ID,
			name: 'Tags',
			type: 'multiSelect',
			options: ['furniture', 'decor'],
		})

		const shapes: TLShapePartial[] = []

		const noteId: TLShapeId = createShapeId()
		shapes.push({
			id: noteId,
			type: NOTE_NODE_TYPE,
			x: 80,
			y: -150,
			props: {
				w: 480,
				h: 210,
				md: [
					'# Home office shopping',
					'',
					'Every card below is a **note** that carries properties — a price and a category, the same way a photo or a sticky note could.',
					'',
					'- Double-click a note to write in it',
					'- Right-click one and choose **Properties** to add or edit its data',
					'- The **▦ table** nodes on the right show everything with a price, live',
				].join('\n'),
				autoHeight: false,
			} satisfies Record<string, unknown> as never,
		})

		const thingIds: TLShapeId[] = []
		for (const thing of DEMO_THINGS) {
			const id = createShapeId()
			thingIds.push(id)
			shapes.push({
				id,
				type: NOTE_NODE_TYPE,
				x: thing.x,
				y: thing.y,
				props: {
					w: 220,
					h: THING_HEIGHT,
					md: `# ${thing.title}`,
					// Auto-height, not a pinned height: the card has to fit its property strip, and the
					// strip grows as properties are added. A fixed height clipped the tag chips off the
					// bottom the moment there were three rows — and would clip anything added later.
					autoHeight: true,
				} satisfies Record<string, unknown> as never,
			})
		}

		const priceId = price?.id ?? 'price'
		// `shapeTypes: null` — anything carrying a price counts, which is the change Phase 2 made. The
		// filter is what makes that usable: without it the table lists the intro note and the other table
		// as rows with no price, which is technically true and completely unhelpful.
		const source = {
			shapeTypes: null,
			scope: 'page' as const,
			frameId: null,
			filters: [{ propertyId: priceId, op: 'isNotEmpty' as const, value: null }],
		}

		// The big number, which is a table in `value` mode — the same node type as the grid below it.
		const totalProps: TableNodeProps & { w: number; h: number } = {
			w: 280,
			h: 150,
			title: 'Total spend',
			source,
			columns: [{ key: priceId, summary: 'sum', width: 1 }],
			groupBy: null,
			sorts: [],
			layout: { mode: 'value', maxRows: DEFAULT_MAX_ROWS },
			rates: {},
		}
		shapes.push({
			id: createShapeId(),
			type: TABLE_NODE_TYPE,
			x: 880,
			y: 140,
			props: totalProps as never,
		})

		// And the same data as a real table, grouped by category and sorted by price — so the demo shows
		// both faces of the node.
		const tableProps: TableNodeProps & { w: number; h: number } = {
			w: 380,
			h: 300,
			title: 'Everything',
			source,
			columns: [
				{ key: LABEL_COLUMN, summary: 'count', width: 2 },
				{ key: priceId, summary: 'sum', width: 1 },
			],
			groupBy: category?.id ?? 'category',
			sorts: [{ key: priceId, dir: 'desc' }],
			layout: { mode: 'table', maxRows: DEFAULT_MAX_ROWS },
			rates: {},
		}
		shapes.push({
			id: createShapeId(),
			type: TABLE_NODE_TYPE,
			x: 880,
			y: 330,
			props: tableProps as never,
		})

		editor.createShapes(shapes)

		// Values go on after creation: they live in `meta`, and `updateShapeProperties` is the one path
		// that keeps the values and the definition sidecar in step.
		thingIds.forEach((id, i) => {
			const thing = DEMO_THINGS[i]!
			const shape = editor.getShape(id)
			if (!shape) return
			const values: Record<string, PropertyValue> = {}
			if (price) values[price.id] = thing.price
			if (category) values[category.id] = thing.category
			if (tags) values[tags.id] = thing.tags
			updateShapeProperties(editor, shape, values)
		})
	})
	editor.zoomToFit({ animation: { duration: 0 } })
}
