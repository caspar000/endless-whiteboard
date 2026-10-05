// Runs node-kit's, note-markdown's, book-reader's and dice's unit suites against the canvas fork
// (and apps/web's, when named).
// `node scripts/fork-suites/run.mjs [package…]`; exits non-zero if any suite fails.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const config = fileURLToPath(new URL('../../packages/canvas/vitest.lifeboard.config.ts', import.meta.url))
const packages = process.argv.slice(2).length
	? process.argv.slice(2)
	: ['node-kit', 'note-markdown', 'book-reader', 'dice']

let failed = false
for (const name of packages) {
	// A bare name is a package; a path (apps/web) is taken as it is.
	const root = fileURLToPath(
		new URL(name.includes('/') ? `../../${name}` : `../../packages/${name}`, import.meta.url)
	)
	console.log(`\n== ${name}`)
	const result = spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', config, '--root', root], {
		cwd: root,
		stdio: 'inherit',
	})
	if (result.status !== 0) failed = true
}
process.exit(failed ? 1 : 0)
