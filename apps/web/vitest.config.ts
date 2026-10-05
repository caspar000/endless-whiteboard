import { defineConfig } from 'vitest/config'

/**
 * Separate from `vite.config.ts` on purpose: unit tests have no use for the PWA plugin or the bundle
 * visualiser, and `e2e/` must be excluded or Vitest tries to collect the Playwright specs (which
 * fails with "Playwright Test did not expect test.describe() to be called here").
 */
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
		environment: 'node',
	},
})
