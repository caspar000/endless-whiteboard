import { atom, useEditor, useValue } from '@lifeboard/canvas'
import { useState, type PointerEvent } from 'react'
import { isSkill, MASTERY } from '../board'
import { lastBands } from './bands'
import { getLayoutConfig, MAX_BORDER, setLayoutConfig } from './layoutConfig'
import { relayout, relayoutSoon } from './relayout'

/**
 * The band guides (dev builds; docs/skill-tree-layout-plan.md, "Bands"): every level's border round
 * You drawn on the board, each its own colour, with what the last layout made of it: how far round
 * its band is taken at its busiest, and whether the band is thinner than its biggest cluster. Drag a
 * border in or out and the board is laid out again with it there; a dragged border stays where it is
 * put, however crowded its band gets, and the skill nodes whose clusters then overlap are ringed in
 * red. "Reset band borders" in the layout tuner hands them all back to the layout.
 */

const KEY = 'lifeboard:skill-tree-band-guides'
const shown = atom<boolean>(KEY, typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === 'true')

export const bandGuidesShown = (): boolean => shown.get()

export function showBandGuides(on: boolean): void {
	shown.set(on)
	try {
		localStorage.setItem(KEY, String(on))
	} catch {
		// Kept for this session only.
	}
}

const colour = (level: number) => `hsl(${(level * 47 + 200) % 360} 75% 55%)`
const NAMES = ['', 'pillars', 'tree roots']
/** Where round its border a level's label sits: from the top, a step clockwise per level. */
const labelAngle = (level: number) => -Math.PI / 2 + (((level - 1) % 10) * Math.PI) / 18

export function BandGuides() {
	const editor = useEditor()
	const on = useValue('lifeboard:skill-tree-band-guides-shown', () => shown.get(), [])
	const report = useValue('lifeboard:skill-tree-band-report', () => lastBands.get(), [])
	const camera = useValue('lifeboard:skill-tree-band-camera', () => editor.getCamera(), [editor])
	const you = useValue(
		'lifeboard:skill-tree-band-you',
		() => {
			const mastery = editor.getCurrentPageShapes().find((s) => isSkill(s) && s.props.kind === MASTERY)
			return mastery ? editor.getShapePageBounds(mastery)?.center : undefined
		},
		[editor]
	)
	const overlapping = useValue(
		'lifeboard:skill-tree-band-overlaps',
		() => {
			const ids = new Set(report?.overlapping ?? [])
			return editor
				.getCurrentPageShapes()
				.filter((s) => isSkill(s) && ids.has(s.props.nodeId))
				.flatMap((s) => {
					const b = editor.getShapePageBounds(s)
					return b ? [{ id: s.id, x: b.center.x, y: b.center.y, r: b.width / 2 }] : []
				})
		},
		[editor, report]
	)
	const [drag, setDrag] = useState<{ level: number; radius: number } | null>(null)
	if (!on || !report || !you) return null
	const z = camera.z
	const c = editor.pageToViewport(you)
	const radiusAt = (e: PointerEvent) => {
		// Past the window's edge the pointer still reports, far out: the drag stops at the edge.
		const x = Math.min(window.innerWidth, Math.max(0, e.clientX))
		const y = Math.min(window.innerHeight, Math.max(0, e.clientY))
		const p = editor.screenToPage({ x, y })
		return Math.min(MAX_BORDER, Math.max(1, Math.round(Math.hypot(p.x - you.x, p.y - you.y))))
	}
	const setBorder = (level: number, radius: number) => {
		const borders = [...getLayoutConfig().bandBorders]
		while (borders.length < level) borders.push(0)
		borders[level - 1] = radius
		setLayoutConfig({ bandBorders: borders })
	}

	return (
		<svg className="lb-band-guides" aria-hidden>
			{overlapping.map((n) => {
				const p = editor.pageToViewport(n)
				return <circle key={n.id} className="lb-band-guides__overlap" cx={p.x} cy={p.y} r={(n.r + 40) * z} />
			})}
			{report.borders.map((border, i) => {
				const level = i + 1
				const r = (drag?.level === level ? drag.radius : border) * z
				const trouble = report.full[i]! > 1 + 1e-6 || report.thin[i]
				const label = `${level}${NAMES[level] ? ` · ${NAMES[level]}` : ''} · ${Math.round(drag?.level === level ? drag.radius : border)} px · ${Math.round(report.full[i]! * 100)}% round${report.thin[i] ? ' · too thin' : ''}${report.set[i] ? ' · set' : ''}`
				return (
					<g key={level} style={{ color: trouble ? 'var(--lb-danger, #e5484d)' : colour(level) }}>
						<circle className="lb-band-guides__ring" cx={c.x} cy={c.y} r={r} strokeDasharray={report.set[i] ? undefined : '10 6'} />
						<circle
							className="lb-band-guides__hit"
							cx={c.x}
							cy={c.y}
							r={r}
							onPointerDown={(e) => {
								e.stopPropagation()
								e.preventDefault()
								e.currentTarget.setPointerCapture(e.pointerId)
								setDrag({ level, radius: radiusAt(e) })
							}}
							onPointerMove={(e) => {
								if (drag?.level !== level) return
								e.stopPropagation()
								const radius = radiusAt(e)
								setDrag({ level, radius })
								setBorder(level, radius)
								relayoutSoon(editor)
							}}
							onPointerUp={(e) => {
								if (drag?.level !== level) return
								e.stopPropagation()
								setBorder(level, radiusAt(e))
								setDrag(null)
								relayout(editor)
							}}
						/>
						<text
							className="lb-band-guides__label"
							// Each level's label a little further round, so close borders' labels don't sit on each other.
							x={c.x + (r + 10) * Math.cos(labelAngle(level))}
							y={c.y + (r + 10) * Math.sin(labelAngle(level))}
							textAnchor="middle"
						>
							{label}
						</text>
					</g>
				)
			})}
		</svg>
	)
}
