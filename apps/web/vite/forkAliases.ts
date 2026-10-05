import { fileURLToPath } from 'node:url'

const fork = (path: string) => fileURLToPath(new URL(`../../../packages/canvas/${path}`, import.meta.url))

/**
 * `tldraw` is the canvas fork (docs/canvas-fork-plan.md, phase 7): the first step of the cutover
 * points the app's imports at it without rewriting them. The compiler still reads tldraw 5's types
 * until the imports are rewritten; `pnpm typecheck:on-fork apps/web` checks against the fork's.
 */
export const forkAliases = process.env.LIFEBOARD_TLDRAW_5
	? // For comparing against tldraw 5 while the cutover is under way.
		[]
	: [
			{ find: /^tldraw$/, replacement: fork('src/index.ts') },
			{ find: /^tldraw\/tldraw\.css$/, replacement: fork('src/lib/canvas.css') },
		]
