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

## `updateShape` merges `props` and `meta` exactly one level deep

Verified in `@tldraw/editor/src/lib/editor/Editor.ts`, `applyPartialToRecordWithProps`:

```ts
if (k === 'props' || k === 'meta') {
  next[k] = { ...prev[k] } as JsonObject
  for (const [nextKey, nextValue] of Object.entries(v as object)) {
    (next[k] as JsonObject)[nextKey] = nextValue
  }
  continue
}
```

Three things the property system depends on, all confirmed here:

- **One level, per key.** So `meta` keys are flat and colon-namespaced (`lifeboard:props`,
  `lifeboard:propDefs`). A nested `meta.lifeboard` object would be *wholly replaced* on every write,
  so writing a value would silently destroy the definition sidecar beside it. Within one key there is
  no merging at all, which is why every write in `properties/values.ts` is read-modify-write.
- **`props` is not required.** A `meta`-only partial is valid, which is what lets any shape — tldraw's
  own images, stickies and text included — carry properties without that shape type cooperating.
- **A no-op update returns the previous record** (`if (v === prev[k]) continue` … `if (!next) return
  prev`), so reference-equality comparators stay correct.

`meta` is typed `JsonObject` and is **not** covered by shape validation or migrations — hence the
defensive parse on every read in `properties/`.

## `ShapeUtil.canScroll` applies only to the shape being *edited*

The plan assumed this would let a table scroll its rows in display mode. It does not. From
`@tldraw/editor/src/lib/editor/shapes/ShapeUtil.ts`:

```ts
/** Whether the shape can be scrolled while editing. */
canScroll(shape: Shape): boolean { return false }
```

and its only consumer, `hooks/useGestureEvents.ts`:

```ts
const editingShapeId = editor.getEditingShapeId()
if (editingShapeId) {
  const shape = editor.getShape(editingShapeId)
  if (shape && editor.getShapeUtil(shape).canScroll(shape)) {
    const bounds = editor.getShapePageBounds(editingShapeId)
    if (bounds?.containsPoint(editor.inputs.getCurrentPagePoint())) return   // don't zoom
  }
}
```

Two limits follow, and both are load-bearing for the table node:

- **Editing only.** A shape not in editing state never gets asked, so this cannot make a node
  scrollable in display mode. It also could not help there anyway: display mode sets
  `pointer-events: none` on the shape container (otherwise the shape stops dragging and
  marquee-selecting), so the wheel event never reaches the node's DOM in the first place.
- **Wheel only.** It suppresses canvas zoom; it does not create a scroll container. The node's own
  content still needs `overflow: auto` for anything to move.

`node.table` therefore **caps its rows** (`layout.maxRows`, with a visible "+N more") and relies on
auto-height to fit them, rather than being a small scrolling box. `canScroll: true` is still set, so
the full set can be scrolled once you double-click into the table.

## A shape becomes a drop target by *having* a drop hook, and it shadows what is beneath it

The four hooks — `onDragShapesIn`, `onDragShapesOver`, `onDragShapesOut`, `onDropShapesOver` — are how a
shape reacts to other shapes being dragged onto it. Three facts about how tldraw picks which shape gets
them, all verified in 5.2.5 and all load-bearing for the kanban view (`views/interaction.ts`):

1. **The target is chosen by hook *presence*, topmost first.** `Editor.getDraggingOverShape` calls
   `getShapesAtPoint(...).reverse()` — z-order, topmost first — and returns the first whose util defines
   any of the four. It is a property lookup on the util, so it cannot vary per shape: every shape of a
   type is a target, or none is. `createNodeShapeUtil` therefore builds a **subclass** carrying the
   hooks, and only for a definition that declares `drop`.
2. **Therefore a drop target shadows anything under it.** Frame adoption during a drag happens *only*
   through `FrameShapeUtil.onDragShapesIn`, so a shape dropped onto our node while it sits inside a
   frame does not join the frame. (The paste path is separate and geometric —
   `getDroppedShapesToNewParents`, called from `putExternalContent`.) There is no way to decline being
   the target while still receiving drops; the trade is accepted deliberately.
3. **`canReceiveNewChildrenOfType` defaults to `false`, and gates the drop callback.**
   `DragAndDropManager.dropShapes` filters the dragged shapes through it and calls `onDropShapesOver`
   only `if (receivableShapes.length > 0)`. So a util with the hooks but the default answer receives
   nothing — the method has to return `true` for the drop to arrive at all. `onDragShapesOver` is *not*
   filtered, which is why the hover hint works regardless.

   The same method also decides whether a shape may become a **paste parent**
   (`getDroppedShapesToNewParents` filters candidates by it), so returning `true` means a shape pasted
   over the node can be reparented into it. The node answers `true` only while it is a placing view,
   which keeps that to the one case where children moving with the card is harmless.

`TLDropShapesOverInfo` carries no point — the cursor's page position comes from
`editor.inputs.getCurrentPagePoint()`, which is what tldraw itself uses to choose the target. So the
*pointer* decides which lane a card lands in, not the dragged shape's own centre.

## `markEventAsHandled` is the only way to stop tldraw acting on a key you handled

tldraw listens for `keydown` on **its container** (`useDocumentEvents.ts`:
`container.addEventListener('keydown', handleKeyDown)`), and `handleKeyDown` begins with:

```ts
if (editor.wasEventAlreadyHandled(e)) return
editor.markEventAsHandled(e)
```

That pair is `@public` and documented for exactly this purpose. Nothing else works from inside a shape:

- **React's `onKeyDown` is too late.** React attaches its listeners at the React root, which is *above*
  tldraw's container, so tldraw's handler has already run by the time the synthetic event is delivered.
- **A native listener on the shape's own element is also not enough on its own** if handling the key
  unmounts that element. React flushes discrete events like `keydown` synchronously, so exiting an editor
  from inside a CodeMirror keymap removed the listener's node *during* dispatch — the listener never ran,
  tldraw saw an unclaimed Escape, and handled it as "clear selection".

That last one cost a real bug: "clear selection" calls `markHistoryStoppingPoint`, so an **empty history
entry** landed on top of the undo stack and the first ⌘Z after writing a note did nothing at all. The fix
is a **capture-phase** listener on the shape's element that marks the event handled before anything else
sees it — see `nodes/markdown/NoteEditor.tsx`.

### Escape is the one key that leaks out of a focused input

Every other key is gated: `handleKeyDown`'s cases call `areShortcutsDisabled(editor)`, which is true
whenever the active element is an input. The `Escape` case returns *before* reaching that check — it only
steps aside for open menus — so `editor.cancel()` runs on a keystroke typed into a text field, clearing
the selection under it. Anything drawn only for a selected shape (the properties panel, which is shown
for a single selection) disappears with the selection, which makes one Escape look like three things
happening at once.

So any panel of ours with a cancellable form takes Escape the same way a shape does: a capture-phase
listener on the form, `markEventAsHandled` plus `stopPropagation` — see `AddProperty` in
`properties/PropertiesPopover.tsx`. React's `onKeyDown` is still too late, for the reason above.

## `onBeforeCreate` sees the parent tldraw chose, which is where "created inside a frame" comes from

`Editor.createShapes` resolves the parent *before* it calls the util's `onBeforeCreate`: a partial with no
`parentId` gets the topmost shape at its x/y that can receive children (a frame, in practice), and the
record handed to the hook already carries it. So a node can read `shape.parentId` there and answer "I was
drawn inside that frame" — which is how a table dropped into a frame arrives scoped to it
(`NodeDefinition.onCreate`, wired in `registry.tsx`).

Two things to know before using it:

- **Every creation path goes through it** — the box tool's click *and* drag, our `createNodeShape`, the
  agent's operations, and paste and duplicate. A hook may therefore only fill in what nobody has chosen
  yet: `frameScopedSource` stands down unless the source still matches the default exactly, or pasting a
  configured table into a frame would silently re-aim it.
- **The parent may not be in the store yet.** Partials created in the same call (a pasted frame and its
  children) are put after every hook has run, so `editor.getShape(parentId)` can return `undefined` for a
  parent that is about to exist. Degrade quietly rather than assuming a lookup succeeds.

## CodeMirror 6 works correctly inside tldraw's camera transform

Worth recording because it was the main risk when choosing an editor. Verified by driving the real app at
1×, 0.5× and 2× zoom: clicking a specific character places the caret at exactly that offset, and
drag-selection tracks the pointer. CodeMirror uses client rects consistently, so a CSS `scale` on an
ancestor does not skew its coordinate mapping.

Two things *do* need overriding, both because CodeMirror is built to be a viewport onto a long document
and a note is the opposite:

- `.cm-scroller { overflow: auto }` and `.cm-content { min-height: 100% }` make the editor size to its
  container. Inside an auto-height shape that is circular — the container is measured *from* the editor —
  and it latches at whatever height the shape happened to start with.
- Those rules have to be overridden in a real stylesheet, not an `EditorView.theme`: a theme is injected
  as a `<style>` block that a later-loaded stylesheet beats at equal specificity.
