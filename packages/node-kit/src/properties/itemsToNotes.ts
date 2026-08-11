import { createMigrationIds, createMigrationSequence } from '@tldraw/store'
import type { MigrationSequence } from '@tldraw/store'
import { fieldAsPropertyDef, type NodeField } from '../fields'
import { ITEM_NODE_TYPE } from '../nodes/item/definition'
import { NOTE_NODE_TYPE } from '../nodes/markdown/definition'
import { ROLLUP_NODE_TYPE } from '../nodes/rollup/definition'
import { parsePropertyRegistry } from './schema'
import {
	nameFromPropertyKey,
	propertyIdFromName,
	TAGS_PROPERTY_ID,
	type PropertyDef,
	type PropertyValue,
} from './types'

/**
 * The item node's retirement: every `node.item` becomes a note, and its fields become properties.
 *
 * ### Why this is a store-scoped migration and not an app-level pass
 *
 * The obvious design — walk the board after loading it and rewrite the shapes — cannot work.
 * `createShapeRecordType` builds the shape validator as `T.union('type', …)` over exactly the
 * **registered** shape types, so the moment `node.item` is unregistered a surviving `node.item` record
 * is a *validation failure*, not a stale record: the board fails to open before any app code runs.
 *
 * A store-scoped migration runs *before* validation on every load path — verified in
 * `TLEditorSnapshot.ts` (`migrateStoreSnapshot` precedes `loadStoreSnapshot`) and
 * `TLLocalSyncClient.ts` (migrate precedes `store.put`) — so one mechanism covers the IndexedDB load,
 * the `snapshot` prop used by pending-restore and backup import, and the fixture tests.
 *
 * ### Why it must be idempotent, and what that forces
 *
 * tldraw only persists the migrated schema when the store next *changes*. Open a board, touch nothing,
 * close it — and this runs again on the next load. So `up(up(x))` must deep-equal `up(x)`, which is why
 * property ids are deterministic slugs of the field key and never generated. Every step below either
 * finds nothing to do or produces exactly the same result as the first time.
 *
 * ### A note for the next props migration
 *
 * Any future `node.markdown` props migration must declare `dependsOn: [itemsToNotesMigrations.id]`.
 * `sortMigrations` orders *independent* sequences heuristically, so without it a note migration could
 * run before the notes this creates exist.
 */
const versions = createMigrationIds('com.lifeboard.itemsToNotes', {
	ItemsToNotesAndProperties: 1,
})

/** The migration id other sequences must `dependsOn` if they touch notes. */
export const ITEMS_TO_NOTES_MIGRATION_ID = versions.ItemsToNotesAndProperties

const PROPERTIES_META_KEY = 'lifeboard:properties'
const VALUES_META_KEY = 'lifeboard:props'
const DEFS_META_KEY = 'lifeboard:propDefs'

interface LooseRecord {
	id?: unknown
	typeName?: unknown
	type?: unknown
	props?: Record<string, unknown>
	meta?: Record<string, unknown>
}

export const itemsToNotesMigrations: MigrationSequence = createMigrationSequence({
	sequenceId: 'com.lifeboard.itemsToNotes',
	// Applies to boards created before this sequence existed — which is all of them.
	retroactive: true,
	sequence: [
		{
			id: versions.ItemsToNotesAndProperties,
			scope: 'store',
			up(store) {
				const records = Object.values(store) as LooseRecord[]
				const items = records.filter(
					(r) => r.typeName === 'shape' && r.type === ITEM_NODE_TYPE && r.props
				)
				if (!items.length) return

				// 1. Registry entries for every distinct field key, plus Tags if anything is tagged.
				const discovered = new Map<string, PropertyDef>()
				for (const item of items) {
					for (const field of readFields(item)) {
						const def = fieldAsPropertyDef(field)
						// First definition of a key wins, so the result doesn't depend on record order —
						// `Object.values` order is stable but not something to rely on for correctness.
						if (def.id && !discovered.has(def.id)) discovered.set(def.id, def)
					}
					if (readTags(item).length && !discovered.has(TAGS_PROPERTY_ID)) {
						discovered.set(TAGS_PROPERTY_ID, {
							id: TAGS_PROPERTY_ID,
							name: nameFromPropertyKey(TAGS_PROPERTY_ID),
							type: 'multiSelect',
						})
					}
				}
				mergeIntoDocumentRegistry(records, discovered)

				// 2. Each item becomes a note in place: same id, same position, same size.
				//
				// Rewriting the record rather than creating a new shape and deleting the old one keeps
				// arrows bound to it, keeps its z-order, and keeps its parent frame — all of which are
				// expressed as references to the id.
				for (const item of items) {
					const fields = readFields(item)
					const tags = readTags(item)
					const values: Record<string, PropertyValue> = {}
					for (const field of fields) {
						if (!field.key) continue
						values[field.key] = field.value
					}
					if (tags.length) values[TAGS_PROPERTY_ID] = [...tags]

					const defs: PropertyDef[] = []
					for (const id of Object.keys(values)) {
						const def = discovered.get(id)
						if (def) defs.push(def)
					}

					item.type = NOTE_NODE_TYPE
					item.props = {
						w: numberOr(item.props?.w, 240),
						h: numberOr(item.props?.h, 120),
						md: markdownForItem(item),
						// The height came from the item card's own layout, so keep it rather than letting
						// the note re-derive one — the board should look as close to unchanged as possible.
						autoHeight: false,
					}
					item.meta = {
						...item.meta,
						[VALUES_META_KEY]: values,
						[DEFS_META_KEY]: defs,
					}
				}

				// 3. Repoint rollups that filtered on the type that no longer exists.
				for (const record of records) {
					if (record.typeName !== 'shape' || record.type !== ROLLUP_NODE_TYPE) continue
					const source = record.props?.source as { nodeType?: unknown } | undefined
					if (source && source.nodeType === ITEM_NODE_TYPE) {
						// `null` rather than the note type: after the migration the board's *notes* are the
						// things carrying prices, but so may a photo or a sticky be. Widening to "anything
						// with the property" is both what the user now means and what keeps the total the
						// same on the day of the upgrade.
						source.nodeType = null
					}
				}
			},
		},
	],
})

function readFields(record: LooseRecord): NodeField[] {
	const raw = record.props?.fields
	if (!Array.isArray(raw)) return []
	// Read defensively: this runs before validation, so the records have not been checked yet.
	return raw.filter(
		(f): f is NodeField => !!f && typeof f === 'object' && typeof (f as NodeField).key === 'string'
	)
}

function readTags(record: LooseRecord): string[] {
	const raw = record.props?.tags
	if (!Array.isArray(raw)) return []
	return raw.filter((t): t is string => typeof t === 'string' && t !== '')
}

function numberOr(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * The item's content as markdown: its title as a heading, its image as an image.
 *
 * `![](asset:…)` keeps the picture attached to the note, resolved by `MarkdownView`'s `img` override
 * against tldraw's asset store. The trade-off is that the markdown is no longer portable outside the
 * app — a future export would have to rewrite these to real files.
 */
function markdownForItem(record: LooseRecord): string {
	const title = typeof record.props?.title === 'string' ? record.props.title.trim() : ''
	const assetId = record.props?.imageAssetId
	const parts: string[] = []
	if (title) parts.push(`# ${title}`)
	if (typeof assetId === 'string' && assetId) parts.push(`![](${assetId})`)
	// A titleless, imageless item becomes an empty note rather than one holding a placeholder: there is
	// nothing to say, and its properties are the content that mattered.
	return parts.join('\n\n')
}

/** Adds the discovered definitions to the document record, leaving any existing ones untouched. */
function mergeIntoDocumentRegistry(
	records: LooseRecord[],
	discovered: ReadonlyMap<string, PropertyDef>
): void {
	if (!discovered.size) return
	const document = records.find((r) => r.typeName === 'document')
	if (!document) {
		// A snapshot with no document record is malformed rather than old; there is nowhere to put the
		// registry, and inventing a document record here risks colliding with tldraw's own. The values
		// still land on the shapes, and `readShapePropertyDefs` can recover the definitions from the
		// per-shape sidecar.
		return
	}

	const existing = parsePropertyRegistry(document.meta?.[PROPERTIES_META_KEY])
	const known = new Set(existing.map((d) => d.id))
	const additions = [...discovered.values()].filter((d) => !known.has(d.id))
	// Idempotence: a second run finds every id already known and writes nothing.
	if (!additions.length) return

	document.meta = {
		...document.meta,
		[PROPERTIES_META_KEY]: [...existing, ...additions],
	}
}

/** Exported for the migration's tests; also the id generator the registry uses for field keys. */
export { propertyIdFromName }
