import { defineConfig } from 'vitest/config'

/**
 * `dist/` must be excluded, unlike in the other packages, because this is the one package that
 * actually emits: after a build the compiled `dist/*.test.js` sit alongside the sources and get
 * collected too. That doubles the reported test count and — worse — runs a stale copy of the suite
 * against a stale copy of the code, so a genuine regression can pass in one and fail in the other.
 */
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		exclude: ['dist/**', 'node_modules/**'],
		environment: 'node',
	},
})
