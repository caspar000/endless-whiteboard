import type { Editor, JsonValue } from 'tldraw'
import { propertyDefValidator, propertyIdFromName, type PropertyDef } from './types'

/**
 * The per-board property registry: the definitions a board knows about, defined once and available to
 * every shape on it.
 *
 * Stored in the tldraw **document record's `meta`**, the same location `fieldTemplates` already uses.
 * That is load-bearing rather than convenient: document meta is part of the store, so the registry
 * persists, exports, imports and (later) syncs for free — no second storage mechanism, no orphan
 * cleanup, and it travels with the board.
 *
 * **Per board, not per workspace** — the decision taken with the user. A board is the unit people
 * think in, and cross-board queries are explicitly out of scope for now.
 */
const META_KEY = 'lifeboard:properties'

/**
 * Reads the registry, dropping anything malformed.
 *
 * Defensive by necessity, not by taste: meta is untyped JSON that tldraw neither validates nor
 * migrates, so an entry here may predate the current property schema or arrive from an imported
 * backup. One bad entry must cost that entry, never the board.
 */
export function readPropertyRegistry(editor: Editor): PropertyDef[] {
	return parsePropertyRegistry(editor.getDocumentSettings().meta[META_KEY])
}

/**
 * Types that have been renamed or absorbed, mapped to what they are now.
 *
 * `url` folded into `link`, which is the same thing with a title — and `parseLinkValue` already reads
 * a bare address as a title-less link, so every stored value survives the rename untouched.
 */
const LEGACY_TYPES: Record<string, string> = { currency: 'financial', url: 'link' }

/**
 * A definition written under an older type name. Normalised on read rather than migrated in place:
 * registries live in untyped meta (document *and* shape sidecars), which tldraw neither validates nor
 * migrates, so read-time is the only choke point that covers every source — old boards, imported
 * backups, and pasted shapes alike.
 */
function normalizeLegacyType(entry: unknown): unknown {
	if (!entry || typeof entry !== 'object') return entry
	const type = (entry as { type?: unknown }).type
	const replacement = typeof type === 'string' ? LEGACY_TYPES[type] : undefined
	return replacement ? { ...(entry as object), type: replacement } : entry
}

/** The pure half of {@link readPropertyRegistry}, so the parsing rules are testable on their own. */
export function parsePropertyRegistry(raw: unknown): PropertyDef[] {
	if (!Array.isArray(raw)) return []

	const defs: PropertyDef[] = []
	const seen = new Set<string>()
	for (const entry of raw) {
		let def: PropertyDef
		try {
			def = propertyDefValidator.validate(normalizeLegacyType(entry))
		} catch {
			continue
		}
		// An id is identity. A blank or duplicate one would make values ambiguous, which is worse than
		// a missing property, so the entry goes rather than the ambiguity staying.
		if (!def.id || seen.has(def.id)) continue
		seen.add(def.id)
		defs.push(def)
	}
	return defs
}

export function findProperty(defs: readonly PropertyDef[], id: string): PropertyDef | undefined {
	return defs.find((d) => d.id === id)
}

/** A map view for the hot paths — aggregation looks properties up per shape, per property. */
export function propertyMap(defs: readonly PropertyDef[]): ReadonlyMap<string, PropertyDef> {
	return new Map(defs.map((d) => [d.id, d]))
}

/**
 * Creates a property, or returns the existing one if the name already maps to it.
 *
 * Returns `null` for a name with nothing usable in it. Ids are deterministic slugs of the name, so
 * "Price" typed on two different boards produces the same id — which is what lets a pasted shape's
 * values land on the right property.
 */
export function createProperty(
	editor: Editor,
	spec: Omit<PropertyDef, 'id'> & { id?: string }
): PropertyDef | null {
	const name = spec.name.trim()
	const id = spec.id ?? propertyIdFromName(name)
	if (!id || !name) return null

	const existing = readPropertyRegistry(editor)
	const already = findProperty(existing, id)
	if (already) return already

	// Built key by key rather than spread: `meta` is validated as `T.jsonValue`, and an explicit
	// `unit: undefined` from a caller would make every shape carrying this property unloadable.
	const def: PropertyDef = { id, name, type: spec.type }
	if (spec.unit) def.unit = spec.unit
	if (spec.options?.length) def.options = spec.options
	writePropertyRegistry(editor, [...existing, def])
	return def
}

/** Renames or retypes a property. Values are keyed by id, so a rename touches no shapes. */
export function updateProperty(
	editor: Editor,
	id: string,
	patch: Partial<Omit<PropertyDef, 'id'>>
): void {
	const defs = readPropertyRegistry(editor)
	if (!findProperty(defs, id)) return
	writePropertyRegistry(
		editor,
		defs.map((d) => (d.id === id ? { ...d, ...patch } : d))
	)
}

/**
 * Removes a definition from the registry.
 *
 * Deliberately does **not** strip the property's values from shapes. Two reasons: sweeping every
 * shape on a board would be a large, unbatchable write, and a delete-then-undo would have to restore
 * them all. Orphaned values are invisible (nothing renders a value with no definition) and are
 * re-adopted if a property with the same id is created again — which is the friendlier outcome.
 */
export function deleteProperty(editor: Editor, id: string): void {
	writePropertyRegistry(
		editor,
		readPropertyRegistry(editor).filter((d) => d.id !== id)
	)
}

/**
 * Adds any definitions the board doesn't have yet, leaving existing ones untouched.
 *
 * This is what makes pasting a shape between boards self-healing: shapes carry a small sidecar of the
 * definitions they use (see `values.ts`), and merging it here turns unrecoverable id → value pairs
 * back into real properties. Idempotent, so it is safe to run on every paste.
 */
export function mergeProperties(editor: Editor, incoming: readonly PropertyDef[]): void {
	const existing = readPropertyRegistry(editor)
	const known = new Set(existing.map((d) => d.id))
	const additions = incoming.filter((d) => d.id && !known.has(d.id))
	if (!additions.length) return
	writePropertyRegistry(editor, [...existing, ...additions])
}

function writePropertyRegistry(editor: Editor, defs: readonly PropertyDef[]): void {
	editor.run(() => {
		editor.updateDocumentSettings({
			meta: {
				...editor.getDocumentSettings().meta,
				// `PropertyDef` is JSON by construction, so this is a widening cast, not a lie.
				[META_KEY]: defs as unknown as JsonValue,
			},
		})
	})
}
