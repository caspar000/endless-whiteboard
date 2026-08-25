# Lifeboard

An infinite-canvas whiteboard where **every element is a typed node** — not just stickies and images,
but markdown notes, properties on any shape, and live table views computed over them. Node types
arrive as **extensions** (toggleable in Settings, each its own package), so the set of things a board
can hold is open-ended by design.

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
| `pnpm test` | Vitest units (properties, facts, table queries, collections, registry, snapshot fixtures) |
| `pnpm test:e2e` | Playwright, against the **production build**. Serves on 4173; set `LB_E2E_PORT` to run two checkouts at once |
| `pnpm --filter @lifeboard/web gen:icons` | Regenerate PWA icons from `public/favicon.svg` |
| `pnpm agent` | Run the agent host by hand — only needed against a production build, since `pnpm dev` starts it |

## The two screens

**Home** — a sidebar (All boards / Recents / Favourites / Storage, with live counts) beside a grid of
board cards, modelled on Freeform's board browser. Each card's preview is that board's own thumbnail,
captured from the live editor as the board is closed; boards never opened show a dotted-paper
placeholder. Star a board to pin it to Favourites.

Both screens share a third surface: **the agent panel**, docked to the right of the tab strip
(<kbd>⌘⇧A</kbd>). It runs Claude Code against the board you are looking at — ask it to research
something and add what it finds, and you watch the nodes appear. It gets the board operations and web
search and nothing else: no shell, no filesystem. Every change is a normal undo step. There is
nothing to configure; `pnpm dev` starts the process behind it. Its composer carries a **model** and a
**reasoning** picker, so a request that is really three tool calls does not get answered at the effort
Claude Code would spend on writing code; changing either steers the conversation already running
rather than starting a new one. Beside them is a **context-window ring**, because a full window has no
error message — it just quietly forgets the top of the conversation. A running turn shows one live
line — `Working for 1m 4s` — and folds its work behind `Worked for 1m 12s` once it settles, keeping the
reply; long requests collapse behind **Show full message**; runs of tool calls group into one row; and a
tick per question down the right edge jumps you back through the conversation. Replies render as
markdown, the box grows as you type, and a tool call opens to show what it was given. Every message carries the board
on screen and your current selection, so “name these” needs no explaining and the agent never opens a
turn by asking what it is looking at. See [`packages/agent-host`](packages/agent-host/README.md).

**Board** — the endless canvas on dotted paper, with a registry-driven toolbar (the bottom dock).
Nodes are drawn from the dock like every other tool; right-click offers "Add to board" for placing
one at the pointer. Double-clicking empty canvas is tldraw's default action. Double-clicking the
board's name in the tab strip renames it.

## Nodes & extensions

The live node types ship as extensions — each a bag of node definitions the app registers at startup
and the user can toggle in **Settings → Extensions**:

| Extension | Node | What it holds | Toolbar |
|---|---|---|---|
| **Markdown notes** (`@lifeboard/note-markdown`) | `node.markdown` | Markdown with Obsidian-style live preview. Grows with its content. | <kbd>m</kbd> |
| **Tables & views** (in node-kit) | `node.table` | One card, four views of the same question: a table (grouping, filters, totals), one big number, a kanban, or a calendar. The last two *arrange the real cards on your board* — drop a sticky in a lane and it takes that status; set the status anywhere and it walks into the lane by itself. | — |
| **Books** (`@lifeboard/book-reader`) | `node.book`, `node.quote` | A dropped PDF/EPUB/MOBI/FB2/CBZ/CBR as a cover card, a full-screen reader that remembers its place, and passages taken out of it as quote cards linked back to the page. | — |

Turning an extension off removes its tools, menu entries and shortcuts; **its shapes stay on your
boards and keep rendering**, because enablement hides types from creation UI without ever touching
the schema. Any shape — ours or tldraw's — can carry typed properties (`price: ₾2399`); a view's *rows*
are pure derivations, computed from the board and never written back to it, so undo history stays clean
and there are no feedback loops. A kanban or a calendar additionally writes **position** — it stands
your real cards in its lanes — under one rule that keeps that safe: position is an *output* of a view
and never an input to one, so membership is always the query's answer and never what a shape overlaps.
See `docs/views-plan.md`.

Two legacy types (`node.item`, `node.rollup`) remain registered but hidden: store migrations rewrite
them into notes-with-properties and tables the first time an old board loads.

## Layout

```
apps/web/                 the app (Vite + React 19 + TS strict, PWA)
  src/app/                routing, home screen (sidebar + card grid)
  src/app/settings/       the settings page: its rail of tabs, and the extension pages under one
  src/app/help/           the help page: sections.tsx is the whole contents, one file per section
  src/agent/              the agent bridge: wire protocol, board capability, prefs, the socket, chat
  src/app/AgentPanel.tsx  the agent panel — the transcript and composer down the right-hand side
  vite/agentHost.ts       dev-server plugin that starts the agent host, so the panel needs no setup
  src/app/appCommands.ts  the app's own commands — where ⌘K's app and canvas verbs are registered
  src/app/CommandPalette.tsx  ⌘K, as a view over the command registry
  src/boards/             board index, delete sequencing, first-run demo
  src/canvas/             <Board> wrapper, dotted paper, toolbar, selection toolbar, debug badge
  src/canvas/insertNode.ts  placing a node, + the "Add <node>" commands generated from the registry
  src/extensions.ts       the composition root — which extensions this build ships, and their toggles
  src/platform/           PlatformAdapter (the entire future Tauri port surface)
  src/persistence/        asset store, downscaling, thumbnails, backup zip, tldraw-internals wrapper
packages/node-kit/        @lifeboard/node-kit — the smart-node system (the SDK)
  src/registry.tsx        NodeDefinition + registry + createNodeShapeUtil  ← the load-bearing seam
  src/commands.ts         Command + registry — every command surface reads this one table
  src/operations.ts       Operation + registry — the parameterised table agents drive the app through
  src/extensions.ts       Extension: the unit the app composes, users toggle, and plugins ship as
  src/fields.ts           field types, coercion, currency formatting
  src/facts.ts            the "what data does this node expose" contract
  src/nodes/*/            item, rollup (legacy, schema-only), table (+ its extension)
packages/note-markdown/   @lifeboard/note-markdown — the markdown note, as a default extension
packages/book-reader/     @lifeboard/book-reader — books & quotes: import, reader, Open Library
packages/mcp-server/      @lifeboard/mcp-server — the MCP server agents connect to (Node, not bundled)
packages/agent-host/      @lifeboard/agent-host — runs Claude Code behind the in-app agent panel
docs/tldraw-api-notes.md  pinned tldraw API surface and v5 deltas — read before upgrading
```

`node-kit` is a package, not a folder, because it is exactly the code that becomes the plugin SDK,
gets reused by a future sync server for schema/validation, and ships unchanged into a Tauri build.
`note-markdown` is the first extension extracted through that SDK: it reaches the host only through
node-kit's public barrel, which is what proves the SDK surface is sufficient for an extension
written outside the host.

## How extensions work

An `Extension` is a named bag of contributions — node definitions, and optionally commands — with
an id, a display name, an icon and a version for the Settings card:

- **Composing.** `apps/web/src/extensions.ts` is the composition root: one `registerExtension` line
  per extension this build ships. `Board.tsx` imports it first, so the registry is populated before
  any module reads it at module scope.
- **Toggling.** Settings is a rail of tabs (Obsidian's shape), one of which is Extensions: a card
  per extension with a switch, and each card opens the extension's own page — long description, the
  switch again, and a "what it adds" list *derived from the manifest* (node types, commands, agent
  operations, file types it opens, context-menu actions), so a third-party extension gets the same
  page for free.
  Off means *stop offering*: the dock button, context-menu entry and shortcut disappear — live, no
  board remount — but the extension's shape types stay registered with the schema, so existing
  boards keep opening and its shapes keep rendering. The disabled set persists in localStorage.
- **Reactivity.** The registry owns its own tiny store (`subscribeToNodeDefinitions` +
  `useSyncExternalStore`), deliberately not a tldraw atom: under Vite's dev prebundling the SDK and
  the app can hold two copies of tldraw's signal library, and dependency tracking never crosses
  that boundary.
- **Writing one.** A new package with a `NodeDefinition` (props validators, migrations from v1, a
  component, an icon, optionally a `kbd` letter), wrapped in an `Extension`, plus a
  `TLGlobalShapePropsMap` augmentation for its type. Everything else — shape util, tool, dock
  button, menus, properties, tables — follows from the registry.

## Agents (MCP)

A coding agent can drive a board — create boards, add nodes, set properties, draw relations, query
— through `@lifeboard/mcp-server`. Off by default; see that package's README for setup.

- **Two tables, not one.** A `Command` is a *button*: `run(ctx)` takes no arguments and returns
  nothing, which is right for a palette row and wrong for an agent. Operations
  (`packages/node-kit/src/operations.ts`) are its sibling — named parameters in, a structured answer
  out, a readable failure when something is wrong. `commandFromOperation` projects a zero-argument
  operation onto a command, so capability both a person and an agent should have is authored once.
- **The schema is generated.** `ParamSpec` declares arguments as data; the TypeScript type `run`
  receives *and* the JSON Schema the agent is shown both come from it, so they cannot drift.
- **It runs in the live editor.** The app connects out to the server (a tab cannot listen on a
  port), and operations act on the mounted tldraw editor — so the property sidecar, store
  migrations, auto-height and rendering all behave exactly as they do by hand, and you watch it
  happen. One `markHistoryStoppingPoint` per operation means ⌘Z takes an agent back one action at a
  time. `board.delete` is the exception and asks for confirmation: it is the only operation with no
  undo entry to return to.
- **Nothing is hardcoded.** The MCP server holds no list of tools — the tab reports what it offers
  and the server projects it, so an extension that contributes an operation contributes a tool.
- **It can see the board, not only read it.** `view.look` renders the board — everything, the
  viewport, the selection, or named shapes — and returns the pixels as an image content block beside
  the JSON (`OperationResult.images`). Coordinates cannot say what a photograph shows or whether a
  layout is aligned; this is the only thing that can. `view.selection` answers the other half of it:
  what the user is pointing at when they say "these ones".
- **It draws the board's own shapes too.** `node.insert` takes tldraw's `text`, `note`, `geo` and
  `frame` beside the registered node types (`packages/node-kit/src/nodes/native.ts`) — a small table
  of *how to create one*, deliberately not registry entries, since registering `text` there would
  replace tldraw's own shape util with an imitation of it.
- **You can watch it work.** Operations report what they touch to a presence channel
  (`agentPresence.ts`); the board draws a cursor there with the verb on it and rings the shapes
  involved (`canvas/AgentPresence.tsx`). node-kit owns the channel and the app owns the drawing, so
  the SDK stays free of the DOM.
- **Consent and reach.** Loopback only, token *and* `Origin` checked, off by default, with a
  read-only mode that withholds every operation that would change anything. See the package README
  for what each gate is actually worth.

## The note's live preview

Writing is the default action, so the note is worth understanding. The editor is **CodeMirror 6**
with our own live-preview decorations (`@lifeboard/note-markdown`, `livePreview.ts`): markdown
renders in place, and the raw syntax appears only on the lines the selection touches — hiding
markers under the caret would mean typing into characters you cannot see.

Two things about it are load-bearing:

- **The document is never transformed.** It stays the markdown string, byte for byte — which the
  property system, the table pipeline, backup export and the note's props migrations all rely on.
  Decorations are presentation only: marker characters are `Decoration.replace`d, delimited spans
  get a class, a task's `[ ]` becomes a real checkbox widget. (This is also why CodeMirror over a
  block editor: BlockSuite/Lexical/ProseMirror make markdown a lossy serialisation of their own
  document model.)
- **One editing session is one undo entry.** The session owns the text and commits to `props.md`
  once, so board-level undo never steps through keystrokes.

Display mode renders through `react-markdown` + GFM (no raw HTML — there is no injection surface to
sanitise), with `remark-breaks` so Enter always starts a visible new line.

## Things worth knowing before you change something

**Adding a node type** means writing a `NodeDefinition`, wrapping it in an `Extension`, and adding
one `registerExtension` line to the composition root — nothing else. Shape util, canvas tool, dock
button, keyboard shortcut, context-menu entry, the Settings card and table participation all follow
from the registry. There is deliberately no per-node-type branching in the UI.

**Adding a command** means one `registerCommand` call — an id, a title, a group, optionally a `when`
predicate and a default `kbd`. `packages/node-kit/src/commands.ts` is the one table every command
surface reads: today the ⌘K palette renders it *and* the Help page's shortcut list is generated from
it, so a binding is documented by the command existing rather than by someone remembering to add a
row. A user-rebindable keymap and generated tldraw overrides are each one more implementation over
the same rows. The palette contains no per-command branching, for the same reason the dock contains
none per node type. Extensions contribute through `Extension.commands`, and disabling one hides its
commands exactly as it hides its nodes.

Two rules that fall out of this. `when` is *availability*, not existence — the palette applies it
(Duplicate is not offered with an empty selection) and the Help page deliberately does not, because a
reference documents what exists. And anything derived from a node type — the generated "Add …"
commands in `canvas/insertNode.ts` — is registered with that node's owner (`getNodeOwner`), so one
extension toggle takes the node and everything generated from it out of the UI together.

**The palette blurs the board while it is open.** tldraw reads keys off the *document* and gates
them on `editor.getIsFocused()`, so `App.tsx` passes `null` to `focusOnly` whenever `paletteOpen` is
set. Without that, every letter typed into the palette would also switch the canvas tool underneath
it. ⌘K itself is a capture-phase `window` listener rather than a tldraw action, because that same
focus gate would make an action dead everywhere except an open board.

**Frames are outlines, not cards.** `Board.tsx` replaces the built-in `frame` util with
`FrameShapeUtil.configure({ showColors: true, getCustomDisplayValues })` — the first flag registers the
frame's existing `color` prop as a real `DefaultColorStyle` style prop (so the border, heading and label
all derive from it and `setStyleForSelectedShapes` reaches it), the second blanks the fill. Replacing a
built-in works because `<Tldraw>` merges `shapeUtils` by shape type. No migration: `color` was always in
the schema, `showColors` only decides whether it is a *style* prop and what renders from it.

**Rounded corners for frames and images** come from Settings → Appearance, on at `sm` by default. A
`data-roundness` attribute on `<html>` resolves to `--lb-shape-radius`, which reaches the frame's `<rect>`
(via the SVG `rx`/`ry` geometry properties) and the image's container. A CSS variable rather than props,
because both elements belong to tldraw. Deliberately in shape units, not screen pixels: unlike the frame's
border width, a corner radius is part of the shape and should scale with it.

**Colour is one swatch, for anything that has one.** The selection toolbar shows a single swatch that
opens a palette above it, mirroring the dock's pen expansion. Which shapes get it comes from tldraw's own
`getSharedStyles().get(DefaultColorStyle)` rather than a list of types, so a shape we don't know about
gets the control for free. The swatch is a **ring** when the colour only paints an outline (a frame, a
`fill: 'none'` rectangle) and a **filled dot** when it paints an area (a sticky) — restricted to `frame`
and `geo`, because a pen stroke has a `fill` prop too but its colour is ink either way.

**The canvas chrome is customised through `canvasComponents` in `canvas/Board.tsx`**: our paper
replaces tldraw's `Background` (rather than enabling grid mode, which would also snap movement), the
bottom dock replaces its `Toolbar`, the selection toolbar renders `InFrontOfTheCanvas`, and the
`MenuPanel`/`StylePanel`/`Grid` slots are removed — each removal has a comment in the file saying
why. Double-click on empty canvas is deliberately tldraw's own again: claiming it board-wide meant
every near-miss left a note behind.

**Board thumbnails are captured when you press "← Boards", not on unmount** — and that timing is
load-bearing. Exporting from the editor's unmount path runs while the board host is
`visibility: hidden` for the persistence drain, and tldraw's exporter then produces an image with every
node background and font missing: previews looked correct for about a second and then decayed into
serif text on white. `captureActiveThumbnail` in `app/App.tsx` captures while the board is still on
screen, and awaits it (bounded by a timeout) so navigation can't outrun the export.

**The shape type id is `node.markdown`, but the product calls it a Note.** Renaming a persisted type
id needs a store-scoped migration rewriting every record, for a cosmetic gain. `NOTE_NODE_TYPE`
(exported by `@lifeboard/note-markdown`) is the name to use in code.

**Changing a node's props requires a migration.** `apps/web/src/persistence/snapshot-fixtures.test.ts`
loads a real snapshot from every released schema and fails if a migration is missing — verified to
catch it. See `src/persistence/fixtures/README.md` for how to add a fixture.

**tldraw is pinned to an exact version (5.2.5).** Two files depend on its internals — the local
IndexedDB naming in `persistence/tldrawLocalDb.ts` (pinned by a test that reads tldraw's own source)
and the API notes in `docs/`. Re-read both before upgrading.

**Aggregations must not recompute while dragging.** `e2e/perf.spec.ts` asserts exactly zero
re-aggregations during a drag on a 500-node board. In dev, a badge in the bottom-left shows the
counters live. If that number starts climbing during drags, the facts `isEqual` stage has been broken.

**tldraw persists on a 350 ms throttle and does not flush on unload.** Two consequences the app works
around: leaving a board keeps its editor mounted briefly so the write lands (`DRAIN_MS` in
`app/App.tsx`), and backup export waits out the window before reading from disk. Both are load-bearing
— removing either silently loses the last edit.

**No storage or file APIs outside `platform/` and `persistence/`.** That rule is what keeps the Tauri
port to one new file (`TauriPlatformAdapter`).

## Deliberate deviations from the original plan

- **tldraw 5.2.5, not v4.** v4 was current when the plan was written. Every API the plan relies on
  exists in 5.x; the deltas are recorded in `docs/tldraw-api-notes.md`.
- **Markdown editing is source-based (CodeMirror 6 with live-preview decorations), not TipTap.**
  Markdown is the source of truth, so editing the string is lossless — a rich-text editor
  round-trips through its own AST and quietly reformats what it doesn't model. It also avoids the
  two-ProseMirror focus conflict the plan flagged as a risk. Display still uses `react-markdown` +
  GFM as planned.
- **Money is per shape, and conversion is opt-in.** A `financial` value carries its own currency
  (`lifeboard:propUnits` on the shape); the property definition's unit is only the default a new value
  inherits. Rates come from open.er-api.com once per provider-update window, cached in KV, and a stale
  table is used and labelled rather than failing a total — `rateBetween` returns `null` for an unknown
  currency instead of 1, because treating an unconvertible value as one-to-one is how a total comes out
  confident and wrong. Per column you choose what to show the total in and which currencies take part;
  per table you can hand-enter rates that beat the fetched ones. Money is converted *before* it is
  reduced, sorted or filtered — reduced first, `max` picks the largest number regardless of currency —
  and grouping by a money column's currency gives a subtotal per currency with nothing converted at all.
- **A `link` property type.** A title and a URL, on any shape. Stored as one string in markdown's own
  link syntax (`[title](url)`) rather than as an object, because property values are bounded to JSON
  scalars — `areValueRecordsEqual` compares one level deep, and that shallowness is what keeps dragging
  free of rollup recomputes. The panel edits it as two boxes; on the card the title is a link that opens
  in a **new tab**, which is what makes it clickable at all, since markdown links inside a note stay
  inert precisely because navigating away would take the board with it. The URL is scheme-allow-listed
  (`http`, `https`, `mailto`) in `properties/url.ts` rather than denied, because a `javascript:` or
  `data:` href built from typed text runs script in the app's own origin. A rejected URL still shows its
  title — as plain text, never as a link.
- **Light and dark themes, plus "system".** Settings → Appearance. Dark is the default and the
  original design. Every colour in `styles.css` goes through a `--lb-*` token, so a theme is a palette
  swap: `:root` is dark and `:root[data-theme='light']` overrides it, with `data-theme` always a
  resolved `light` or `dark` (`app/useTheme.ts` does the resolving, and `index.html` repeats it inline
  so a light-mode load doesn't flash dark). tldraw follows via its user preference rather than the
  `colorScheme` prop, which would remount every editor. Thumbnails are exported in the active theme,
  so a preview looks like the board you left. A theme change re-exports every board that still has a
  mounted editor — including inactive tabs, which needs `data-exporting` to swap their
  `visibility: hidden` for a clip, because tldraw's exporter drops HTML-backed shapes it considers
  invisible. Boards with no mounted editor have nothing to export from, so their previews are dropped
  and rebuilt the next time each is opened.
- **Grid and snapping are two settings, not one.** tldraw has a single `isGridMode` flag that both
  draws its grid and snaps dragging to it, and it is *per-board session state* — which is how one board
  ends up with a grid the others don't have, since ⌘' is easy to hit by accident. Settings → Canvas
  owns all of it app-wide instead: **Grid** on/off (on by default), **Grid style** (our dotted paper or
  tldraw's, ours by default), and **Snap to grid** (off by default). The grid is drawn from tldraw's
  `Background` slot with `Grid: null`, because tldraw only renders its own grid while `isGridMode` is on
  — going through that slot would re-couple the two. `isGridMode` is therefore used purely as the
  snapping flag, and tldraw's ⌘' action is removed so it can't drift per board again.
- **The canvas style panel is removed.** None of the node types have style props, so it only ever
  applied to tldraw's built-in shapes. Their colour and size now come from tldraw's defaults.

## Status

MVP milestones 1–10 are implemented and verified, plus the property system, tables, collections,
inline expressions, the extension split, the command registry and ⌘K palette, and the agent/MCP
surface: ~690 unit tests across four packages, and Playwright suites covering board CRUD, per-board
persistence, note editing and undo granularity, live aggregation, image downscaling/dedupe/GC,
backup round-trip, offline operation, the zero-recompute guarantee, dotted paper, board thumbnails,
the palette, and an agent building a board end to end over the real bridge.

Not started (Phase 2+): sync to a self-hosted server, Tauri packaging, chart nodes, live API nodes,
the org-mode note extension, and the *runtime-loaded* plugin path (the compile-time extension system
is in; sandboxing and a placeholder shape util for uninstalled plugins are what remain).

A free tldraw hobby licence key is still needed before any production deploy; the "made with tldraw"
watermark stays.
