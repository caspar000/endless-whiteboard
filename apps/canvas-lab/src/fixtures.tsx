import {
	HTMLContainer,
	MigrationId,
	Rectangle2d,
	ShapeUtil,
	TLShapeUtilConstructor,
	TLStoreSnapshot,
	TLUnknownShape,
	createShapePropsMigrationSequence,
	createTLStore,
	defaultShapeUtils,
} from '@lifeboard/canvas'

/**
 * The reference boards from phase 0 (`packages/canvas/fixtures/`), for `?fixture=<name>`. They load
 * into memory only, so looking at one never saves anything.
 */
const snapshots = import.meta.glob<TLStoreSnapshot>('../../../packages/canvas/fixtures/*.json', {
	import: 'default',
})

const SHAPE_SEQUENCE = 'com.tldraw.shape.'

/**
 * Lifeboard's own shapes (`node.*`) aren't part of the fork, so they show as labelled boxes. Each has
 * a props migration sequence at the version the board was saved with, so loading leaves them as
 * they are.
 */
function standInShapeUtils(snapshot: TLStoreSnapshot) {
	const sequences = snapshot.schema.schemaVersion === 2 ? snapshot.schema.sequences : {}
	return Object.entries(sequences)
		.filter(([id]) => id.startsWith(`${SHAPE_SEQUENCE}node.`))
		.map(([id, version]) => {
			const type = id.slice(SHAPE_SEQUENCE.length)
			const sequence = Array.from({ length: version }, (_, i) => ({
				id: `${id}/${i + 1}` as MigrationId,
				up: () => {},
			}))
			const size = (shape: TLUnknownShape) => {
				const { w = 100, h = 100 } = shape.props as { w?: number; h?: number }
				return { w, h }
			}
			return class StandIn extends ShapeUtil<TLUnknownShape> {
				static override type = type
				static override migrations = createShapePropsMigrationSequence({ sequence })
				getDefaultProps() {
					return {}
				}
				getGeometry(shape: TLUnknownShape) {
					const { w, h } = size(shape)
					return new Rectangle2d({ width: w, height: h, isFilled: true })
				}
				component(shape: TLUnknownShape) {
					const { w, h } = size(shape)
					return (
						<HTMLContainer
							style={{
								width: w,
								height: h,
								border: '1px dashed var(--color-text-3)',
								padding: 8,
								font: '12px sans-serif',
								color: 'var(--color-text-3)',
							}}
						>
							{type}
						</HTMLContainer>
					)
				}
				indicator(shape: TLUnknownShape) {
					const { w, h } = size(shape)
					return <rect width={w} height={h} />
				}
			} as TLShapeUtilConstructor<TLUnknownShape>
		})
}

/**
 * Lifeboard stores images as `asset:<sha256>`; the lab serves them from the fixture folder (see
 * `vite.config.ts`).
 */
function withLabAssetUrls(snapshot: TLStoreSnapshot): TLStoreSnapshot {
	const store = Object.fromEntries(
		Object.entries(snapshot.store).map(([id, record]) => {
			if (record.typeName !== 'asset' || !('src' in record.props)) return [id, record]
			const { src } = record.props
			if (!src?.startsWith('asset:')) return [id, record]
			const labSrc = `/fixture-assets/${src.slice('asset:'.length)}`
			return [id, { ...record, props: { ...record.props, src: labSrc } }]
		})
	)
	return { ...snapshot, store }
}

export async function loadFixture(name: string) {
	const load = snapshots[`../../../packages/canvas/fixtures/${name}.json`]
	if (!load) throw Error(`No fixture called ${name}`)
	const snapshot = await load()
	const shapeUtils = standInShapeUtils(snapshot)
	const store = createTLStore({ shapeUtils: [...defaultShapeUtils, ...shapeUtils] })
	store.loadStoreSnapshot(withLabAssetUrls(snapshot))
	return { store, shapeUtils }
}
