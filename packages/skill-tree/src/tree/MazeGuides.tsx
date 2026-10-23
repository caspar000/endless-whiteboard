import { atom, useEditor, useValue, type TLShapeId } from '@lifeboard/canvas'
import type { MazeGrid } from './maze'

/**
 * The hexagon view (layout tuner): the cells of the last maze laid out (tree/maze.ts) drawn on the
 * board round the node it grew from, the ones the tree took brighter than the free ones, to see how
 * the region and its corridors come out.
 */

const KEY = 'lifeboard:skill-tree-maze-guides'
const shown = atom<boolean>(KEY, typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === 'true')

export const mazeGuidesShown = (): boolean => shown.get()

export function showMazeGuides(on: boolean): void {
	shown.set(on)
	try {
		localStorage.setItem(KEY, String(on))
	} catch {
		// Kept for this session only.
	}
}

/** The last maze's grid and the shape it grew from (viewSync.ts sets it). */
export const lastMazeGrid = atom<(MazeGrid & { start: TLShapeId }) | null>('lifeboard:skill-tree-maze-grid', null)

export function MazeGuides() {
	const editor = useEditor()
	const on = useValue('lifeboard:skill-tree-maze-guides-shown', () => shown.get(), [])
	const cells = useValue(
		'lifeboard:skill-tree-maze-guides-cells',
		() => {
			const g = lastMazeGrid.get()
			if (!on || !g) return null
			const b = editor.getShapePageBounds(g.start)
			if (!b) return null
			const z = editor.getCamera().z
			const used = new Set(g.used)
			// A flat-topped hexagon's corners are a cell's centre-to-centre distance over √3 out; a square's half of it.
			const reach = (g.shape === 'hex' ? g.cell / Math.sqrt(3) : g.cell / 2) * z
			return g.cells.map((c, i) => {
				const p = editor.pageToViewport({ x: b.center.x + c.x, y: b.center.y + c.y })
				const corners =
					g.shape === 'hex'
						? Array.from({ length: 6 }, (_, k) => `${p.x + reach * Math.cos((k * Math.PI) / 3)},${p.y + reach * Math.sin((k * Math.PI) / 3)}`)
						: [`${p.x - reach},${p.y - reach}`, `${p.x + reach},${p.y - reach}`, `${p.x + reach},${p.y + reach}`, `${p.x - reach},${p.y + reach}`]
				return { key: i, points: corners.join(' '), used: used.has(i) }
			})
		},
		[editor, on]
	)
	if (!cells) return null
	return (
		<svg className="lb-band-guides" aria-hidden>
			{cells.map((c) => (
				<polygon key={c.key} className={`lb-maze-guides__cell${c.used ? ' lb-maze-guides__cell--used' : ''}`} points={c.points} />
			))}
		</svg>
	)
}
