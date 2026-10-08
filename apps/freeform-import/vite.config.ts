import { defineConfig } from 'vite'

/**
 * Bundled like the server (apps/server/vite.config.ts), and for the same reason: the board schema it
 * builds boards against is the app's own TypeScript and TSX, which Node can't run from source.
 */
export default defineConfig({
	build: {
		ssr: 'src/cli.ts',
		outDir: 'dist',
		target: 'node26',
		sourcemap: true,
		emptyOutDir: true,
	},
	ssr: { noExternal: true },
})
