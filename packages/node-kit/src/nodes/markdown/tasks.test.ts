import { describe, expect, it } from 'vitest'
import { findTasks, lineIsTask, toggleTaskAt, toggleTaskOnLine } from './tasks'

describe('findTasks', () => {
	it('finds tasks in document order, with their state', () => {
		const md = '# Chores\n- [ ] milk\n- [x] bread\n- plain'
		expect(findTasks(md)).toEqual([
			{ line: 1, checked: false },
			{ line: 2, checked: true },
		])
	})

	it('accepts every bullet character, either case of x, and any indentation', () => {
		const md = '* [ ] a\n+ [X] b\n  - [x] c'
		expect(findTasks(md)).toEqual([
			{ line: 0, checked: false },
			{ line: 1, checked: true },
			{ line: 2, checked: true },
		])
	})

	it('ignores task syntax inside a fenced code block', () => {
		// The correspondence this whole module rests on is "Nth checkbox on screen = Nth task in source".
		// A fenced `- [ ]` renders as code with no checkbox, so counting it would shift every checkbox
		// after it — clicking one task would tick another.
		const md = ['- [ ] real', '```md', '- [ ] not a task', '```', '- [x] also real'].join('\n')
		expect(findTasks(md)).toEqual([
			{ line: 0, checked: false },
			{ line: 4, checked: true },
		])
	})

	it('does not let a tilde fence be closed by a backtick fence', () => {
		const md = ['~~~', '- [ ] hidden', '```', '- [ ] still hidden', '~~~', '- [ ] visible'].join(
			'\n'
		)
		expect(findTasks(md)).toEqual([{ line: 5, checked: false }])
	})

	it('ignores a bullet that only looks like a task', () => {
		expect(findTasks('- [] no space\n- [y] wrong letter\n-[ ] no gap')).toEqual([])
	})
})

describe('toggleTaskAt', () => {
	const md = '# Chores\n- [ ] milk\n- [x] bread'

	it('ticks and unticks by document order', () => {
		expect(toggleTaskAt(md, 0)).toBe('# Chores\n- [x] milk\n- [x] bread')
		expect(toggleTaskAt(md, 1)).toBe('# Chores\n- [ ] milk\n- [ ] bread')
	})

	it('returns null for an index with no task, so no undo entry is spent', () => {
		expect(toggleTaskAt(md, 2)).toBeNull()
		expect(toggleTaskAt(md, -1)).toBeNull()
		expect(toggleTaskAt('no tasks here', 0)).toBeNull()
	})

	it('leaves indentation, bullet character and spacing exactly as they were', () => {
		expect(toggleTaskAt('  *  [ ]  spaced', 0)).toBe('  *  [x]  spaced')
	})

	it('changes nothing else in the document', () => {
		const doc = '# T\n\n- [ ] a\n\ntext with [ ] brackets\n\n- [ ] b'
		expect(toggleTaskAt(doc, 1)).toBe('# T\n\n- [ ] a\n\ntext with [ ] brackets\n\n- [x] b')
	})

	it('skips over fenced content when counting', () => {
		const doc = ['- [ ] one', '```', '- [ ] fake', '```', '- [ ] two'].join('\n')
		expect(toggleTaskAt(doc, 1)).toBe(
			['- [ ] one', '```', '- [ ] fake', '```', '- [x] two'].join('\n')
		)
	})
})

describe('toggleTaskOnLine', () => {
	it('toggles by line, for the editor’s keyboard shortcut', () => {
		expect(toggleTaskOnLine('- [ ] a\n- [ ] b', 1)).toBe('- [ ] a\n- [x] b')
	})

	it('returns null when that line is not a task', () => {
		expect(toggleTaskOnLine('# Heading\n- [ ] a', 0)).toBeNull()
		expect(toggleTaskOnLine('- [ ] a', 5)).toBeNull()
	})
})

describe('lineIsTask', () => {
	it('recognises a task line', () => {
		expect(lineIsTask('- [ ] a')).toBe(true)
		expect(lineIsTask('  + [X] a')).toBe(true)
		expect(lineIsTask('- plain')).toBe(false)
		expect(lineIsTask('# heading')).toBe(false)
	})
})
