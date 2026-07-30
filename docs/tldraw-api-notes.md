# tldraw API notes (pinned: 5.2.5)

The plan (`.context/attachments/.../plan.md`) was written against tldraw **v4**. Current stable is
**5.2.5**, so this project pins 5.2.5. Every API the plan depends on exists in 5.2.5 — verified
against the shipped `.d.ts` files. The deltas that affect our code are recorded here.

Re-verify this file before any tldraw upgrade (§5 of the plan: "review its changelog before any
upgrade — internal IndexedDB naming and UI-override APIs are the fragile spots").

## Confirmed present in 5.2.5

| API | Where from | Notes |
|---|---|---|
| `ShapeUtil`, `BaseBoxShapeUtil` | `@tldraw/editor` | `BaseBoxShapeUtil` gives `getGeometry` + `onResize` for w/h shapes |
| `HTMLContainer` | `@tldraw/editor` | |
| `T` (validators) | `@tldraw/validate` | namespace: `string number boolean jsonValue arrayOf object literalEnum nonZeroNumber …`; instance methods `.nullable() .optional() .refine() .check()` |
| `RecordProps<R>` | `@tldraw/tlschema` | `{ [K in keyof R['props']]: T.Validatable<R['props'][K]> }` |
| `createShapePropsMigrationSequence`, `createShapePropsMigrationIds`, `TLPropsMigrations` | `@tldraw/tlschema` | `TLPropsMigrations = { readonly sequence: Array<StandaloneDependsOn \| TLPropsMigration> }` |
| `createComputedCache(name, derive, opts?)` | `@tldraw/store` | returns `{ get(context, id) }`. `context` is any `StoreObject` — `Editor` qualifies. `opts.areRecordsEqual` / `opts.areResultsEqual` |
| `computed(name, fn, { isEqual })` | `@tldraw/state` | `ComputedOptions.isEqual` is the facts-pipeline lever (§4.3) |
| `useValue` | `@tldraw/state-react` | overloads: `useValue(signal)` and `useValue(name, fn, deps)` |
| `TLAssetStore` | `@tldraw/tlschema` | `upload(asset, file, abortSignal?) => Promise<{src, meta?}>`, `resolve?(asset, ctx)`, `remove?(assetIds)` |
| `getSnapshot(store)` / `loadSnapshot(store, snapshot, opts?)` | `@tldraw/editor` | `getSnapshot` returns `TLEditorSnapshot` (document + session) |
| `persistenceKey` | `TldrawEditorWithoutStoreProps` | |
| `stopEventPropagation`, `useEditor`, `useIsEditing` | `@tldraw/editor` | |
| `editor.run(fn, opts?)` | `Editor` | history batching |

## v5 deltas that changed our code vs. the plan's v4 sketch

1. **`getIndicatorPath` replaces `indicator`.** `ShapeUtil` now declares
   `abstract getIndicatorPath(shape): TLIndicatorPath | undefined` where
   `TLIndicatorPath = Path2D | { path: Path2D; additionalPaths?: Path2D[]; clipPath?: Path2D }`.
   Built-in box shapes implement it as `const p = new Path2D(); p.rect(0, 0, w, h); return p`.
   `createNodeShapeUtil` does exactly this, so node definitions never touch it.

2. **`canEdit(shape, info: TLEditStartInfo)` takes two args.** The factory ignores `info` and
   returns `def.canEdit ?? false`.

3. **`BaseBoxShapeUtil` requires `props.w` / `props.h`** on the shape (`TLBaseBoxShape`). Rather
   than making every definition redeclare them (the plan's sketch did), the factory *injects*
   `w: T.nonZeroNumber, h: T.nonZeroNumber` into props and composes `getDefaultProps()` from
   `def.defaultProps()` + `def.defaultSize`. Box-ness is owned by the factory, so a plugin
   definition cannot get it wrong.

## tldraw's local IndexedDB naming (fragile — pinned by test)

From `@tldraw/editor/src/lib/utils/sync/LocalIndexedDb.ts`, marked
*"DO NOT CHANGE THESE WITHOUT ADDING MIGRATION LOGIC"*:

```
STORE_PREFIX  = 'TLDRAW_DOCUMENT_v2'      // db name = STORE_PREFIX + persistenceKey
dbNameIndexKey = 'TLDRAW_DB_NAME_INDEX_v2' // localStorage JSON array of all db names
```

Deleting a board must delete the database *and* drop its name from that localStorage index,
otherwise the index grows unboundedly. This is wrapped in exactly one function —
`deleteTldrawDocument()` in `apps/web/src/persistence/tldrawLocalDb.ts` — with a test pinning
both constants (`tldrawLocalDb.test.ts`). If a tldraw upgrade changes them, that test fails loudly
instead of silently leaking board data.

## `putExternalContent` resolves before the upload finishes

In `tldraw/src/lib/defaultExternalContentHandlers.ts`, the files branch of
`defaultHandleExternalContent` does this:

```ts
editor.createTemporaryAssetPreview(assetInfo.id, sanitizedFile)   // asset record, src: ''
Promise.allSettled(assetsToUpdate.map(async (a) => {              // NOT awaited
  const newAsset = await editor.getAssetForExternalContent({ type: 'file', file: a.file })
  editor.updateAssets([{ ...newAsset, id: a.asset.id }])          // src filled in later
}))
createShapesForAssets(editor, assetPartials, pagePoint)
```

So `await editor.putExternalContent({ type: 'files', … })` resolves while the upload is still
running, and for that window the store holds a shape pointing at an asset whose `src` is `''`.

Three consequences we handle explicitly:

- **Unmounting the editor in that window loses the image permanently.** The `updateAssets` write
  never lands, so the record keeps `src: ''` — the shape renders blank forever while the bytes sit
  orphaned in the blob store. `app/drainSchedule.ts` keeps a left board mounted until uploads settle
  *plus one full clean window*, because filling in the `src` is itself a throttled write.
- **Anything reading a persisted snapshot can see the half-written state** — asset GC and backup
  export both do. `collectAssetRefs` reports it as `pending`, and both callers refuse to act on it
  rather than concluding "this board references nothing".
- **Tests cannot assume the blob exists once the import call returns.** `hasPendingAssetUploads()` /
  `waitForAssetUploads()` in `persistence/assetStore.ts` are the seam for waiting on it.
