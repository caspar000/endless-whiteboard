import { atom } from '@tldraw/state'
import { HistoryEntry, MigrationSequence, SerializedStore, Store, StoreSchema } from '@tldraw/store'
import {
	TLAssetStore,
	TLUserStore,
	SchemaPropsInfo,
	TLRecord,
	TLStore,
	TLStoreProps,
	TLUnknownShape,
	createTLSchema,
} from '@tldraw/tlschema'
import { TLShapeUtilConstructor } from '../editor/shapes/ShapeUtil'
import { TLAnyShapeUtilConstructor, checkShapesAndAddCore } from './defaultShapes'

/** @public */
export type TLStoreOptions = {
	initialData?: SerializedStore<TLRecord>
	defaultName?: string
} & (
	| {
			shapeUtils?: readonly TLAnyShapeUtilConstructor[]
			/** The app's own store migrations, run alongside tldraw's when a snapshot loads. */
			migrations?: readonly MigrationSequence[]
	  }
	| { schema?: StoreSchema<TLRecord, TLStoreProps> }
)

/** @public */
export type TLStoreEventInfo = HistoryEntry<TLRecord>

/**
 * A helper for creating a TLStore. Custom shapes cannot override default shapes.
 *
 * @param opts - Options for creating the store.
 *
 * @public */
export function createTLStore({ initialData, defaultName = '', ...rest }: TLStoreOptions): TLStore {
	const schema =
		'schema' in rest && rest.schema
			? // we have a schema
			  rest.schema
			: // we need a schema
			  schemaForShapes(
					currentPageShapesToShapeMap(
						checkShapesAndAddCore('shapeUtils' in rest && rest.shapeUtils ? rest.shapeUtils : [])
					),
					'migrations' in rest ? rest.migrations : undefined
			  )

	return new Store({
		schema,
		initialData,
		props: {
			defaultName,
			// Today's store asks for these; the 2023 editor manages assets and users itself.
			assets: inlineAssetStore,
			users: noUsers,
			onMount: () => {},
		},
	})
}

/**
 * Assets as the 2023 editor stores them: the asset record's own `src`, inlined as a data URL when a
 * file is uploaded. Apps that keep files elsewhere (Lifeboard does) replace this.
 */
const inlineAssetStore: Required<TLAssetStore> = {
	upload: async (_asset, file) => ({
		src: await new Promise<string>((resolve, reject) => {
			const reader = new FileReader()
			reader.onload = () => resolve(reader.result as string)
			reader.onerror = () => reject(reader.error)
			reader.readAsDataURL(file)
		}),
	}),
	resolve: (asset) => asset.props.src,
	remove: async () => {},
}

/** No user records: the 2023 editor keeps the current user in its own preferences. */
const noUsers: Required<TLUserStore> = {
	currentUser: atom('currentUser', null),
	resolve: () => atom('user', null),
}

/**
 * Today's schema always includes the arrow binding, whose migrations depend on the arrow shape's, so
 * a store without arrows must leave it out.
 */
export function schemaForShapes(
	shapes: Record<string, SchemaPropsInfo>,
	migrations?: readonly MigrationSequence[]
) {
	return createTLSchema({ shapes, migrations, ...(shapes.arrow ? {} : { bindings: {} }) })
}

function currentPageShapesToShapeMap(shapeUtils: TLShapeUtilConstructor<TLUnknownShape>[]) {
	return Object.fromEntries(
		shapeUtils.map((s): [string, SchemaPropsInfo] => [
			s.type,
			{
				props: s.props,
				migrations: s.migrations,
			},
		])
	)
}
