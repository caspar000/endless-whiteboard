import { useValue } from '@lifeboard/canvas'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { entriesOfBacklog } from './source'
import { backlogs } from './store'

/**
 * Settings → Extensions → Backlog: every backlog in the vault. A backlog outlives the card that showed
 * it (a randomizer or a ranking may still read it), so this is where one is let go of.
 */
export function BacklogSettings() {
	const all = useValue(
		'lifeboard:backlog-list',
		() =>
			Object.values(backlogs.get())
				.map((b) => ({
					id: b.backlogId,
					name: b.name,
					items: entriesOfBacklog(b.backlogId).length,
					collections: b.entries.filter((e) => e.kind === 'collection').length,
				}))
				.sort((a, b) => a.name.localeCompare(b.name)),
		[]
	)
	const [confirming, setConfirming] = useState<string | null>(null)
	return (
		<div className="lb-rank-settings">
			<h4 className="lb-rank-settings__heading">Your backlogs</h4>
			{all.length === 0 ? (
				<p className="lb-rank-settings__hint">None yet. Add a Backlog card from the dock or ⌘K, and put something in it.</p>
			) : (
				<ul className="lb-rank-settings__list">
					{all.map((b) => (
						<li key={b.id}>
							<span className="lb-rank-settings__name">{b.name}</span>
							<span className="lb-rank-settings__meta">
								{b.items} {b.items === 1 ? 'item' : 'items'}
								{b.collections ? `, ${b.collections} of them in ${b.collections === 1 ? 'a collection' : `${b.collections} collections`}` : ''}
							</span>
							{confirming === b.id ? (
								<span className="lb-rank-settings__confirm">
									<button type="button" className="lb-rank-settings__danger" onClick={() => (backlogs.put(b.id, null), setConfirming(null))}>
										Delete
									</button>
									<button type="button" onClick={() => setConfirming(null)}>
										Keep
									</button>
								</span>
							) : (
								<button type="button" className="lb-rank-settings__delete" aria-label={`Delete ${b.name}`} title="Delete this backlog" onClick={() => setConfirming(b.id)}>
									<Trash2 size={14} aria-hidden />
								</button>
							)}
						</li>
					))}
				</ul>
			)}
			<p className="lb-rank-settings__hint">A card whose backlog is deleted starts again empty. What a backlog collected stays where it came from.</p>
		</div>
	)
}
