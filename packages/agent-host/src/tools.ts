import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentBridge } from '@lifeboard/mcp-server/bridge'
import type { OperationManifestEntry } from '@lifeboard/mcp-server/protocol'
import { toolNameFor } from '@lifeboard/mcp-server/tools'
import { z, type ZodRawShape, type ZodTypeAny } from 'zod'

/**
 * The connected tab's operations, as tools the in-process model can call.
 *
 * The same projection `mcp-server` performs for an external agent, with one difference forced by the
 * SDK: an in-process server is registered through the high-level `McpServer`, whose `registerTool`
 * takes a **Zod shape** rather than the JSON Schema the manifest carries over the wire. So the schema
 * is translated back here.
 *
 * That translation is only safe because the operation parameter space is tiny and closed — node-kit's
 * `ParamType` is `string | number | boolean | string[]`, optionally with `choices` — and `toJsonSchema`
 * is the only thing that writes these schemas. Anything outside that space is refused rather than
 * approximated: a parameter the model is shown inaccurately is worse than one it is not shown at all,
 * because it produces a call that validates here and fails in the app.
 */

interface JsonSchemaProperty {
	type?: string
	description?: string
	enum?: string[]
	items?: { type?: string }
}

/**
 * One JSON Schema property as a Zod type, or `null` for anything unrecognised.
 *
 * `.describe()` is not decoration — the description is the entire UX of a tool call, and dropping it
 * would leave the model guessing what a parameter means from its name.
 */
export function zodForProperty(property: JsonSchemaProperty): ZodTypeAny | null {
	const described = (type: ZodTypeAny) =>
		property.description ? type.describe(property.description) : type

	switch (property.type) {
		case 'string': {
			const choices = property.enum
			// A closed set becomes an enum rather than a string, so an invalid value is a schema error
			// the model is told about immediately rather than a round trip that fails in the app.
			if (choices?.length) {
				const [first, ...rest] = choices
				return described(z.enum([first as string, ...rest]))
			}
			return described(z.string())
		}
		case 'number':
			return described(z.number())
		case 'boolean':
			return described(z.boolean())
		case 'array':
			// `string[]` is the only array node-kit emits.
			return property.items?.type === 'string' ? described(z.array(z.string())) : null
		default:
			return null
	}
}

/** A manifest entry's input schema as a Zod shape, or `null` if any parameter is untranslatable. */
export function shapeFor(entry: OperationManifestEntry): ZodRawShape | null {
	const shape: ZodRawShape = {}
	const required = new Set(entry.inputSchema.required)

	for (const [name, raw] of Object.entries(entry.inputSchema.properties)) {
		const property = raw as JsonSchemaProperty
		const type = zodForProperty(property)
		if (!type) return null
		// Optional means "may be absent", never "has a default" — node-kit's operations read an
		// omitted parameter as `undefined` and decide for themselves what that means.
		shape[name] = required.has(name) ? type : type.optional()
	}

	return shape
}

/**
 * Builds the MCP server the model talks to.
 *
 * Rebuilt per turn rather than kept and mutated, because the manifest is not stable: toggling an
 * extension in Settings adds or removes operations, and a turn should be able to call whatever the
 * app offers *now*. Rebuilding costs nothing next to a model round trip and removes the entire class
 * of bug where the tool list and the app disagree.
 */
export function buildToolServer(
	bridge: AgentBridge,
	manifest: readonly OperationManifestEntry[],
	log: (message: string) => void = () => {}
): McpServer {
	const server = new McpServer({ name: 'lifeboard', version: '0.1.0' })

	for (const entry of manifest) {
		const shape = shapeFor(entry)
		if (!shape) {
			log(`Skipping "${entry.id}" — its parameters do not map onto a tool schema.`)
			continue
		}

		server.registerTool(
			toolNameFor(entry.id),
			{
				title: entry.title,
				description: entry.description,
				inputSchema: shape,
				/**
				 * Put these tools in the prompt rather than behind tool search.
				 *
				 * By default the SDK *defers* MCP tool schemas: the model is told a server exists and has
				 * to call `ToolSearch` to find out what it offers. For a machine with twenty servers
				 * attached that is the right trade. Here it is the wrong one — this server is the entire
				 * reason the panel exists, every conversation in it is about a board, and deferring meant
				 * each one opened with a search for the tools it was always going to use.
				 *
				 * The cost is honest: ~25 schemas in the prompt on every turn. The deferred path pays for
				 * the same schemas *plus* a model turn to ask for them, so the only case where deferring
				 * wins is one where the tools go unused — which, in a panel whose whole subject is the
				 * board, is not the common case.
				 *
				 * `_meta['anthropic/alwaysLoad']` is the SDK's documented hook for this; it is what
				 * `createSdkMcpServer({ alwaysLoad: true })` sets on each tool, and this server is built
				 * from a raw `McpServer` so it sets it directly.
				 */
				_meta: { 'anthropic/alwaysLoad': true },
				annotations: {
					title: entry.title,
					readOnlyHint: entry.readOnly,
					// Everything here acts on the user's own boards; nothing reaches the open internet.
					openWorldHint: false,
				},
			},
			async (args: Record<string, unknown>) => {
				const result = await bridge.invoke(entry.id, args)
				if (!result.ok) {
					// `isError` rather than a throw: a failed operation is a normal answer the model
					// should read and act on, not a transport fault.
					return { content: [{ type: 'text' as const, text: result.error }], isError: true }
				}
				return {
					content: [
						{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) },
						// `view.look` renders the board and hands back the pixels; this is where they
						// become something the model can actually see. Without it the operation would be
						// a JSON description of an image it was never shown.
						...(result.images ?? []).map((image) => ({
							type: 'image' as const,
							data: image.data,
							mimeType: image.mediaType,
						})),
					],
				}
			}
		)
	}

	return server
}
