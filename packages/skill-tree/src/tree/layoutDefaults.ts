/**
 * The whole-life layout's settings with nothing that needs the canvas, so the layout can run in a
 * worker (layoutWorker.ts); layoutConfig.ts keeps them per device.
 */
/**
 * Every number the whole-life layout runs on (docs/skill-tree-layout-plan.md), so they can be tuned
 * from the board (tree/LayoutTuner.tsx) instead of in the code. The layout functions take a config
 * and default to `DEFAULT_LAYOUT`, so tests stay put; the board passes the tuned one.
 */
export interface LayoutConfig {
	// Sizes
	skillSize: number
	pillarSize: number
	masterySize: number
	// Skeleton
	/**
	 * How skill nodes are placed: in strictly nested cones, then compacted with no move allowed to
	 * cross or overlap (compact.ts); in bubbles, each subtree in a circle packed round its parent
	 * (bubbles.ts); in radial wedges compacted wedge by wedge (wedges.ts); in cones,
	 * every node's children in slices of its cone (cones.ts); in
	 * bands, one ring per level, each branch a wedge (bands.ts); each
	 * from its parent (a balloon layout, balloon.ts); or on rings round the middle, in slices.
	 */
	placement: 'compactCones' | 'compactBubbles' | 'bubbles' | 'wedges' | 'cones' | 'bands' | 'fromParent' | 'rings'
	/** How far round its node a family of children may fan, in degrees (placed from the parent). */
	fanSpread: number
	/** In bubbles: each family round its parent with its biggest branch in the middle and smallest at the ends. */
	balanceSiblings: boolean
	/**
	 * Each level's border round You, set by hand from the band guides (tree/BandGuides.tsx), the first
	 * the pillars'; 0 or missing leaves a border to the layout (in bands).
	 */
	bandBorders: number[]
	/** The pillars' border round You, unless set by hand (in bands). */
	bandFirst: number
	/** The tree roots' border. */
	bandSecond: number
	/** The third level's border. */
	bandThird: number
	/** How much further out each border past the third is than the one inside it. */
	bandStep: number
	/** The most bands a family splits over when one band's arc is too short for it (in bands). */
	bandRows: number
	/** In cones: move the family of each of two colliding skill nodes out until none collide. */
	coneGrow: boolean
	/** How far out from a node its expand circle reaches to start with: its children go inside it (in bands). */
	expandRadius: number
	/** Keep every branch off the arrow into its own node, at the cost of longer arrows (placed from the parent). */
	keepWayBack: boolean
	/** Open ground between the middle and the pillars, for the arrows out to them. */
	hubRoom: number
	/** Free space kept between two clusters when the skeleton is placed. */
	clusterGap: number
	/** The narrowest a pillar's slice may be, in degrees. */
	minSlice: number
	/** Levels below the middle that share one ring across the board (pillars, tree roots). */
	sharedLevels: number
	// Clusters
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
	// Compaction
	/** Slide each branch toward the node it hangs from. */
	slideToParent: boolean
	/** Draw each branch, whole, toward the middle. */
	gravity: boolean
	/** Draw each cluster toward its nearest neighbour (ShrinkTree). */
	shrinkTree: boolean
	/** The least free space between two nodes while compacting. */
	compactGap: number
	gravityRounds: number
	shrinkRounds: number
	/** How far from straight in gravity may move a branch, in degrees. */
	gravityFan: number
	/** The longest an arrow between skill nodes may get, edge to edge: compaction never stretches one past it. */
	maxArrow: number
	/** What a move may not make worse: every crossing (of nodes, light lines and arrows), of skill nodes and arrows, or nothing. */
	arrowRule: 'skills' | 'all' | 'none'
	/** Last, turn each cluster so its gaps face where its arrows come in. */
	reorientClusters: boolean
	/** Then push every node an arrow runs through off it, sideways, as if the arrow were solid. */
	pushOffArrows: boolean
	/** Last, turn branches and clusters a little where that leaves fewer crossings (phase B, step 3). */
	repairCrossings: boolean
	/**
	 * How much the arrows between skill nodes curve so that, at each node, they leave at evenly spaced
	 * angles (Lombardi style), against staying straight: 0 curves them only round what they cross.
	 */
	arrowCurve: number
}

export const DEFAULT_LAYOUT: LayoutConfig = {
	skillSize: 150,
	pillarSize: 210,
	masterySize: 380,
	placement: 'compactBubbles',
	fanSpread: 240,
	balanceSiblings: false,
	keepWayBack: false,
	bandBorders: [],
	bandFirst: 750,
	bandSecond: 1000,
	bandThird: 2500,
	bandStep: 1500,
	bandRows: 2,
	expandRadius: 1200,
	coneGrow: true,
	hubRoom: 150,
	clusterGap: 60,
	minSlice: 40,
	sharedLevels: 2,
	memberPad: 12,
	gateRoom: 26,
	spokeRoom: 28,
	worksArc: 95,
	orbitGrowth: 1.12,
	slideToParent: true,
	gravity: true,
	shrinkTree: true,
	compactGap: 12,
	gravityRounds: 4,
	shrinkRounds: 4,
	gravityFan: 60,
	maxArrow: 600,
	arrowRule: 'all',
	reorientClusters: true,
	pushOffArrows: true,
	repairCrossings: true,
	arrowCurve: 0.5,
}

type NumberKey = { [K in keyof LayoutConfig]: LayoutConfig[K] extends number ? K : never }[keyof LayoutConfig]
type BooleanKey = { [K in keyof LayoutConfig]: LayoutConfig[K] extends boolean ? K : never }[keyof LayoutConfig]

/** What the tuner shows for each setting, in order. */
export type LayoutField =
	| { key: NumberKey; label: string; min: number; max: number; step: number; group: string }
	| { key: BooleanKey; label: string; group: string }
	| { key: 'arrowRule'; label: string; group: string; options: readonly { value: LayoutConfig['arrowRule']; label: string }[] }
	| { key: 'placement'; label: string; group: string; options: readonly { value: LayoutConfig['placement']; label: string }[] }

export const LAYOUT_FIELDS: readonly LayoutField[] = [
	{ group: 'Sizes', key: 'skillSize', label: 'Skill node', min: 80, max: 300, step: 10 },
	{ group: 'Sizes', key: 'pillarSize', label: 'Pillar', min: 100, max: 400, step: 10 },
	{ group: 'Sizes', key: 'masterySize', label: 'You (the middle)', min: 150, max: 700, step: 10 },
	{
		group: 'Skeleton',
		key: 'placement',
		label: 'Place skill nodes',
		options: [
			{ value: 'compactCones', label: 'Cones, compacted without crossing' },
			{ value: 'compactBubbles', label: 'Bubbles, compacted without crossing' },
			{ value: 'bubbles', label: 'Bubbles, each subtree in a circle' },
			{ value: 'wedges', label: 'Radial wedges, compacted per wedge' },
			{ value: 'cones', label: 'In cones, each inside its parent’s' },
			{ value: 'bands', label: 'In bands, one ring per level' },
			{ value: 'fromParent', label: 'From their parent' },
			{ value: 'rings', label: 'On rings round the middle' },
		],
	},
	{ group: 'Skeleton', key: 'fanSpread', label: 'Fan of children round a node (°)', min: 60, max: 330, step: 10 },
	{ group: 'Skeleton', key: 'balanceSiblings', label: 'Balance each fan (biggest in the middle)' },
	{ group: 'Bands', key: 'bandFirst', label: 'Pillars’ border', min: 200, max: 5000, step: 50 },
	{ group: 'Bands', key: 'bandSecond', label: 'Tree roots’ border', min: 200, max: 8000, step: 50 },
	{ group: 'Bands', key: 'bandThird', label: 'Third border', min: 200, max: 12000, step: 50 },
	{ group: 'Bands', key: 'bandStep', label: 'Each border after, further out by', min: 100, max: 4000, step: 50 },
	{ group: 'Bands', key: 'bandRows', label: 'Most bands a family splits over', min: 1, max: 6, step: 1 },
	{ group: 'Bands', key: 'coneGrow', label: 'Cones: move colliding families out' },
	{ group: 'Bands', key: 'expandRadius', label: 'Expand circle to start with (radius)', min: 200, max: 6000, step: 50 },
	{ group: 'Skeleton', key: 'keepWayBack', label: 'Keep branches off the arrow into them' },
	{ group: 'Skeleton', key: 'hubRoom', label: 'Room round the middle', min: 0, max: 600, step: 10 },
	{ group: 'Skeleton', key: 'clusterGap', label: 'Gap between clusters', min: 0, max: 400, step: 5 },
	{ group: 'Skeleton', key: 'minSlice', label: 'Narrowest pillar slice (°)', min: 0, max: 72, step: 1 },
	{ group: 'Skeleton', key: 'sharedLevels', label: 'Rings shared across the board', min: 0, max: 4, step: 1 },
	{ group: 'Clusters', key: 'memberPad', label: 'Space between members', min: 0, max: 80, step: 2 },
	{ group: 'Clusters', key: 'gateRoom', label: 'Room for an arrow through a cluster', min: 0, max: 120, step: 2 },
	{ group: 'Clusters', key: 'spokeRoom', label: 'Room for a spoke to the outer orbit', min: 0, max: 120, step: 2 },
	{ group: 'Clusters', key: 'worksArc', label: 'Arc of works round an entry (°)', min: 20, max: 180, step: 5 },
	{ group: 'Clusters', key: 'orbitGrowth', label: 'First orbit growth', min: 1.02, max: 1.5, step: 0.01 },
	{ group: 'Compaction', key: 'slideToParent', label: 'Slide branches toward their parent' },
	{ group: 'Compaction', key: 'gravity', label: 'Gravity toward the middle' },
	{ group: 'Compaction', key: 'shrinkTree', label: 'ShrinkTree toward nearest neighbours' },
	{ group: 'Compaction', key: 'compactGap', label: 'Least space while compacting', min: 0, max: 300, step: 2 },
	{ group: 'Compaction', key: 'gravityRounds', label: 'Gravity rounds', min: 0, max: 12, step: 1 },
	{ group: 'Compaction', key: 'shrinkRounds', label: 'ShrinkTree rounds', min: 0, max: 12, step: 1 },
	{ group: 'Compaction', key: 'gravityFan', label: 'Gravity may veer (°)', min: 0, max: 90, step: 5 },
	{ group: 'Arrows', key: 'maxArrow', label: 'Longest arrow (edge to edge)', min: 100, max: 4000, step: 50 },
	{
		group: 'Arrows',
		key: 'arrowRule',
		label: 'Crossings a move may not add',
		options: [
			{ value: 'all', label: 'Any: nodes, lines, arrows' },
			{ value: 'skills', label: 'Skill nodes and arrows' },
			{ value: 'none', label: 'Anything goes' },
		],
	},
	{ group: 'Arrows', key: 'reorientClusters', label: "Turn clusters' gaps toward their arrows" },
	{ group: 'Arrows', key: 'pushOffArrows', label: 'Push nodes off arrows, as if solid' },
	{ group: 'Arrows', key: 'repairCrossings', label: 'Turn branches to repair crossings' },
	{ group: 'Arrows', key: 'arrowCurve', label: 'How much arrows curve to spread evenly', min: 0, max: 1, step: 0.05 },
]

/** The furthest a border can be set by hand, so a drag that runs off the window can't fling it away. */
export const MAX_BORDER = 30000

/** Only the known settings, each of the right type and in range. */
export function clean(raw: Partial<Record<keyof LayoutConfig, unknown>>): LayoutConfig {
	const out = { ...DEFAULT_LAYOUT }
	const borders = raw.bandBorders
	if (Array.isArray(borders)) out.bandBorders = borders.map((b) => (typeof b === 'number' && Number.isFinite(b) && b > 0 ? Math.min(MAX_BORDER, b) : 0))
	for (const field of LAYOUT_FIELDS) {
		const v = raw[field.key]
		if ('min' in field) {
			if (typeof v === 'number' && Number.isFinite(v)) (out[field.key] as number) = Math.min(field.max, Math.max(field.min, v))
		} else if ('options' in field) {
			if (field.key === 'arrowRule' && field.options.some((o) => o.value === v)) out.arrowRule = v as LayoutConfig['arrowRule']
			if (field.key === 'placement' && field.options.some((o) => o.value === v)) out.placement = v as LayoutConfig['placement']
		} else if (typeof v === 'boolean') (out[field.key] as boolean) = v
	}
	return out
}
