import type { Page } from '@playwright/test'

/**
 * A board of `count` distinct shapes for the GPU renderer's checks and benches
 * (docs/gpu-renderer-plan.md): labelled geo shapes, text, notes and markdown nodes on a jittered
 * grid, and one relation in four, bound to two nearby shapes. Seeded, so every run builds the same
 * board. The page caps a board at `MAX_SHAPES_PER_PAGE` (20,000) for now.
 */
export async function insertSynthetic(page: Page, count: number, seed = 1): Promise<{ bounds: { x: number; y: number; w: number; h: number }; shapes: number }> {
	return page.evaluate(
		({ count, seed }) => {
			interface EditorLike {
				createShapes(shapes: Record<string, unknown>[]): void
				createBindings(bindings: Record<string, unknown>[]): void
				getCurrentPageShapes(): unknown[]
				getCurrentPageBounds(): { x: number; y: number; w: number; h: number } | undefined
				run(fn: () => void, opts?: unknown): void
				selectNone(): void
			}
			const editor = (window as unknown as { editor: EditorLike }).editor
			// mulberry32
			let s = seed >>> 0
			const rand = () => {
				s = (s + 0x6d2b79f5) >>> 0
				let t = s
				t = Math.imul(t ^ (t >>> 15), t | 1)
				t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
				return ((t ^ (t >>> 14)) >>> 0) / 4294967296
			}
			const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!
			const text = (v: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: v }] }] })
			const words = ['alpha', 'river', 'stone', 'ember', 'cloud', 'north', 'quiet', 'signal', 'garden', 'copper', 'lantern', 'harbor']
			const phrase = (n: number) => Array.from({ length: n }, () => pick(words)).join(' ')
			const colors = ['black', 'grey', 'violet', 'blue', 'light-blue', 'yellow', 'orange', 'green', 'red'] as const
			const geos = ['rectangle', 'ellipse', 'diamond', 'hexagon', 'star', 'cloud'] as const

			const relations = Math.floor(count / 4)
			const nodes = count - relations
			const cols = Math.ceil(Math.sqrt(nodes))
			const CELL = 320
			const shapes: Record<string, unknown>[] = []
			const at: { x: number; y: number }[] = []
			for (let i = 0; i < nodes; i++) {
				const x = (i % cols) * CELL + rand() * 60
				const y = Math.floor(i / cols) * CELL + rand() * 60
				at.push({ x, y })
				const id = `shape:synth-${i}`
				const kind = rand()
				if (kind < 0.5) shapes.push({ id, type: 'geo', x, y, props: { geo: pick(geos), w: 180 + rand() * 60, h: 120 + rand() * 60, color: pick(colors), fill: pick(['none', 'semi', 'solid']), richText: text(phrase(2 + Math.floor(rand() * 3))) } })
				else if (kind < 0.7) shapes.push({ id, type: 'text', x, y, props: { richText: text(phrase(3 + Math.floor(rand() * 5))), color: pick(colors) } })
				else if (kind < 0.85) shapes.push({ id, type: 'note', x, y, props: { color: pick(colors), richText: text(phrase(4)) } })
				else shapes.push({ id, type: 'node.markdown', x, y, props: { w: 220, h: 140, md: `# ${phrase(2)}\n\n${phrase(10)}`, autoHeight: false } })
			}
			const arrows: Record<string, unknown>[] = []
			const bindings: Record<string, unknown>[] = []
			for (let r = 0; r < relations; r++) {
				const a = Math.floor(rand() * nodes)
				// A neighbour within a few cells.
				const b = Math.min(nodes - 1, Math.max(0, a + pick([1, -1, cols, -cols, cols + 1, 2])))
				if (a === b) continue
				const id = `shape:synth-rel-${r}`
				arrows.push({ id, type: 'arrow', x: at[a]!.x, y: at[a]!.y, props: { start: { x: 0, y: 0 }, end: { x: at[b]!.x - at[a]!.x, y: at[b]!.y - at[a]!.y }, color: pick(colors), bend: rand() < 0.3 ? (rand() - 0.5) * 120 : 0 } })
				bindings.push(
					{ type: 'arrow', fromId: id, toId: `shape:synth-${a}`, props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
					{ type: 'arrow', fromId: id, toId: `shape:synth-${b}`, props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } }
				)
			}
			editor.run(
				() => {
					for (let i = 0; i < shapes.length; i += 2000) editor.createShapes(shapes.slice(i, i + 2000))
					// Arrows are created with their bindings in the same transaction (phase 4 of the
					// performance plan: otherwise they stay under the store's history).
					for (let i = 0; i < arrows.length; i += 1000) {
						editor.createShapes(arrows.slice(i, i + 1000))
						editor.createBindings(bindings.slice(i * 2, (i + 1000) * 2))
					}
				},
				{ history: 'ignore' }
			)
			editor.selectNone()
			const b = editor.getCurrentPageBounds() ?? { x: 0, y: 0, w: 1, h: 1 }
			return { bounds: { x: b.x, y: b.y, w: b.w, h: b.h }, shapes: editor.getCurrentPageShapes().length }
		},
		{ count, seed }
	)
}
