import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	Editor,
	MigrationId,
	Rectangle2d,
	ShapeUtil,
	TLRecord,
	TLShapeUtilConstructor,
	TLStoreSnapshot,
	TLUnknownShape,
	createShapePropsMigrationSequence,
	createTLStore,
} from '@lifeboard/canvas-editor'
import { defaultShapeTools } from '../lib/defaultShapeTools'
import { defaultShapeUtils } from '../lib/defaultShapeUtils'
import { defaultTools } from '../lib/defaultTools'

/**
 * Phase 2's check (docs/canvas-fork-plan.md): every board Lifeboard has saved loads in the fork
 * without a validation error, and saving it again gives back the same records.
 *
 * The boards are the phase 0 reference boards and the app's persistence fixtures. The same reference
 * boards are loaded by the app in `apps/web/src/persistence/reference-boards.test.ts`.
 */
// Paths from this file's own location: jsdom replaces the global URL, which node:url doesn't accept.
const here = dirname(fileURLToPath(import.meta.url))
const persistenceFixtures = join(here, '../../../../apps/web/src/persistence/fixtures')
const boards = [
	...jsonFiles(join(here, '../../fixtures')),
	...jsonFiles(persistenceFixtures),
	...jsonFiles(join(persistenceFixtures, 'health')),
]

function jsonFiles(dir: string) {
	return readdirSync(dir)
		.filter((file) => file.endsWith('.json'))
		.map((file) => [file, join(dir, file)] as const)
}

const SHAPE_SEQUENCE = 'com.tldraw.shape.'

/**
 * Lifeboard's own shapes (`node.*`) aren't part of the fork, so they load as stand-ins: no props
 * validation, and a props migration sequence at the version the board was saved with, so loading
 * neither rejects nor changes them. The real shapes come with the cutover (phase 7).
 */
function standInShapeUtils(snapshot: TLStoreSnapshot) {
	return Object.entries(snapshot.schema.schemaVersion === 2 ? snapshot.schema.sequences : {})
		.filter(([id]) => id.startsWith(`${SHAPE_SEQUENCE}node.`))
		.map(([id, version]) => {
			const type = id.slice(SHAPE_SEQUENCE.length)
			const sequence = Array.from({ length: version }, (_, i) => ({
				id: `${id}/${i + 1}` as MigrationId,
				up: () => {},
			}))
			return class StandIn extends ShapeUtil<TLUnknownShape> {
				static override type = type
				static override migrations = createShapePropsMigrationSequence({ sequence })
				getDefaultProps() {
					return {}
				}
				getGeometry(shape: TLUnknownShape) {
					const { w = 100, h = 100 } = shape.props as { w?: number; h?: number }
					return new Rectangle2d({ width: w, height: h, isFilled: true })
				}
				component() {
					return null
				}
				indicator() {
					return null
				}
			} as TLShapeUtilConstructor<TLUnknownShape>
		})
}

describe('boards saved by Lifeboard', () => {
	it('include the reference boards and the persistence fixtures', () => {
		expect(boards.map(([file]) => file).sort()).toEqual([
			'default-shapes.json',
			'lifeboard.json',
			'v0.1.0-all-node-types.json',
			'v0.1.0-health.json',
		])
	})

	it.each(boards)('%s loads and saves back unchanged', (_file, path) => {
		const snapshot = JSON.parse(readFileSync(path, 'utf8')) as TLStoreSnapshot
		const shapeUtils = [...defaultShapeUtils, ...standInShapeUtils(snapshot)]
		const store = createTLStore({ shapeUtils })
		store.loadStoreSnapshot(snapshot)

		// Mount an editor on it, so its side effects (arrow parents, page states) get their chance to
		// touch the document.
		const editor = new Editor({
			store,
			shapeUtils,
			tools: [...defaultTools, ...defaultShapeTools],
			getContainer: () => document.createElement('div'),
			initialState: 'select',
		})

		// The document only: loading also creates this session's camera and instance records.
		const saved: Record<string, TLRecord> = store.getStoreSnapshot('document').store
		for (const [id, record] of Object.entries(snapshot.store)) expect(saved[id]).toEqual(record)
		// Nothing else, except a document and page for a board saved without them (the synthetic
		// health fixture holds shapes only).
		const added = Object.values(saved).filter((record) => !(record.id in snapshot.store))
		for (const record of added) expect(['document', 'page']).toContain(record.typeName)

		editor.dispose()
	})
})
