import { useValue } from '@lifeboard/canvas'
import { useState, type KeyboardEvent } from 'react'
import { MASTERY, MASTERY_NODE } from './board'
import { addPillar, ensureMastery, hangableTrees, hangTree, movePillar, pillarsOf, removePillar, renamePillar, treesUnder } from './mastery'
import { getTreeDefs } from './treeDefs'

const keepKeys = (e: KeyboardEvent) => e.stopPropagation()

const sizeOf = (nodes: number) => (nodes === 1 ? '1 node' : `${nodes} nodes`)

/**
 * Mastery, built here (mastery.ts): You at the top, the pillars under you in their order, each with
 * the trees hung under it drawn as its branches, and for the pillar picked, the trees to hang and take
 * down. A tree can hang under several pillars, and shows under each. Every change is vault data, so
 * every board showing Mastery follows.
 */
export function MasteryBuilder() {
	const trees = useValue('lifeboard:mastery-builder', getTreeDefs, [])
	const pillars = pillarsOf(trees)
	const [picked, setPicked] = useState('')
	const [newPillar, setNewPillar] = useState('')
	const current = pillars.find((p) => p.nodeId === picked) ?? pillars[0]
	const under = current ? treesUnder(current.nodeId, trees) : []
	const others = current ? hangableTrees(trees).filter((t) => !t.mounts.includes(current.nodeId)) : []

	if (!trees[MASTERY]?.nodes.some((n) => n.nodeId === MASTERY_NODE)) {
		return (
			<div className="lb-mastery">
				<p className="lb-mastery__empty">Mastery is the tree at the middle of everything: you, the pillars of your life, and your other trees hung under them.</p>
				<button type="button" className="lb-mastery__button" onClick={ensureMastery}>
					Set up Mastery
				</button>
			</div>
		)
	}

	const add = () => {
		if (!newPillar.trim()) return
		setPicked(addPillar(newPillar))
		setNewPillar('')
	}

	return (
		<div className="lb-mastery">
			<div className="lb-mastery__columns">
				<div className="lb-mastery__pillars">
					<div className="lb-mastery__you">You</div>
					<ul>
						{pillars.map((p, i) => {
							const branches = treesUnder(p.nodeId, trees)
							return (
								<li key={p.nodeId} className="lb-mastery__limb">
									<div className={p.nodeId === current?.nodeId ? 'lb-mastery__pillar lb-mastery__pillar--on' : 'lb-mastery__pillar'} onClick={() => setPicked(p.nodeId)}>
										<input aria-label="Pillar name" value={p.name} onKeyDown={keepKeys} onFocus={() => setPicked(p.nodeId)} onChange={(e) => renamePillar(p.nodeId, e.target.value)} />
										<button type="button" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => movePillar(p.nodeId, -1)}>
											↑
										</button>
										<button type="button" aria-label={`Move ${p.name} down`} disabled={i === pillars.length - 1} onClick={() => movePillar(p.nodeId, 1)}>
											↓
										</button>
										<button type="button" aria-label={`Remove ${p.name}`} onClick={() => removePillar(p.nodeId)}>
											×
										</button>
									</div>
									{branches.length > 0 && (
										<ul className="lb-mastery__branches" aria-label={`Trees under ${p.name || 'this pillar'}`}>
											{branches.map((t) => (
												<li key={t.treeId} className="lb-mastery__branch" onClick={() => setPicked(p.nodeId)}>
													<span className="lb-mastery__branch-name">{t.name || t.treeId}</span>
													<span className="lb-mastery__size">{sizeOf(t.nodes.length)}</span>
												</li>
											))}
										</ul>
									)}
								</li>
							)
						})}
					</ul>
					<div className="lb-mastery__add">
						<input placeholder="New pillar" value={newPillar} onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && add())} onChange={(e) => setNewPillar(e.target.value)} />
						<button type="button" className="lb-mastery__button" disabled={!newPillar.trim()} onClick={add}>
							Add pillar
						</button>
					</div>
				</div>
				<div className="lb-mastery__trees">
					{current ? (
						<>
							<div className="lb-mastery__heading">Under {current.name || 'this pillar'}</div>
							{under.length ? (
								<ul>
									{under.map((t) => (
										<li key={t.treeId} className="lb-mastery__tree">
											<span>{t.name || t.treeId}</span>
											<span className="lb-mastery__size">{sizeOf(t.nodes.length)}</span>
											{t.mounts.length > 1 && <span className="lb-mastery__also">also under {t.mounts.filter((m) => m !== current.nodeId).map((m) => pillars.find((p) => p.nodeId === m)?.name ?? m).join(', ')}</span>}
											<button type="button" aria-label={`Take ${t.name || t.treeId} from ${current.name}`} onClick={() => hangTree(t.treeId, current.nodeId, false)}>
												×
											</button>
										</li>
									))}
								</ul>
							) : (
								<p className="lb-mastery__empty">Nothing hangs here yet.</p>
							)}
							<select
								aria-label="Add a tree"
								value=""
								disabled={!others.length}
								onChange={(e) => e.target.value && hangTree(e.target.value, current.nodeId, true)}
							>
								<option value="">{others.length ? 'Add a tree…' : 'No other trees in the vault'}</option>
								{others.map((t) => (
									<option key={t.treeId} value={t.treeId}>
										{t.name || t.treeId}
									</option>
								))}
							</select>
						</>
					) : (
						<p className="lb-mastery__empty">Add a pillar to hang trees under it.</p>
					)}
				</div>
			</div>
			<p className="lb-mastery__hint">Put it on a board with ⌘K › Add Mastery to this board. Import a syllabus to add its tree to the vault; a tree only one syllabus feeds goes by that syllabus's name.</p>
		</div>
	)
}
