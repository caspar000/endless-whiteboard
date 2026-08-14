import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { AgentBridge } from './bridge.js'
import { FALLBACK_MANIFEST } from './fallbackManifest.js'
import { resolveTool, toolsFromManifest } from './tools.js'

export const SERVER_NAME = 'lifeboard'
export const SERVER_VERSION = '0.1.0'

/**
 * The MCP server: a projection of the connected tab's operations, and a relay for calls against
 * them. It understands neither boards nor nodes — everything that does lives in the app.
 */
export function createServer(bridge: AgentBridge): Server {
	const server = new Server(
		{ name: SERVER_NAME, version: SERVER_VERSION },
		{
			capabilities: {
				// `listChanged` is what lets the cold-start fallback below be honest: the list can grow
				// the moment a tab connects, and the client is told rather than left with a stale one.
				tools: { listChanged: true },
			},
		}
	)

	/**
	 * The live manifest, or the committed fallback when no tab is connected.
	 *
	 * The fallback exists because an MCP client asks for the tool list once, at startup — usually
	 * before the user has opened Lifeboard. Without it the agent would see no tools at all and
	 * conclude the integration is broken, rather than seeing the tools and being told to open the app
	 * when it calls one.
	 */
	const currentManifest = () => bridge.getManifest() ?? FALLBACK_MANIFEST

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: toolsFromManifest(currentManifest()),
	}))

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const manifest = currentManifest()
		const entry = resolveTool(manifest, request.params.name)
		if (!entry) {
			return {
				content: [
					{
						type: 'text' as const,
						text: `No such tool: "${request.params.name}". The available tools depend on which extensions are enabled in Lifeboard.`,
					},
				],
				isError: true,
			}
		}

		const result = await bridge.invoke(entry.id, request.params.arguments ?? {})

		if (!result.ok) {
			// `isError` rather than a thrown exception: a failed operation is a normal answer the agent
			// should read and act on, not a transport-level fault.
			return { content: [{ type: 'text' as const, text: result.error }], isError: true }
		}

		return {
			content: [
				{
					type: 'text' as const,
					// Pretty-printed on purpose — an agent reads this, and the extra bytes buy legibility
					// on the shape of a board that a single line would bury.
					text: JSON.stringify(result.data, null, 2),
				},
			],
		}
	})

	// Toggling an extension in Settings changes what the app offers; re-announce so the agent's tool
	// list never names an operation that has gone away.
	bridge.onManifestChange(() => {
		void server.sendToolListChanged()
	})

	return server
}
