import { useValue } from '@lifeboard/canvas'
import { useState, type KeyboardEvent } from 'react'
import {
	addEntry,
	addTrack,
	entriesOnlyIn,
	getItems,
	getTracks,
	isItemDone,
	moveInTrack,
	removeEntry,
	updateItem,
	updateTrack,
	type ItemDef,
	type TrackDef,
} from './syllabus'
import { deleteSyllabus, treesGoingWith } from './syllabusTrees'

const keepKeys = (e: KeyboardEvent) => e.stopPropagation()

const STATES = [
	{ value: 'active', label: 'Active' },
	{ value: 'paused', label: 'Paused' },
	{ value: 'notStarted', label: 'Not started' },
] as const

/** Active first, then paused, then not started; by name within each. */
const stateRank = (state: string) => {
	const at = STATES.findIndex((s) => s.value === state)
	return at < 0 ? STATES.length : at
}

/**
 * The extension's page in Settings: every syllabus (a track) in the vault, to rename, pause, add to
 * and remove, and its entries, to rename, reorder and remove. Everything here is vault data, so every
 * list, card and tree on every board follows. Drafts are left out: they belong to the board whose
 * import made them until someone confirms it there.
 */
export function SyllabusSettings() {
	const { tracks, items } = useValue('lifeboard:syllabus-settings', () => ({ tracks: getTracks(), items: getItems() }), [])
	const [open, setOpen] = useState<string | null>(null)
	const [newName, setNewName] = useState('')
	const all = Object.values(tracks)
	const confirmed = all
		.filter((t) => !t.draft)
		.sort((a, b) => stateRank(a.state) - stateRank(b.state) || (a.name || a.trackId).localeCompare(b.name || b.trackId))
	const drafts = all.length - confirmed.length

	const add = () => {
		if (!newName.trim()) return
		setOpen(addTrack(newName))
		setNewName('')
	}

	return (
		<div className="lb-appearance__card">
			<div className="lb-syllabi">
				{confirmed.length ? (
					<ul className="lb-syllabi__list">
						{confirmed.map((track) => (
							<TrackRow
								key={track.trackId}
								track={track}
								items={items}
								open={open === track.trackId}
								onToggle={() => setOpen(open === track.trackId ? null : track.trackId)}
							/>
						))}
					</ul>
				) : (
					<p className="lb-mastery__empty">No syllabus in the vault yet. Add one below, or drop a syllabus .yaml file on a board.</p>
				)}
				<div className="lb-syllabi__add">
					<input
						placeholder="New syllabus"
						aria-label="New syllabus name"
						value={newName}
						onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && add())}
						onChange={(e) => setNewName(e.target.value)}
					/>
					<button type="button" className="lb-mastery__button" disabled={!newName.trim()} onClick={add}>
						Add syllabus
					</button>
				</div>
				<p className="lb-mastery__hint">
					Active syllabi feed Up next. Put one on a board with ⌘K › Show a track as a list, and make a skill tree from one in Settings › Skill trees. A whole syllabus with its works comes from a .yaml file dropped on a board
					{drafts > 0 && `; ${drafts === 1 ? 'one import is' : `${drafts} imports are`} still a draft on a board and will show here once confirmed`}.
				</p>
			</div>
		</div>
	)
}

function TrackRow({
	track,
	items,
	open,
	onToggle,
}: {
	track: TrackDef
	items: Readonly<Record<string, ItemDef>>
	open: boolean
	onToggle: () => void
}) {
	const [confirming, setConfirming] = useState(false)
	const [newEntry, setNewEntry] = useState('')
	const entries = track.order.map((id) => items[id]).filter((i): i is ItemDef => !!i)
	const done = entries.filter((e) => isItemDone(e.itemId)).length
	const name = track.name || 'Untitled syllabus'

	const add = () => {
		if (addEntry(track.trackId, newEntry)) setNewEntry('')
	}

	if (confirming) {
		const going = entriesOnlyIn(track.trackId).length
		const kept = entries.length - going
		const trees = treesGoingWith(track.trackId)
		return (
			<li className="lb-syllabi__track lb-syllabi__track--confirm">
				<span className="lb-syllabi__question">
					Remove “{name}”{going > 0 && ` and its ${going === 1 ? 'entry' : `${going} entries`}, with their works and ticks`}
					{trees.length > 0 && `, and the skill ${trees.length === 1 ? 'tree' : 'trees'} ${trees.map((t) => `“${t.name || t.treeId}”`).join(', ')} made from it, from every board`}?
					{kept > 0 && ` ${kept === 1 ? 'One entry another syllabus lists stays' : `${kept} entries other syllabi list stay`}.`} Lists and cards of it on boards will show it missing.
				</span>
				<button type="button" className="lb-mastery__button lb-syllabi__danger" onClick={() => deleteSyllabus(track.trackId)}>
					Remove
				</button>
				<button type="button" className="lb-mastery__button" autoFocus onClick={() => setConfirming(false)}>
					Cancel
				</button>
			</li>
		)
	}

	return (
		<li className={open ? 'lb-syllabi__track lb-syllabi__track--open' : 'lb-syllabi__track'}>
			<div className="lb-syllabi__head">
				<button type="button" className="lb-syllabi__fold" aria-expanded={open} aria-label={open ? `Fold ${name}` : `Show the entries of ${name}`} onClick={onToggle}>
					{open ? '▾' : '▸'}
				</button>
				<input
					className="lb-syllabi__name"
					aria-label="Syllabus name"
					placeholder="Untitled syllabus"
					value={track.name}
					onKeyDown={keepKeys}
					onChange={(e) => updateTrack(track.trackId, { name: e.target.value })}
				/>
				<span className="lb-syllabi__count">
					{done}/{entries.length}
				</span>
				<select aria-label={`State of ${name}`} value={track.state} onChange={(e) => updateTrack(track.trackId, { state: e.target.value })}>
					{STATES.map((s) => (
						<option key={s.value} value={s.value}>
							{s.label}
						</option>
					))}
				</select>
				<button type="button" className="lb-syllabi__icon" aria-label={`Remove ${name}`} title="Remove this syllabus" onClick={() => setConfirming(true)}>
					×
				</button>
			</div>
			{open && (
				<div className="lb-syllabi__body">
					<label className="lb-syllabi__goal">
						<span>Goal</span>
						<input value={track.goal} placeholder="Game director, Western canon…" onKeyDown={keepKeys} onChange={(e) => updateTrack(track.trackId, { goal: e.target.value })} />
					</label>
					{entries.length ? (
						<ol className="lb-syllabi__entries">
							{entries.map((entry, i) => (
								<li key={entry.itemId} className={isItemDone(entry.itemId) ? 'lb-syllabi__entry lb-syllabi__entry--done' : 'lb-syllabi__entry'}>
									<span className="lb-syllabi__num">{i + 1}</span>
									<input
										aria-label="Entry title"
										placeholder="Untitled"
										value={entry.title}
										onKeyDown={keepKeys}
										onChange={(e) => updateItem(entry.itemId, { title: e.target.value })}
									/>
									{entry.children.length > 0 && (
										<span className="lb-syllabi__works">
											{entry.children.length} {entry.children.length === 1 ? 'work' : 'works'}
										</span>
									)}
									<button type="button" className="lb-syllabi__icon" aria-label={`Move ${entry.title} up`} disabled={i === 0} onClick={() => moveInTrack(track.trackId, entry.itemId, -1)}>
										↑
									</button>
									<button
										type="button"
										className="lb-syllabi__icon"
										aria-label={`Move ${entry.title} down`}
										disabled={i === entries.length - 1}
										onClick={() => moveInTrack(track.trackId, entry.itemId, 1)}
									>
										↓
									</button>
									<button type="button" className="lb-syllabi__icon" aria-label={`Remove ${entry.title}`} title="Remove this entry" onClick={() => removeEntry(track.trackId, entry.itemId)}>
										×
									</button>
								</li>
							))}
						</ol>
					) : (
						<p className="lb-mastery__empty">No entries yet.</p>
					)}
					<div className="lb-syllabi__add">
						<input
							placeholder="New entry"
							aria-label={`New entry in ${name}`}
							value={newEntry}
							onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && add())}
							onChange={(e) => setNewEntry(e.target.value)}
						/>
						<button type="button" className="lb-mastery__button" disabled={!newEntry.trim()} onClick={add}>
							Add entry
						</button>
					</div>
				</div>
			)}
		</li>
	)
}
