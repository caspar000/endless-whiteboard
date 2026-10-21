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
- Grid: zoom 10%, 25%, 50%, 100%, 200%, 400%; light and dark; pixel ratio 1 and 2, in Chromium on
  every run. WebKit (`LB_PARITY_WEBKIT=1`, Desktop Safari) only on purpose, once at the end of a
  phase that gives the GPU something new to draw: at pixel ratio 2 (what real Safari runs the GPU
  layer at), without the four-tree board (which crashes Playwright's WebKit, not Safari). Agreed
  2026-10-20: every run in WebKit cost ~20 minutes for little.
- Pass: pixelmatch threshold 0.1 and at most 0.07% of pixels differing per screenshot (0.05% until
  2026-10-21, raised for accepted sub-pixel edge differences; phases 2–3) (a
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

#### Phase 0, as built (2026-10-20)

- `?renderer=dom|gpu|auto` and `localStorage['lifeboard:renderer']`, read by `getRendererMode()`
  (`canvas-editor/src/lib/editor/rendererMode.ts`); `window.lifeboardRenderer.set()` switches it at
  runtime. Nothing reads it yet. A settings control waits for phase 2, when it does something.
- Fixtures in `apps/web/e2e/fixtures/`: `gallery.ts` (every registered shape type with its
  defaults, then geo × geo type, fill × dash, colours, size × font, text, notes, lines, frames,
  images, arrows with every head, dash, bend, label, elbow, scale, waypoints and kept-behind; strokes
  drawn with the mouse) and `synthetic.ts` (N distinct shapes, seeded). The four-tree board comes from
  the whole-life test command, which now also shows under automation (`navigator.webdriver`) so the
  production build used by e2e has it.
- `e2e/parity.spec.ts`: the three scenes × pixel ratio 1 and 2 × dark and light × zoom 10–400%,
  up to 6 views per zoom; renderer A against B, pixelmatch threshold 0.1, at most 0.05% differing;
  the app's chrome hidden. `LB_PARITY_BASELINE=save|compare` keeps or checks renderer A's shots in
  `apps/web/.parity-baseline/<browser>/` (ignored by git). A `webkit-parity` project (Desktop Safari)
  runs it in WebKit too.
- **Noise: the page against itself differs by 0.0000%** on every view (gallery 58 views, four-trees
  68, synthetic 72, at both pixel ratios, Chromium and WebKit). Two page renders are identical, so any
  difference the GPU path makes shows.
- `e2e/bench.spec.ts`: GPU flags unless `LB_BENCH_GPU=0`, and a `large boards benchmark` test
  (`LB_BENCH=1 pnpm exec playwright test e2e/bench.spec.ts -g large`).

**Before**, production build, GPU, 1280×720, mean / p95 ms per frame (8.3 is the floor):

| | Pan, all on screen | Pan 25% | Pan 50% | Pan 100% | Hover, all | Brush, all | Drag a node, all |
|---|---|---|---|---|---|---|---|
| Four-tree board (3,490) | 27 / 42 | 14.2 / 25.1 | 8.4 / 9.7 | 8.3 / 9.5 | 15.6 / 33.6 | 31.9 / 58.3 | (nodes are pinned) |
| Synthetic (10,000) | 36.3 / 58.3 | 8.8 / 10.3 | 8.4 / 9.8 | 8.4 / 10.1 | 11.6 / 17.3 | 24.9 / 42.2 | 69.3 / 116.6 |

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

#### Phase 1, as built (2026-10-20)

- `canvas-editor/src/lib/gpu/`: `primitives.ts` (the contract: `GpuPrimitive`, so far `rect`, and
  `gpuColor`), `gpuScene.ts` (per editor: which shapes are the GPU's and their instance data, as
  per-shape computed caches), `GpuRenderer.ts` (WebGL2, instanced rounded rects by signed distance),
  `GpuLayer.tsx` (the canvas at `--layer-gpu: 250`, between the grid and the shapes, in the page only
  while the renderer asks for it, made fresh with its context on each mount and removed with it; a
  lost context hands everything back).
  `ShapeUtil.toGpu` declared; `Shape.tsx` gives a GPU-drawn shape's element `visibility: hidden`.
- **Simpler than planned, on purpose:** no R-tree yet. The instance buffer holds every GPU shape in
  z-order, so a camera move only changes uniforms and nothing walks the shapes per frame; a change
  rebuilds the buffer from cached per-shape arrays (cheap up to tens of thousands). The index comes
  back with chunked buffers in phase 8, where the size needs it.
- `compare` renderer mode: the page draws everything and the GPU draws on top with
  `mix-blend-mode: difference`; where the two agree the screen is black.
- `gpu-test-rect` (`apps/web/src/canvas/gpuTestShape.tsx`), registered only under automation, and
  a `gpu-rects` parity scene: 8 looks × rotated, half-transparent, both.
- **What matching the page took**, all measured with probes against the page:
  - The page-to-screen mapping is the shape layer's own: `z·(p + camera + offset) + 0.5·(1 − z)`.
  - Chrome doesn't snap anything to device pixels: an edge's coverage follows the camera in
    fractions of a pixel. Snapping made it worse.
  - The background runs under a see-through border to the outer edge, and stops at an opaque
    border's inner edge (Blink's background bleed avoidance).
  - WebKit at pixel ratio 2 anti-aliases exactly like Chrome (0.033% on `gpu-rects`). At pixel
    ratio 1 and exactly 100% it snaps bordered boxes to whole pixels by a rule not yet reproduced.
- **Playwright's WebKit crashes with a WebGL canvas under a large board.** The four-tree board
  panned at 10% crashes the page with an empty WebGL canvas added by hand (our code not involved),
  and pans fine without one. Until that's understood the GPU layer is off in WebKit
  (`GPU_LAYER_SUPPORTED`): no canvas, the page draws everything, and WebKit parity compares the page
  with itself. Phase 2 starts by checking real Safari.
- **A WebGL layer under the shapes changes the page's own pixels.** The browser then composites
  the shape layer apart, and its antialiasing shifts a little: measured 0.046% of pixels on the
  synthetic board zoomed out with an empty WebGL canvas, none with an empty 2D one or none at all.
  So the canvas only exists while the GPU renderer is on (with it off, the page is exactly Phase 0's,
  checked against the baselines), and the parity checks compare `idle` (GPU layer there, drawing
  nothing) against `gpu`, so the GPU's drawing is held to 0.05% on its own. What the compositing does
  to shapes the page still draws is reported per scene (`COMPOSITING` lines): up to 0.25% on the
  synthetic board (all page-drawn) zoomed out, 0.08% on the four-tree board. It shrinks as shape
  types move to the GPU, and is gone in `auto` below the budget, where there is no GPU layer.
- Parity, GPU against `idle`: `gpu-rects` worst view 0.0446% (ratio 1) and 0.0347% (ratio 2) in
  Chromium, 0.0328% at ratio 2 in WebKit; every other scene 0%.

### Phase 2: the switch. M

- The budget: shapes on screen counted from the index; above the budget (with hysteresis so it
  doesn't flicker at the edge) shapes with a `toGpu` go to the GPU and their elements get
  `visibility: hidden`; below it, everything is the page's.
- Real Safari doesn't crash (checked by hand 2026-10-20: the four-tree board with an empty WebGL
  canvas under it, panned zoomed out, kept working, no slower). The crash is Playwright's WebKit
  build. So: the GPU layer back on in WebKit at pixel ratio 2 and up (ratio 1 keeps the page, for the
  border snapping); WebKit parity runs every scene but the four-tree board with the GPU on, and the
  four-tree board on the page, with that noted.
- Hidden boards (open tabs) give their WebGL context back; a board keeps one only while shown.
- Switching on and off needs hysteresis: each switch makes and frees a WebGL context.
- Live shapes stay in the page. Z-order across the two: when a GPU shape lies above a live shape
  and overlaps it, it's drawn on a second GPU canvas above the shape layer (usually none).
- The switch happens in one frame: the GPU frame is drawn before the elements are hidden, and the
  elements are shown before the GPU stops drawing them.
- Measure the budget: the number of visible elements where the page path stops holding 8.3 ms on
  this machine, and set it a margin below.

Done when: the frame-by-frame switch check passes with the test shape type; the suite passes;
nothing else changed (no real type has `toGpu` yet).

#### Phase 2, as built (2026-10-20)

- `GpuScene.wanted` decides whether the layer is in the page: the board shown (`shown`, set by the
  app from the active tab, so a board open behind it holds no WebGL context), the browser able
  (`gpuLayerSupported`: WebKit only at pixel ratio 2 and up, after the hand check in real Safari),
  and the renderer `gpu`, `compare`, `idle`, or `auto` with its count over the budget.
- `auto`: the GPU's shapes on screen (eligible and not culled) over `DEFAULT_GPU_BUDGET` (64,
  `localStorage['lifeboard:gpu-budget']` overrides) turn it on; under 70% of it turn it off. Not
  counted at all on a board none of whose types have `toGpu`, which is every real board until phase 3.
- **The budget, measured** (production build, GPU, pan per frame): the page holds the 120 fps floor
  up to ~70–85 shapes on screen (four-tree board 72 → 8.4 ms, 85 → 9.1, 147 → 10.4, 479 → 16.9,
  3,446 → 44; synthetic 87 → 9.6, 309 → 13.2, 816 → 22.5, 3,664 → 76.5). 64 is a margin under it.
- **Z-order:** a shape the GPU could draw that lies above a page-drawn shape it overlaps is left to
  the page (one pass in drawing order over a grid of page-drawn bounds). Simpler than the second GPU
  canvas the plan had, and it can't stack anything wrong.
- **A Phase 1 bug found:** the scene drew in the order of `getRenderingShapeList`, which is sorted by
  id on purpose (page elements never move in the DOM; z-order is each entry's `index`). Overlapping
  GPU shapes would have stacked by id. Now sorted by `index`; a unit test and the `gpu-rects` scene's
  new stacking cases cover it.
- `e2e/switch.spec.ts`: 300 half-transparent rects, budget 40, zoomed out across it and back in, five
  shots per step while it settles, each against the page alone (≤ 0.4%: a lost or doubled shape
  differs by percents): passes; and a count wobbling about the budget switches once.
- **Left for phase 3:** borders far thinner than a device pixel (a 1 px border at 25% zoom) are
  spread across pixels a little differently from Skia's: one `gpu-rects` view at pixel ratio 1
  differs by 0.058% (limit 0.05%). Phase 3 is thin strokes zoomed out, so that's where it gets solved.
- A settings control for the renderer waits for phase 3, when `auto` first switches on real boards.

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

#### Phase 3, as built (2026-10-20)

- **The GPU layer moved over the shapes** (`--layer-gpu: 350`, under the overlays). Under them, the
  WebGL canvas made the browser composite the shape layer apart and rasterise it at another scale,
  which blurred the page's own thin lines zoomed out (what phases 1–2 recorded as "compositing";
  seen side by side it was blur, not antialiasing). Over them, the page draws exactly as without the
  layer (page alone against `idle`: 0.0000% at every zoom), and parity compares the GPU with the page
  alone again. The z-order rule turned over with it: a shape the GPU could draw that lies **under** an
  overlapping page-drawn shape is left to the page. So on the four-tree board, whose lines run under
  the nodes they join, the lines stay the page's until the nodes are the GPU's (phase 4).
- `GpuStroke` (an SVG path, width, colour, dash, halo) and `gpu/stroke.ts`: paths flattened (M L H V
  Q C A Z, absolute and relative), dashed by length as `stroke-dasharray` lays it (a dash starting
  where the line ends isn't drawn, as the browser doesn't), and built into one strip per line with
  round joins and caps that never overlap (capsules per segment would double the soft rim at every
  joint). Widths, the halo and antialiasing are the shader's, so zoom changes no geometry. Coverage is
  a pixel square's exact share of the stroke, across the stroke's own direction.
- Halos: in `--color-background` (read when the theme changes), `2·min(0.75, 1.5 / --tl-zoom)` each
  side, `--tl-zoom` read at draw time and watched (it lags the camera on big boards, as the page's).
- Frames are runs in z-order of rect instances and stroke vertices; WebGL2 has no base instance, so a
  rect run re-points its instance attributes.
- `ArrowShapeUtil.toGpu`: halo (unless kept behind), body with its dash, `arrow` heads; the page keeps
  labels (text, phase 4), heads that cut the line (masked), and the selection hint.
  `LineShapeUtil.toGpu`: solid, dashed and dotted (each dashed segment its own dash); the hand-drawn
  style stays the page's.
- A see-through shape drawing more than one piece (an arrow's line over its halo) stays the page's:
  the page fades it as one, the GPU would fade each piece and show the halo through the line.
- Parity scene `gpu-strokes`: every arrow form, dash, size, bend, elbow, scale, waypoints, kept
  behind, half-transparent, crossing pairs, and lines of both splines and three dashes. Light theme
  and pixel ratio 2 within 0.036%; one dark view at ratio 1 and 50% is 0.065% (below).
- **Known, accepted (2026-10-20/21):** sub-pixel edge placement (this and phase 2's thin borders)
  turned up in more views than two (a synthetic view at 10% in dark mode, 0.061%; a rect view, 0.059%),
  so the parity limit is 0.07% for every view instead of a list of exceptions. Haloed lines at 50% sit ~0.1 device pixel lower on the page than exact maths
  puts them (both halo and line; at 25% and 100% they match). It shows only in dark mode, where the
  near-white halo meets the dark paper. Skia's rasteriser places some edges on a sub-pixel grid; that
  is what to look at, alongside phase 2's sub-pixel borders.

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

#### Phase 4a, as built (2026-10-21): text, pictures and the skill tree's nodes

- **Pictures** (`GpuImage`, `gpu/atlas.ts`): anything the browser's 2D canvas draws as the page does,
  kept in one 4096² texture at the exact scale and sub-pixel phase it's seen at (1/4096 of a pixel,
  fine enough that a glyph lands in the same quarter pixel as the page's), drawn stretched while the
  camera moves and rastered again once it has been still for 120 ms, 6 ms a frame. A shelf of
  pictures is drawn side by side in one canvas and sent in one upload: thousands of uploads in a
  frame (the board zoomed out, every picture new) ran WebGL out of memory. The canvas is in the
  document, out of sight, because a canvas takes `-webkit-font-smoothing`, tabular figures and the
  other font settings from its own element's style; detached, its text came out 10–20% heavier.
- **Nodes read from their elements** (`gpu/snapshots.ts`; `NodeDefinition.gpu`, on for skills,
  entries and works). What the browser laid out is read back after it renders and redrawn:
  - boxes: background, flat tints (`linear-gradient(c, c)` layers), one radius, snapped to whole
    pixels in the shape's own space as Blink paints them (found by probing: an edge is at the shape's
    translation plus the rounded layout position);
  - solid borders, and dashed round ones drawn as Blink draws them (`DrawCurvedDashedDottedBoxSide`:
    the outline brought in by half the width rounded down, stroked 2.2× wide, dash 3w gap 2w, the gap
    fitted to the outline's length as Skia measures it, rounded down, cut to the ring); exact at
    pixel ratio 2, within a few pixels at 1;
  - glows (`box-shadow`): a picture by canvas `shadowBlur`, which blurs as CSS does, clipped to outside
    the box;
  - text: each line one `fillText`, so the browser shapes and spaces it, placed where its glyphs were
    laid out (glyph by glyph if the widths disagree), the baseline snapped to a whole pixel in the
    shape's space as Blink does; `-webkit-line-clamp` cut to its lines with the ellipsis after the
    last glyph that leaves room;
  - SVG (rings, icons): a picture of its own markup with the computed styles written in.

  Anything else (transforms, filters, pictures, text cut short another way, square dashed borders)
  leaves the node to the page, and why is kept in `lifeboardRenderer.snapshots(editor).reasons`.
  A node is the page's until it's read, and again from the moment its element, the theme or a font
  changes until it's read again, so nothing out of date shows. Moving it doesn't need a new read.
- **The z-order rule** goes by where a stroke runs (boxes along it, 64 units each, padded by its width,
  halo and a pixel), not its bounds, and skips culled shapes, whose overlaps are off screen. Before,
  one page-drawn node on screen sent nearly every line on the four-tree board to the page.
- **Strokes:** curves are cut only as finely as the zoom needs (a sixth of a device pixel at the top
  of the zoom's power of two; at 10% the four-tree board's lines were 83 MB cut for 400%), and the
  frame reuses the rect and stroke arrays when their pieces haven't changed.
- **Chromium multisamples curves.** It rasterises a curved path 4× multisampled and a straight one
  analytically (measured: a 0.3 px curve covers one sample of four, and four curves laid over each
  other still one; straight ones add up). The four-tree board's lines lie over each other, so drawn
  analytically they came out darker zoomed out (0.49% at 10%). The layer now draws into a 4×
  multisampled target, and a curve thinner than a device pixel is covered by samples; everything
  else keeps its exact shader edges, on quads a pixel wider, so it resolves unchanged. Not in WebKit,
  which paints pages with CoreGraphics.
- **Parity runs on Chromium's GPU rasteriser** on macOS (`LB_PARITY_SOFTWARE=1` for the software one),
  because that's what people see: the software rasteriser antialiases round edges and dash ends
  differently (4× vertical supersampling) and the two disagree by up to 0.15 px on a circle's edge.
  CI has no GPU, so the spec skips there (agreed 2026-10-21; `LB_PARITY=1` forces it).
- A shape whose pictures would be more than 1,024 device pixels across at the zoom's power of two is
  the page's: zoomed far in (400% on a retina screen) a node's glow and ring didn't fit in the atlas
  together, and its text went missing. `auto` keeps so few shapes on the page anyway.
- **Accepted (2026-10-21):** at 25% and below, thin lines differ by a quarter of a pixel's coverage
  here and there (the GPU's curves aren't cut where Skia cuts them, and multisampling turns that into
  whole samples), up to 0.59% of pixels on the four-tree board in dark mode; the limit there is 0.6%.
- **Known miss:** in dark mode at pixel ratio 1, a dotted elbow arrow at 50% and 100% differs by
  0.17%/0.12% (0.065% under the software rasteriser): Chromium's GPU rasteriser draws dots on a
  curved path differently from the GPU layer's exact ones, with or without multisampling. Left for
  phase 4d (dash styles).

**Numbers** (production build, GPU, mean / p95 ms a frame):

| Four-tree board (3,490) | Pan at fit (10%) | Pan 25% | Pan 50% | Pan 100% | Hover, fit | Brush, fit |
|---|---|---|---|---|---|---|
| Page | 19.2 / 33.5 | 11.6 / 16.9 | 8.4 / 9.9 | 8.3 / 9.5 | 13.2 / 25.1 | 22.1 / 42.8 |
| GPU | 9.8 / 16.9 | 8.8 / 10.0 | 8.5 / 10.0 | 8.5 / 10.3 | 8.8 / 16.3 | 13.8 / 33.4 |

Parity: 19 of 20 (the miss above); the suite: 222 passed.

#### Phase 4b, as built (2026-10-21): geo

- `GeoShapeUtil.toGpu` is the same reader as the nodes': the body a picture of its own SVG, the label
  its text. Every geo type, fill, dash (the hand-drawn one too: it's SVG all the same), size, colour
  and label.
- The SVG picture takes in its widest stroke's reach past the box (a shape's SVG has no viewBox, and a
  picture is clipped to its size). What it fills from elsewhere in the page, the hatching pattern, is
  copied in with its tile inlined as a data URL: a picture of an SVG can't see the page's
  definitions or load a blob. The pattern's id follows the zoom, so the element changes and is read
  again.
- Labels have tldraw's text outline: six sharp `text-shadow`s in the paper's colour, a pixel each way
  up to 200% and `2px / --tl-zoom` past it. They're drawn under the text in the same picture; a shape
  with one is read again when `--tl-zoom` changes the outline.
- Positioned children paint after what flows, by z-index, then in order (the label is `z-index: 10`);
  a negative z-index, and generated content (`::before`, `::after`, list bullets), leave the shape to
  the page.
- Speed work found on the way: elements are read only while the camera is still and handed over a few
  times a second; the frame is kept by a reactor of its own instead of being asked on every camera
  move; the atlas finds pictures by a number, not their key; a round piece is four wedges a half turn,
  not twelve (a dotted arrow zoomed out is thousands of dots); the zoom's powers of two are atoms.
- The benchmark now records each measurement's zoom and turns edge scrolling off: brush and drag start
  at the screen's edge, where the camera scrolls by time, so the slower renderer brushed and dragged
  further. Before, page and GPU weren't measured at the same zoom on the 10,000-shape board.
- **The 10,000-shape board was slower on the GPU zoomed out** (31 → 82 ms panning at 10%), found when
  the benchmark was made fair, and fixed (25.9 against the page's 32.5). Drawing wasn't it; signals and
  reads were:
  - The scene read the camera, the culled set and the editor's rendering list straight from the editor.
    All three are woken by every frame of a pan (the camera is a record, and the queries see it), and
    every computed built on them then checked each shape's caches to find nothing had changed. The zoom's
    powers of two, the culled set and the rendering list are now atoms, set only when they change.
  - Each shape had a reactor for its element's visibility; one set of hidden shapes and one reactor
    now apply it, showing and hiding only what changed.
  - Each shape's stroke vertices stay on the GPU in a slot of their own; a frame sends only new ones.
  - Elements are read only after the camera has been still for 150 ms: between the wheel steps of a
    gesture the editor already counts the camera idle, and reading (and handing over) in a pan cost it
    frames.

  10,000-shape board at 10% (page / GPU, ms): pan 32.5 / 25.9, hover 10.8 / 8.6, brush 19.6 / 16.2,
  drag 16.6 / 16.9. Most of it (notes, text, markdown) is still the page's until 4c and 5. The
  four-tree board: pan at fit 19.6 / 9.6, 25% 12.4 / 8.9, 100% 8.3 / 9.9; at 100%, where `auto` turns
  the GPU on (some 110 shapes on screen), it's 1.5 ms slower: for the budget in phase 9.
- Parity 19/20 (the dotted dark arrow); one run's dark view at 200% failed on Chromium drawing a label
  in garbage glyphs on the page itself, and passed again. Suite 224 passed.

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
  screen. At pixel ratio 1 (a Mac on a non-retina screen) WebKit snaps bordered boxes to whole pixels
  at exactly 100%, inconsistently (a 6 px border comes out 7). And Playwright's WebKit crashes with
  any WebGL canvas under the four-tree board panned at 10% (phase 1). The GPU layer is off in WebKit
  until both are understood; checking real Safari comes first.
- **The page beside the GPU layer.** Shapes the page still draws while the GPU layer is on are
  composited apart, and differ from the page alone by up to 0.25% of pixels zoomed out (phase 1).
  Fewer of them each phase; to remove it entirely, everything on screen above the budget has to be
  the GPU's, or the page would have to be composited like that always.
- **Effects the GPU path must match:** `box-shadow`, CSS filters, blend modes, `backdrop-filter`.
  Any type using one that can't pass parity stays in the page.
- **Memory at 1M shapes**: unproven until phase 8.
- **Size**: this is the largest change the canvas has had. Phases 0–4 alone fix the boards you have
  today; 5–9 are for the boards you want to make.
