import type { Editor } from '@lifeboard/canvas'
import { useValue } from '@lifeboard/canvas'
import { getIconBridge } from '@lifeboard/node-kit'
import { useState, type KeyboardEvent } from 'react'
import { SKILL_TYPE, type SkillNodeProps, type SkillShape } from '../board'
import { parseRequirements, type NodeStatus } from '../requirements'
import { getSkillIndex } from '../skillIndex'

const keepKeys = (e: KeyboardEvent) => e.stopPropagation()

const KINDS = ['skill', 'method', 'keystone', 'root'] as const

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

	const setProps = (props: Partial<SkillNodeProps>) => editor.updateShape({ id: skill.id, type: SKILL_TYPE, props } as never)

	const advancing = useValue(
		'lifeboard:skill-advancing',
		() =>
			Object.values(getSkillIndex())
				.filter((e) => e.tags.includes(skill.props.nodeId) && !e.evidence && !e.hasChildren)
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
