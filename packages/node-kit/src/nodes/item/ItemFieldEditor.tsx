import { useState } from 'react'
import type { Editor } from 'tldraw'
import {
	FIELD_TYPES,
	coerceFieldValue,
	defaultUnitForType,
	fieldKeyLabel,
	normalizeFieldKey,
	type FieldType,
	type NodeField,
} from '../../fields'
import { updateNodeProps, type NodeShape } from '../../registry'
import { readFieldTemplates, saveFieldTemplate } from './templates'
import type { ItemNodeProps } from './definition'

/**
 * The field editor shown while an item node is in editing state: add/remove/retype fields, edit
 * values and tags, and save the field shape as a reusable template.
 *
 * Every mutation goes through a single `updateShape` inside `editor.run`, so each user action is
 * exactly one undo step.
 */
export function ItemFieldEditor({
	shape,
	editor,
}: {
	shape: NodeShape<ItemNodeProps>
	editor: Editor
}) {
	const { fields, tags } = shape.props
	const [newKey, setNewKey] = useState('')
	const [newType, setNewType] = useState<FieldType>('text')
	const [tagDraft, setTagDraft] = useState('')

	const update = (props: Partial<ItemNodeProps>) => updateNodeProps(editor, shape, props)

	const setFields = (next: NodeField[]) => update({ fields: next })

	const addField = (key: string, type: FieldType) => {
		const normalized = normalizeFieldKey(key)
		if (!normalized) return
		if (fields.some((f) => f.key === normalized)) return
		const unit = defaultUnitForType(type)
		setFields([
			...fields,
			{ key: normalized, type, value: type === 'checkbox' ? false : null, ...(unit ? { unit } : {}) },
		])
		setNewKey('')
	}

	const templates = readFieldTemplates(editor)

	return (
		<div className="lb-fields">
			<div className="lb-fields__rows">
				{fields.map((field, i) => (
					<div className="lb-fields__row" key={`${field.key}-${i}`}>
						<span className="lb-fields__key" title={field.key}>
							{fieldKeyLabel(field.key)}
						</span>

						<select
							className="lb-fields__type"
							value={field.type}
							aria-label={`Type of ${field.key}`}
							onChange={(e) => {
								const type = e.currentTarget.value as FieldType
								const next = [...fields]
								const unit = defaultUnitForType(type)
								next[i] = {
									key: field.key,
									type,
									// Retyping re-coerces rather than discarding: "2399" typed as text
									// becomes 2399 when switched to currency.
									value: coerceFieldValue(type, field.value),
									...(unit ? { unit } : {}),
								}
								setFields(next)
							}}
						>
							{FIELD_TYPES.map((t) => (
								<option key={t} value={t}>
									{t}
								</option>
							))}
						</select>

						{field.type === 'checkbox' ? (
							<input
								className="lb-fields__value"
								type="checkbox"
								aria-label={`Value of ${field.key}`}
								checked={field.value === true}
								onChange={(e) => {
									const next = [...fields]
									next[i] = { ...field, value: e.currentTarget.checked }
									setFields(next)
								}}
							/>
						) : (
							<input
								className="lb-fields__value"
								aria-label={`Value of ${field.key}`}
								value={field.value === null ? '' : String(field.value)}
								inputMode={field.type === 'number' || field.type === 'currency' ? 'decimal' : 'text'}
								placeholder={field.type === 'currency' ? '2399' : ''}
								onChange={(e) => {
									const next = [...fields]
									next[i] = { ...field, value: coerceFieldValue(field.type, e.currentTarget.value) }
									setFields(next)
								}}
								onKeyDown={(e) => e.stopPropagation()}
							/>
						)}

						{field.type === 'currency' || field.type === 'number' ? (
							<input
								className="lb-fields__unit"
								aria-label={`Unit of ${field.key}`}
								value={field.unit ?? ''}
								placeholder="GEL"
								size={4}
								onChange={(e) => {
									const next = [...fields]
									const unit = e.currentTarget.value.trim()
									next[i] = unit ? { ...field, unit } : { key: field.key, type: field.type, value: field.value }
									setFields(next)
								}}
								onKeyDown={(e) => e.stopPropagation()}
							/>
						) : (
							<span />
						)}

						<button
							className="lb-fields__remove"
							title={`Remove ${field.key}`}
							aria-label={`Remove ${field.key}`}
							onClick={() => setFields(fields.filter((_, j) => j !== i))}
						>
							×
						</button>
					</div>
				))}
			</div>

			<div className="lb-fields__add">
				<input
					className="lb-fields__new-key"
					value={newKey}
					placeholder="Add field (e.g. price)"
					onChange={(e) => setNewKey(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter') addField(newKey, newType)
						e.stopPropagation()
					}}
				/>
				<select
					className="lb-fields__new-type"
					aria-label="New field type"
					value={newType}
					onChange={(e) => setNewType(e.currentTarget.value as FieldType)}
				>
					{FIELD_TYPES.map((t) => (
						<option key={t} value={t}>
							{t}
						</option>
					))}
				</select>
				<button className="lb-fields__add-btn" onClick={() => addField(newKey, newType)}>
					Add
				</button>
			</div>

			<div className="lb-fields__tags">
				<input
					className="lb-fields__tag-input"
					value={tagDraft}
					placeholder="Add tag (e.g. desk)"
					onChange={(e) => setTagDraft(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							const tag = tagDraft.trim()
							if (tag && !tags.includes(tag)) update({ tags: [...tags, tag] })
							setTagDraft('')
						}
						e.stopPropagation()
					}}
				/>
				{tags.map((tag) => (
					<button
						key={tag}
						className="lb-fields__tag"
						title={`Remove tag ${tag}`}
						onClick={() => update({ tags: tags.filter((t) => t !== tag) })}
					>
						{tag} ×
					</button>
				))}
			</div>

			{(templates.length > 0 || fields.length > 0) && (
				<div className="lb-fields__templates">
					{templates.map((tpl) => (
						<button
							key={tpl.name}
							className="lb-fields__template"
							title={`Apply template: ${tpl.fields.map((f) => f.key).join(', ')}`}
							onClick={() => {
								// Applying a template adds missing keys and leaves existing values alone.
								const existing = new Set(fields.map((f) => f.key))
								const additions = tpl.fields.filter((f) => !existing.has(f.key))
								if (additions.length) setFields([...fields, ...additions])
							}}
						>
							{tpl.name}
						</button>
					))}
					{fields.length > 0 && (
						<button
							className="lb-fields__save-template"
							onClick={() => {
								const name = window.prompt('Save these fields as a template named:')?.trim()
								if (name) saveFieldTemplate(editor, name, fields)
							}}
						>
							Save as template
						</button>
					)}
				</div>
			)}
		</div>
	)
}
