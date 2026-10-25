import type { Editor } from '@lifeboard/canvas'
import { useValue } from '@lifeboard/canvas'
import { getAssetBridge, getIconBridge, useAssetUrl } from '@lifeboard/node-kit'
import { useRef, useState, type KeyboardEvent } from 'react'
import { MASTERY, SKILL_TYPE, type SkillNodeProps, type SkillShape } from '../board'
import { parseRequirements, type NodeStatus } from '../requirements'
import { allItems, lookOf } from '../sources'

const keepKeys = (e: KeyboardEvent) => e.stopPropagation()

/** What a node can be. You is Mastery's alone, made in Settings (mastery.ts). */
const KINDS = ['skill', 'method', 'keystone', 'root', 'pillar'] as const

/**
 * A node's settings, what it is waiting for, and the items that would advance it. The requirement is
 * edited as YAML (requirements.ts); an edit that doesn't parse is kept as typed and shown with its
 * error, and the node counts as unmet until it parses.
 */
export function SkillEditor({ skill, editor, status }: { skill: SkillShape; editor: Editor; status: NodeStatus | null }) {
	const [draft, setDraft] = useState(skill.props.requires)
	const [picking, setPicking] = useState(false)
	const { Icon, IconPicker } = getIconBridge()
	const parsed = parseRequirements(draft)
	const fileInput = useRef<HTMLInputElement>(null)
	const picture = useAssetUrl(skill.props.picture ?? '')

	// You and Mastery's pillars are made in Settings, not here.
	const builtIn = skill.props.treeId === MASTERY
	const setProps = (props: Partial<SkillNodeProps>) => editor.updateShape({ id: skill.id, type: SKILL_TYPE, props } as never)

	const advancing = useValue(
		'lifeboard:skill-advancing',
		() =>
			Object.values(allItems())
				.filter((e) => e.tags.includes(skill.props.nodeId) && !e.children.length)
				.flatMap((e) => {
					const look = lookOf(e.itemId)
					return look && (!look.done || look.hollow) ? [{ itemId: e.itemId, title: look.title, done: look.done }] : []
				})
				.slice(0, 8),
		[skill.props.nodeId]
	)

	return (
		<div className="lb-skill-editor">
			<label>
				<span>Name</span>
				<input autoFocus value={skill.props.name} onKeyDown={keepKeys} onChange={(e) => setProps({ name: e.target.value })} />
			</label>
			<div className="lb-skill-editor__block">
				<span>Icon</span>
				<button type="button" className="lb-skill-editor__iconbtn" onClick={() => setPicking((open) => !open)}>
					{skill.props.icon ? <Icon name={skill.props.icon} size={18} /> : 'Choose an icon'}
					<span>{picking ? 'Done' : skill.props.icon ? 'Change' : ''}</span>
				</button>
				{picking && (
					<IconPicker
						value={skill.props.icon}
						onPick={(name) => {
							setProps({ icon: name ?? '' })
							setPicking(false)
						}}
					/>
				)}
			</div>
			<div className="lb-skill-editor__block">
				<span>Picture</span>
				<div className="lb-skill-editor__picture">
					{picture && <img src={picture} alt="" />}
					<button type="button" className="lb-skill-editor__iconbtn" onClick={() => fileInput.current?.click()}>
						{picture ? 'Change' : 'Choose a picture'}
					</button>
					{picture && (
						<button type="button" className="lb-skill-editor__iconbtn" onClick={() => setProps({ picture: '' })}>
							Remove
						</button>
					)}
				</div>
				<input
					ref={fileInput}
					type="file"
					accept="image/*"
					hidden
					onChange={async (e) => {
						const file = e.target.files?.[0]
						e.target.value = ''
						if (file) setProps({ picture: await getAssetBridge().store(file) })
					}}
				/>
			</div>
			{builtIn ? (
				<p className="lb-skill-editor__id">{skill.props.kind === 'pillar' ? 'A pillar of Mastery.' : 'You, at the middle of Mastery.'} Pillars and what hangs under them are in Settings › Skill trees.</p>
			) : (
				<>
					<label>
						<span>Id</span>
						<input value={skill.props.nodeId} onKeyDown={keepKeys} onChange={(e) => setProps({ nodeId: e.target.value.trim() })} />
					</label>
					<div className="lb-skill-editor__pair">
						<label>
							<span>Kind</span>
							<select value={skill.props.kind} onChange={(e) => setProps({ kind: e.target.value })}>
								{KINDS.map((kind) => (
									<option key={kind}>{kind}</option>
								))}
							</select>
						</label>
						<label>
							<span>Tree</span>
							<input value={skill.props.treeId} onKeyDown={keepKeys} onChange={(e) => setProps({ treeId: e.target.value.trim() })} />
						</label>
					</div>
					<div className="lb-skill-editor__pair">
						<label>
							<span>Sector</span>
							<input value={skill.props.sector} onKeyDown={keepKeys} onChange={(e) => setProps({ sector: e.target.value })} />
						</label>
						<label>
							<span>Ring</span>
							<input value={skill.props.ring} onKeyDown={keepKeys} onChange={(e) => setProps({ ring: e.target.value })} />
						</label>
					</div>
					<div className="lb-skill-editor__block">
						<span>Requires</span>
						<textarea
							rows={5}
							value={draft}
							spellCheck={false}
							placeholder={'- node: [adler/root]\n- count: { min: 3 }'}
							onKeyDown={keepKeys}
							onChange={(e) => {
								setDraft(e.target.value)
								if (parseRequirements(e.target.value).ok) setProps({ requires: e.target.value })
							}}
						/>
						{!parsed.ok && <p className="lb-skill-editor__error">{parsed.error}</p>}
					</div>
				</>
			)}
			{status && status.conditions.length > 0 && (
				<ul className="lb-skill-editor__conditions">
					{status.conditions.map((c, i) => (
						<li key={i} className={c.met ? 'lb-skill-editor__met' : undefined}>
							<span>{c.met ? '✓' : '○'}</span>
							<span>{c.label}</span>
							<span>
								{c.have}/{c.need}
							</span>
						</li>
					))}
				</ul>
			)}
			{status?.state === 'unlocked' && (
				<p className="lb-skill-editor__id">
					Mastery evidence: {status.mastery.count} · Ship {status.mastery.ships}
					{status.mastery.nextAt !== null ? ` · next tier at ${status.mastery.nextAt}` : ''}
				</p>
			)}
			{advancing.length > 0 && (
				<div className="lb-skill-editor__block">
					<span>Would advance this</span>
					<ul className="lb-skill-editor__advancing">
						{advancing.map((entry) => (
							<li key={entry.itemId}>
								{entry.title}
								{entry.done ? ' (needs notes)' : ''}
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	)
}
