# Replacing tldraw with an open-source engine — options

Status: **Research, no decision yet.** Written 2026-10-05. Figures were checked against npm, GitHub and
the installed packages that day.

Why this exists: tldraw's licence forbids production use without a key, forbids touching the key
check, and makes any paid offering need a commercial licence with prices set by its sales team. The
owner does not accept those terms, so this compares every truly open-source way out.

---

## The short version

1. **Not all of tldraw is under the tldraw licence.** The data layer is MIT: `@tldraw/store`,
   `@tldraw/tlschema`, `@tldraw/state`, `@tldraw/state-react`, `@tldraw/utils` and `@tldraw/validate`
   (checked in `node_modules`: each ships an MIT `LICENSE.md`). The licensed part is the editor and
   UI (`@tldraw/editor`, `tldraw`) and sync (`@tldraw/sync`, `@tldraw/sync-core`). Every board we have
   stored is MIT-licensed data, and can stay in its format.
2. **The last open tldraw is a complete editor.** `@tldraw/editor` and `@tldraw/tldraw`
   `2.0.0-alpha.19` (published 2023-12-12) are **Apache-2.0**, and tldraw's announcement of the change
   says "the pre-release 2.x versions released until Apache-2.0 will remain licensed under Apache-2.0".
   It has the same architecture our code is written against: `Editor` (9,400 lines), `ShapeUtil` and
   `BaseBoxShapeUtil`, `HTMLContainer`, every default shape and tool, snapping, undo, drop targets,
   SVG export. And no licence manager.
3. **No other open-source framework fits.** Excalidraw is healthy but can't layer anything over a
   custom React element and has no rich text. AFFiNE's BlockSuite is the closest in features but is
   Lit, vendored from a monorepo, with a licence mismatch. React Flow is great for nodes and has none
   of the drawing. Details below.
4. **Recommendation: fork the Apache-2.0 tldraw editor and move it onto the current MIT data layer**,
   writing what it lacks (separate binding records, rich text, sync) ourselves. Rough size: **17–28
   person-weeks**, against **35–55** for an engine from scratch, and boards keep their format.

---

## What "parity" means here

From an inventory of this repo (2026-10-05):

- **146 of 471 TypeScript files import tldraw** — about 27,500 of 83,400 lines. 74 files take an
  `Editor`, 51 use shape types, 36 read `shape.meta`. 86 distinct `editor.*` methods are called.
- **Custom shapes:** seven node types through one adapter, `createNodeShapeUtil` in
  `packages/node-kit/src/registry.tsx` (a `BaseBoxShapeUtil` per `NodeDefinition`, components in
  `HTMLContainer`, drop targets, auto-height, `canBind`, `canScroll`).
- **Overridden built-ins:** note and text (`{…}` expressions), geo (fill colour in meta), arrow
  (hidden relations), frame (transparent, colourable).
- **Relations are arrows with bindings at both ends** (`node-kit/src/edges.ts`, `relations.ts`).
- **Rich text** is TipTap inside tldraw's text editing, with our expression-suggest extension.
- **Signals** drive the zero-recompute guarantee for tables and rollups (`computed`,
  `createComputedCache` from `@tldraw/state` — MIT).
- **Persistence:** tldraw's IndexedDB, read directly in `persistence/tldrawLocalDb.ts`.
  **Sync:** `@tldraw/sync` on the client, `TLSocketRoom` on the server (both licensed).
- **Users rely on:** draw, highlight, eraser, geo, arrow, text, note, frame, image (with crop), video,
  bookmark, embed; multi-select, transform, snapping, undo, camera, PNG/SVG export.
- **Tests:** all 14 e2e specs drive `window.editor` and `.tl-*` selectors.

Already engine-agnostic: the collection engine, queries, kanban/calendar layout, aggregation,
property formatting, most node components (book card, roll card, the CodeMirror note editor), the MCP
server and agent host, and the self-hosting server apart from its sync rooms.

---

## The candidates

### A. Fork tldraw 2.0.0-alpha.19 (Apache-2.0) onto the current MIT data layer — recommended

**What it is.** Take the last Apache-2.0 editor and default shapes, rename it (Apache-2.0 allows forks;
tldraw's trademark does not come with it), and run it on today's MIT `store`, `tlschema` and `state`
packages, which define the records our boards already use — including binding records and `richText`
props.

**What it already has** (checked in the published package): the `Editor` with history, side effects,
snapping, click and text managers; `ShapeUtil`, `BaseBoxShapeUtil`, `HTMLContainer`; arrow, bookmark,
draw, embed, frame, geo, highlight, image, line, note, text and video shapes; select, eraser, hand,
laser and zoom tools; `onDragShapesOver`, `canReceiveNewChildrenOfType`, `canBind`, `canScroll`; SVG
export; touch input.

**What it lacks, compared with what we use from 5.5:**

| Gap | Why it matters | Rough size |
|---|---|---|
| Moving the editor onto the 2026 MIT store/schema/state | Keeps every stored board readable as is | 2–4 wks |
| Bindings as separate records (2023 arrows kept their binding in their own props) | Relations are built on them | 2–3 wks |
| Rich text in text, note, geo and arrow labels (2023 was plain text) | Stored boards hold TipTap JSON; the `{…}` helper lives in TipTap | 2–3 wks |
| Sync and offline (tldraw sync came in 2024) | The self-hosting work needs a replacement for `TLSocketRoom` | 3–4 wks |
| Smaller 5.x APIs we use: `configure()` on shape utils, shape visibility, the asset store interface, `toImage` | Used by frames, hidden relations, uploads, thumbnails | 1–2 wks |
| Porting Lifeboard to the fork's API (146 files, mostly the same names) | | 3–5 wks |
| Two years of upstream fixes we won't get | Edge cases in transforms, arrows, text | 3–5 wks, spread out |
| **Total** | | **17–28 person-weeks** |

**Sync options for the fork:**
- *Our own server-authoritative protocol on the MIT store.* `@tldraw/store` already produces record
  diffs and applies remote ones (`listen`, `mergeRemoteChanges`). The server keeps the SQLite room
  files we have. Smallest change from what is built.
- *Yjs* (MIT) with Hocuspocus (MIT, Node, SQLite). Offline, presence and a CRDT for free; the cost is
  a two-way binding between the store and a `Y.Doc`. Pays off if real offline editing on mobile
  matters, which it does in the mobile phase.

**Risks.**
- **We maintain an editor alone.** No upstream; every fix is ours.
- **Clean-room discipline.** Anything added to the fork must be written independently. Copying from
  tldraw 2.0+ source (licensed) into an Apache fork would breach that licence. The 2023 code, the MIT
  packages and tldraw's public docs are fair to learn from; the licensed source is not. This
  assistant has read licensed 5.5 source in this project, so treat code it writes for the fork with
  that in mind, and get a lawyer's view before selling.
- **Apache-2.0 obligations:** keep the licence and `NOTICE`, mark modified files. Easy.

### B. Our own engine on the MIT data layer

**What it is.** A hybrid DOM engine of our own — one CSS-transformed layer, shapes as React
components, SVG for geo, arrows and ink — with tldraw's MIT store, schema and signals underneath.

**Stack (all MIT):** `@tldraw/store`/`tlschema`/`state`, `rbush` (hit-testing, culling),
`perfect-freehand` (ink, the library tldraw itself uses), TipTap (core is MIT; several former Pro
extensions went MIT in 2025), CodeMirror, Yjs + Hocuspocus or our own diff sync, `snapdom` for PNG
export.

**Size:** **35–55 person-weeks**:

| Subsystem | Person-weeks |
|---|---|
| Camera, pointer pipeline, tool state machine, culling | 3–4 |
| Store binding, schema migrations | 2–3 |
| Selection, lasso, multi-shape resize/rotate, snapping | 4–6 |
| Geo shapes and styles | 2 |
| Freehand and eraser | 1–2 |
| Arrows bound to outlines (labels, re-routing) | 3–5 |
| Frames (reparenting, clipping) | 2 |
| Rich text, stickies, auto-size | 2–3 |
| Images and assets | 1–2 |
| Clipboard | 1–2 |
| Undo across local and remote changes | 1–2 |
| PNG/SVG export | 2–3 |
| Multiplayer, presence, offline | 3–4 |
| Touch and mobile | 2–3 |
| Keyboard, accessibility, performance | 2–4 |
| Porting Lifeboard | 4–8 |

**Why not first:** it rebuilds what option A already has, and the hard parts — arrow binding and
transform edge cases — are exactly where the 2023 code has years of work in it. Option B is the
fallback if the fork turns out too tangled to modernise.

### C. AFFiNE BlockSuite "edgeless" — closest in features, wrong in shape

- **Licence:** the old standalone repo says MPL-2.0; the npm packages and AFFiNE's monorepo say MIT
  for this code. Unresolved. MPL would be file-level copyleft (share changes to its files, not the app).
  AFFiNE's own sync server is under an Enterprise licence and can't be reused.
- **Health:** the standalone repo stopped in July 2025 and npm is frozen at 0.22.4; development
  continues inside AFFiNE (`blocksuite/`, 0.27.x). Using it means vendoring from a monorepo.
- **Fit:** brush, connectors, frames, rich-text note blocks, shapes, images, a database view, Yjs as
  the native data model (offline and self-hosted sync come easily). AFFiNE ships mobile apps on
  Capacitor.
- **Against:** every block is a Lit web component — React nodes need a portal bridge with no public
  API; a new data model (Yjs blocks), so every board and every node is rewritten; stale docs, a
  moving API. Effectively a full rewrite into someone else's framework.

### D. React Flow (xyflow) plus our own drawing tools

- **Licence:** MIT; xyflow sells "Pro" *examples* (undo/redo, Yjs collaboration, freehand, helper
  lines), not library features. The Pro terms forbid redistributing them and include a vague
  non-compete, so we'd write those parts ourselves.
- **Fit:** nodes are real React components, with sub-flows, resizing, multi-select, touch, culling.
- **Against:** xyflow's own docs say it "is not made for creating whiteboard applications". Edges
  attach to handles, not shape outlines; no rotation, multi-shape transform, ink, geo shapes, rich
  text, export or undo. That is most of option B's list again, on a model built for flowcharts.

### E. Excalidraw — the healthiest project, a poor fit

- **Licence:** MIT; 133k stars, active. Excalidraw+ (hosted, paid) on an MIT core is the business
  model the owner has in mind, which proves it can work.
- **Fit for drawing:** excellent — freehand, shapes, bound and elbow arrows, frames, image crop,
  snapping, undo, export, touch.
- **Blockers for Lifeboard:**
  - Custom React content only through embeddables, which **always paint above every other element**.
    A maintainer closed the request to change this as "isn't feasible performance-wise" (issue #12101).
    So no arrow, sticky or highlight could ever sit on a note, a table or a book.
  - **No rich text** (open requests #6678, #1126).
  - True custom elements (#4957) have been open since 2022.
- **Sync:** a socket.io relay, or small Yjs bindings (`y-excalidraw`, 38 stars).

### F. Plait / Drawnix

- **Licence:** MIT; Worktile backs it, Drawnix has 14.9k stars.
- **Against:** Angular-first (React layer at 0.4.0), SVG rendering, no sync backend, no
  frames-as-containers found, docs mostly in Chinese. Custom React nodes would need an unproven bridge.

### Not viable

- **tldraw v1** (MIT, archived January 2024): an older architecture without frames or a sync story,
  further from our code than the 2023 Apache release.
- **Logseq's tldraw fork:** AGPL-3.0 — its network clause bites the moment hosted sync is sold — and
  Logseq has dropped whiteboards.
- **Konva, Fabric.js, PixiJS, Leafer** (MIT): renderers. Interactive React content inside them means
  DOM overlays above the canvas: Excalidraw's z-order problem again.
- **matrix-neoboard** (Apache-2.0): an app bound to Matrix rooms, not a library.
  **maxGraph** (Apache-2.0): a diagram editor. **JointJS:** the useful parts are commercial.
  **dgmjs:** GPL. **Penpot, Graphite:** applications.

---

## Side by side

| | A. Fork 2023 tldraw | B. Own engine | C. BlockSuite | D. React Flow | E. Excalidraw |
|---|---|---|---|---|---|
| Licence | Apache-2.0 + MIT | MIT | MPL-2.0 or MIT (unclear) | MIT | MIT |
| React nodes as first-class shapes | yes | yes | via Lit bridge | yes | no — always on top |
| Drawing tools | yes | build | yes | build | yes |
| Arrows bound to shapes | yes (2023 form) | build | connectors | handles only | yes |
| Rich text | add (TipTap) | build | yes | build | no |
| Frames as containers | yes | build | yes | sub-flows | yes |
| Sync / offline | add | add | Yjs native | add | relay / small Yjs lib |
| Existing boards | keep format | keep format | rewrite | rewrite | rewrite |
| Lifeboard code | port, same API shape | port to new API | rewrite | rewrite | rewrite |
| Size | **17–28 pw** | 35–55 pw | 30–50 pw (est.) | 35–50 pw (est.) | not reachable |
| Upstream | none (fork) | none | AFFiNE, moving | xyflow | Excalidraw |

Sizes are rough, for one experienced developer working full time, and assume no surprises.

---

## What survives any of these

- The self-hosting server: login, vault index, settings, assets, GC, export, moving boards. Only
  `apps/server/src/rooms.ts` (the `TLSocketRoom` part) and the client's `useSync` call change.
- The node system's logic: collections, queries, views, properties, formatting, aggregation.
- The node components themselves, the MCP server, the agent host.
- With options A and B, every stored board, backup and fixture, because the record format is MIT and
  stays.

---

## Decisions this needs

1. **Which option.** Recommended: A, with B as the fallback.
2. **Sync for the fork:** our own diff protocol on the MIT store (closest to what is built) or Yjs
   (offline for free, more binding work). Recommended: our own now, Yjs if the mobile phase needs true
   offline editing.
3. **When.** Before deploying, so we never ship on licensed code; or after, deploying first behind a
   trial key and migrating once the fork is ready.
4. **A legal check before selling anything**, on the clean-room point above.

## Sources

- tldraw licence change, 2023-12-20: https://tldraw.dev/blog/license-update-for-the-tldraw-sdk
- tldraw licence: https://github.com/tldraw/tldraw/blob/main/LICENSE.md
- MIT data layer: `packages/store/LICENSE.md` etc. in https://github.com/tldraw/tldraw
- Apache release: `npm view @tldraw/editor@2.0.0-alpha.19 license` → `Apache-2.0`
- Excalidraw embeds always on top: https://github.com/excalidraw/excalidraw/issues/12101
- Excalidraw custom elements: https://github.com/excalidraw/excalidraw/issues/4957
- BlockSuite in AFFiNE: https://github.com/toeverything/AFFiNE/tree/canary/blocksuite
- React Flow on whiteboards: https://reactflow.dev/learn/advanced-use/whiteboard
- React Flow Pro terms: https://xyflow.com/pro-license
- Plait / Drawnix: https://github.com/worktile/plait, https://github.com/plait-board/drawnix
- tldraw v1: https://github.com/tldraw/tldraw-v1
- Hocuspocus 4: https://tiptap.dev/blog/release-notes/hocuspocus-4-stable-release
- TipTap open-sourcing: https://tiptap.dev/blog/release-notes/were-open-sourcing-more-of-tiptap
