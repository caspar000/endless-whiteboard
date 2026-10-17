# Canvas performance plan

Status: Phases 1–2 done, Phase 2 awaiting review. Stop and report after each phase.

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

## Phase 3: spatial index

- An R-tree (rbush, MIT) of shape page bounds, kept up to date from store changes.
- Culling, `getShapeAtPoint`, brush and scribble selection, and `getShapesAtPoint` query it instead of
  scanning every shape.

## Phase 4: unmount what is far away

- Shapes well outside the culling margin unmount instead of hiding. Shapes that hold state (editing,
  video, readers, anything with `canUnmount` false) stay mounted.
- Measure board open time and memory at 2,000 and 5,000 nodes before and after.

## Phase 5: bulk relation changes

- Batch `arrowDidUpdate` so it runs once per arrow per operation rather than once per binding.
  Paste, import, and the agent's bulk edits get linear.

## Phase 6: level of detail when zoomed out

A design decision before any code. Below a zoom threshold, draw nodes as plain boxes and relations as
plain lines on one `<canvas>`, and mount full shapes again as you zoom in. This is the phase that
makes thousands of shapes on screen at once smooth.
