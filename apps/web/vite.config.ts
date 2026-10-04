import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { agentHostPlugin } from './vite/agentHost'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
	version: string
}

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
	},
	plugins: [
		react(),
		// Starts the in-app agent's host process with the dev server, so the panel needs no setup.
		agentHostPlugin(),
		VitePWA({
			registerType: 'prompt',
			includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
			manifest: {
				name: 'Lifeboard',
				short_name: 'Lifeboard',
				description: 'An endless whiteboard where every element is a typed node.',
				theme_color: '#101012',
				background_color: '#101012',
				display: 'standalone',
				orientation: 'any',
				start_url: '/',
				icons: [
					{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
					{
						src: 'icon-512-maskable.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable',
					},
				],
			},
			workbox: {
				// tldraw ships large chunks; the default 2 MiB cap would silently drop them from the
				// precache and the app would not actually work offline.
				maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
				globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
				navigateFallback: 'index.html',
			},
		}),
		// Writes stats.html on build so bundle growth is visible (§7).
		visualizer({ filename: 'stats.html', gzipSize: true, template: 'treemap' }),
	],
	build: {
		target: 'es2022',
		sourcemap: true,
	},
})
