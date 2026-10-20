# GPU renderer plan

Goal: any board pans, zooms, hovers, selects and drags as fast at any zoom and any size (10,000,
100,000, 1,000,000 shapes) as a small board does at 100%, and **looks exactly as it does now**.

Written 2026-10-20 after the research and the prototype (`prototypes/gpu-canvas`). Phases stop for
review; each ends with the checks listed under it passing.

Agreed 2026-10-20: work on `gpu-renderer` off `develop`; builds for the e2e checks are fine; the
parity tolerance below is fine; phase 8c's server backup is fine when it comes.

## Why the board is slow, measured

All numbers on the M1 Pro's GPU in headless Chromium. By default headless Chromium renders in
software (SwiftShader), which every earlier number in `docs/performance-plan.md` used. To get the
GPU, launch with `--use-angle=metal --enable-gpu-rasterization --ignore-gpu-blocklist --enable-gpu`.
120 fps is the cap, so 8.3 ms a frame is the floor.

Four-tree test board, 3,490 shapes, 26,509 page elements, 186 MB JS heap (dev build):

| Pan | Whole board | 25% | 50% | 100% |
|---|---|---|---|---|
| App today | 40 ms | 27 ms | 14 ms | 8.6 ms |
| App, shapes `visibility: hidden` | 10 ms | | | |
| App, shapes `display: none` | 8.3 ms | | | |

A trace of the zoomed-out pan, per frame: Blink's layerization 19 ms (a paint chunk per shape),
GPU raster 18 ms, the browser's mouse hit test 7.6 ms, our signals ~5 ms. Promoting the shape layer
(`will-change`) made it four times worse; positioning shapes without transforms changed nothing.
The cost is the browser handling every element on screen on every frame. Opening the board takes
2 s; every shape is mounted.

Prototype (WebGL2, instanced discs, rings, line segments and glyphs, copies of this board):

| Pan | Whole board | 10% | 25% | 50% | 100% |
|---|---|---|---|---|---|
| 3,490 shapes | 8.4 ms | 8.3 | 8.3 | 8.3 | 8.3 |
| 101,210 | 8.4 | 8.3 | 8.3 | 8.3 | 8.3 |
| 1,001,630 | 10.5 | 8.3 | 8.3 | 8.3 | 8.3 |

Hit test at 1M shapes: 0.07 µs. What it doesn't prove: memory for a million *distinct* shapes
(copies share one GPU buffer), the data layer, rich HTML nodes.

## The approach: hybrid, with the page as the source of truth

1. **Every shape keeps its page element**, laid out as today. It stays the source of truth for
   editing, events, accessibility, exports (`exportShapeFromDom`), text layout and the e2e suite.
2. **A WebGL2 layer draws shapes when there are many on screen.** Below a budget of shapes on
   screen (a starting guess of 300, measured in phase 2), nothing changes: the page draws them, as
   now. Above it, the GPU draws every shape it can and their elements get `visibility: hidden`
   (measured: 42 → 10 ms; it keeps layout, unlike `display: none`). Normal work at normal zoom never
   leaves today's path, so most of the e2e suite tests exactly what it tests now.
3. **Live shapes always stay in the page**: the one being edited, a playing video, an open book
   reader, anything that asks (`ShapeUtil.isLive`).
4. **The switch must be invisible.** That's the whole visual contract: for every shape type the GPU
   picture matches the page's picture, checked by pixel comparison at every zoom, theme and pixel
   ratio (see *Verification*). A type the GPU can't match yet stays in the page.
5. **Text layout comes from the page.** The hidden element is still laid out, so line breaks and
   positions are read from it (as the prototype's export did), never re-implemented. Text pixels
   come from the browser's own rasteriser (Canvas2D `fillText` into an atlas at the device size),
   the same Skia that draws the page.
6. **No WebGL2, or the context is lost**: the page draws everything, as today.

Rejected along the way: level of detail (changes the board); promoting layers, CSS containment,
left/top positioning (measured, no gain); a full rewrite to a canvas-only renderer (throws away the
page's text layout, editing, accessibility and the e2e suite).

## Verification, used by every phase

### 1. Visual parity: the page against the GPU, same machine, same run

A new spec, `e2e/parity.spec.ts`, renders each scene twice in one browser: once with the renderer
forced to the page (`?renderer=dom`), once forced to the GPU (`?renderer=gpu`), same camera, UI
chrome hidden, and compares the two screenshots with pixelmatch.

- **Because both pictures come from the same machine in the same run, there are no stored golden
  images**, so fonts and platforms can't make it flaky, and it runs the same locally and in CI.
- Scenes: the **gallery board** (below), the four-tree board, a dense synthetic board.
- Grid: zoom 10%, 25%, 50%, 100%, 200%, 400%; light and dark; pixel ratio 1 and 2; Chromium and
  WebKit (iPhone project). That's 24 screenshots per scene per browser.
- Pass: pixelmatch threshold 0.1 and at most 0.05% of pixels differing per screenshot (a
  starting value; set in phase 0 from two page renders of the same scene, so it sits just above
  the page's own run-to-run noise). On failure the diff image is attached to the report.
- Tightened per type where it can be: lines and discs should match to the pixel at 100%.

### 2. The switch, frame by frame

`e2e/parity.spec.ts` also zooms across the budget in steps and screenshots every step, each compared
with a page-only render at the same camera: no frame may lose a shape, double one, or jump.

### 3. The page path unchanged

Before each phase, screenshot the gallery board and the four-tree board with `?renderer=dom` at the
whole zoom grid and keep them locally (`test-results/dom-baseline/`). After the phase, the same
screenshots must match them under the same threshold: the page path didn't move.

### 4. The e2e suite

The whole suite (`pnpm exec playwright test`, 27 specs, ~228 tests, Chromium and WebKit) passes at
the end of each phase, locally with `LB_E2E_PORT` set, and in CI on the PR. Load makes the full run
flaky (known): a failure is rerun alone before it counts. The suite builds the app first (agreed).

### 5. Performance, against the numbers above

`e2e/bench.spec.ts` gains GPU launch flags and the cases in the tables above (pan, zoom, hover,
drag a node, box-select; four-tree board, synthetic 10k and 100k distinct shapes). Each phase
records its numbers in this file. `e2e/perf.spec.ts` gains tripwires for the wins as they land
(loose under CI's software raster, tight locally).

### 6. Unit tests

For the display-list builders (shape → GPU primitives), text-run extraction, the spatial index, the
atlas packer and the budget/hysteresis logic, in `packages/canvas`'s vitest suite.

## The gallery board

A fixture (`apps/web/e2e/fixtures/gallery.ts`, inserted by a test helper) with one of everything,
laid out in a grid so each sits alone and together:

- **Canvas shapes:** geo (every geo type × fill none/semi/solid/pattern × dash draw/solid/dashed/
  dotted × sizes, with and without labels), text (sizes, alignments, wrapping), draw and highlight
  (pressure, closed), line (all spline types), frame (named, nested), note (sticky with crease and
  shadow, pinned), image (cropped, flipped), video (poster), embed, bookmark/link preview.
- **Arrows:** straight, bent, routed with waypoints (smooth), every arrowhead, every dash, labelled,
  bound and unbound, exact and edge anchors, `scale`, halo on and off (kept behind), hidden
  relations shown.
- **Node types:** markdown note, item, table, rollup, book, quote, dice card, habit, track, up next,
  skill-tree header; skill nodes in every state (locked, available, unlocked, finished branch),
  every tier, draft, root, keystone, mastery, pillar, with and without pictures; entries and works
  (done, hollow, counts).
- **States:** selected, hovered, editing, locked, a frame clipping its children.

## Phases

Each phase lists what changes, what must be true at its end, and how that's checked. Sizes are
rough: S a few days, M a week or two, L several weeks.

### Phase 0: the safety net (no rendering change). M

- The renderer switch: `?renderer=dom|gpu|auto` and a dev setting; `auto` (default) is today's
  page path until phase 2.
- The gallery board fixture; generators for synthetic boards of N distinct shapes (a mix of types,
  realistic relations) and the four-tree board.
- `parity.spec.ts` with the page against itself (both sides `dom`): proves the harness is stable
  and sets the noise threshold.
- `bench.spec.ts` with GPU flags and the new cases; record the "before" numbers here.
- The page-path baseline screenshots (*Verification 3*).

Done when: the whole suite passes; parity of the page against itself passes 10 runs in a row on
Chromium and WebKit; the before numbers are in this file.

### Phase 1: the GPU layer, drawing nothing yet. M

- `packages/canvas/src/lib/gpu/`: a WebGL2 canvas between the grid and the shape layer; pixel ratio,
  resize, context loss and restore; a frame scheduler that draws in the same animation frame as the
  page's camera transform (no lag of a frame between the two).
- The scene: kept from store diffs (create, update, delete, reorder), a dynamic R-tree for what's on
  screen, z-order from the page's sorted shapes.
- The display-list contract on `ShapeUtil`: `toGpu(shape, ctx): GpuPrimitive[] | null`. Primitives:
  rect, rounded rect, ellipse/disc, ring arc, path (filled, stroked, dashed), text run, image,
  shadow. `null` means "the page draws this one".
- The renderer: instanced batches per primitive kind and per texture, in z-order runs (a run is
  broken only where z-order needs it), as in the prototype.
- A debug view: page only, GPU only, both with a difference highlight.

Done when: the suite passes (nothing visible changed); unit tests cover the scene sync and index;
with `?renderer=gpu` and a test-only shape type that draws a rect, parity passes for it.

### Phase 2: the switch. M

- The budget: shapes on screen counted from the index; above the budget (with hysteresis so it
  doesn't flicker at the edge) shapes with a `toGpu` go to the GPU and their elements get
  `visibility: hidden`; below it, everything is the page's.
- Live shapes stay in the page. Z-order across the two: when a GPU shape lies above a live shape
  and overlaps it, it's drawn on a second GPU canvas above the shape layer (usually none).
- The switch happens in one frame: the GPU frame is drawn before the elements are hidden, and the
  elements are shown before the GPU stops drawing them.
- Measure the budget: the number of visible elements where the page path stops holding 8.3 ms on
  this machine, and set it a margin below.

Done when: the frame-by-frame switch check passes with the test shape type; the suite passes;
nothing else changed (no real type has `toGpu` yet).

### Phase 3: arrows and lines. L

The biggest single cost (lines hidden took the zoomed-out pan from 40 to 25 ms on the four-tree
board), and the simplest to match.

- Every arrow form: straight, arc (bend), routed waypoints drawn smooth, elbow; the same path the
  page draws, from the same geometry functions (`getArrowInfo`, `getRoutedArrowInfo`), tessellated
  once and re-tessellated only when the arrow changes.
- Dash patterns matched exactly: the page's `getPerfectDashProps` decides dash and gap lengths, the
  GPU draws those.
- Arrowheads (every type), the label (text run, with its gap cut out of the line), the halo, the
  masks, `scale`, colours from the theme, the hint path when selected.
- The line shape (all splines). Detail under half a device pixel simplified away (as in the
  prototype; invisible by construction, checked by parity).

Done when: parity passes for every arrow and line in the gallery at the whole grid; `arrows`,
`relations`, `svg`, `views` and `perf` specs pass; the four-tree zoomed-out pan drops by the lines'
share (expected ~40 → ~25 ms before nodes move).

### Phase 4: simple shapes and the skill tree's nodes. L

- Geo (every type, fill, dash, size, label), text, note (crease and soft shadow), frame (title,
  clipping), draw and highlight, image (the same asset, mipmapped), video poster.
- Skill nodes, entries and works: discs, rings and progress arcs with round caps, dashed borders,
  icons (rasterised once into an atlas from the same SVG at the device size), glows and shadows
  (the page's `box-shadow` reproduced with the same Gaussian), tier colours, locked dimming
  (opacity), pictures.
- Text: runs and line boxes read from the hidden element; glyph runs rasterised by the browser into
  an atlas per (font, weight, size at the device's scale), re-rasterised when the zoom settles
  at a new size; clipped and ellipsised exactly where the page clips them.

Done when: parity passes for all of these at the whole grid, on Chromium and WebKit; the suite
passes; the four-tree board pans zoomed out at ≤ 10 ms (the `visibility: hidden` measurement).

### Phase 5: rich nodes as cached pictures. L

Markdown notes, items, tables, rollups, books, quotes, dice cards, habits, tracks, up next, embeds,
link previews, the skill-tree header: HTML that isn't worth re-drawing primitive by primitive.

- Each one's picture taken from its own element when it changes (debounced), at the resolution the
  zoom needs, packed into a texture atlas with a memory budget and LRU eviction.
- The picture comes from Chrome's HTML-in-Canvas (`drawElementImage` / `texElementImage2D`, in
  origin trial to Chrome 160) where present, otherwise from the existing export path
  (`exportShapeFromDom` into an SVG, drawn to a canvas). A spike at the start of the phase checks
  both for fidelity and for WebKit (a canvas tainted by an SVG `foreignObject` can't be uploaded to
  WebGL there; if so, WebKit keeps these in the page).
- Until a node's picture is ready, or when it can't be taken, that node stays in the page.

Done when: parity passes for every rich node at the zooms above the budget; texture memory stays
under its budget on the dense synthetic board; `books`, `dice`, `propertyCard`, `views`, `ui` and
`smoke` specs pass.

### Phase 6: everything above and around the shapes. M

- Check every layer against the GPU path: selection and hover indicators (already a 2D canvas),
  handles, brush, snap lines, the tracing aura, comments, presence cursors, agent presence, the
  maze's hexagon view, dice overlays, property cards, the quick-look focus mode.
- Browser hit testing: hidden elements no longer take the browser's per-frame mouse hit test (the
  7.6 ms); the editor's geometric hit testing is unchanged. Interactive content inside a node
  (buttons, checkboxes) works as today below the budget; above it, the first click selects, as a
  click on a tiny node does today.
- Accessibility: below the budget, unchanged. Above it, hidden elements leave the accessibility
  tree; an off-screen list of the shapes on screen keeps them reachable (checked with
  `getByRole` in a new test).

Done when: `ui`, `keyboard`, `keymap`, `touch`, `phone`, `comments`, `agent`, `controls`, `dice`
and `webkit` specs pass with `?renderer=auto` on boards above the budget as well as below it.

### Phase 7: exports, thumbnails and the agent's view. S

Exports still copy the hidden elements, which are laid out, so they should be unchanged; this phase
proves it and fixes what isn't.

Done when: thumbnails, SVG/PNG export and the agent's board image are pixel-identical before and
after (`svg`, `assets`, `pwa`, `agent` specs, plus a direct image comparison).

### Phase 8: the data layer, for 100,000 to 1,000,000 shapes. L, in three parts

With drawing solved, the next limits are memory and loading. Measured first on synthetic boards of
10k, 100k and 1M distinct shapes; each part only if the measurement says so.

- **8a. Unmount what the GPU draws and isn't near the screen** (issue #47's unmounting): an element
  per shape is ~7.6 page elements; at 100k shapes that's 760k elements. Exports, text extraction and
  pictures ask for an element to be mounted and wait for it.
- **8b. Per-shape memory**: today ~50 KB per shape (record, cached geometry, signals, React). Scene
  data for the GPU and the index in typed arrays; per-shape computed caches created on demand and
  dropped when off screen. Target ≤ 2 KB per shape off screen.
- **8c. Loading and syncing by region**: the board stored in spatial chunks; open loads what's on
  screen first and streams the rest; sync subscribes to regions. Server and IndexedDB migrations,
  so it needs a server backup before deploying (AGENTS.md).

Done when, for each part: its board size opens and pans, zooms, hovers and drags at the floor; the
suite passes; memory and open time recorded here.

### Phase 9: default on, and tidy. S

- `auto` on for everyone; the page-only path stays as the fallback (no WebGL2, lost context).
- README *Things worth knowing* (the two renderers, the parity rule: a type with `toGpu` must pass
  parity), the extension-surfaces skill (a new node type needs a `toGpu` or stays in the page),
  Help if anything shows.

## Working rules

- A branch `gpu-renderer` off `develop`; a PR per phase into `develop`. Nothing reaches `main`
  without your go-ahead; phase 8c needs a server backup first.
- Clean-room rule (`docs/canvas-fork-plan.md`): techniques from Figma, Grida, tldraw or anywhere
  else are implemented from the idea, never ported.
- Each phase ends with a report: what changed, the checks and their results, the numbers, screenshots
  side by side. Then it stops for review.
- Every number measured on the GPU (the flags above) and, for CI, also under software raster.

## Risks

- **Text pixels.** The browser's text through Canvas2D should match the page's, but subpixel
  positioning can differ by a fraction of a pixel. If parity can't pass for text at some size, text
  at that size stays in the page (the node can still be GPU-drawn under it).
- **WebKit.** WebGL2 is there (Safari 15+); HTML-in-Canvas isn't; a `foreignObject` picture may be
  refused as a texture. Rich nodes may stay in the page on iPhone, which is fine on a phone-sized
  screen.
- **Effects the GPU path must match:** `box-shadow`, CSS filters, blend modes, `backdrop-filter`.
  Any type using one that can't pass parity stays in the page.
- **Memory at 1M shapes**: unproven until phase 8.
- **Size**: this is the largest change the canvas has had. Phases 0–4 alone fix the boards you have
  today; 5–9 are for the boards you want to make.
