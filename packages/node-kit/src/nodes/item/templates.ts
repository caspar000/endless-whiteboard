import type { Editor, JsonValue } from 'tldraw'
import { fieldValidator, type NodeField } from '../../fields'
import { toTemplateFields } from './definition'

/**
 * Named field templates live in the tldraw **document record's `meta`** (§4.2). That location is
 * load-bearing: document meta is part of the store, so templates persist, export, and sync for free
 * — no second storage mechanism, no orphan cleanup, and they travel with a board on import.
 */
const META_KEY = 'lifeboard:fieldTemplates'

export interface FieldTemplate {
	name: string
	fields: NodeField[]
}

export function readFieldTemplates(editor: Editor): FieldTemplate[] {
	const raw = editor.getDocumentSettings().meta[META_KEY]
	if (!Array.isArray(raw)) return []

	// Document meta is untyped JSON that may predate the current field schema (or arrive from an
	// imported backup), so entries are validated and bad ones dropped rather than trusted.
	const templates: FieldTemplate[] = []
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
		const { name, fields } = entry as { name?: unknown; fields?: unknown }
		if (typeof name !== 'string' || !name || !Array.isArray(fields)) continue
		const validFields: NodeField[] = []
		for (const field of fields) {
			try {
				validFields.push(fieldValidator.validate(field))
			} catch {
				// skip malformed field
			}
		}
		if (validFields.length) templates.push({ name, fields: validFields })
	}
	return templates
}

export function saveFieldTemplate(editor: Editor, name: string, fields: readonly NodeField[]): void {
	const trimmed = name.trim()
	if (!trimmed) return
	const existing = readFieldTemplates(editor).filter((t) => t.name !== trimmed)
	const next: FieldTemplate[] = [...existing, { name: trimmed, fields: toTemplateFields(fields) }]
	writeFieldTemplates(editor, next)
}

export function deleteFieldTemplate(editor: Editor, name: string): void {
	writeFieldTemplates(
		editor,
		readFieldTemplates(editor).filter((t) => t.name !== name)
	)
}

function writeFieldTemplates(editor: Editor, templates: FieldTemplate[]): void {
	editor.run(() => {
		editor.updateDocumentSettings({
			meta: {
				...editor.getDocumentSettings().meta,
				// `NodeField` is JSON-scalar by construction, so this is a widening cast, not a lie.
				[META_KEY]: templates as unknown as JsonValue,
			},
		})
	})
}
