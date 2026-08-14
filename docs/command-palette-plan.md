# Command palette (⌘K) — implementation plan

Status: **Phases 1–3 are done** on `t3code/add-command-k-functionality` — the registry ships, the
palette ships on top of it, and two more surfaces (insert commands, the Help page) are now views over
the same table. Only Phase 4 remains, and it is deliberately unscoped. Written to be executed by an
agent without prior context — every step names its files and cites the existing code it must follow.

## Architecture in one paragraph

The command registry is the feature; the palette is only its first consumer. One table of
user-invokable actions (`packages/node-kit/src/commands.ts`) that every command surface reads as a
view: the ⌘K palette now, the Help page's shortcut list next, generated tldraw overrides and a
user-rebindable keymap later. This mirrors the node registry's rule ("no per-node-type branching in
the UI" — `packages/node-kit/src/registry.tsx`) and is deliberate: **never build a palette feature
against a hardcoded list; put the data on `Command` and render it.**

## What is already done (do not redo)

- `packages/node-kit/src/commands.ts` — the registry. `Command` (id/title/group/icon/kbd/when/run),
  `CommandContext` (`{ editor: Editor | null; view: 'list'|'settings'|'help'|'board' }`),
  `registerCommand(cmd, owner?)` (replace-by-id semantics, HMR-safe), `getVisibleCommands()`
  (stable snapshot, filters by owning-extension enablement, does **not** apply `when`),
  `subscribeToCommands` (fires on registration and extension toggles — chained off
  `subscribeToNodeDefinitions`). Tests in `commands.test.ts`.
- `packages/node-kit/src/extensions.ts` — `Extension.commands?: readonly Command[]`;
  `registerExtension` registers them with the extension id as owner, so disabling an extension
  hides its commands ("stop offering, never stop working").
- `packages/node-kit/src/index.ts` — everything above is exported.
- `apps/web/src/app/appCommands.ts` — app + canvas commands registered at module scope
  (composition-root pattern, StrictMode-safe). App capability flows through
  `setAppCommandApi(...)`, which `App.tsx` re-points at its live callbacks in a no-deps `useEffect`.
  Registered so far: `board.new`, `view.home`, `view.settings`, `view.help`, `view.theme.*`,
  `edit.undo`, `edit.redo`, `view.zoom-fit`, `view.zoom-reset` (canvas ones gated
  `when: ctx => ctx.editor !== null`).

Verified: `pnpm -r typecheck` and `pnpm -r test` pass.

## Phase 2 — the palette (done)

- `apps/web/src/app/paletteItems.ts` + `paletteItems.test.ts` — the pure rules: `parseQuery`
  (`>` prefix → commands mode), `buildPaletteItems` (navigate mode = boards capped at `MAX_BOARDS`
  plus the `Boards`/`Navigate` groups; commands mode = everything passing `when`), substring
  filtering, grouping into a declared section order (`GROUP_ORDER`, so the layout is a decision
  rather than a side effect of which module evaluates first) with the ungrouped bucket forced last,
  and `formatKbd`
  (platform-correct modifier order: `⇧⌘Z` on a Mac, `Ctrl+Shift+Z` off it).
- `apps/web/src/app/CommandPalette.tsx` — combobox in a portal; virtual highlight via
  `stepSelection`; manual scroll maths (not `scrollIntoView`, which would scroll the page behind);
  `pointerdown` for rows and backdrop; closes before running.
- `apps/web/src/styles.css` — `.lb-palette*` (z-index 600) replacing the dead `.lb-create-menu`
  block, plus a new `--lb-backdrop` token in both themes.
- `apps/web/src/app/App.tsx` — `paletteOpen` state, capture-phase `window` ⌘K listener,
  `focusOnly(paletteOpen ? null : activeBoardId)`, and `getCommandContext` (a `useCallback`, so the
  editor is read at invoke time rather than captured).
- `apps/web/e2e/commandPalette.spec.ts` — 5 tests, all passing, including the focus-trap regression
  (typing `draw` in the palette must not switch the canvas tool).
- Help page has an "Anywhere" shortcut group; README documents the registry and the blur rule.

## House rules (from CLAUDE.md and the codebase)

- pnpm. Never `any`. No new dependencies — the palette is hand-rolled (the app has zero UI deps by
  design; do not add cmdk/kbar). Don't run `pnpm dev` or builds; verify with
  `pnpm -r typecheck` and `pnpm -r test`.
- tldraw is pinned at exactly `5.2.5`; do not touch its version.
- Comments in this codebase explain *why*, densely — match that register.
- Styling: hand-written BEM-ish `lb-*` classes in `apps/web/src/styles.css`, colours only through
  `--lb-*` tokens (must work in both themes).

---

## Phase 2 — design notes (all implemented; kept as rationale)

### 2.1 Files

- `apps/web/src/app/CommandPalette.tsx` — the component (overlay + input + list).
- `apps/web/src/app/paletteItems.ts` — pure functions that turn `(query, ctx, boards, commands)`
  into the item list; unit-testable without DOM. Put the mode split and filtering here.
- `apps/web/src/app/paletteItems.test.ts` — vitest.
- CSS appended to `apps/web/src/styles.css` (see 2.6).
- Wiring + open-state in `apps/web/src/app/App.tsx`.

### 2.2 Open/close and the focus trap — **the critical integration**

- Open state lives in `App.tsx`: `const [paletteOpen, setPaletteOpen] = useState(false)`.
- ⌘K listener: `window.addEventListener('keydown', handler, { capture: true })` in a `useEffect`
  in `App.tsx` (or a small hook the component exports). Match
  `(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'`, then `e.preventDefault()` +
  `e.stopPropagation()`, toggle open. It must be a window listener, **not** a tldraw override:
  tldraw's shortcuts are gated on `editor.getIsFocused()` and `App.tsx` blurs all editors outside
  the board view (`focusOnly`, `App.tsx:164-177`), so an override would be dead on
  Home/Settings/Help.
- **`focusOnly` runs in a no-deps `useEffect` after every render** (`App.tsx:358-362`). If you
  only open the palette, that effect immediately re-focuses the active editor and every keystroke
  typed into the palette also drives tldraw tool shortcuts. Change the call to
  `focusOnly(paletteOpen ? null : activeBoardId)` so opening the palette blurs the board (blur also
  calls `editor.complete()`, which is right — same rationale as tab switching). Closing restores
  focus automatically because the effect runs again with `paletteOpen === false`.
- Also `stopPropagation` on the palette root's `onKeyDown` as a second fence — the pattern used by
  every input in the app (e.g. `PropertiesPopover.tsx:390`).
- Escape closes. A `pointerdown` on the backdrop closes (use `pointerdown`, not `click` — see
  `suggestMenu.ts:41-49` for why). Close the palette **before** running an item: `run` may navigate
  or open a board, and the overlay must not sit over the transition.

### 2.3 Context and data

Build the context fresh per render/invocation in `App.tsx` — never store it:

```ts
const ctx: CommandContext = {
	editor: activeBoardId ? (editors.current.get(activeBoardId) ?? null) : null,
	view: route.view,
}
```

- Commands: `useSyncExternalStore(subscribeToCommands, getVisibleCommands)` (the snapshot is
  stable between changes — that contract already holds). Then filter `cmd.when?.(ctx) ?? true`
  per render, and check `when` again at invoke time.
- Boards: `api.boards` is already in `App.tsx` (sorted by `updatedAt` desc by `listBoards`).

### 2.4 Modes (VS Code split)

Input parsing in `paletteItems.ts`:

- **Default (no prefix): navigate.** Items = boards (icon, name; Enter → `openBoard(board)` — use
  `openBoard` from `App.tsx:277`, never raw `navigate`, so tabs and the outgoing thumbnail are
  handled) plus the `Navigate`-group commands and `board.new`. With an empty query, show boards
  (most recent first, cap ~8) and a dim footer hint: “Type `>` for commands”.
- **`>` prefix: commands.** All visible+available commands, grouped by `group` in registration
  order, section headers rendered from the group name, `kbd` rendered with the `.lb-kbd` keycap
  style (`styles.css:3368`; the Help page shows usage at `help/kit.tsx`). Display-format `kbd`
  strings (`'cmd+shift+z'` → `⌘⇧Z` on mac, `Ctrl+Shift+Z` elsewhere) with a small pure helper in
  `paletteItems.ts`; detect mac the way the codebase does (search for existing `navigator.platform`
  / `Mac` usage and follow it; if none, `navigator.platform.startsWith('Mac')` is fine).
- Filtering: case-insensitive substring on title (and group name for commands), the app's
  established idiom with its documented rationale — copy `filter` from
  `packages/node-kit/src/collections/suggest.ts:155-159`. No fuzzy scoring; item counts are small.
- Leave `@` (find on board) and `=` (expressions) **unimplemented** but leave the parse function
  shaped so a new prefix is one case (Phase 4).

### 2.5 List behaviour

- Combobox pattern: the input keeps DOM focus the whole time; a virtual highlight moves through
  the list. ArrowUp/ArrowDown wrap using `stepSelection` (exported from node-kit,
  `suggestMenu.ts:109`). Enter runs the highlighted item; hovering with the mouse moves the
  highlight; `pointerdown` on a row runs it.
- Reset highlight to 0 whenever the query changes. Scroll the highlighted row into view
  (`scrollIntoView({ block: 'nearest' })` — see `suggestMenu.ts:80-95`).
- ARIA: `role="listbox"` / `role="option"` / `aria-selected`, `aria-activedescendant` on the input.

### 2.6 Rendering and CSS

- Render via `createPortal` to `document.body` from `CommandPalette.tsx`, mounted in `App.tsx`
  inside the shell. Fixed overlay, panel centred at ~18vh from the top, width ~560px, max-height
  ~60vh with the list scrolling.
- z-index: **500+**. Landscape: `.lb-popover` 240 → tldraw 250 → dock 300 → `.lb-suggest` 400 →
  top. The dead `.lb-create-menu` block (`styles.css:1427-1490`, z-index 500) is the removed
  create-menu's row styling — icon + name + hint — and is unreferenced (verify with a grep before
  touching). **Claim it: rename/rework it into `.lb-palette*` classes** rather than adding a
  parallel block; also crib row styling from `.lb-suggest*` (`styles.css:2346-2384`).
- Class scheme: `.lb-palette` (backdrop), `.lb-palette__panel`, `__input`, `__list`, `__section`,
  `__row`, `__row--on`, `__icon`, `__name`, `__hint` (right-aligned; holds the `.lb-kbd` keycaps).
- Both themes must look right — only `--lb-*` tokens.

### 2.7 Docs and Help

- Add ⌘K to `SHORTCUT_GROUPS` in `apps/web/src/app/help/sections/Shortcuts.tsx` (hand-written for now;
  Phase 3 generates this).
- README: add the palette to the layout/shortcuts sections; note the registry under the
  architecture notes ("deliberate deviations" style).

### 2.8 Tests

- Unit (`paletteItems.test.ts`): mode parsing (`''`, `'foo'`, `'>'`, `'> zo'`), `when` filtering
  with `editor: null` vs a stub truthy editor (cast a minimal object via a typed helper, no `any`),
  board filtering, kbd display formatting.
- e2e (`apps/web/e2e/commandPalette.spec.ts`), following the conventions in `apps/web/e2e/helpers.ts`
  — **use `gotoFresh` (`helpers.ts:8`)**, and remember hidden tabs keep their editors mounted, so
  page-wide locators can match more than one board (`helpers.ts:103-104`). Cases:
  1. `ControlOrMeta+k` on the home screen opens the palette; Escape closes it.
  2. Typing a board name + Enter opens that board (URL hash contains `#/board/`).
  3. `> theme` + Enter on “Theme: Dark” flips `html[data-theme]` to `dark`.
  4. On a board: ⌘K, `> undo` visible (canvas group present); on home: `> undo` absent
     (`when` gating).
  5. While the palette is open on a board, typing letters does **not** change the active tldraw
     tool (the focus-trap regression test — this is the bug the `focusOnly` change prevents).
- Run: `pnpm -r typecheck`, `pnpm -r test`, then `pnpm test:e2e` (Playwright runs against a
  production build — check `apps/web/playwright.config.ts` for how it builds/serves; building for
  e2e is the one sanctioned build).

---

## Phase 3 — prove the registry pays (done)

Shipped:

- `apps/web/src/canvas/insertNode.ts` — `insertNode(editor, def, point)` factored out of the context
  menu (both callers now share the history stopping point, selection and edit-mode hand-off), plus
  `registerNodeCommands()`, which projects the node registry onto the command table as one
  `<type>.insert` command per non-deprecated definition, owned by the node's extension. Called from
  the composition root (`apps/web/src/extensions.ts`) *after* the `registerExtension` lines.
- `packages/node-kit/src/registry.tsx` — new `getNodeOwner(type)`, so a derived contribution can
  inherit the node's owner instead of duplicating the mapping.
- `apps/web/src/app/appCommands.ts` — `shape.properties` (`alt+p`), `edit.duplicate` (`cmd+d`) and
  `edit.delete` (`backspace`), all gated on a `hasSelection` predicate.
- `apps/web/src/app/help/sections/Shortcuts.tsx` — the bound-command rows are generated from
  `getVisibleCommands()`. Only genuinely non-command bindings stay hand-written: ⌘K and ⌘/, tldraw's
  tool letters, the pointer gestures, and the note and expression editors' own keymaps.
  **`when` is deliberately not applied here** — it says whether a command can run *now*, and a
  reference documents what exists. `HELP_TITLES` maps a group name to the sentence fragment this page
  is written in (`Canvas` → "On the canvas"); the palette keeps the short header a narrow list wants.
- `groupInOrder` was generalised in `paletteItems.ts` and is shared by the palette and Help, so two
  views of one table cannot order it two different ways.
- Tests: `apps/web/src/canvas/insertNode.test.ts` (5) plus two e2e cases — inserting a note from the
  palette, and the Help page listing "Zoom to fit" purely because the command exists.

### 3.1 Insert-node commands (as specced)

- Factor the create-at-point logic out of `AddToBoardItems` (`apps/web/src/canvas/uiOverrides.tsx:157-193`
  — create shape, `markHistoryStoppingPoint`, select, enter edit mode) into a shared helper, e.g.
  `apps/web/src/canvas/insertNode.ts`, taking an explicit page-point. The context-menu path keeps
  the pointer position; the palette path uses `editor.getViewportPageBounds().center`.
- Register one `node.<type>.insert` command per definition (“Add sticky note”, …), group `Insert`,
  `when: ctx => ctx.editor !== null`, `icon` from `def.toolbarIcon`. Register them in a small
  module imported by the composition root (`apps/web/src/extensions.ts`), iterating
  `getNodeDefinitions()` and passing the **owning extension id** as `owner` so enablement hides
  them automatically (ownership: `registry.tsx` tracks it; if no public accessor exists, add
  `getNodeOwner(type)` to node-kit rather than duplicating the mapping). Skip `deprecated` defs.
  Also include tldraw's own insertables the create menu offered (text, frame) if trivially
  expressible as `editor.setCurrentTool(...)` or shape creation.

Not done, and deliberately: registering tldraw's tool letters as commands. The Help page's dock tour
(`DOCK_GROUPS`) already documents every tool and its letter, so doing it now would duplicate that
rather than replace it. It becomes worthwhile in Phase 4, when `uiOverrides.actions`/`tools` are
*generated* from the table — at that point the tool letters have to live there anyway.

### 3.2 Help page reads the registry (as specced)

- Replace the hand-maintained `SHORTCUT_GROUPS` (`help/sections/Shortcuts.tsx`) with groups derived from
  `getVisibleCommands()` — entries with `kbd`, grouped by `group`, via
  `useSyncExternalStore(subscribeToCommands, getVisibleCommands)`. tldraw-native shortcuts that
  have no command yet (tool letters, etc.) either stay as a hand-written trailing group or get
  registered as display-only commands (`run` activates the tool) — prefer registering them, since
  that also puts tools in the palette.

---

## Phase 4 — later (do NOT build now; keep doors open)

`@` find-on-board (via `shapeLabel`/`getPageFacts`), `=` expression mode (shared namespace with
`{…}`), user-rebindable keymap (then `uiOverrides.actions` gets generated from the table and `kbd`
becomes the default the user overrides), nested/drill-in commands, hooks, board modes. The only
obligation today: command ids are stable and namespaced — never rename one.

## Known issue, not introduced here

`ui.spec.ts:375` ("the same helper works inside a sticky") is **load-sensitive**. It failed 100% of
the time before this branch; the fix in `suggestExtension.ts` (arming the caret rescue when `{` is
typed, not only when a suggestion is accepted) makes it pass consistently on an idle machine —
measured 12/12, 36/36 and two clean full-suite runs — but it can still fail when the machine is
heavily loaded, e.g. another checkout running Playwright at the same time. Observed failure: after
the first Enter the menu re-opens showing the *initial* suggestions, meaning the caret came back at
the position recorded when `{` was typed rather than after the accepted word.

The root cause is architectural and predates the palette work: tldraw mirrors each rich-text edit
through the shape store and resets the ProseMirror selection afterwards, so programmatic edits race
it. `resume`/`restore` chases that with an absolute caret offset and a 500 ms deadline. Two things
were tried and rejected, both measured:

- Disarming `resume` once the caret "looks right" — **fails every run**. At arming time it already
  looks right (this code set it), so the rescue is discarded before the displacement it exists to
  undo has happened.
- Widening the deadline to 2 s — no measurable improvement (3/24, then 1/24), so it was reverted
  rather than left in as an unjustified change.

The principled fix is to stop trusting an absolute offset across a document rewrite: have `restore`
re-find the open expression by content (the caret belongs immediately before the `}` that closes the
`{` it was armed in) instead of replaying a stale position. That is a real change to the plugin's
model and wants its own pass, not a tail-end patch.

## Gotchas checklist (read before coding)

- [ ] `focusOnly(paletteOpen ? null : activeBoardId)` — the whole focus story hinges on it.
- [ ] Close palette before `run`.
- [ ] `openBoard`, never `navigate`, for board items.
- [ ] `getVisibleCommands()` + per-render `when`; never `getCommands()` in UI.
- [ ] Stable snapshots: don't map/filter into `useSyncExternalStore`'s `getSnapshot`.
- [ ] StrictMode is on: no effect-based command registration (module scope only).
- [ ] `pointerdown` not `click` for rows/backdrop; `stopPropagation` on the palette root.
- [ ] z-index ≥ 500; both themes; `--lb-*` tokens only.
- [ ] e2e: `gotoFresh`; multiple mounted editors behind hidden tabs.
