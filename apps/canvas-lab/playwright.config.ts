import { defineConfig, devices } from '@playwright/test'

/** Its own port, so it never collides with Lifeboard's dev server or e2e run. */
const PORT = Number(process.env.LAB_E2E_PORT ?? 5191)

export default defineConfig({
	testDir: './e2e',
	workers: 1,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: `pnpm exec vite --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
})
