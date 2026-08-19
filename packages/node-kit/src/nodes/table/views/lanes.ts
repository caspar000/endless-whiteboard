import { STATUS_STAGES, isChoiceType, type PropertyDef, type StatusStage } from '../../../properties/types'
import { stageForOption } from '../../../properties/options'
import { EMPTY_GROUP_KEY, type TableGroup } from '../query'
import { CURRENCY_GROUP_PREFIX, LABEL_COLUMN, type TableNodeProps } from '../spec'

/**
 * Which property makes the lanes, or `null` when the kanban has nothing to draw yet.
 *
 * Three groupings a table allows are refused here, and for one reason each:
 *
 * - **none** — a kanban with one lane is a list, badly drawn.
 * - **the label column** — a lane per shape name is a lane per card, and worse, it would leave the
 *   query with no property column at all, whereupon `queryTable`'s membership rule ("carry at least
 *   one of the table's column properties") matches *everything on the page* and the view would try to
 *   file every drawing on the board. See the plan's gotcha 1.
 * - **a currency grouping** — "the currency of the price" is a fact about an amount, not a state a
 *   card can be dragged into, so a lane for it could only ever be read-only.
 */
export function laneProperty(props: TableNodeProps): string | null {
	const groupBy = props.groupBy
	if (!groupBy) return null
	if (groupBy === LABEL_COLUMN) return null
	if (groupBy.startsWith(CURRENCY_GROUP_PREFIX)) return null
	return groupBy
}

/**
 * The lanes to draw, in order.
 *
 * Order matters more here than in a table, because a kanban's columns are read left to right as a
 * *progression*: a board showing "Done, Blocked, To-do" because those happen to be the biggest buckets
 * would be nonsense. So, in precedence:
 *
 * 1. A stored order (`layout.lanes`) — someone arranged these by hand. It leads the list rather than
 *    being the whole of it, so an option added to the property later still gets a lane.
 * 2. For a `status` property, its **stages**: to-do, then in progress, then done, and within a stage
 *    the order the options are declared in. This is what a status property is *for*, and it is the one
 *    ordering the board can derive without being told.
 * 3. For any other choice property, the order its options are declared in.
 * 4. Otherwise the order the query produced, which is biggest bucket first.
 *
 * Two rules apply on top, whichever branch ran. **Values present on the board are never dropped**,
 * even when the property's `options` list has never heard of them — options are "a convenience list,
 * never a constraint" (`properties/types.ts`), so an unlisted value is appended rather than hidden,
 * which would lose a card. And the empty lane sorts **last** and appears only when something is in it:
 * it is an absence, not a category, but "cards with no status yet" is exactly the pile a kanban is good
 * at showing, so it earns a lane as soon as it has an occupant.
 */
export function laneKeys(
	def: PropertyDef | null,
	groups: readonly TableGroup[],
	override?: readonly string[] | null
): string[] {
	const present = new Set<string>()
	for (const group of groups) if (group.key !== null) present.add(group.key)

	const ordered: string[] = []
	const push = (key: string) => {
		if (key === EMPTY_GROUP_KEY) return
		if (!ordered.includes(key)) ordered.push(key)
	}

	// A stored order arranges the front of the list; it does not *replace* it. An option added to the
	// property after someone dragged their lanes around would otherwise never get a lane, and so could
	// never be dropped into.
	if (override?.length) for (const key of override) push(key)
	if (def && isChoiceType(def.type)) for (const option of orderedOptions(def)) push(option)

	// Whatever the board actually holds, in the query's own order — the only source that cannot be
	// stale, and the sole branch for a property with no options at all.
	for (const group of groups) if (group.key !== null) push(group.key)

	if (present.has(EMPTY_GROUP_KEY)) ordered.push(EMPTY_GROUP_KEY)
	return ordered
}

/** A choice property's options, by stage for a `status` and as declared for anything else. */
function orderedOptions(def: PropertyDef): string[] {
	const options = def.options ?? []
	if (def.type !== 'status') return [...options]

	const byStage = new Map<StatusStage, string[]>(STATUS_STAGES.map((stage) => [stage, []]))
	for (const option of options) {
		// Anything unlisted counts as `todo`, which is `stageForOption`'s own rule — so a status property
		// is usable the moment it has options, before anyone has assigned stages.
		byStage.get(stageForOption(def, option))!.push(option)
	}
	return STATUS_STAGES.flatMap((stage) => byStage.get(stage)!)
}

/** The rows in each lane, keyed as `laneKeys` names them. Lanes with nothing in them are absent. */
export function rowsByLane(groups: readonly TableGroup[]): Map<string, TableGroup> {
	const out = new Map<string, TableGroup>()
	for (const group of groups) if (group.key !== null) out.set(group.key, group)
	return out
}
