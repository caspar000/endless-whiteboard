/**
 * How a tool call reads in the transcript.
 *
 * Two pure functions, in their own module rather than beside the component that uses them. That is
 * not tidiness: a non-component export from a `.tsx` file defeats React Fast Refresh for the whole
 * file, so every edit to the agent panel would reload the panel from scratch and lose the
 * conversation on screen — while working on the conversation on screen.
 */

/**
 * A tool name as the user should read it.
 *
 * The wire carries `mcp__lifeboard__node_insert`, which is three encodings deep — the SDK's MCP
 * namespacing, the underscore-for-dot swap MCP tool names require, and the operation id itself.
 * Undoing all three here keeps that entirely inside the plumbing that needs it.
 */
export function prettyToolName(name: string): string {
	const bare = name.startsWith('mcp__lifeboard__') ? name.slice('mcp__lifeboard__'.length) : name
	return bare.replace(/_/g, '.')
}

/**
 * Truncation point for a tool's arguments.
 *
 * Not a stylistic limit. `node.image` and friends carry base64, and pasting a megabyte of it into a
 * transcript node — inside a `pre` that the panel then measures — is how the tab stops responding.
 */
export const MAX_TOOL_DETAIL = 2000

/**
 * A tool's arguments as something worth reading, or `''` for nothing worth showing.
 *
 * Pretty-printed rather than on one line: these are nested objects (a node's props, a query's
 * filters) and a 360px column turns a single line into a horizontal scroll nobody will use.
 *
 * `''` is the signal that there is nothing to expand, and it covers the common case rather than an
 * edge one: every no-argument operation (`view.zoom-fit`, `board.list`) has an input of `{}`, and
 * offering to expand nothing is worse than not offering.
 */
export function formatToolInput(input: unknown): string {
	if (input === null || input === undefined) return ''
	if (typeof input === 'object' && Object.keys(input as object).length === 0) return ''
	try {
		const text = JSON.stringify(input, null, 2)
		// `undefined` for a value JSON cannot represent at all — a bare function or symbol, which
		// cannot have come off the wire, but the row still has to render.
		if (typeof text !== 'string') return ''
		return text.length > MAX_TOOL_DETAIL ? `${text.slice(0, MAX_TOOL_DETAIL)}\n…` : text
	} catch {
		// Cyclic. Also impossible off the wire, and also not a reason to fail a render.
		return ''
	}
}
