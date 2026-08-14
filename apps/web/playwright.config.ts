import { defineConfig, devices } from '@playwright/test'

/**
 * Smoke tests run against the **production build** (`vite preview`), not the dev server, so they
 * exercise the same bundle, service worker and asset pipeline the user gets.
 */

/**
 * The preview port, overridable so two checkouts can run this suite at once.
 *
 * `strictPort` plus `reuseExistingServer: false` means a second run on the same port doesn't queue
 * or fall back — it takes the port from whoever had it, and *both* runs then fail with
 * `ERR_CONNECTION_REFUSED` partway through, which reads exactly like a flaky app rather than two
 * runs colliding. Git worktrees make that easy to hit, so each one can set `LB_E2E_PORT`.
 */
const PORT = Number(process.env.LB_E2E_PORT ?? 4173)
const ORIGIN = `http://localhost:${PORT}`

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
		baseURL: ORIGIN,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
		url: ORIGIN,
		// Never reuse a running server. The command *builds* first, so reusing one means testing a
		// stale `dist/` — which silently produced passes and failures that had nothing to do with the
		// current source. Paying for a rebuild each run is much cheaper than debugging that.
		reuseExistingServer: false,
		timeout: 180_000,
	},
})
