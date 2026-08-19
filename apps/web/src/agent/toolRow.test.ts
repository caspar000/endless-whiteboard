import { describe, expect, it } from 'vitest'
import { MAX_TOOL_DETAIL, formatToolInput, prettyToolName } from './toolRow'

describe('a tool name', () => {
	it('undoes all three encodings', () => {
		// MCP namespacing, then the underscore-for-dot swap, then the operation id. A mismatch here is
		// the difference between reading `node.insert` and `mcp__lifeboard__node_insert`.
		expect(prettyToolName('mcp__lifeboard__node_insert')).toBe('node.insert')
		expect(prettyToolName('mcp__lifeboard__view_zoom-fit')).toBe('view.zoom-fit')
	})

	it('leaves a name that is not ours alone, apart from the swap', () => {
		expect(prettyToolName('WebSearch')).toBe('WebSearch')
	})
})

describe('a tool call’s arguments', () => {
	it('are pretty-printed, because the column is 360px wide', () => {
		expect(formatToolInput({ boardId: 'b1', props: { text: 'hi' } })).toBe(
			'{\n  "boardId": "b1",\n  "props": {\n    "text": "hi"\n  }\n}'
		)
	})

	it('are nothing at all for an operation that takes none', () => {
		// The common case, not an edge one: `board.list` and `view.zoom-fit` both send `{}`, and an
		// expander that opens onto nothing is worse than no expander.
		expect(formatToolInput({})).toBe('')
		expect(formatToolInput(undefined)).toBe('')
		expect(formatToolInput(null)).toBe('')
	})

	it('are truncated, because an image operation carries base64', () => {
		// Not a stylistic limit — this is the case that would otherwise put a megabyte of base64 into
		// a `pre` the panel then measures.
		const formatted = formatToolInput({ data: 'A'.repeat(MAX_TOOL_DETAIL * 2) })
		expect(formatted.length).toBe(MAX_TOOL_DETAIL + 2)
		expect(formatted.endsWith('\n…')).toBe(true)
	})

	it('survive a payload JSON cannot represent', () => {
		const cyclic: Record<string, unknown> = {}
		cyclic.self = cyclic
		// Neither can come off a WebSocket, but a render must not throw on one.
		expect(formatToolInput(cyclic)).toBe('')
		expect(formatToolInput(() => {})).toBe('')
	})
})
