import { atom } from '@lifeboard/canvas'

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
	 * How skill nodes are placed: in bands, one ring per level, each branch a wedge (bands.ts); each
	 * from its parent (a balloon layout, balloon.ts); or on rings round the middle, in slices.
	 */
	placement: 'bands' | 'fromParent' | 'rings'
	/** How far round its node a family of children may fan, in degrees (placed from the parent). */
	fanSpread: number
	/**
	 * Each level's border round You, set by hand from the band guides (tree/BandGuides.tsx), the first
	 * the pillars'; 0 or missing leaves a border to the layout (in bands).
	 */
	bandBorders: number[]
	/** How wide a family may fan on its ring before it splits into staggered rows, in degrees (in bands). */
	bandFan: number
	/** The most rows a family splits into within its band (in bands). */
	bandRows: number
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
}

export const DEFAULT_LAYOUT: LayoutConfig = {
	skillSize: 150,
	pillarSize: 210,
	masterySize: 380,
	placement: 'bands',
	fanSpread: 240,
	keepWayBack: false,
	bandBorders: [],
	bandFan: 90,
	bandRows: 3,
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
			{ value: 'bands', label: 'In bands, one ring per level' },
			{ value: 'fromParent', label: 'From their parent' },
			{ value: 'rings', label: 'On rings round the middle' },
		],
	},
	{ group: 'Skeleton', key: 'fanSpread', label: 'Fan of children round a node (°)', min: 60, max: 330, step: 10 },
	{ group: 'Skeleton', key: 'bandFan', label: 'Widest fan before rows (°, bands)', min: 20, max: 360, step: 5 },
	{ group: 'Skeleton', key: 'bandRows', label: 'Most rows in a band (bands)', min: 1, max: 6, step: 1 },
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
]

const KEY = 'lifeboard:skill-tree-layout'

function read(): LayoutConfig {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LayoutConfig>
		return clean({ ...DEFAULT_LAYOUT, ...raw })
	} catch {
		return { ...DEFAULT_LAYOUT }
	}
}

/** Only the known settings, each of the right type and in range. */
export function clean(raw: Partial<Record<keyof LayoutConfig, unknown>>): LayoutConfig {
	const out = { ...DEFAULT_LAYOUT }
	const borders = raw.bandBorders
	if (Array.isArray(borders)) out.bandBorders = borders.map((b) => (typeof b === 'number' && Number.isFinite(b) && b > 0 ? Math.min(200000, b) : 0))
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

const current = atom<LayoutConfig>('lifeboard:skill-tree-layout', typeof localStorage === 'undefined' ? { ...DEFAULT_LAYOUT } : read())

/** The layout settings in use on every board of this device. */
export const getLayoutConfig = (): LayoutConfig => current.get()

export function setLayoutConfig(patch: Partial<LayoutConfig>): void {
	current.set(clean({ ...current.get(), ...patch }))
	try {
		localStorage.setItem(KEY, JSON.stringify(current.get()))
	} catch {
		// Kept for this session only.
	}
}
