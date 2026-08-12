import { describe, expect, it } from 'vitest'
import { markdownNoteExtension } from './extension'
import { NOTE_NODE_TYPE, noteNodeDefinition, noteTitle } from './definition'

describe('markdownNoteExtension', () => {
	it('contributes the note definition under a stable id', () => {
		expect(markdownNoteExtension.id).toBe('lifeboard.note-markdown')
		expect(markdownNoteExtension.nodes.map((n) => n.type)).toEqual([NOTE_NODE_TYPE])
	})

	it('gives the definition everything the registry-driven UI needs', () => {
		expect(noteNodeDefinition.label).toBeTruthy()
		expect(noteNodeDefinition.icon).toBeTruthy()
		expect(noteNodeDefinition.kbd).toBe('m')
		expect(Array.isArray(noteNodeDefinition.migrations.sequence)).toBe(true)
	})

	it('validates its default props against its own validators', () => {
		const defaults: Record<string, unknown> = { ...noteNodeDefinition.defaultProps() }
		for (const [key, validator] of Object.entries(noteNodeDefinition.props)) {
			expect(
				() => (validator as { validate(v: unknown): unknown }).validate(defaults[key]),
				key
			).not.toThrow()
		}
	})
})

describe('noteTitle', () => {
	it('labels notes by their first heading', () => {
		expect(noteTitle('# Chores\n- milk')).toBe('Chores')
	})

	it('falls back to the first line of prose, stripped of markup', () => {
		expect(noteTitle('\n> **quoted** start')).toBe('quoted start')
		expect(noteTitle('')).toBe('')
	})
})
