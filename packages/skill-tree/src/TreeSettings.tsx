import { useSyncExternalStore, type ReactNode } from 'react'
import { useValue } from '@lifeboard/canvas'
import { getTreePrefs, setTreePrefs, subscribeToTreePrefs } from './treePrefs'
import { clean, getLayoutConfig, LAYOUT_FIELDS, setLayoutConfig } from './tree/layoutConfig'

/** The layout algorithms to choose from, as the layout tuner lists them. */
const PLACEMENTS = LAYOUT_FIELDS.flatMap((f) => (f.key === 'placement' && 'options' in f ? f.options : []))

/** The skill-tree defaults, on the extension's page in Settings. Each tree can override them. */
export function TreeSettings() {
	const prefs = useSyncExternalStore(subscribeToTreePrefs, getTreePrefs)
	const layout = useValue('lifeboard:skill-tree-layout-settings', getLayoutConfig, [])
	return (
		<div className="lb-appearance__card">
			<Row title="An import shows" hint="What a syllabus's tree view opens on. Shift+E switches between the two.">
				<select value={prefs.importShows} onChange={(e) => setTreePrefs({ importShows: e.target.value === 'overview' ? 'overview' : 'all' })}>
					<option value="all">Everything</option>
					<option value="overview">Skill nodes only</option>
				</select>
			</Row>
			<Row title="Show tree headers" hint="Draw each tree's header card, to select it and change where its view starts.">
				<input type="checkbox" checked={prefs.showHeaders} onChange={(e) => setTreePrefs({ showHeaders: e.target.checked })} />
			</Row>
			<Row
				title="Layout"
				hint={`${PLACEMENTS.find((o) => o.value === layout.placement)?.hint ?? ''} Re-calculate a board's layout (⌘K) to see it change.`}
			>
				<select value={layout.placement} onChange={(e) => setLayoutConfig(clean({ ...layout, placement: e.target.value }))}>
					{PLACEMENTS.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
			</Row>
			<Row title="Live physics" hint="Trees keep moving like Obsidian's graph instead of settling after a drag.">
				<input type="checkbox" checked={prefs.live} onChange={(e) => setTreePrefs({ live: e.target.checked })} />
			</Row>
		</div>
	)
}

function Row({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
	return (
		<div className="lb-tree-setting">
			<span className="lb-tree-setting__label">
				<span className="lb-tree-setting__title">{title}</span>
				<span className="lb-tree-setting__hint">{hint}</span>
			</span>
			{children}
		</div>
	)
}
