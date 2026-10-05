import {
	createComputedCache as createStoreComputedCache,
	type CreateComputedCacheOpts,
	type IdOf,
	type StoreObject,
	type UnknownRecord,
} from '@tldraw/store'

/**
 * The store's `createComputedCache`, typed for the fork's `TLShape`, which takes shapes of any type
 * (see shape-types.ts) and so isn't one of the schema's record types. The cache itself is the
 * store's.
 *
 * @public
 */
export function createComputedCache<
	Context extends StoreObject<any>,
	Result,
	Record extends UnknownRecord = UnknownRecord,
>(
	name: string,
	derive: (context: Context, record: Record) => Result | undefined,
	opts?: CreateComputedCacheOpts<Result, Record>
): { get(context: Context, id: IdOf<Record>): Result | undefined } {
	return createStoreComputedCache(name, derive as never, opts as never)
}
