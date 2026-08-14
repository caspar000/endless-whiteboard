import { describe, expect, it } from 'vitest'
import { FALLBACK_MANIFEST } from './fallbackManifest.js'
import { operationIdFor, resolveTool, toolNameFor, toolsFromManifest } from './tools.js'
import type { OperationManifestEntry } from './protocol.js'

const entry = (over: Partial<OperationManifestEntry> = {}): OperationManifestEntry => ({
	id: 'board.list',
	title: 'List boards',
	description: 'Every board in this workspace, most recently edited first.',
	readOnly: true,
	inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
	...over,
})

describe('tool names', () => {
	it('replaces the dots MCP clients reject', () => {
		expect(toolNameFor('board.list')).toBe('board_list')
		expect(toolNameFor('node.markdown.insert')).toBe('node_markdown_insert')
		expect(toolNameFor('view.zoom-fit')).toBe('view_zoom-fit')
	})

	it('produces names matching the conventional MCP pattern', () => {
		for (const op of FALLBACK_MANIFEST) {
			expect(toolNameFor(op.id), op.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
		}
	})

	it('round-trips every shipped operation id', () => {
		for (const op of FALLBACK_MANIFEST) {
			expect(operationIdFor(toolNameFor(op.id)), op.id).toBe(op.id)
		}
	})

	it('keeps names unique across the whole surface', () => {
		const names = FALLBACK_MANIFEST.map((op) => toolNameFor(op.id))
		expect(new Set(names).size).toBe(names.length)
	})
})

describe('toolsFromManifest', () => {
	it('carries the description, schema and read-only hint', () => {
		const [tool] = toolsFromManifest([entry()])
		expect(tool).toEqual({
			name: 'board_list',
			description: 'Every board in this workspace, most recently edited first.',
			inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
			annotations: { title: 'List boards', readOnlyHint: true, openWorldHint: false },
		})
	})

	it('marks a mutating operation as not read-only', () => {
		const [tool] = toolsFromManifest([entry({ id: 'node.insert', readOnly: false })])
		expect(tool?.annotations.readOnlyHint).toBe(false)
	})

	it('projects the whole shipped surface without loss', () => {
		expect(toolsFromManifest(FALLBACK_MANIFEST)).toHaveLength(FALLBACK_MANIFEST.length)
	})
})

describe('resolveTool', () => {
	it('finds the operation a tool call names', () => {
		expect(resolveTool([entry()], 'board_list')?.id).toBe('board.list')
	})

	it('returns undefined for a tool the manifest does not have', () => {
		expect(resolveTool([entry()], 'board_delete')).toBeUndefined()
	})
})

describe('the committed fallback manifest', () => {
	it('is non-empty, so a cold-start client sees tools before any tab connects', () => {
		expect(FALLBACK_MANIFEST.length).toBeGreaterThan(15)
	})

	it('includes the operations an agent needs to get started', () => {
		const ids = FALLBACK_MANIFEST.map((op) => op.id)
		expect(ids).toContain('board.list')
		expect(ids).toContain('node.types')
		expect(ids).toContain('node.insert')
		expect(ids).toContain('relation.connect')
	})

	it('gives every tool a description an agent can choose from', () => {
		for (const op of FALLBACK_MANIFEST) {
			expect(op.description.length, op.id).toBeGreaterThan(20)
		}
	})
})
