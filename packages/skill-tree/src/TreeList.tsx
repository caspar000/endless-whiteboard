import { useValue } from '@lifeboard/canvas'
import { useState } from 'react'
import { MASTERY } from './board'
import { pillarsOf } from './mastery'
import { allMakers } from './sources'
import { getTreeDefs, liveTreeDefs, type TreeDef } from './treeDefs'
import { deleteTree, makeTrees } from './treeMaking'

const sizeOf = (nodes: number) => (nodes === 1 ? '1 node' : `${nodes} nodes`)

/**
 * Every tree in the vault, in Settings › Skill trees, to delete, and the form that makes one
 * (treeMaking.ts): from one or more of what the sources offer (syllabi), or empty. A tree made here
 * is on no board and under no pillar; Mastery below hangs it, ⌘K › Show a skill tree on this board
 * shows it.
 */
export function TreeList() {
	const { trees, makers } = useValue('lifeboard:tree-list', () => ({ trees: getTreeDefs(), makers: allMakers() }), [])
	const listed = liveTreeDefs(trees)
		.filter((t) => t.treeId !== MASTERY)
		.sort((a, b) => (a.name || a.treeId).localeCompare(b.name || b.treeId))
	const makerName = new Map(makers.map((m) => [m.id, m.name]))
	const pillarName = new Map(pillarsOf(trees).map((p) => [p.nodeId, p.name]))
	const nodeName = new Map(Object.values(trees).flatMap((t) => t.nodes.map((n) => [n.nodeId, n.name] as const)))
	return (
		<div className="lb-syllabi">
			{listed.length ? (
				<ul className="lb-syllabi__list" aria-label="Skill trees">
					{listed.map((tree) => (
						<TreeRow
							key={tree.treeId}
							tree={tree}
							from={tree.madeFrom.map((id) => makerName.get(id)).filter((n): n is string => !!n)}
							under={tree.mounts.map((m) => pillarName.get(m) ?? nodeName.get(m) ?? m)}
						/>
					))}
				</ul>
			) : (
				<p className="lb-mastery__empty">No skill trees yet. Make one below.</p>
			)}
			<MakeTree />
		</div>
	)
}

function TreeRow({ tree, from, under }: { tree: TreeDef; from: string[]; under: string[] }) {
	const [confirming, setConfirming] = useState(false)
	const name = tree.name || tree.treeId
	if (confirming) {
		// What would go with it: the branches a shared root was made with (deleteTreeDefs).
		const branches = liveTreeDefs().filter(
			(t) => t.treeId !== tree.treeId && t.madeFrom.length > 0 && t.mounts.length > 0 && t.mounts.every((m) => tree.nodes.some((n) => n.nodeId === m)) && t.madeFrom.every((m) => tree.madeFrom.includes(m))
		)
		return (
			<li className="lb-syllabi__track lb-syllabi__track--confirm">
				<span className="lb-syllabi__question">
					Delete “{name}”{branches.length > 0 && ` and ${branches.map((b) => `“${b.name || b.treeId}”`).join(', ')} under it`} from the vault and every board that shows it? Ticks in
					syllabi stay.
				</span>
				<button type="button" className="lb-mastery__button lb-syllabi__danger" onClick={() => deleteTree(tree.treeId)}>
					Delete
				</button>
				<button type="button" className="lb-mastery__button" autoFocus onClick={() => setConfirming(false)}>
					Cancel
				</button>
			</li>
		)
	}
	return (
		<li className="lb-syllabi__track">
			<div className="lb-syllabi__head">
				<span className="lb-tree-list__name">{name}</span>
				<span className="lb-syllabi__count">{sizeOf(tree.nodes.length)}</span>
				<span className="lb-tree-list__about">
					{[from.length ? `from ${from.join(', ')}` : '', under.length ? `under ${under.join(', ')}` : ''].filter(Boolean).join(' · ')}
				</span>
				<button type="button" className="lb-syllabi__icon" aria-label={`Delete ${name}`} title="Delete this tree" onClick={() => setConfirming(true)}>
					×
				</button>
			</div>
		</li>
	)
}

function MakeTree() {
	const makers = useValue('lifeboard:tree-makers', allMakers, [])
	const [picked, setPicked] = useState<string[]>([])
	const [name, setName] = useState('')
	const [shared, setShared] = useState(true)
	const [said, setSaid] = useState('')
	const chosen = picked.filter((id) => makers.some((m) => m.id === id))
	const several = chosen.length > 1
	const needsName = !chosen.length || (several && shared)
	const groups = [...new Set(makers.map((m) => m.group))]

	const toggle = (id: string) => setPicked(chosen.includes(id) ? chosen.filter((p) => p !== id) : [...chosen, id])
	const make = () => {
		try {
			const result = makeTrees(chosen, { name, sharedRoot: several && shared })
			const names = (ids: string[]) => ids.map((id) => `“${getTreeDefs()[id]?.name || id}”`).join(', ')
			setSaid(
				[
					result.made.length ? `Made ${names(result.made)}.` : '',
					result.already.length ? `${names(result.already)} ${result.already.length === 1 ? 'was' : 'were'} made already.` : '',
				]
					.filter(Boolean)
					.join(' ')
			)
			setPicked([])
			setName('')
		} catch (error) {
			setSaid(error instanceof Error ? error.message : String(error))
		}
	}

	return (
		<div className="lb-tree-make">
			<div className="lb-mastery__heading">Make a skill tree</div>
			{groups.map((group) => (
				<fieldset key={group} className="lb-tree-make__from">
					<legend>From {group.toLowerCase()}</legend>
					{makers
						.filter((m) => m.group === group)
						.map((m) => (
							<label key={m.id} className="lb-tree-make__maker">
								<input type="checkbox" checked={chosen.includes(m.id)} onChange={() => toggle(m.id)} />
								{m.name || m.id}
							</label>
						))}
				</fieldset>
			))}
			{several && (
				<label className="lb-tree-make__shared">
					<input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
					Hang them from one shared root
				</label>
			)}
			<div className="lb-syllabi__add">
				{needsName && (
					<input
						aria-label={chosen.length ? 'Shared root name' : 'Tree name'}
						placeholder={chosen.length ? 'Shared root name' : 'Name of an empty tree'}
						value={name}
						onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && name.trim() && make())}
						onChange={(e) => setName(e.target.value)}
					/>
				)}
				<button type="button" className="lb-mastery__button" disabled={needsName && !name.trim()} onClick={make}>
					{chosen.length ? (several && !shared ? `Make ${chosen.length} trees` : 'Make the tree') : 'Make an empty tree'}
				</button>
			</div>
			{said && <p className="lb-mastery__hint" role="status">{said}</p>}
			<p className="lb-mastery__hint">
				A syllabus whose file came with a tree makes that tree; any other makes a path of its entries, each lit once it is done, in any order. A tree made here is on no board:
				⌘K › Show a skill tree on this board puts it on one, and Mastery below hangs it under a pillar.
			</p>
		</div>
	)
}
