import { defineConfig } from 'vite'

/**
 * The server is bundled, not run from source, because the board schema it must share with the app is
 * built from the extensions' own TypeScript and TSX. Everything is inlined (`noExternal: true`): those
 * packages import libraries that only they depend on, which Node could not resolve from here.
 */
export default defineConfig({
	build: {
		ssr: 'src/main.ts',
		outDir: 'dist',
		target: 'node26',
		sourcemap: true,
		emptyOutDir: true,
	},
	ssr: { noExternal: true },
})
