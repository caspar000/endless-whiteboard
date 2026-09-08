// A relative path rather than `@lifeboard/link-preview/node`, because this file is loaded as part
// of the *vite config*: vite bundles the config with esbuild and marks bare imports external, so a
// workspace package whose entry point is TypeScript would be handed to Node as `.ts` and fail. A
// relative import is inlined instead. Nothing else in the app should copy this — it is a
// config-loading quirk, not a convention.
import { handleUnfurlRequest, UNFURL_PATH } from '../../../packages/link-preview/src/node'
import type { Connect, Plugin } from 'vite'

/**
 * Serves link previews from the same origin as the app.
 *
 * A tab cannot read a cross-origin page — a `no-cors` fetch comes back opaque and empty — so
 * something on the server side has to, and in development the only thing already running is this
 * dev server. That is the same arrangement as the agent host next door, minus the process: the work
 * is a function call, not a spawn.
 *
 * **Also mounted on the preview server**, unlike `agentHostPlugin`, and that is the interesting
 * part. `pnpm preview` serves the production build with no dev server anywhere, which is the shape
 * of the eventual self-hosted deployment — so mounting here means link previews are exercised the
 * way they will actually ship, including by the Playwright suite, rather than being a
 * development-only nicety that quietly stops working in the build.
 *
 * A host that serves the app some other way mounts the same handler in two lines; see
 * `packages/link-preview/src/node.ts`. Where there is no endpoint at all — plain static hosting —
 * the app falls back to the page's host as its title, with no image and nothing broken.
 */
export function linkPreviewPlugin(): Plugin {
	const mount = (middlewares: Connect.Server) => {
		middlewares.use(UNFURL_PATH, (request, response) => {
			// The handler answers every outcome itself and never rejects; `catch` is here so that a
			// bug in it fails as a 500 rather than an unhandled rejection that takes the server down.
			void handleUnfurlRequest(request, response).catch(() => {
				if (response.headersSent) return
				response.statusCode = 500
				response.end('{}')
			})
		})
	}

	return {
		name: 'lifeboard:link-preview',
		configureServer: (server) => mount(server.middlewares),
		configurePreviewServer: (server) => mount(server.middlewares),
	}
}
