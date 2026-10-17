import { parseRequirements } from '../requirements'

/** The node ids a node's requirements name as prerequisites, in order. */
export function prerequisitesOf(requires: string): string[] {
	const parsed = parseRequirements(requires)
	return parsed.ok ? parsed.conditions.flatMap((c) => ('node' in c ? c.node : [])) : []
}
