import type { OperationManifestEntry } from './protocol.js'

/**
 * Turning operations into MCP tools.
 *
 * There is no list of tools in this package. The connected tab reports what it offers and this
 * projects that onto MCP — so an extension that contributes an operation contributes a tool, with
 * no change here. It is the same registry-driven rule the app already follows for node types.
 */

/**
 * Operation ids are dot-namespaced (`board.list`); MCP tool names are conventionally restricted to
 * `[A-Za-z0-9_-]`, and clients that validate against that pattern reject a dot outright. So the
 * separator is swapped on the way out and swapped back on the way in.
 *
 * The mapping is total and reversible only because operation ids never contain an underscore —
 * which is why they are named with dots and hyphens (`view.zoom-fit`) and must stay that way.
 */
export function toolNameFor(operationId: string): string {
	return operationId.replace(/\./g, '_')
}

export function operationIdFor(toolName: string): string {
	return toolName.replace(/_/g, '.')
}

export interface McpTool {
	name: string
	description: string
	inputSchema: OperationManifestEntry['inputSchema']
	annotations: {
		title: string
		readOnlyHint: boolean
		/** Everything here acts on the user's own boards and nothing reaches the open internet. */
		openWorldHint: false
	}
}

export function toolsFromManifest(manifest: readonly OperationManifestEntry[]): McpTool[] {
	return manifest.map((entry) => ({
		name: toolNameFor(entry.id),
		description: entry.description,
		inputSchema: entry.inputSchema,
		annotations: {
			title: entry.title,
			readOnlyHint: entry.readOnly,
			openWorldHint: false,
		},
	}))
}

/** Finds the operation a tool call names, or `undefined` if the manifest has no such tool. */
export function resolveTool(
	manifest: readonly OperationManifestEntry[],
	toolName: string
): OperationManifestEntry | undefined {
	// Matched by the projected name rather than by reversing it, so an id containing a character the
	// mapping does not round-trip can never resolve to the wrong operation.
	return manifest.find((entry) => toolNameFor(entry.id) === toolName)
}
