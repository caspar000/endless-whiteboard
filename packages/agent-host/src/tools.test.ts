import { describe, expect, it } from 'vitest'
import type { OperationManifestEntry } from '@lifeboard/mcp-server/protocol'
import { shapeFor, zodForProperty } from './tools.js'

/**
 * The JSON Schema the manifest carries has to become the Zod shape the SDK's in-process server
 * wants, and the risk in that translation is not that it throws — it is that it quietly *widens*.
 * A schema that drops an enum or turns a number into a string produces a call the model believes
 * is valid and the app rejects, which reads to the user as the agent being wrong.
 */

function entry(properties: Record<string, unknown>, required: string[] = []): OperationManifestEntry {
	return {
		id: 'node.insert',
		title: 'Insert node',
		description: 'Adds a node.',
		readOnly: false,
		inputSchema: { type: 'object', properties, required, additionalProperties: false },
	}
}

describe('translating a parameter', () => {
	it('carries the description across — it is the whole UX of a tool call', () => {
		const type = zodForProperty({ type: 'string', description: 'The board to open.' })
		expect(type?.description).toBe('The board to open.')
	})

	it('keeps a closed set closed', () => {
		const type = zodForProperty({ type: 'string', enum: ['todo', 'doing', 'done'] })
		expect(type?.safeParse('doing').success).toBe(true)
		// The point of the enum surviving: an invalid value fails here, where the model is told,
		// rather than after a round trip into the app.
		expect(type?.safeParse('elsewhere').success).toBe(false)
	})

	it('maps the rest of node-kit\'s parameter space', () => {
		expect(zodForProperty({ type: 'number' })?.safeParse(4).success).toBe(true)
		expect(zodForProperty({ type: 'boolean' })?.safeParse(true).success).toBe(true)
		expect(
			zodForProperty({ type: 'array', items: { type: 'string' } })?.safeParse(['a']).success
		).toBe(true)
	})

	/**
	 * Refused rather than approximated. An untranslatable parameter shown as something looser would
	 * be a tool the model can call wrongly with no warning; withholding it is the honest failure.
	 */
	it('refuses anything outside that space', () => {
		expect(zodForProperty({ type: 'object' })).toBeNull()
		expect(zodForProperty({ type: 'array', items: { type: 'number' } })).toBeNull()
		expect(zodForProperty({})).toBeNull()
	})
})

describe('translating an operation', () => {
	it('distinguishes required from optional', () => {
		const shape = shapeFor(entry({ type: { type: 'string' }, x: { type: 'number' } }, ['type']))
		expect(shape).not.toBeNull()
		expect(shape!.type!.isOptional()).toBe(false)
		expect(shape!.x!.isOptional()).toBe(true)
	})

	it('drops the whole operation when one parameter will not translate', () => {
		expect(shapeFor(entry({ ok: { type: 'string' }, bad: { type: 'object' } }))).toBeNull()
	})

	it('handles an operation with no parameters', () => {
		expect(shapeFor(entry({}))).toEqual({})
	})
})
