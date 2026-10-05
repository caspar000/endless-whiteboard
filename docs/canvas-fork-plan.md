# Moving Lifeboard onto an open-source canvas — the plan

Status: **Phase 0 done** (2026-10-05). Phase 1 next.

Lifeboard leaves tldraw's licensed editor for a fork of tldraw `2.0.0-alpha.19`, the last
Apache-2.0 release (December 2023), running on the MIT tldraw data packages that our boards are
already stored in. Why: `docs/canvas-engine-options.md`. What the fork lacks, item by item, with ids
used below: `docs/fork-parity.md`.

The goal of the phases is that **each one ends in something you can check on its own**, and the
app keeps working on today's tldraw until the cutover phase, so nothing is broken in between.

---

## Ground rules

These hold for every phase.

### Clean room

- **Allowed to read and adapt:** the fork itself (Apache-2.0); the MIT tldraw packages (`store`,
  `tlschema`, `state`, `state-react`, `utils`, `validate`) at any version; tldraw's public docs,
  release notes and blog; our own code; other MIT/Apache libraries.
- **Not allowed:** the source of `@tldraw/editor`, `tldraw`, `@tldraw/sync` or `@tldraw/sync-core`
  from 2.0.0-beta onward. That includes the copies installed in `node_modules` until cutover.
- **Missing features are built from what they must do** — our own call sites, our tests,
  `docs/tldraw-api-notes.md` (our record of behaviour) and the public docs — not from how tldraw
  wrote them.
- The assistant doing this work has read licensed 5.5 source earlier in the project. Get a lawyer's
  view before selling anything.

### Apache-2.0 obligations

- Keep the fork's `LICENSE` and add a `NOTICE` that credits tldraw and says the code was modified.
- Every file we change keeps its licence header situation clear: a line at the top of the package
  README says the package is a modified fork, and the git history shows every change.
- **No tldraw branding:** packages are renamed (below), the UI never says "tldraw", and nothing
  suggests tldraw endorses Lifeboard. Internal identifiers (`Editor`, `ShapeUtil`, the `tl-` CSS
  prefix) stay, to keep the diff readable. Renaming them is a later choice.

### Licence guard

`pnpm check:licences` lists every package in the lockfile that falls under the tldraw licence. It
reports from phase 0 and **fails the build from phase 7 on**, so licensed code can't come back.

### Where the work lives

- `packages/canvas-editor` — the fork of `@tldraw/editor` (editor core).
- `packages/canvas` — the fork of `@tldraw/tldraw` (default shapes, tools, UI).
- `packages/canvas-assets` — the fork of `@tldraw/assets` (icons, fonts, translations).
- `apps/canvas-lab` — a small Vite app that mounts the fork on its own. Every phase before cutover is
  verified here, not in Lifeboard.

The fork is imported from the GitHub tag `v2.0.0-alpha.19` with its history, so `git log` shows
exactly what we changed. Work happens on branches stacked on `self-hosting/phase-2`, one per phase
(`canvas-fork/phase-N`), until everything is pushed together.

---

## Phase 0 — Ground and reference data

**Do**
1. Add `pnpm check:licences` (report mode).
2. **Capture reference boards from the current app while it still runs on tldraw 5.5.** One board
   with every default shape and every format in register section D: rich text with formatting,
   arrows bound at both ends, an elbow arrow, a flipped image, a cropped image, draw and highlight
   strokes, a frame with children, a group, notes with label colours, a video, an embed, a
   bookmark, every Lifeboard node type, relations (visible and hidden), properties. Saved as
   fixtures in `packages/canvas/fixtures/`. They are the yardstick for phases 2–7.
3. Record what each fixture board looks like now: a PNG per board, rendered by today's app.

**Verify**
- `pnpm check:licences` prints the five licensed packages (`tldraw`, `@tldraw/editor`, `@tldraw/driver`,
  `@tldraw/sync`, `@tldraw/sync-core`). It also lists the Claude Agent SDK, which is proprietary but runs
  only in the local agent host, never in the app or the server.
- The fixtures load in today's app through `snapshot-fixtures.test.ts`.
- The PNGs are committed next to the fixtures.

**Size:** about half a week.

**As built:** `scripts/check-licences.mjs` reads the licence from each installed package rather than
guessing from names, and found five licensed packages, not four (`@tldraw/driver` too). The boards
are `packages/canvas/fixtures/lifeboard.json` and `default-shapes.json`, made by
`apps/web/scripts/capture-reference-boards.mjs` with real pointer gestures where the stored format
depends on them (strokes, arrows). `apps/web/src/persistence/reference-boards.test.ts` holds today's
app to "every document record loads unchanged", which is the bar phase 2 has to meet. Gestures over
an embed are swallowed by its iframe; the script keeps strokes clear of it and fails if any expected
shape type is missing.

## Phase 1 — The fork, as it was

**Do**
1. Import `packages/editor`, `packages/tldraw` and `packages/assets` from the tag, renamed to the
   three packages above, with their 2023 data packages (Apache-2.0) from npm for now.
2. Make them build in this workspace (TypeScript 5.9, React 19, Vite 8). Fix only what the newer
   toolchain breaks.
3. `apps/canvas-lab`: one page with the fork's canvas, its own toolbar and menus.

**Verify**
- The fork's own test files (about 140) pass, or each failure is listed with its reason.
- A Playwright smoke test in the lab: draw a rectangle, a freehand stroke, an arrow between two shapes,
  a sticky, a text; select, move, resize, rotate; undo and redo; export SVG and PNG; reload and find
  everything there.
- `pnpm check:licences` shows no new licensed packages.

**Size:** 1–2 weeks.

## Phase 2 — The fork on today's MIT data layer

**Do**
1. Replace the 2023 `store`, `tlschema`, `state`, `utils` and `validate` with today's MIT 5.5 versions,
   the ones Lifeboard already uses.
2. Make the fork compile against them and read every format in register section D. Where a feature
   isn't built yet, read and preserve: rich text renders as plain text (D1), bound arrows draw from
   their stored points (D2), elbow arrows draw straight (D4).
3. **Never lose data the fork doesn't understand yet.** Loading and saving a board without editing it
   must give back the same records.

**Verify**
- The fork's tests pass, updated for the new record shapes.
- Every phase 0 fixture, and every existing fixture in `apps/web/src/persistence/fixtures/`, loads in
  the lab without a validation error.
- **Round-trip test:** load each fixture, save it, compare. Records must be identical.
- The lab shows the fixture boards; side by side with the phase 0 PNGs, shapes are where they were
  (formatting and arrow attachment are allowed to differ until phases 3–4).
- Existing local boards still open: the fork reads the same IndexedDB names (E20).

**Size:** 3–5 weeks. This is the riskiest phase: the 2023 shape code was written against older
record shapes, and every default shape is touched.

## Phase 3 — Connected arrows as binding records

**Covers:** D2, E1.

**Do** — binding records created by the arrow tool and when an end is dragged onto a shape; arrows
that follow their shapes; bindings removed when a shape is deleted; a binding-util mechanism so
other binding types can exist; the editor methods Lifeboard calls.

**Verify**
- Unit tests: bind, move either shape, unbind, delete either shape, undo and redo each.
- The phase 0 fixture's arrows attach where they did in the PNG.
- Lab Playwright: draw an arrow between two stickies, move one, the arrow follows; delete it, the
  binding is gone; undo brings both back.

**Size:** 2–3 weeks.

## Phase 4 — Rich text

**Covers:** D1, E2.

**Do** — TipTap editing and rendering for text, notes, geo labels and arrow labels; measurement and
auto-size; a basic formatting toolbar; a way to add TipTap extensions (Lifeboard's `{…}` helper).

**Verify**
- Unit tests: create, edit, format, undo, measure.
- The fixtures' formatted text matches the phase 0 PNGs.
- Lab Playwright: type into each text-bearing shape; bold and a list survive a reload; a test
  extension added through the options shows its menu.

**Size:** 2–3 weeks.

## Phase 5 — Everything else Lifeboard calls

**Covers:** D3–D10, E3–E20, U1–U5.

**Do** — the rest of the API surface, item by item, plus the UI pieces Lifeboard builds on.

**Verify**
- **Lifeboard's own packages, tested against the fork.** A Vitest alias points `tldraw` at
  `packages/canvas`, and node-kit's, note-markdown's, book-reader's and dice's unit suites run on it.
  They must pass unchanged. This is the main gate for this phase.
- The lab mounts Lifeboard's node types through node-kit (same alias): a note, a table reading
  stickies, a kanban, a book card, a relation between two notes.
- A checklist in `docs/fork-parity.md`: every E and U item marked done with its commit.

**Size:** 3–5 weeks.

## Phase 6 — Our own sync

**Covers:** S1–S3. Independent of phases 3–5 (it works on the store, not the editor), so it can run
alongside them once phase 2 is done.

**Do**
1. A protocol of our own over the MIT store: clients send their diffs and apply others'; the server
   validates and migrates each push against the shared schema, orders them with a clock, and
   persists to the per-board SQLite files; a client reconnects from its last clock.
2. Replace `TLSocketRoom` in `apps/server` and `useSync` in the client.
3. A one-time migration of rooms already stored in sync-core's SQLite layout (plain SQL reads of our
   own data, no licensed code).

**Verify**
- `apps/server` tests, rewritten for the new protocol: two clients exchange edits; a board survives a
  restart; a malformed or invalid push is refused; an old-format room is migrated.
- Lab Playwright, two pages: an edit in one appears in the other in under a second; kill the server,
  edit, restart, the edit arrives.

**Size:** 3–4 weeks.

## Phase 7 — Cutover

**Do**
1. Point Lifeboard at the fork: first with a Vite and Vitest alias (`tldraw` → `packages/canvas`),
   then rewrite the imports.
2. Port what the alias can't cover: the UI overrides, the selection toolbar, the context menu.
3. Remove `tldraw`, `@tldraw/editor`, `@tldraw/driver`, `@tldraw/sync` and `@tldraw/sync-core` from
   every `package.json`. Switch `pnpm check:licences` to fail on any of them.

**Verify**
- **The full unit and e2e suites pass.** The 158 e2e tests are the parity gate for what Lifeboard does
  today.
- `perf.spec.ts` passes; its numbers are recorded against today's.
- `pnpm check:licences` passes with no licensed package anywhere in the lockfile.
- A hand checklist in the real app: every phase 0 fixture opens and matches its PNG; server boards
  sync between two browsers; a board moves to the server and back.

**Size:** 2–4 weeks.

**After this phase, deploying needs no licence key from anyone.**

## Phase 8 onward — The backlog, at your pace

Everything in `docs/fork-parity.md` marked **Backlog**: B, I, A, L, P, X and S4–S7. Each item is its
own small change with its own test, picked in whatever order matters to you. Suggested first,
because they are about people rather than polish: mobile touch (I6), accessibility (A1–A3), SVG
sanitising (X1), performance (P1–P3).

---

## Size

| Phase | Person-weeks |
|---|---|
| 0 Ground and reference data | 0.5 |
| 1 The fork as it was | 1–2 |
| 2 MIT data layer | 3–5 |
| 3 Bindings | 2–3 |
| 4 Rich text | 2–3 |
| 5 The rest of the API | 3–5 |
| 6 Sync | 3–4 |
| 7 Cutover | 2–4 |
| **Until Lifeboard runs on the fork** | **17–27** |

Rough, for one developer full time. Phase 6 can run alongside 3–5.

## Decisions before phase 0

1. **Package names:** `@lifeboard/canvas-editor`, `@lifeboard/canvas`, `@lifeboard/canvas-assets`?
2. **Sync design (phase 6):** our own diff protocol on the MIT store (recommended: closest to what is
   built, no new dependency), or Yjs with Hocuspocus (offline editing comes with it; more binding work).
3. **Deploying:** wait for phase 7 (recommended: nothing licensed is ever shipped), or deploy the
   current branch earlier on a trial key.
4. **Internal names** (`Editor`, `ShapeUtil`, `tl-` CSS classes): keep through cutover (recommended),
   or rename as part of the fork.
