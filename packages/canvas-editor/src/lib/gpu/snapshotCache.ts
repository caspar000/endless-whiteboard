import type { TLShapeId } from '@tldraw/tlschema'
import type { GpuPrimitive } from './primitives'
import { drawRecipe, type Recipe } from './recipes'

/**
 * What the element reader (`snapshots.ts`) read of each shape, kept between sessions
 * (docs/gpu-renderer-plan.md, phase 10): reading means mounting a shape, laying it out and taking it
 * apart, a few hundred a second, so a board of 20,000 shapes took minutes on every open before the
 * GPU could draw it zoomed out. Kept, it's read once.
 *
 * In its own IndexedDB database, by shape id, each entry with the key it was read for: a hash of what
 * the picture depends on (`GpuSnapshots` makes it: the record, the render key, the theme, the reader
 * and the app's build). Only shapes whose util says `canLeavePage` are kept, the ones that draw from
 * their own record; one that shows other shapes' data could come back out of date.
 *
 * Off until the app gives it a version (`configureGpuSnapshotCache`), which it changes with every
 * build: styles change between builds, and with them what a shape looks like.
 */

const DB_NAME = 'lifeboard-gpu-snapshots'
const STORE = 'shapes'
/** Past this many entries, the oldest are let go. */
const MAX_ENTRIES = 200_000

export interface CachedSnapshot {
	key: string
	prims: StoredPrimitive[]
	/** When it was last written, for letting the oldest go. */
	at: number
}

/** A primitive as stored: a picture's recipe without its `draw`. */
type StoredPrimitive = Exclude<GpuPrimitive, { kind: 'image' }> | (Omit<Extract<GpuPrimitive, { kind: 'image' }>, 'draw' | 'recipe'> & { recipe: Recipe })

let version: string | null = null

/** Turns the cache on, for this build of the app, or off (`null`). */
export function configureGpuSnapshotCache(options: { version: string } | null): void {
	version = options?.version ?? null
}

/** The build the cache is kept for, or null when it's off. */
export const gpuSnapshotCacheVersion = (): string | null => version

let db: Promise<IDBDatabase | null> | null = null
function open(): Promise<IDBDatabase | null> {
	if (typeof indexedDB === 'undefined') return Promise.resolve(null)
	db ??= new Promise((resolve) => {
		const request = indexedDB.open(DB_NAME, 1)
		request.onupgradeneeded = () => {
			const store = request.result.createObjectStore(STORE)
			store.createIndex('at', 'at')
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => resolve(null)
		request.onblocked = () => resolve(null)
	})
	return db
}

/** The kept snapshots of these shapes, those there are. */
export async function loadSnapshots(ids: Iterable<TLShapeId>): Promise<Map<TLShapeId, CachedSnapshot>> {
	const out = new Map<TLShapeId, CachedSnapshot>()
	const d = await open()
	if (!d) return out
	return new Promise((resolve) => {
		const tx = d.transaction(STORE, 'readonly')
		const store = tx.objectStore(STORE)
		for (const id of ids) {
			const request = store.get(id)
			request.onsuccess = () => {
				if (request.result) out.set(id, request.result as CachedSnapshot)
			}
		}
		tx.oncomplete = () => resolve(out)
		tx.onerror = () => resolve(out)
		tx.onabort = () => resolve(out)
	})
}

/** Keeps these snapshots, and lets the oldest go past `MAX_ENTRIES`. */
export async function saveSnapshots(entries: [TLShapeId, CachedSnapshot][]): Promise<void> {
	const d = await open()
	if (!d || !entries.length) return
	await new Promise<void>((resolve) => {
		const tx = d.transaction(STORE, 'readwrite')
		const store = tx.objectStore(STORE)
		for (const [id, entry] of entries) store.put(entry, id)
		const count = store.count()
		count.onsuccess = () => {
			const over = count.result - MAX_ENTRIES
			if (over <= 0) return
			// The oldest tenth more than is over, so this doesn't happen on every write.
			let left = over + Math.floor(MAX_ENTRIES / 10)
			const cursor = store.index('at').openKeyCursor()
			cursor.onsuccess = () => {
				const c = cursor.result
				if (!c || left-- <= 0) return
				store.delete(c.primaryKey)
				c.continue()
			}
		}
		tx.oncomplete = () => resolve()
		tx.onerror = () => resolve()
		tx.onabort = () => resolve()
	})
}

/** A shape's primitives as they can be stored, or null if a picture among them has no recipe. */
export function storable(prims: GpuPrimitive[]): StoredPrimitive[] | null {
	const out: StoredPrimitive[] = []
	for (const p of prims) {
		if (p.kind !== 'image') {
			out.push(p)
			continue
		}
		if (!p.recipe || hasBlobUrl(p.recipe)) return null
		const { draw: _draw, ...rest } = p
		out.push({ ...rest, recipe: p.recipe })
	}
	return out
}

/** Primitives back from storage, each picture drawn from its recipe. */
export function restored(prims: StoredPrimitive[]): GpuPrimitive[] {
	return prims.map((p) => (p.kind === 'image' ? { ...p, draw: (ctx: CanvasRenderingContext2D) => drawRecipe(ctx, p.recipe) } : p))
}

/** A picture of an object URL: gone with the page that made it. */
function hasBlobUrl(r: Recipe): boolean {
	if (r.t === 'cut') return hasBlobUrl(r.inner)
	return (r.t === 'img' || r.t === 'svg') && r.url.startsWith('blob:')
}

/** For tests: forget the open database. */
export function resetGpuSnapshotCache(): void {
	db = null
}
