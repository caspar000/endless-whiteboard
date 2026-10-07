import { defineConfig, devices } from '@playwright/test'

/**
 * Tests against the real server (apps/server) serving the production build: what needs a vault, such
 * as server boards opening and saving offline. Separate from the main suite, which runs the app alone.
 *
 *   pnpm exec playwright test -c playwright.server.config.ts
 */
const PORT = Number(process.env.LB_E2E_SERVER_PORT ?? 4393)
const ORIGIN = `http://127.0.0.1:${PORT}`

export default defineConfig({
	testDir: './e2e-server',
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-server' }]],
	timeout: 90_000,
	expect: { timeout: 20_000 },
	use: { baseURL: ORIGIN, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'bash e2e-server/start-server.sh',
		url: `${ORIGIN}/api/status`,
		reuseExistingServer: false,
		timeout: 240_000,
	},
})
