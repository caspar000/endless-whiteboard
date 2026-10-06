# Fork parity register

Everything tldraw 5.5 has that the Apache-2.0 fork (tldraw `2.0.0-alpha.19`, December 2023) lacks.
The plan that works through it is `docs/canvas-fork-plan.md`.

Each item has an id, so commits and the plan can point at it. **Needed for** says when it has to
exist:

- **Cutover** — Lifeboard uses it today. The app can't move to the fork without it (plan phases 2–7).
- **Backlog** — Lifeboard doesn't use it yet. Built after cutover, at your pace.

**Status:** `todo`, `doing`, `done` (with the commit), or `dropped` (with the reason).

Sources: a diff of every tldraw API this repo calls against the fork's source, and tldraw's public
release notes for 2.0–5.5. No licensed tldraw source was used to compile this.

---

## D — Data formats the fork must read and preserve

The records are defined, with their migrations, in the MIT `@tldraw/tlschema`, which the fork runs on
(plan phase 2). So stored boards never need converting. The fork has to *understand* these fields,
and until it does, it must leave them untouched.

| Id | Format | Arrived | Needed for | Status |
|---|---|---|---|---|
| D1 | `richText` (TipTap JSON) instead of `text` on text, note, geo; on arrow labels too | 3.10, 4.0 | Cutover | done (phase 4) |
| D2 | Arrow connections as separate `binding` records (type `arrow`); arrow `start`/`end` are plain points | 2.2 | Cutover | done (phase 3) |
| D3 | Draw and highlight strokes stored as a base64 delta-encoded `path` with `scaleX`/`scaleY`, instead of `points` arrays | 4.3 | Cutover | done (phase 2) |
| D4 | Arrow `kind` (`arc` or `elbow`) and the elbow midpoint | 3.13 | Cutover (draw elbows as straight until G-items land) | done: elbows routed and drawn (B1); the seven routes measured from tldraw 5 come out the same |
| D5 | `flipX`/`flipY` on images (2.4) and geo shapes (5.3) | 2.4, 5.3 | Cutover | done: images draw flipped (phase 5); geo shapes mirror their outline, tick and cloud with the label upright, on screen, in hit-testing and in export, and flipping or resizing past an edge toggles the flags, as tldraw 5 does (compared side by side) |
| D6 | `labelColor` on notes | 3.4 | Cutover | done (phase 4) |
| D7 | `scale` prop for dynamic size mode | 2.3 | Cutover (read; mode itself is backlog) | done for reading (phase 2); the mode is backlog |
| D8 | Text `textAlign` (was `align`) | 2.2 | Cutover | done (phase 2) |
| D9 | Asset `pixelRatio`; asset upload returning `{ src, meta }` | 4.5, 3.8 | Cutover | done: read and kept (phase 2); upload returns `{ src, meta }` (phase 5) |
| D10 | Document-scoped `user` records, `dash: 'none'`, comment records — not used by Lifeboard, must survive a load/save untouched | 5.0, 5.3 | Cutover (preserve only) | done (phase 2): load/save round trip of the reference boards |
| D11 | Fill styles `fill` (full colour) and `lined-fill` (a flat fill a shade off the colour, so the outline shows; not hatching) | 3.x | Cutover | done: drawn and exported as tldraw 5 draws them (measured) |

## E — Editor APIs Lifeboard calls

21 of the 77 editor methods this repo calls are missing from the fork, and 34 of the symbols it imports
from `tldraw` are editor or UI features the fork lacks (the other 38 come from the MIT packages and
keep working).

| Id | API | What uses it here | Needed for | Status |
|---|---|---|---|---|
| E1 | Bindings API: `getBindingsFromShape`, `createBindings`, `deleteBindings`, `getArrowBindings`, binding utils, `defaultBindingUtils`, `canBind` options, a binding-deleted side effect | Relations (`node-kit/src/edges.ts`, `relations.ts`) | Cutover | done (phase 3) |
| E2 | Rich text editing: TipTap in text, note, geo and arrow labels; `textOptions.tipTapConfig`; `tipTapDefaultExtensions`; a way to add our own extension | The `{…}` expression helper, every text shape | Cutover | done (phase 4) |
| E3 | `run` and `markHistoryStoppingPoint` (the fork has `batch` and `mark`) | 51 + 20 call sites | Cutover | done (phase 5) |
| E4 | Shape visibility (`getShapeVisibility` option, `isShapeHidden`) | Hidden relations (`canvas/relationVisibility.ts`) | Cutover | done (phase 5) |
| E5 | Camera options: `getCameraOptions`/`setCameraOptions`, zoom steps, `getBaseZoom`, locking | Quick Look (`canvas/quickLook.ts`) | Cutover | done (phase 5); wheel behaviour and speeds not applied |
| E6 | `ShapeUtil.configure()` | Frame (`showColors`, transparent fill), geo (fill colour in meta) | Cutover (subclassing is acceptable) | done (phase 5) |
| E7 | Theme and colour API: `getCurrentTheme`, `getColorMode`, `getColorValue`, the `colorScheme` prop | Dark/light, fill and swatch colours | Cutover | done (phase 5) |
| E8 | `focus`, `blur`, `getIsFocused`, `markEventAsHandled`, `canEditShape` | Keyboard handling, tab switching, Quick Look | Cutover | done (phase 5) |
| E9 | `onHandleDrag` on shape utils, `TLHandleDragInfo` | Shift-to-hide while drawing a relation | Cutover | done (phase 5) |
| E10 | Asset store interface (`TLAssetStore`: upload, resolve) and `useImageOrVideoAsset` | The content-addressed image pipeline, server assets | Cutover | done (phase 5) |
| E11 | `toImage` (PNG/SVG/blob export of chosen shapes) | Thumbnails, agent vision (`ops/view.ts`) | Cutover | done: `toImage` (phase 5); shapes drawn in HTML export their content (phase 7); text, note, geo and arrow labels export as the canvas shows them, formatting and all, with every font face they use embedded. On the way: labels draw like tldraw 5's (bold and italic faces for all four fonts, highlights, code, links, headings and lists measured and matched) |
| E12 | `getIndicatorPath` on shape utils (the fork uses an `indicator()` component) | `createNodeShapeUtil` | Cutover | done (phase 5): default indicator from geometry; `getIndicatorPath` accepted, outline from geometry |
| E13 | `getSnapshot`/`loadSnapshot`, `createTLSchemaFromUtils` | Backups, fixtures, the server schema | Cutover | done (phase 3–5) |
| E14 | `pageToViewport`, `getSelectionScreenBounds` | Overlays, toolbars | Cutover | done (phase 5) |
| E15 | External content defaults: `defaultHandleExternalFileContent`/`TextContent`/`UrlContent`, `TLFilesExternalContent` | `canvas/FileImportHandler.tsx` | Cutover | done (phase 5) |
| E16 | `TldrawOptions` (`options` prop), `TldrawEditorStoreProps` (`store` / `persistenceKey` props) | `canvas/Board.tsx` | Cutover | done (phase 5); `options` holds the limits only |
| E17 | `DefaultShapeWrapper`, `TLShapeWrapperProps`, `suffixSafeId`, `useUniqueSafeId` | Trace layer, SVG ids | Cutover | done (phase 5) |
| E18 | Names that changed: `Vec`/`Box` (fork: `Vec2d`/`Box2d`), `TLComponents` (fork: `TLEditorComponents`) | Everywhere | Cutover (aliases) | done (phase 5) |
| E19 | Drop-target behaviour as Lifeboard relies on it (`docs/tldraw-api-notes.md`: drag-in fires on drag start, topmost hook wins, `canReceiveNewChildrenOfType` gates the drop) | Kanban, calendar, frames adopting cards | Cutover | done (phase 5) |
| E20 | Local persistence behaviour: same IndexedDB names (the fork already uses `TLDRAW_DOCUMENT_v2`), flush on close and `pagehide` | Existing local boards, `persistence/tldrawLocalDb.ts` | Cutover | done: same names, and databases opened at tldraw 5's version 4 with its `assets` store (phase 2); pending writes flushed on close, `pagehide` and the tab going hidden (phase 5) |

## U — UI pieces Lifeboard builds on

| Id | Piece | What uses it here | Needed for | Status |
|---|---|---|---|---|
| U1 | Contextual toolbar (`TldrawUiContextualToolbar`), toolbar button | `canvas/SelectionToolbar.tsx` | Cutover | done (phase 5) |
| U2 | Image and video toolbar contents (crop, replace, download, alt text) | Selection toolbar for media | Cutover | done (phase 5); no zoom slider while cropping |
| U3 | Composable menus: `TldrawUiMenuItem`, `TldrawUiMenuGroup`, `DefaultContextMenu`(+`Content`) | Context menu (`canvas/uiOverrides.tsx`) | Cutover | done (phase 5): context menu |
| U4 | `DefaultKeyboardShortcutsDialog`(+`Content`) | Keyboard shortcuts dialog | Cutover | done (phase 5) |
| U5 | The `components` override slots as Lifeboard uses them (Toolbar, Background, InFrontOfTheCanvas, Grid, MenuPanel, StylePanel, ContextMenu) | `canvas/Board.tsx` | Cutover | done (phase 5) |

## S — Sync and presence

tldraw sync arrived in 2.4 under the tldraw licence; nothing of it can be used. Ours is `packages/canvas-sync`.

| Id | Piece | What uses it here | Needed for | Status |
|---|---|---|---|---|
| S1 | Client sync: send store diffs, apply remote ones, reconnect from a clock | Server-vault boards (`useSync` in `canvas/Board.tsx`) | Cutover | done (phase 6): `SyncClient`, `useSyncedStore` in `packages/canvas-sync` |
| S2 | Server rooms: one per board, SQLite storage, validation and migration against the shared schema | `apps/server/src/rooms.ts` | Cutover | done (phase 6): `SyncRoom`, `SqliteRoomStorage` |
| S3 | Moving existing server rooms from sync-core's SQLite layout to ours | Any room created before cutover | Cutover | done (phase 6): on first open, plain SQL |
| S4 | Presence: other users' cursors and selections | Not used yet (the agent cursor is our own) | Backlog | todo |
| S5 | Offline edits for server boards: a local copy and an outbox (tldraw sync never had this) | Mobile phase | Backlog | todo |
| S6 | Who created and last edited a shape | Not used | Backlog | todo |
| S7 | Comments | Not used | Backlog | todo |

## B — Features users would notice, not used by Lifeboard yet

| Id | Feature | Arrived | Status |
|---|---|---|---|
| B1 | Elbow arrows (drawing and routing; reading them is D4) | 3.13 | done: our own router (`elbow-arrow.ts`, the shortest clean route out of one side and into another), rounded corners, the middle handle, curved/elbow in the arrow tool's row and the selection toolbar. Not yet: snapping an end to a side or its centre (the binding's `snap`), and the wobbly `draw` stroke |
| B2 | Drag arrow labels along the arrow | 2.0 beta | todo |
| B3 | Sticky clone handles; Tab creates the next sticky | 2.1 | todo |
| B4 | Wrap selection in a frame (⌘⇧F); the frame tool highlights what it will enclose | 5.2 | todo |
| B5 | Advanced crop (aspect ratios, snapping crop edges); flip images and geo shapes | 3.14, 2.4, 5.3 | todo (flipping is done, D5) |
| B6 | Heart geo shape; custom geo types; fill styles "fill" and "lined-fill" | 2.2–5.0 | todo (the fill styles are done, D11) |
| B7 | Smart typography (curly quotes, `->` to `→`) | 5.5 | todo |
| B8 | Paste: raw `<iframe>` embeds, Mermaid to shapes, Excalidraw content; URL onto a selected shape sets its link | 3.8–5.5 | todo |
| B9 | Drag a shape out of the toolbar | 4.0 | todo |
| B10 | Dynamic size mode (shapes keep their size on screen) | 2.3 | todo |
| B11 | Flatten selection to an image | 2.3 | todo |
| B12 | Laser that fades as one stroke | 4.4 | todo |
| B13 | Text tool lock; note resize by scale | 3.3, 3.8 | todo |
| B14 | Align centre option | 5.4 | todo |

## I — Interaction

| Id | Feature | Arrived | Status |
|---|---|---|---|
| I1 | Edge scrolling while dragging | 2.0 beta | todo |
| I2 | Snapping to the grid while creating; handle-point snapping; snapping inside frames | 2.0–3.5 | todo |
| I3 | Cmd/Ctrl-click multi-select; smarter select-all | 3.3, 3.15 | todo |
| I4 | Quick zoom overview (`z` + Shift); Shift +/− zooms at the cursor; 5% minimum zoom | 4.4, 3.11 | todo |
| I5 | Right-click-drag pans the camera | 5.0 | todo |
| I6 | Touch: double-tap-and-drag zoom; long-press | 5.2, 2.1 | done: one-finger zoom (`useTouchZoom`: the second tap is held back until it moves, so a plain double tap still reaches the editor); long-press already opened the context menu through Radix, now under test |
| I7 | Context menu from any tool; Shift+Q copies a shape's style; Cmd-click a style applies it to the selection only | 5.0–5.2 | todo |
| I8 | Move the selection into and out of frames and groups by keyboard; Option+arrows between pages | 3.11–3.13 | todo |
| I9 | Better pressure handling for pen tablets | 2.2 | todo |
| I10 | Option to select locked shapes; option to turn off shortcuts; inverted wheel zoom | 5.1, 3.15, 4.4 | todo |

## A — Accessibility

| Id | Feature | Arrived | Status |
|---|---|---|---|
| A1 | Keyboard navigation between shapes (Tab, ⌘ arrows), keyboard resize, focus rings | 3.11–3.12 | done: Tab/⇧Tab in reading order, ⌘/Ctrl+arrow to the nearest shape that way, ⌥⇧+arrow resizes, the view follows; the selection outline is the focus ring on the board. Focus rings across the app's own controls are part of A3 |
| A2 | Screen-reader announcements | 3.12 | done: a polite live region per board (`CanvasAnnouncer`) says the selection (kind and text, or how many) and the tool as they change; the canvas is an application named "Board" |
| A3 | Enhanced accessibility mode (WCAG 2.2 AA) | 4.0 | todo |

## L — Language and theming

| Id | Feature | Arrived | Status |
|---|---|---|---|
| L1 | 40+ languages (the fork has about 30; the rest fall back to English since phase 7) | 3.8 | todo |
| L2 | Right-to-left layouts | 5.0 | todo |
| L3 | Custom themes and palettes | 5.0 | todo |
| L4 | Follow the system dark/light setting | 2.3 | todo |
| L5 | Redesigned style panel and page menu (inline rename, drag to reorder) | 4.0, 5.1 | todo |
| L6 | Today's colour palette. The fork's was 2023's | 3.x | done: every colour, fill style and text colour in both modes measured from tldraw 5.5's rendering and matched exactly; a shape's own fill colour paints at full strength in every fill style, on screen and in export, as it did on tldraw 5 |

## P — Performance

Measured with `e2e/bench.spec.ts` (`LB_BENCH=1`, `LB_BENCH_NODES=2000` for the large board) against
tldraw 5 on 2026-10-06. At 2,000 nodes the fork runs less script than tldraw 5 in every gesture;
what remains slow on both is painting many HTML nodes and moving thousands at once. On the way, the
page's shape cap went from 2023's 2,000 to today's 4,000 (measured): a large board was refusing new
shapes.

Unmeasured: how the fork does on Lifeboard's 500-node `perf.spec.ts`. Phase 7 measures it.

| Id | Improvement | Arrived | Status |
|---|---|---|---|
| P1 | Selection outlines drawn on a 2D canvas (tldraw cites up to 25× faster) | 4.4 | done: one canvas in screen space (`SelectionIndicatorsCanvas`) from `getIndicatorPath` or the geometry (nodes, notes, geo); arrows and pen strokes keep SVG. Brushing 2,000 nodes: 9% less main-thread time |
| P2 | R-tree spatial index for hit-testing and culling | 4.4 | measured, not needed yet: hovering over 2,000 nodes costs 14 ms of script for 60 moves (tldraw 5: 39 ms) |
| P3 | Culling rechecks only shapes affected by a change | 5.3 | measured, not needed yet: the selection check is a set now, which removed an O(shapes × selected) step, but brushing or dragging 2,000 nodes is spent painting HTML nodes and updating records, not culling |
| P4 | Batched text measurement | 5.0 | todo |
| P5 | Faster freehand ink (2–3×); input buffering | 5.2, 2.1 | todo |
| P6 | Image resolution matched to zoom | 2.3 | todo |

## X — Safety and export

| Id | Item | Arrived | Status |
|---|---|---|---|
| X1 | Sanitise pasted and dropped SVG | 4.5 | done: `sanitizeSvg` (canvas-editor) cleans pasted SVG text before it is measured and every SVG file before it is stored: no scripts, handlers, outside links, `foreignObject`, frames, or animations that set a link or handler |
| X2 | Clipboard hooks (before copy, before paste, raw paste) | 5.0 | todo |
| X3 | Copy as PNG by default (⌘⇧C); paste as plain text (⌘⇧V) | 5.0 | todo |
| X4 | Export options: `scale`, `pixelRatio`, trim to content (`padding: 'auto'`); custom shapes export without writing `toSvg` | 3.0–5.0 | todo |
| X5 | Clicks pass through transparent image pixels | 4.5 | todo |

## F — Fork housekeeping

Found while importing the fork (phase 1). Not tldraw features; things the fork does that Lifeboard must
not ship.

| Id | Item | Needed for | Status |
|---|---|---|---|
| F1 | Default icon, font and translation URLs point at tldraw's CDN (`unpkg.com/@tldraw/assets@…`, `ui/assetUrls.ts`, `utils/static-assets/assetUrls.ts`). Make the bundled `@lifeboard/canvas-assets/imports` the default, so nothing is fetched from a third party and the app works offline | Cutover | done: the bundled `@lifeboard/canvas-assets` is the default; nothing is fetched from a CDN |
| F2 | The error screen links to tldraw's GitHub issues and Discord (`DefaultErrorFallback.tsx`) | Cutover | done: the crash screen points nowhere outside, says the boards are saved, and no longer offers "Reset data", which would have wiped every board and setting in the browser |
| F3 | Three translation strings say "tldraw" (the `.tldr` file open/save messages) | Cutover | done: the English strings say "the app" and "canvas file"; the 93 translated strings that named tldraw are gone, so those languages fall back to the English |
| F4 | The 2023 data packages need a two-line pnpm patch for today's TypeScript (`patches/@tldraw__utils@2.0.0-alpha.19.patch`); goes away with them in phase 2 | Phase 2 | obsolete: the 2023 data packages and their patch went in phase 2 |
| F5 | The fork compiles with upstream's looser settings, not the workspace's (`noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns` off) | Backlog | doing: consumers compile against the fork's declarations (phase 7), so this no longer blocks them; about 1,800 errors to fix in the fork itself |
