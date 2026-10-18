import { createShapePropsMigrationSequence, type NodeComponentProps, type NodeDefinition } from '@lifeboard/node-kit'
import { useValue, type Editor } from '@lifeboard/canvas'
import { SlidersHorizontal } from 'lucide-react'
import { memo, useState, type SyntheticEvent } from 'react'
import { isTree } from '../board'
import { syncBoard } from '../treeSync'
import { DEFAULT_LAYOUT, getLayoutConfig, LAYOUT_FIELDS, setLayoutConfig, type LayoutConfig } from './layoutConfig'
import { lastLayoutStats } from './layoutStats'
import { recalculate } from './viewSync'

export const TUNER_TYPE = 'node.skillLayoutTuner'

const swallow = (e: SyntheticEvent) => e.stopPropagation()

/** One layout run per pause in the changes: the whole board takes a second or so to lay out. */
const timers = new WeakMap<Editor, ReturnType<typeof setTimeout>>()
function relayoutSoon(editor: Editor): void {
	clearTimeout(timers.get(editor))
	timers.set(
		editor,
		setTimeout(() => relayout(editor), 450)
	)
}

/** Nodes take their new sizes, then every tree view on the board is laid out again with the settings. */
export function relayout(editor: Editor): void {
	syncBoard(editor)
	for (const header of editor.getCurrentPageShapes().filter(isTree)) recalculate(editor, header)
}

/**
 * The layout tuner (dev builds): every setting of the whole-life layout (tree/layoutConfig.ts) on a
 * card on the board. A change lays every tree view on the board out again; the card shows how that
 * came out. The settings are per device, shared by every board.
 */
function TunerImpl({ editor }: NodeComponentProps<Record<string, never>>) {
	const config = useValue('lifeboard:skill-tree-layout-config', getLayoutConfig, [])
	const stats = useValue('lifeboard:skill-tree-layout-stats-now', () => lastLayoutStats.get(), [])
	const [copied, setCopied] = useState(false)
	const set = (patch: Partial<LayoutConfig>) => {
		setLayoutConfig(patch)
		relayoutSoon(editor)
	}
	const groups = [...new Set(LAYOUT_FIELDS.map((f) => f.group))]

	return (
		<div className="lb-tuner" onPointerDown={swallow} onPointerUp={swallow} onKeyDown={swallow} onWheel={swallow}>
			<div className="lb-tuner__head">
				<SlidersHorizontal size={15} />
				<span>Layout tuner</span>
			</div>
			{groups.map((group) => (
				<section key={group} className="lb-tuner__group">
					<h4>{group}</h4>
					{LAYOUT_FIELDS.filter((f) => f.group === group).map((field) => {
						const changed = config[field.key] !== DEFAULT_LAYOUT[field.key]
						if ('min' in field) {
							const value = config[field.key]
							return (
								<label key={field.key} className={`lb-tuner__row${changed ? ' lb-tuner__row--changed' : ''}`}>
									<span>{field.label}</span>
									<input type="range" min={field.min} max={field.max} step={field.step} value={value} onChange={(e) => set({ [field.key]: Number(e.target.value) })} />
									<input
										type="number"
										min={field.min}
										max={field.max}
										step={field.step}
										value={value}
										onChange={(e) => e.target.value !== '' && set({ [field.key]: Number(e.target.value) })}
									/>
								</label>
							)
						}
						if ('options' in field) {
							return (
								<label key={field.key} className={`lb-tuner__row${changed ? ' lb-tuner__row--changed' : ''}`}>
									<span>{field.label}</span>
									<select value={config.arrowRule} onChange={(e) => set({ arrowRule: e.target.value as LayoutConfig['arrowRule'] })}>
										{field.options.map((o) => (
											<option key={o.value} value={o.value}>
												{o.label}
											</option>
										))}
									</select>
								</label>
							)
						}
						return (
							<label key={field.key} className={`lb-tuner__row lb-tuner__row--check${changed ? ' lb-tuner__row--changed' : ''}`}>
								<input type="checkbox" checked={config[field.key]} onChange={(e) => set({ [field.key]: e.target.checked })} />
								<span>{field.label}</span>
							</label>
						)
					})}
				</section>
			))}
			<section className="lb-tuner__group">
				<h4>Last layout</h4>
				{stats ? (
					<dl className="lb-tuner__stats">
						<dt>Size</dt>
						<dd>
							{stats.width} × {stats.height} px · {stats.fill}% covered
						</dd>
						<dt>Arrows crossing arrows</dt>
						<dd>{stats.arrowCrossings}</dd>
						<dt>Arrows through a skill node</dt>
						<dd>{stats.arrowsThroughSkills}</dd>
						<dt>Arrow length</dt>
						<dd>
							{stats.shortestArrow}–{stats.longestArrow} px, mean {stats.meanArrow}
						</dd>
						<dt>Overlaps</dt>
						<dd>{stats.overlaps}</dd>
						<dt>Nodes · time</dt>
						<dd>
							{stats.nodes} · {stats.ms} ms
						</dd>
					</dl>
				) : (
					<p className="lb-tuner__hint">Change a setting, or Re-run, to lay the board out and see how it comes out.</p>
				)}
			</section>
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
				<button
					type="button"
					onClick={async () => {
						await navigator.clipboard.writeText(JSON.stringify(getLayoutConfig(), null, 2))
						setCopied(true)
						setTimeout(() => setCopied(false), 1500)
					}}
				>
					{copied ? 'Copied' : 'Copy settings'}
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
