import { beforeEach, describe, expect, it } from 'vitest'
import { clearOperationRegistry, operationManifest } from '../operations'
import { clearExtensionRegistry } from '../extensions'
import { clearNodeRegistry } from '../registry'
import { registerCoreOperations } from './index'

/**
 * Generates — and then guards — the MCP server's cold-start tool list.
 *
 * An MCP client asks for the tool list once, at startup, usually before Lifeboard is open. The
 * server therefore ships a committed manifest so the tools exist before any tab connects, and
 * replaces it with the live one the moment a tab does.
 *
 * That committed file is a *copy of this table*, and a copy that nothing checks is a copy that goes
 * stale silently — an agent would be offered a tool the app no longer has. So it is a file snapshot:
 * the test writes it, and any later change to the operations makes the test fail until it is
 * regenerated.
 *
 *     pnpm --filter @lifeboard/node-kit test -u
 *
 * Only descriptions and parameter schemas travel — no board data, nothing environment-specific — so
 * the artefact is deterministic and reviewable in a diff.
 */
const GENERATED_PATH = '../../../mcp-server/src/fallbackManifest.ts'

beforeEach(() => {
	clearOperationRegistry()
	clearExtensionRegistry()
	clearNodeRegistry()
	registerCoreOperations()
})

function generate(): string {
	const manifest = operationManifest()
	return [
		'// GENERATED FILE — do not edit by hand.',
		'//',
		"// The MCP server's cold-start tool list: what it offers before a Lifeboard tab has connected",
		'// and reported its live operations. Produced from the operation registry by',
		'// `packages/node-kit/src/ops/manifest.test.ts`; regenerate with:',
		'//',
		'//     pnpm --filter @lifeboard/node-kit test -u',
		'',
		"import type { OperationManifestEntry } from './protocol.js'",
		'',
		`export const FALLBACK_MANIFEST: OperationManifestEntry[] = ${JSON.stringify(manifest, null, '\t')}`,
		'',
	].join('\n')
}

describe('the MCP fallback manifest', () => {
	it('matches the operations this build registers', async () => {
		await expect(generate()).toMatchFileSnapshot(GENERATED_PATH)
	})

	it('describes every operation, since an agent picks a tool by reading this', () => {
		for (const entry of operationManifest()) {
			expect(entry.description.length, `${entry.id} has no usable description`).toBeGreaterThan(20)
		}
	})

	it('uses ids that survive the MCP tool-name mapping', () => {
		for (const entry of operationManifest()) {
			// The server swaps `.` for `_` because MCP tool names are restricted to [A-Za-z0-9_-].
			// An underscore in an id would make that mapping ambiguous in reverse.
			expect(entry.id, 'operation ids must not contain an underscore').not.toContain('_')
			expect(entry.id).toMatch(/^[a-z][a-z0-9.-]*$/)
		}
	})
})
