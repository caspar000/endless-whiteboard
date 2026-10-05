// Typechecks node-kit, note-markdown, book-reader and dice with `tldraw` pointed at the canvas fork,
// and lists the errors in their own files: each one is API the fork still lacks or types differently.
// The fork's own files compile under upstream's looser settings (F5), so errors there are not counted.
// `node scripts/fork-suites/typecheck.mjs [package…]`
import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const editorModules = `${repo}packages/canvas-editor/node_modules/@tldraw`
const packages = process.argv.slice(2).length
	? process.argv.slice(2)
	: ['node-kit', 'note-markdown', 'book-reader', 'dice']

let total = 0
for (const name of packages) {
	const dir = `${repo}packages/${name}/`
	const config = `${dir}tsconfig.fork.json`
	writeFileSync(
		config,
		JSON.stringify({
			extends: './tsconfig.json',
			compilerOptions: {
				experimentalDecorators: true,
				paths: {
					tldraw: [`${repo}packages/canvas/src/index.ts`],
					...Object.fromEntries(
						['state', 'state-react', 'store', 'tlschema', 'utils', 'validate'].map((p) => [
							`@tldraw/${p}`,
							[`${editorModules}/${p}/src/index.ts`],
						])
					),
				},
			},
		})
	)
	const result = spawnSync('pnpm', ['exec', 'tsc', '-p', config, '--noEmit', '--pretty', 'false'], {
		cwd: dir,
		encoding: 'utf8',
	})
	rmSync(config)
	const own = result.stdout
		.split('\n')
		.filter((line) => /error TS/.test(line) && line.startsWith('src/'))
	total += own.length
	console.log(`\n== ${name}: ${own.length} errors in its own files`)
	for (const line of own) console.log(line)
}
process.exit(total ? 1 : 0)
