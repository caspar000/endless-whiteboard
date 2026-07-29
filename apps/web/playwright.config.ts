import { defineConfig, devices } from '@playwright/test'

/**
 * Smoke tests run against the **production build** (`vite preview`), not the dev server, so they
 * exercise the same bundle, service worker and asset pipeline the user gets.
 */
export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	// Each test drives IndexedDB and localStorage on one origin; running them concurrently in the
	// same browser would let them clobber each other's boards.
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
	timeout: 60_000,
	expect: { timeout: 15_000 },
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'pnpm build && pnpm preview --port 4173 --strictPort',
		url: 'http://localhost:4173',
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
	},
})
