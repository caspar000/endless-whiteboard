import { describe, expect, it } from 'vitest'
import type { OperationManifestEntry } from '@lifeboard/mcp-server/protocol'
import { allowedToolNames, decidePermission } from './session.js'

/**
 * The panel's security boundary, asserted directly.
 *
 * A model that declines to read a file has only demonstrated good behaviour; these assert that it
 * would have been *stopped*. That distinction is the whole reason the gate is a pure function
 * rather than a closure buried in the options object.
 */

const manifest: OperationManifestEntry[] = [
	{
		id: 'node.insert',
		title: 'Insert node',
		description: 'Adds a node.',
		readOnly: false,
		inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
	},
	{
		id: 'view.zoom-fit',
		title: 'Zoom to fit',
		description: 'Fits the board.',
		readOnly: true,
		inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
	},
]

const allowed = allowedToolNames(manifest)

describe('the tool gate', () => {
	it('names board tools the way the SDK will ask about them', () => {
		// Three encodings deep: MCP namespacing, the underscore-for-dot swap, then the operation id.
		// A mismatch here silently denies every board tool, so it is pinned rather than assumed.
		expect(allowed.has('mcp__lifeboard__node_insert')).toBe(true)
		expect(allowed.has('mcp__lifeboard__view_zoom-fit')).toBe(true)
	})

	it('allows the board tools the app offered', () => {
		expect(decidePermission(allowed, 'mcp__lifeboard__node_insert').behavior).toBe('allow')
	})

	it('allows research, which is what makes "look it up and add it" work', () => {
		expect(decidePermission(allowed, 'WebSearch').behavior).toBe('allow')
		expect(decidePermission(allowed, 'WebFetch').behavior).toBe('allow')
	})

	it('refuses the filesystem and the shell', () => {
		for (const tool of ['Bash', 'Read', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep', 'Task']) {
			const decision = decidePermission(allowed, tool)
			expect(decision.behavior, tool).toBe('deny')
			// Denials carry a sentence rather than a bare refusal: the model reads this and tells the
			// user what it cannot do, instead of retrying the same call.
			if (decision.behavior === 'deny') expect(decision.message.length).toBeGreaterThan(0)
		}
	})

	/**
	 * An operation the app withheld — read-only mode, or a disabled extension — is not merely absent
	 * from the tool list; calling it by name is refused too. The app already filters the manifest, and
	 * this is the second half of that: filtering is the UX, refusing is the gate.
	 */
	it('refuses a board tool the manifest did not offer', () => {
		expect(decidePermission(allowed, 'mcp__lifeboard__board_delete').behavior).toBe('deny')
	})

	it('refuses a lookalike name', () => {
		expect(decidePermission(allowed, 'mcp__other__node_insert').behavior).toBe('deny')
		expect(decidePermission(allowed, 'node_insert').behavior).toBe('deny')
	})
})
