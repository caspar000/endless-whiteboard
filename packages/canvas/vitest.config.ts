import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { canvasTestConfig } from '../canvas-editor/vitest.config'

export default defineConfig({
	resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
	test: {
		...canvasTestConfig,
		// Before the fake timers, which the shared list ends with.
		setupFiles: [
			...canvasTestConfig.setupFiles.slice(0, -1),
			fileURLToPath(new URL('./test-setup.ts', import.meta.url)),
			...canvasTestConfig.setupFiles.slice(-1),
		],
	},
})
