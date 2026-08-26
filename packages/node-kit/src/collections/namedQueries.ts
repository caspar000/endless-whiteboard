import { isExtensionEnabled, subscribeToNodeDefinitions } from '../registry'
import { EXPRESSION_OPS, EXPRESSION_SOURCES } from './expressions'

/**
 * A name bound to an expression — `runway` standing for `sum cash page`.
 *
 * The third registry, and deliberately the smallest. `commands.ts` is what a person can *do*,
 * `operations.ts` is what an agent can do, and this is what the board can be asked. It exists
 * because the answer to "how do I make the language extensible" should not be an interpreter: a
 * named query is *textual*, expanded to the expression it stands for and then evaluated by the
 * evaluator that was already there. Nothing new can be computed that could not be computed before —
 * what changes is that a question worth asking twice only has to be composed once.
 *
 * That also decides the storage format for free. A query is a string, so a user's own queries are a
 * few bytes of JSON in localStorage, an extension's are literals in its manifest, and both arrive
 * through this one door.
 */
export interface NamedQuery {
	/**
	 * What you type: `runway`, `burn rate`. Matched case-insensitively, and may contain spaces —
	 * "burn rate" is what someone would actually call it, and nothing in the grammar objects.
	 */
	name: string
	/** The expression it stands for, without braces: `sum cash page`. */
	body: string
	/** One line, shown beside the name in the `{…}` menu. */
	description?: string
}

const queries = new Map<string, NamedQuery>()

/** Which extension registered each query. Ownerless ones are the user's own and never toggle off. */
const ownerByName = new Map<string, string>()

const listeners = new Set<() => void>()

let visibleCache: NamedQuery[] | null = null

function invalidate(): void {
	visibleCache = null
	for (const listener of listeners) listener()
}

// Extension toggles change what is offered, exactly as they do for commands — same store, chained
// for the same reason.
subscribeToNodeDefinitions(invalidate)

export function subscribeToQueries(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

function key(name: string): string {
	return name.trim().toLowerCase()
}

/**
 * The words a query may not be called, because the grammar already means something by them.
 *
 * Refused at registration rather than resolved by precedence at read time. A query named `sum` that
 * merely *lost* to the verb would be a saved question that silently never runs — and the person who
 * saved it would have no way to find out. Refusing at the door is the only version of this that can
 * tell them.
 */
function isReservedName(name: string): boolean {
	const word = key(name)
	return word in EXPRESSION_OPS || word in EXPRESSION_SOURCES
}

/**
 * Registers a query, replacing any with the same name — the same rule as `registerCommand`, and it
 * carries the precedence this needs: the app loads the user's own queries *after* the extensions', so
 * a name someone chose for themselves wins over one that arrived with a plugin.
 *
 * Returns whether it took. A reserved name is refused rather than thrown over: the caller is usually
 * a person typing a name into the palette, and that is a sentence to show them, not a crash.
 */
export function registerQuery(query: NamedQuery, owner?: string): boolean {
	const name = query.name.trim()
	if (!name || !query.body.trim() || isReservedName(name)) return false
	queries.set(key(name), { ...query, name })
	if (owner !== undefined) ownerByName.set(key(name), owner)
	else ownerByName.delete(key(name))
	invalidate()
	return true
}

export function forgetQuery(name: string): void {
	if (!queries.delete(key(name))) return
	ownerByName.delete(key(name))
	invalidate()
}

/** Why a name cannot be used, or `null` if it can. Written to be shown to whoever typed it. */
export function queryNameProblem(name: string): string | null {
	const trimmed = name.trim()
	if (!trimmed) return 'Give it a name.'
	if (isReservedName(trimmed)) return `“${trimmed}” already means something in an expression.`
	return null
}

/** The query by that name, if its owning extension is enabled. Case- and space-insensitive. */
export function getQuery(name: string): NamedQuery | undefined {
	const found = queries.get(key(name))
	if (!found) return undefined
	const owner = ownerByName.get(key(name))
	return owner === undefined || isExtensionEnabled(owner) ? found : undefined
}

/** Every query on offer, in registration order. Stable snapshot between changes. */
export function getVisibleQueries(): NamedQuery[] {
	visibleCache ??= [...queries.entries()]
		.filter(([name]) => {
			const owner = ownerByName.get(name)
			return owner === undefined || isExtensionEnabled(owner)
		})
		.map(([, query]) => query)
	return visibleCache
}

/** The queries nobody owns — the ones the user saved, which are also the ones they can forget. */
export function getUserQueries(): NamedQuery[] {
	return [...queries.entries()]
		.filter(([name]) => !ownerByName.has(name))
		.map(([, query]) => query)
}

/** Used by tests to get a clean slate. */
export function clearQueryRegistry(): void {
	queries.clear()
	ownerByName.clear()
	invalidate()
}
