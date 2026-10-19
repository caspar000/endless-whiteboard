import { createShapePropsMigrationSequence, type NodeComponentProps, type NodeDefinition } from '@lifeboard/node-kit'
import { useValue } from '@lifeboard/canvas'
import { SlidersHorizontal, X } from 'lucide-react'
import { memo, type SyntheticEvent } from 'react'
import { DEFAULT_LAYOUT, getLayoutConfig, setLayoutConfig, type LayoutConfig } from './layoutConfig'
import { LayoutFields } from './LayoutFields'
import { mazeGuidesShown, showMazeGuides } from './MazeGuides'
import { relayout, relayoutSoon } from './relayout'

export const TUNER_TYPE = 'node.skillLayoutTuner'

/** The card's controls keep their presses from the canvas; its header doesn't, so it drags the card. */
const swallow = (e: SyntheticEvent) => {
	const target = e.target as HTMLElement
	if (!target.closest('.lb-tuner__head') || target.closest('button')) e.stopPropagation()
}

/**
 * The layout tuner (dev builds): the maze's settings (the same ones as Settings › Advanced) on a card
 * on the board, and the hexagon view (MazeGuides.tsx). A change lays every tree view on the board out again. The settings are per device,
 * shared by every board.
 */
function TunerImpl({ editor, shape }: NodeComponentProps<Record<string, never>>) {
	const config = useValue('lifeboard:skill-tree-layout-config', getLayoutConfig, [])
	const hexagons = useValue('lifeboard:skill-tree-maze-guides-tuner', mazeGuidesShown, [])
	const set = (patch: Partial<LayoutConfig>) => {
		setLayoutConfig(patch)
		relayoutSoon(editor)
	}
	return (
		<div className="lb-tuner" onPointerDown={swallow} onPointerUp={swallow} onKeyDown={swallow} onWheel={swallow}>
			<div className="lb-tuner__head">
				<SlidersHorizontal size={15} />
				<span>Layout tuner</span>
				<button type="button" className="lb-tuner__close" title="Remove the tuner" aria-label="Remove the tuner" onClick={() => editor.deleteShape(shape.id)}>
					<X size={14} />
				</button>
			</div>
			<section className="lb-tuner__group">
				<h4>View</h4>
				<label className="lb-tuner__row lb-tuner__row--check">
					<input type="checkbox" checked={hexagons} onChange={(e) => showMazeGuides(e.target.checked)} />
					<span>Show the hexagons</span>
				</label>
			</section>
			<LayoutFields config={config} onChange={set} />
			<div className="lb-tuner__buttons">
				<button type="button" onClick={() => relayout(editor)}>
					Re-run
				</button>
				<button
					type="button"
					onClick={() => {
						setLayoutConfig(DEFAULT_LAYOUT)
						relayoutSoon(editor)
					}}
				>
					Defaults
				</button>
			</div>
		</div>
	)
}

const Tuner = memo(TunerImpl, () => true)

export const tunerNodeDefinition: NodeDefinition<Record<string, never>> = {
	type: TUNER_TYPE,
	label: 'Layout tuner',
	icon: '⚙',
	toolbarIcon: SlidersHorizontal,
	props: {},
	migrations: createShapePropsMigrationSequence({ sequence: [] }),
	defaultProps: () => ({}),
	defaultSize: { w: 360, h: 640 },
	autoHeight: { minHeight: 200 },
	// A dev tool, added from ⌘K in dev builds only: kept out of the dock and the create menu.
	deprecated: true,
	component: Tuner,
}
