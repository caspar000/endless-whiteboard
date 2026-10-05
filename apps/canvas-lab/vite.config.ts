import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const fixtureAssets = fileURLToPath(new URL('../../packages/canvas/fixtures/assets/', import.meta.url))

/**
 * Serves the reference boards' images at `/fixture-assets/<sha256>`. They are stored by hash without
 * an extension, which Vite's own file serving would hand out as JavaScript.
 */
function fixtureAssetsPlugin(): Plugin {
	return {
		name: 'fixture-assets',
		configureServer(server) {
			server.middlewares.use('/fixture-assets', (req, res, next) => {
				const file = join(fixtureAssets, basename(req.url ?? ''))
				if (!existsSync(file)) return next()
				const bytes = readFileSync(file)
				const isPng = bytes.subarray(0, 4).toString('hex') === '89504e47'
				res.setHeader('Content-Type', isPng ? 'image/png' : 'image/jpeg')
				res.end(bytes)
			})
		},
	}
}

export default defineConfig({ plugins: [react(), fixtureAssetsPlugin()] })
