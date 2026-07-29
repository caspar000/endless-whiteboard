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
		// Never reuse a running server. The command *builds* first, so reusing one means testing a
		// stale `dist/` — which silently produced passes and failures that had nothing to do with the
		// current source. Paying for a rebuild each run is much cheaper than debugging that.
		reuseExistingServer: false,
		timeout: 180_000,
	},
})
