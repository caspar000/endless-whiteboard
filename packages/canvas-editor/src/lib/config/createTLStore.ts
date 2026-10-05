import { atom } from '@tldraw/state'
import { HistoryEntry, MigrationSequence, SerializedStore, Store, StoreSchema } from '@tldraw/store'
import {
	TLAssetStore,
	TLUserStore,
	SchemaPropsInfo,
	TLRecord,
	TLStore,
	TLStoreProps,
	TLUnknownBinding,
	TLUnknownShape,
	createTLSchema,
	defaultBindingSchemas,
} from '@tldraw/tlschema'
import { TLBindingUtilConstructor } from '../editor/bindings/BindingUtil'
import { TLShapeUtilConstructor } from '../editor/shapes/ShapeUtil'
import { TLAnyShapeUtilConstructor, checkShapesAndAddCore } from './defaultShapes'

/** @public */
export type TLStoreOptions = {
	initialData?: SerializedStore<TLRecord>
	defaultName?: string
} & (
	| {
			shapeUtils?: readonly TLAnyShapeUtilConstructor[]
			/** Binding types beyond the arrow's, which is included whenever the arrow shape is. */
			bindingUtils?: readonly TLAnyBindingUtilConstructor[]
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
			  createTLSchemaFromUtils({
					shapeUtils: 'shapeUtils' in rest ? rest.shapeUtils : undefined,
					bindingUtils: 'bindingUtils' in rest ? rest.bindingUtils : undefined,
					migrations: 'migrations' in rest ? rest.migrations : undefined,
			  })

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
 * The schema for a set of shape and binding utils, with the app's own store migrations.
 *
 * Core shapes are always included. The arrow binding comes with the arrow shape (its migrations
 * depend on the arrow's), and is left out of a store without arrows.
 *
 * @public
 */
export function createTLSchemaFromUtils({
	shapeUtils = [],
	bindingUtils = [],
	migrations,
}: {
	shapeUtils?: readonly TLAnyShapeUtilConstructor[]
	bindingUtils?: readonly TLAnyBindingUtilConstructor[]
	migrations?: readonly MigrationSequence[]
}) {
	const shapes = currentPageShapesToShapeMap(checkShapesAndAddCore(shapeUtils))
	const bindings: Record<string, SchemaPropsInfo> = shapes.arrow
		? { arrow: defaultBindingSchemas.arrow }
		: {}
	for (const util of bindingUtils) {
		bindings[util.type] = { props: util.props, migrations: util.migrations }
	}
	return createTLSchema({ shapes, bindings, migrations })
}

/** @public */
export type TLAnyBindingUtilConstructor = TLBindingUtilConstructor<TLUnknownBinding>

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
