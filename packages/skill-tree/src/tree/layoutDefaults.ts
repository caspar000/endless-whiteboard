/**
 * Every number the whole-life layout runs on, the maze (tree/maze.ts, docs/skill-tree-layout-plan.md),
 * so they can be set from Settings and the layout tuner instead of in the code. Nothing here needs
 * the canvas; layoutConfig.ts keeps them per device. The layout functions take a config and default
 * to `DEFAULT_LAYOUT`, so tests stay put; the board passes the one set.
 */
export interface LayoutConfig {
	// Node sizes
	skillSize: number
	pillarSize: number
	masterySize: number
	// Maze
	/** The hexagons' size: from one cell's centre to the next. */
	mazeCell: number
	/** Cells from a node to its only child: 1 next door, 2 with a corridor cell between. */
	mazeSpacing: number
	/** The room to start from, in cells per cell the tree takes; the region grows from it until everything fits. */
	mazeRoom: number
	/** How a chain winds: along the walls of the room left, or straight outward. */
	mazeWalk: 'snake' | 'straight'
	/** The cells' shape. */
	mazeGrid: 'hex' | 'square'
	/** Open ground between You and the first cells. */
	mazeHub: number
	// Clusters (the view with everything)
	/** Free space kept between two clusters. */
	clusterGap: number
	/** Free space between two members of a cluster. */
	memberPad: number
	/** Room on each side of an arrow through a cluster's gap. */
	gateRoom: number
	/** Room for a spoke passing between two entries to one on the second orbit. */
	spokeRoom: number
	/** How far round its entry an arc of works reaches, either side of straight out, in degrees. */
	worksArc: number
	/** How much the first orbit widens each time its entries don't fit, as a factor. */
	orbitGrowth: number
	// Arrows
	/**
	 * How much the arrows not running along a corridor curve so that, at each node, they leave at
	 * evenly spaced angles (Lombardi style), against staying straight: 0 curves them only round what
	 * they cross.
	 */
	arrowCurve: number
}

export const DEFAULT_LAYOUT: LayoutConfig = {
	skillSize: 150,
	pillarSize: 210,
	masterySize: 380,
	mazeCell: 210,
	mazeSpacing: 1,
	mazeRoom: 1.5,
	mazeWalk: 'snake',
	mazeGrid: 'hex',
	mazeHub: 20,
	clusterGap: 60,
	memberPad: 12,
	gateRoom: 26,
	spokeRoom: 28,
	worksArc: 95,
	orbitGrowth: 1.12,
	arrowCurve: 0.5,
}

type NumberKey = { [K in keyof LayoutConfig]: LayoutConfig[K] extends number ? K : never }[keyof LayoutConfig]
type ChoiceKey = { [K in keyof LayoutConfig]: LayoutConfig[K] extends string ? K : never }[keyof LayoutConfig]

/** What Settings (under Advanced) and the layout tuner show for each setting, in order. */
export type LayoutField =
	| { key: NumberKey; label: string; hint: string; group: string; min: number; max: number; step: number }
	| { key: ChoiceKey; label: string; hint: string; group: string; options: readonly { value: string; label: string }[] }

export const LAYOUT_FIELDS: readonly LayoutField[] = [
	{ group: 'Maze', key: 'mazeCell', label: 'Hexagon size', hint: 'From one cell’s centre to the next. A skill node is 150 across.', min: 150, max: 600, step: 10 },
	{ group: 'Maze', key: 'mazeSpacing', label: 'Cells to an only child', hint: '1 puts a node next to its only child; 2 leaves a corridor cell between.', min: 1, max: 3, step: 1 },
	{ group: 'Maze', key: 'mazeRoom', label: 'Room to start from', hint: 'Cells per cell the tree takes. The region grows from here until every node fits; more gives a roomier maze.', min: 1, max: 4, step: 0.05 },
	{
		group: 'Maze',
		key: 'mazeWalk',
		label: 'Chains wind',
		hint: 'How a node with one child walks to it.',
		options: [
			{ value: 'snake', label: 'Along the walls' },
			{ value: 'straight', label: 'Straight outward' },
		],
	},
	{
		group: 'Maze',
		key: 'mazeGrid',
		label: 'Cells',
		hint: 'Hexagons give six ways out of a cell and smooth turns; squares four and right angles.',
		options: [
			{ value: 'hex', label: 'Hexagons' },
			{ value: 'square', label: 'Squares' },
		],
	},
	{ group: 'Maze', key: 'mazeHub', label: 'Room round You', hint: 'Open ground between You and the first cells.', min: 0, max: 600, step: 10 },
	{ group: 'Node sizes', key: 'skillSize', label: 'Skill node', hint: 'Across, in pixels.', min: 80, max: 300, step: 10 },
	{ group: 'Node sizes', key: 'pillarSize', label: 'Pillar', hint: 'Across, in pixels.', min: 100, max: 400, step: 10 },
	{ group: 'Node sizes', key: 'masterySize', label: 'You (the middle)', hint: 'Across, in pixels.', min: 150, max: 700, step: 10 },
	{ group: 'Clusters (with everything shown)', key: 'clusterGap', label: 'Gap between clusters', hint: 'Free space kept between two clusters.', min: 0, max: 400, step: 5 },
	{ group: 'Clusters (with everything shown)', key: 'memberPad', label: 'Space between members', hint: 'Free space between two cards of a cluster.', min: 0, max: 80, step: 2 },
	{ group: 'Clusters (with everything shown)', key: 'gateRoom', label: 'Room for an arrow through a cluster', hint: 'Each side of an arrow passing through a cluster’s gap.', min: 0, max: 120, step: 2 },
	{ group: 'Clusters (with everything shown)', key: 'spokeRoom', label: 'Room for a spoke to the outer orbit', hint: 'For a spoke between two entries to one further out.', min: 0, max: 120, step: 2 },
	{ group: 'Clusters (with everything shown)', key: 'worksArc', label: 'Arc of works round an entry (°)', hint: 'Either side of straight out.', min: 20, max: 180, step: 5 },
	{ group: 'Clusters (with everything shown)', key: 'orbitGrowth', label: 'First orbit growth', hint: 'How much the first orbit widens each time its entries don’t fit.', min: 1.02, max: 1.5, step: 0.01 },
	{ group: 'Arrows', key: 'arrowCurve', label: 'How much arrows curve to spread evenly', hint: 'For arrows not along a corridor. 0 curves them only round what they cross.', min: 0, max: 1, step: 0.05 },
]

/** Only the known settings, each of the right type and in range. */
export function clean(raw: Partial<Record<keyof LayoutConfig, unknown>>): LayoutConfig {
	const out: LayoutConfig = { ...DEFAULT_LAYOUT }
	for (const field of LAYOUT_FIELDS) {
		const v = raw[field.key]
		if ('min' in field) {
			if (typeof v === 'number' && Number.isFinite(v)) out[field.key] = Math.min(field.max, Math.max(field.min, v))
		} else if (typeof v === 'string' && field.options.some((o) => o.value === v)) {
			;(out as unknown as Record<string, string>)[field.key] = v
		}
	}
	return out
}
