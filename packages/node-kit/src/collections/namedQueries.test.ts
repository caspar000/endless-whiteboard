import { beforeEach, describe, expect, it } from 'vitest'
import { clearExtensionRegistry, registerExtension, type Extension } from '../extensions'
import { clearNodeRegistry, setExtensionEnabled } from '../registry'
import {
	clearQueryRegistry,
	forgetQuery,
	getQuery,
	getUserQueries,
	getVisibleQueries,
	queryNameProblem,
	registerQuery,
} from './namedQueries'

const extension = (over: Partial<Extension> = {}): Extension => ({
	id: 'vendor.test',
	name: 'Test',
	nodes: [],
	...over,
})

beforeEach(() => {
	clearQueryRegistry()
	clearExtensionRegistry()
	clearNodeRegistry()
})

describe('registerQuery', () => {
	it('finds a name whatever case or spacing it is typed in', () => {
		registerQuery({ name: 'Burn Rate', body: 'sum spend page' })
		expect(getQuery('burn rate')?.body).toBe('sum spend page')
		expect(getQuery('  BURN RATE ')?.body).toBe('sum spend page')
	})

	it('refuses a name the grammar already uses, and says so rather than throwing', () => {
		// A query called `sum` that merely lost to the verb would be a saved question that silently
		// never runs, and the person who saved it would never find out.
		expect(registerQuery({ name: 'sum', body: 'sum price page' })).toBe(false)
		expect(registerQuery({ name: 'PAGE', body: 'count page' })).toBe(false)
		expect(getQuery('sum')).toBeUndefined()
		expect(queryNameProblem('sum')).toContain('already means something')
		expect(queryNameProblem('')).toBe('Give it a name.')
		expect(queryNameProblem('runway')).toBeNull()
	})

	it('refuses an empty question', () => {
		expect(registerQuery({ name: 'nothing', body: '   ' })).toBe(false)
	})

	it('replaces by name, so the user’s own wins over one that arrived with a plugin', () => {
		// The app loads its saved queries after the extensions, which is what makes this the rule.
		registerExtension(extension({ queries: [{ name: 'runway', body: 'sum cash page' }] }))
		registerQuery({ name: 'runway', body: 'count page' })
		expect(getQuery('runway')?.body).toBe('count page')
		expect(getVisibleQueries()).toHaveLength(1)
	})

	it('hides an extension’s queries when it is switched off, and keeps the user’s', () => {
		registerExtension(extension({ queries: [{ name: 'runway', body: 'sum cash page' }] }))
		registerQuery({ name: 'mine', body: 'count page' })

		setExtensionEnabled('vendor.test', false)
		expect(getQuery('runway')).toBeUndefined()
		expect(getVisibleQueries().map((q) => q.name)).toEqual(['mine'])

		setExtensionEnabled('vendor.test', true)
		expect(getQuery('runway')).toBeDefined()
	})

	it('separates the user’s own queries, which are the ones they can forget', () => {
		registerExtension(extension({ queries: [{ name: 'runway', body: 'sum cash page' }] }))
		registerQuery({ name: 'mine', body: 'count page' })
		expect(getUserQueries().map((q) => q.name)).toEqual(['mine'])

		forgetQuery('MINE')
		expect(getUserQueries()).toEqual([])
		expect(getQuery('mine')).toBeUndefined()
	})
})
