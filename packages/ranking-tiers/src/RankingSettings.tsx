import { useValue } from '@lifeboard/canvas'
import { resolveItemSource, sourceEntries } from '@lifeboard/node-kit'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { DEFAULT_TIERS, rankingView } from './model'
import { formatTiers, getPrefs, parseTiers, setPrefs } from './prefs'
import { rankingLabel } from './source'
import { rankings } from './store'

/**
 * Settings → Extensions → Ranking Tiers: how odds are written, the tiers a new card starts with, and
 * every ranking in the vault. A ranking outlives the card that showed it (it is vault data, so a
 * randomizer can still draw from it), so this is where one is let go of.
 */
export function RankingSettings() {
	const prefs = useValue('lifeboard:ranking-prefs-ui', () => getPrefs(), [])
	const all = useValue(
		'lifeboard:ranking-list',
		() =>
			Object.values(rankings.get())
				.map((r) => {
					const view = rankingView(r, sourceEntries(r.source))
					return {
						id: r.rankingId,
						label: rankingLabel(r),
						from: r.source ? resolveItemSource(r.source).name : 'Nothing yet',
						ranked: view.bands.reduce((n, b) => n + b.items.length, 0),
						tiers: r.tiers.length,
						weighted: r.weighted,
					}
				})
				.sort((a, b) => a.label.localeCompare(b.label)),
		[]
	)
	const [tiersText, setTiersText] = useState(() => formatTiers(prefs.tiers))
	const [confirming, setConfirming] = useState<string | null>(null)

	return (
		<div className="lb-rank-settings">
			<label className="lb-rank-settings__check">
				<input type="checkbox" checked={prefs.percent} onChange={(e) => setPrefs({ percent: e.target.checked })} />
				<span>Write odds as percentages (“20%”) rather than “1 in 5”</span>
			</label>

			<label className="lb-rank-settings__label" htmlFor="lb-rank-default-tiers">
				New cards start with these tiers
			</label>
			<textarea
				id="lb-rank-default-tiers"
				className="lb-rank-settings__tiers"
				rows={Math.max(4, prefs.tiers.length + 1)}
				value={tiersText}
				spellCheck={false}
				onChange={(e) => setTiersText(e.target.value)}
				onBlur={() => {
					const tiers = parseTiers(tiersText)
					setPrefs({ tiers: tiers.length ? tiers : DEFAULT_TIERS })
					setTiersText(formatTiers(tiers.length ? tiers : DEFAULT_TIERS))
				}}
			/>
			<p className="lb-rank-settings__hint">One per line, top first. “× 3” after a name is its weight, used when weighted shuffle is on (1 to 5; 1 when left out).</p>

			<h4 className="lb-rank-settings__heading">Your rankings</h4>
			{all.length === 0 ? (
				<p className="lb-rank-settings__hint">None yet. Add a Ranking Tiers card from the dock or ⌘K, and choose what it ranks.</p>
			) : (
				<ul className="lb-rank-settings__list">
					{all.map((r) => (
						<li key={r.id}>
							<span className="lb-rank-settings__name">{r.label}</span>
							<span className="lb-rank-settings__meta">
								{r.from} · {r.ranked} ranked in {r.tiers} tiers{r.weighted ? ' · weighted' : ''}
							</span>
							{confirming === r.id ? (
								<span className="lb-rank-settings__confirm">
									<button type="button" className="lb-rank-settings__danger" onClick={() => (rankings.put(r.id, null), setConfirming(null))}>
										Delete
									</button>
									<button type="button" onClick={() => setConfirming(null)}>
										Keep
									</button>
								</span>
							) : (
								<button type="button" className="lb-rank-settings__delete" aria-label={`Delete ${r.label}`} title="Delete this ranking" onClick={() => setConfirming(r.id)}>
									<Trash2 size={14} aria-hidden />
								</button>
							)}
						</li>
					))}
				</ul>
			)}
			<p className="lb-rank-settings__hint">A card whose ranking is deleted starts again from the tiers above.</p>
		</div>
	)
}
