import { useSyncExternalStore, type ReactNode } from 'react'
import { getTreePrefs, setTreePrefs, subscribeToTreePrefs } from './treePrefs'

/** The skill-tree defaults, on the extension's page in Settings. Each tree can override them. */
export function TreeSettings() {
	const prefs = useSyncExternalStore(subscribeToTreePrefs, getTreePrefs)
	return (
		<div className="lb-appearance__card">
			<Row title="An import shows" hint="What a syllabus's tree view opens on. Double-click a node to focus on it either way.">
				<select value={prefs.importShows} onChange={(e) => setTreePrefs({ importShows: e.target.value === 'all' ? 'all' : 'overview' })}>
					<option value="overview">Skill nodes only</option>
					<option value="all">Everything</option>
				</select>
			</Row>
			<Row title="Focus reaches" hint="How many steps out from a focused node its neighbours stay visible, folded.">
				<select value={prefs.focusDepth} onChange={(e) => setTreePrefs({ focusDepth: Number(e.target.value) })}>
					{[0, 1, 2, 3].map((n) => (
						<option key={n} value={n}>
							{n === 0 ? 'Only the node' : n === 1 ? '1 step' : `${n} steps`}
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
