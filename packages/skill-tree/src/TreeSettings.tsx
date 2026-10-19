import { useSyncExternalStore, type ReactNode } from 'react'
import { useValue } from '@lifeboard/canvas'
import { getTreePrefs, setTreePrefs, subscribeToTreePrefs } from './treePrefs'
import { DEFAULT_LAYOUT, getLayoutConfig, setLayoutConfig } from './tree/layoutConfig'
import { LayoutFields } from './tree/LayoutFields'

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
				hint="The whole-life board grows from You through a maze of hexagons, branch by branch, the maze only as big as the tree needs. Re-calculate a board's layout (⌘K) to see a change."
			>
				<span className="lb-tree-setting__value">Maze</span>
			</Row>
			<details className="lb-tree-advanced">
				<summary>Advanced</summary>
				<LayoutFields config={layout} onChange={setLayoutConfig} />
				<button type="button" className="lb-tree-advanced__reset" onClick={() => setLayoutConfig(DEFAULT_LAYOUT)}>
					Back to the defaults
				</button>
			</details>
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
