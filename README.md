# Lifeboard

An infinite-canvas whiteboard where **every element is a typed node** — not just stickies and images,
but markdown documents, structured item records, and live computed rollups over them.

Think Notion-style databases on an endless whiteboard, local-first and fast.

```
pnpm install
pnpm dev          # http://localhost:5173
```

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server |
| `pnpm build` | Production build (also writes `apps/web/stats.html` for bundle inspection) |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm test` | Vitest units (rollup aggregation, fields, facts, registry, snapshot fixtures) |
| `pnpm test:e2e` | Playwright, against the **production build** |
| `pnpm --filter @lifeboard/web gen:icons` | Regenerate PWA icons from `public/favicon.svg` |

## The two screens

**Home** — a sidebar (All boards / Recents / Favourites / Storage, with live counts) beside a grid of
board cards, modelled on Freeform's board browser. Each card's preview is that board's own thumbnail,
captured from the live editor as the board is closed; boards never opened show a dotted-paper
placeholder. Star a board to pin it to Favourites.

**Board** — the endless canvas on dotted paper, with a registry-driven toolbar. Double-clicking empty
canvas asks which kind of node to add rather than creating a text shape; double-clicking the board's
name in the top bar renames it.

## The three node types

| Node | What it holds | Toolbar |
|---|---|---|
| **Markdown** (`node.markdown`) | A markdown string. Double-click to edit the source. | `M` / <kbd>m</kbd> |
| **Item** (`node.item`) | Title, image, tags, and typed fields (`price: ₾2399`, `category: desk`). | `▤` / <kbd>i</kbd> |
| **Rollup** (`node.rollup`) | A live aggregate over other nodes — sum/count/avg/min/max, optionally grouped. | `Σ` / <kbd>s</kbd> |

Rollups are **pure derivations**: never written to the store, so undo history stays clean and there
are no feedback loops.

## Layout

```
apps/web/                 the app (Vite + React 19 + TS strict, PWA)
  src/app/                routing, home screen (sidebar + card grid), storage panel
  src/boards/             board index, delete sequencing, first-run demo
  src/canvas/             <Board> wrapper, dotted paper, node create menu, toolbar, debug badge
  src/platform/           PlatformAdapter (the entire future Tauri port surface)
  src/persistence/        asset store, downscaling, thumbnails, backup zip, tldraw-internals wrapper
packages/node-kit/        @lifeboard/node-kit — the smart-node system
  src/registry.tsx        NodeDefinition + registry + createNodeShapeUtil  ← the load-bearing seam
  src/fields.ts           field types, coercion, currency formatting
  src/facts.ts            the "what data does this node expose" contract
  src/nodes/*/            markdown, item, rollup (definition + components + engine)
docs/tldraw-api-notes.md  pinned tldraw API surface and v5 deltas — read before upgrading
```

`node-kit` is a package, not a folder, because it is exactly the code that becomes the plugin SDK,
gets reused by a future sync server for schema/validation, and ships unchanged into a Tauri build.

## Things worth knowing before you change something

**Adding a node type** means adding a `NodeDefinition` and registering it — nothing else. Shape util,
canvas tool, toolbar entry, keyboard shortcut, the double-click create menu, and rollup participation
all follow from the registry. There is deliberately no per-node-type branching in the UI.

**The canvas chrome is customised in three places**, all in `canvas/Board.tsx`: `DottedPaper` replaces
tldraw's `Background` (rather than enabling grid mode, which would also snap movement), `StylePanel` is
set to `null`, and `createTextOnCanvasDoubleClick: false` disables the default double-click behaviour
so `NodeCreateMenu` can offer the node types instead.

**Board thumbnails are captured when you press "← Boards", not on unmount** — and that timing is
load-bearing. Exporting from the editor's unmount path runs while the board host is
`visibility: hidden` for the persistence drain, and tldraw's exporter then produces an image with every
node background and font missing: previews looked correct for about a second and then decayed into
serif text on white. `leave()` in `canvas/Board.tsx` captures while the board is still on screen, and
awaits it (bounded by a timeout) so navigation can't outrun the export.

**Changing a node's props requires a migration.** `apps/web/src/persistence/snapshot-fixtures.test.ts`
loads a real snapshot from every released schema and fails if a migration is missing — verified to
catch it. See `src/persistence/fixtures/README.md` for how to add a fixture.

**tldraw is pinned to an exact version (5.2.5).** Two files depend on its internals — the local
IndexedDB naming in `persistence/tldrawLocalDb.ts` (pinned by a test that reads tldraw's own source)
and the API notes in `docs/`. Re-read both before upgrading.

**Rollups must not recompute while dragging.** `e2e/perf.spec.ts` asserts exactly zero re-aggregations
during a drag on a 500-node board. In dev, a badge in the bottom-left shows the counters live. If that
number starts climbing during drags, the facts `isEqual` stage has been broken.

**tldraw persists on a 350 ms throttle and does not flush on unload.** Two consequences the app works
around: leaving a board keeps its editor mounted briefly so the write lands (`DRAIN_MS` in
`app/App.tsx`), and backup export waits out the window before reading from disk. Both are load-bearing
— removing either silently loses the last edit.

**No storage or file APIs outside `platform/` and `persistence/`.** That rule is what keeps the Tauri
port to one new file (`TauriPlatformAdapter`).

## Deliberate deviations from the original plan

- **tldraw 5.2.5, not v4.** v4 was current when the plan was written. Every API the plan relies on
  exists in 5.x; the deltas are recorded in `docs/tldraw-api-notes.md`.
- **Markdown editing is source-based (a textarea), not TipTap.** Markdown is the source of truth, so
  editing the string is lossless — a rich-text editor round-trips through its own AST and quietly
  reformats what it doesn't model. It also avoids the two-ProseMirror focus conflict the plan flagged
  as a risk. Display still uses `react-markdown` + GFM as planned. WYSIWYG remains a possible
  follow-up.
- **Dark theme only.** Every node component is styled dark; a light theme means restyling them, not
  flipping a flag. Thumbnails are exported in the same dark theme, so a preview looks like the board
  you left.
- **The canvas style panel is removed.** None of the node types have style props, so it only ever
  applied to tldraw's built-in shapes. Their colour and size now come from tldraw's defaults.

## Status

MVP milestones 1–10 are implemented and verified: 69 unit tests, 25 Playwright specs covering board
CRUD, per-board persistence, node editing and undo granularity, live rollups, image
downscaling/dedupe/GC, backup round-trip, offline operation, the zero-recompute guarantee, the
double-click create menu, dotted paper, and board thumbnails.

Not started (Phase 2+): sync to a self-hosted server, Tauri packaging, table/chart nodes, live API
nodes, the sandboxed plugin runtime.

A free tldraw hobby licence key is still needed before any production deploy; the "made with tldraw"
watermark stays.
