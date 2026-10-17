# Canvas performance plan

Status: Phases 1–5 done. Phase 6 and unmounting off-screen shapes are not needed yet; they wait in
[#47](https://github.com/caspar000/endless-whiteboard/issues/47) with their measurements.

### Phase 5, as built

Creating, duplicating, deleting and undoing many relations at once. Each was quadratic for its own
reason, and each reason was a step that cost as much as the board is big, run once per relation:

- **Placing each new arrow in z-order** walked every sibling to find the ones above its bound shapes.
  `reparentArrow` binary-searches the sorted children instead.
- **The sorted children** were re-sorted in full after every reorder, reading every shape. A few
  moved shapes are now taken out and put back by binary search, in place (`parentsToChildren.ts`).
- **The store's diff squash** checked the accumulated diff for keys on every diff, and `for…in` on a
  large object collects every key before yielding one. A pnpm patch to `@tldraw/store`
  (`patches/@tldraw__store@5.5.2.patch`) checks once and keeps the answer as keys are added.
- **The three binding indexes** (arrow ends, arrows bound to a shape, bindings of a shape) were
  rebuilt whenever any binding changed, and deleting bound shapes reads them between unbinds.
  `bindingMap` keeps them up to date from the store's history, in a `ShardedMap` that copies a 256th
  of itself per change.
- **Deleting a selection** filtered the whole selection once per deleted shape. `deleteShapes` cleans
  the page states once for the batch, and the per-shape check is a lookup in a set cached per page state.
- **Finding a parent for each new shape** asked every shape on the page whether it takes children.
  `createShapes` works out the candidates once per shape type for the batch.
- **`getCurrentPageShapesSorted`** found each shape's children by scanning the whole page. It walks the
  sorted children instead.

`bulkRelations.bench.test.ts` measures it on request (`LB_BENCH=1`); `incrementalIndexes.test.ts`
compares the child order, the page order and the binding indexes with a rebuild through random changes.

| | Before | After |
|---|---|---|
| Create 2,000 relations (unit test) | 6.9 s | 0.24 s |
| Create 8,000 relations (unit test) | ~2 min (extrapolated) | 1.9 s |
| Delete 2,000 bound nodes | 12.7 s | 0.28 s |
| Undo that delete, 4,000 nodes | 3.6 s | 1.0 s |
| Create 5,000 relations in the app, in batches of 250 | 45–62 s | 3.3 s |

### Phase 4, as built

Planned as "unmount what is far away". Measuring first found two things that stood between Lifeboard
and thousands of nodes sooner than the DOM did, so the phase went after those, and unmounting waits.

- **A page held 4,000 shapes**, and relations are shapes: 2,000 nodes with a relation each was the
  ceiling, and `createShapes` refused a batch that went past it. `MAX_SHAPES_PER_PAGE` is 20,000.
  Z-indexes are allocated from it (twice it upward, once more per frame with children), which still
  leaves room for 100,000 frames below CSS's limit; property strips stack at three times it, so they
  move with it.
- **Every write visited every arrow.** The arrow's geometry read its bindings from one map built by a
  store query, and queries sit below the store's history. At 5,000 relations a hover cost 11.8 ms.
  `IdValues` (next to `IdFlags`) keeps each arrow's bindings in its own atom; `getArrowBinding` reads
  it whenever it is in step with the map and the map itself in the middle of a change, so the answer
  is always current. The values are created before anything can compute an arrow's geometry: an arrow
  that read the map before they existed kept depending on it, which is how a reloaded board lost the
  gain. `arrowBindingValues.test.ts` walks the signal graph to keep it that way.
- **Selecting re-decided culling for every shape**, because selected and edited shapes are never
  culled. The full pass (`_getOffScreenShapeIds`) no longer reads the selection; `getCulledShapeIds`
  takes the selected and edited shapes out of its result, returning it untouched when none are in it.
- **Opening a board rebuilt TipTap's schema once per label.** `generateHTML` builds it on every call;
  `renderHtmlFromRichText` now caches it per set of extensions.

| | Before | After |
|---|---|---|
| 5,000 nodes + 5,000 relations: pan at 100% | 14.6 ms | 8.3 ms |
| 5,000 nodes + 5,000 relations: hover write | 11.8 ms | 0.66 ms |
| 10,000 shapes: selection write | 14.5 ms | 1.4 ms |
| 10,000 shapes: cold start with the board open | 3.3–3.8 s | 2.6 s |

The "before" column for the 5,000-node rows was measured with the cap already raised, since a board
that size could not exist under the old one.

**Why nothing is unmounted yet.** Culled shapes stay mounted and hidden, and that is now cheap while
the board is in use: hidden shapes have no layout objects, panning 10,000 shapes runs at the frame
rate, and the JS heap is about 300 MB. What they still cost is the cold start: React mounting, text
measurement and markdown parsing for every shape take most of the 2.6 s. Unmounting would cut that,
but thumbnails and the agent's view of the board export HTML nodes by copying their element from the
page (`exportShapeFromDom`), so an unmounted shape would export as a grey box. It needs a way to mount
the shapes an export asks for, and wait for them, before it is safe.

### Phase 3, as built

Planned as a spatial index. Profiling the interactions it was meant to speed up showed that hit
testing was not where the time went, so the phase went after what was:

- **A write woke every shape.** A signal visits every reactor below it when it changes, whatever the
  computeds in between return. Each shape had reactors under the instance and page-state records
  (`isEditing`, its size, its display, the arrow hint, the expression text), so a brush move, a hover
  or a selection change visited about 20,000 reactors at 2,000 nodes. `IdFlags`
  (`derivations/idFlags.ts`) gives each shape its own atom for "am I culled / being edited / the only
  one selected", set by one reactor only when that shape's answer flips. `isShapeBeingEdited(id)` and
  `isOnlySelectedShape(id)` are the public face; `useIsEditing`, the text labels, `RichText`, the text
  and node components and the expression hooks use them.
- **`getCurrentPageId()` read the whole instance record**, so the shape list (and everything else that
  asked for the page) rebuilt on every brush move. It is a computed now.
- **The device pixel ratio** every shape container reads is an atom mirrored from the instance
  record (`getDevicePixelRatio()`), for the same reason.
- **Every arrow re-rendered on a selection change**: it read the selection in its render. It reads
  `isOnlySelectedShape` through `useValue`.
- **Expression text read the page facts even without a `{`**, tying every note and label to every
  property edit on the board. Both hooks check for a brace first.
- **Dragging rebuilt the shape list every frame**, because each entry carried the shape record and its
  masked bounds. The list now reads `_getShapeRenderInfoCache` (type, opacity, hidden, provides a
  background), compared by value, and `Shape` reads its own record.
- **A label-aware broad phase** in `getShapeAtPoint` and `getShapesAtPoint`: a cached page box that
  includes label geometry, which `Group2d` leaves out of its bounds. Worth about 9% on zoomed-out hover
  and brush; a unit test covers the label case.

| 2,000 nodes + 1,999 relations | After phase 2 | After phase 3 |
|---|---|---|
| Brush update write | 8.0 ms | 2.4 ms |
| Hover change write | 7.3 ms | 2.3 ms |
| Selection change write | 11.3 ms | 3.7 ms |
| Brush selection, 100% zoom, per pointer move | 34 ms | 17.5 ms |
| Drag a node, per frame | 24.4 ms | 15.9 ms |
| Pan at 100% zoom, relations shown | 10.2 ms | 8.9 ms |

The first column was measured after the `getCurrentPageId` and arrow-hint fixes had landed, so it
understates what the phase changed.

**Why there is no spatial index.** At 100% zoom hit tests only look at the ~50 shapes that are on
screen, and the remaining cost per hover is the signals library checking the dependencies of the
visible-shape list, not geometry. Zoomed out, a Chrome trace of hovering puts 9 ms per move in the
browser's own DOM hit test and ~16 ms per frame in layerization, against 7 ms of our JavaScript: the
cost of thousands of positioned elements, which Phase 6 removes. An index would have saved a few
milliseconds on brush selection at 2,000 nodes. It stays an option after Phase 6, if measurements
call for it.

**Left as is:** every arrow's geometry still reads one shared bindings map built from a store query, so
any write still visits each arrow once (about 1 ms per write at 2,000 arrows). Fixing it means keeping
per-arrow binding atoms in step with the store synchronously, and a write path that skipped them
would silently detach arrows; not worth the risk for 1 ms.

### Phase 2, as built

- `getRenderingShapeList()` is the list the canvas renders: order, z-index, opacity, masked bounds.
  It depends on the document, not the camera.
- `getCulledShapeIds()` decides what is off screen, compared by contents so an unchanged answer wakes
  nothing. Each shape reads `isShapeCulled(id)` in a quick reactor and writes `display` to its own
  container, so a camera move re-renders nothing in React. `getRenderingShapes()` still returns
  entries with `isCulled`, merged from the two, for the code and tests that read it.
- `getRenderingBounds()` still follows the viewport on every move. The culling bounds move only when
  the viewport leaves them, and then with half a screen of slack; when the camera stops they are set
  exactly again (viewport plus `renderingBoundsMargin`).
- Exact culling waits until the camera has been idle for `CULLING_SETTLE_MS` (250 ms), not the 64 ms
  that makes it "idle". Without that, a frame slower than 64 ms flipped the camera to idle mid-pan,
  the exact refresh hid hundreds of shapes, the next move showed them again, and those two frames
  were slow enough to cause the next flip. That loop put the zoomed-out p95 at 97 ms.
- The tripwire is a unit test rather than an e2e one (`culling.test.ts`): thirty camera moves rebuild
  the list zero times. A unit test cannot flake under load.

| Pan, all relations shown | Original | After phase 1 | After phase 2 |
|---|---|---|---|
| 1,000 nodes, 100% zoom | 31.6 ms | 11.4 ms | 8.3 ms |
| 2,000 nodes, 100% zoom | 35.1 ms | 22.1 ms | 10.2 ms |
| 2,000 nodes, relations hidden, 100% zoom | 20 ms | 12.9 ms | 8.4 ms |
| 2,000 nodes, zoomed to fit (avg / p95) | 144 / 174 ms | 53.7 / 66.9 ms | 36.9 / 48.4 ms |

Not touched by this phase: dragging. Every drag frame still rebuilds `getRenderingShapeList` (it reads
every shape) and re-decides culling, about 24 ms at 2,000 nodes. That belongs with the spatial index
in Phase 3.

### Phase 1, as built

- Arrows without a label or a cut-out arrowhead render no `<mask>` and no `<defs>`. SVG export
  (`toSvg`) is unchanged; it runs once, not per frame.
- `threadsOf` and `commentsOf` read cached `store.query.records` computeds, so the pins overlay and
  the toolbar's count depend on comment records only.
- The select tool's idle state ignores camera-move pointer events (`INTERNAL_POINTER_IDS.CAMERA_MOVE`,
  now exported from `canvas-editor`) and refreshes the hover on the first tick after the camera stops.
- The aura's drift freezes while the camera moves and resumes from the same phase.

| Pan, all relations shown | Before | After |
|---|---|---|
| Mythic Bastionland | 17–25 ms | 8.3 ms |
| Mythic Bastionland, tracing lens on the book | 13.7 ms | 8.7 ms |
| 500 nodes, 100% zoom | 29.6 ms | 8.4 ms |
| 1,000 nodes, 100% zoom | 31.6 ms | 11.4 ms |
| 2,000 nodes, 100% zoom | 35.1 ms | 22.1 ms |
| 2,000 nodes, zoomed to fit | 144 ms | 53.7 ms |
| 2,000 nodes, drag a node with 2 relations | 31.4 ms | 25.4 ms |

What is left at 2,000 nodes is the per-frame `getRenderingShapes` walk and the DOM size, which are
Phases 2–4.

The goal is boards with thousands of nodes and relations that pan, zoom and drag at the display's
frame rate. The numbers below come from a production build driven by Playwright in headless
Chromium (120 fps cap, so 8.3 ms per frame is the floor; software raster, so absolute numbers run
higher than on a machine with a GPU).

## What was measured

| Board | Pan, relations hidden | Pan, relations shown |
|---|---|---|
| Mythic Bastionland (190 shapes, 53 relations) | 8.3 ms | 17–25 ms |
| Synthetic 500 nodes + 499 relations, 100% zoom | 8.3 ms | 29.6 ms |
| Synthetic 2,000 nodes + 1,999 relations, 100% zoom | 20 ms | 35.1 ms |
| Synthetic 2,000 nodes + 1,999 relations, zoomed to fit | 39 ms | 144 ms |

Causes, in the order the profiles ranked them:

1. Every arrow wraps its line and its halo in an SVG `<mask>` sized to its bounds plus 100 px a
   side. Chrome rasterizes masks offscreen, and the shape layer is repainted on every camera frame,
   so every visible arrow pays for two masks per frame. Turning masks off with CSS brought the
   Mythic Bastionland board back to 8.4 ms.
2. `updateRenderingBounds` runs on every camera tick, so `getRenderingShapes` walks and sorts every
   shape, and React diffs the whole list, on every pan frame.
3. `CommentsOverlay` re-runs on every camera change and reads `store.allRecords()`. The toolbar's
   comment count reads it on every document change.
4. The select tool's idle state hit-tests every shape (`getShapeAtPoint`) on the synthetic pointer
   move the editor sends with each camera change.
5. Culled shapes stay mounted with `display: none`, so the DOM holds every shape on the board.
6. Creating relations is quadratic: each new binding runs `arrowDidUpdate`, which reads indexes the
   same transaction keeps invalidating.
7. Zoomed out with everything visible, one DOM element per shape is the ceiling: 47 ms per frame at
   2,000 nodes with painting switched off entirely.
8. The tracing aura rebuilds its outline 30 times a second for as long as the lens is on, including
   while the camera moves.

Any technique borrowed from newer tldraw releases follows the clean-room rule
(`docs/canvas-fork-plan.md`): implement it from the general idea, never port the code.

## Phase 1: what you feel today

Small, contained changes. Expected result: the Mythic Bastionland board pans at the floor with all
relations shown, and per-frame JS on large boards drops by the comments and hover costs.

- Render an arrow's mask only when it hides something: a label, or an arrowhead that is cut out of
  the line. Every other arrow draws its paths directly (`ArrowShapeUtil.tsx`).
- Read comment threads and comments through cached `store.query.records` computeds instead of
  filtering `allRecords()` (`canvas/comments/comments.ts`).
- In the select tool's idle state, skip the hover hit-test for camera-move pointer events and run it
  once when the camera stops (`SelectTool/childStates/Idle.ts`).
- Freeze the aura's drift while the camera moves (`canvas/auraPhase.ts`, `canvas/TraceLayer.tsx`).

## Phase 2: no per-frame work proportional to the board

- Take culling out of `getRenderingShapes`: the ordered list changes only when the document does.
  Each shape's visibility is written straight to its container's style by a reactor, so a camera move
  re-renders nothing in React.
- Move the culling bounds only when the viewport leaves a margin around them (hysteresis), not on
  every tick.
- A tripwire test in the style of `e2e/perf.spec.ts`: panning recomputes `getRenderingShapes` zero
  times.

## Phase 3: interactions cost the same on any board

Originally "spatial index"; see *Phase 3, as built* for why it became this.

## Phase 4: boards past 4,000 shapes

Originally "unmount what is far away"; see *Phase 4, as built* for why it became this. Unmounting is
still worth doing for the cold start, once exports can ask for the shapes they need to be mounted.

- Shapes well outside the culling margin unmount instead of hiding. Shapes that hold state (editing,
  video, readers, anything with `canUnmount` false) stay mounted.
- Measure board open time and memory at 2,000 and 5,000 nodes before and after.

## Phase 5: bulk relation changes

- Make paste, import and the agent's bulk edits linear in the number of relations they touch.
- Measured: creating one relation per node takes 0.3 s at 500 nodes, 6.5 s at 2,000 and 45–62 s at
  5,000 (in batches of 250). With the cap raised in Phase 4, boards that size can now exist.

## Phase 6: level of detail when zoomed out

Deferred to [#47](https://github.com/caspar000/endless-whiteboard/issues/47), along with unmounting
off-screen shapes.

A design decision before any code. Below a zoom threshold, draw nodes as plain boxes and relations as
plain lines on one `<canvas>`, and mount full shapes again as you zoom in. This is the phase that
makes thousands of shapes on screen at once smooth.
