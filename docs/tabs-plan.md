# Tabs: reorder, new tab and split view

The tab strip shows the open boards and the daily page as folder labels after a pinned "All Boards"
label. This plan brings over what the tabs of oritask and oribet-admin do that Lifeboard's don't, in the
folder-label look and the `--lb-*` / `--tab-*` tokens.

Agreed with the user on 2026-11-26: the phases in order, stopping to report after each. After phase 2
was built the user dropped groups (they don't fit Lifeboard) and asked for splits as oritask has them,
so phases 3 and 4 became one.

- Settings, Help and the pinned "All Boards" stay outside the strip, as now.
- Tabs stay per browser window (`sessionStorage`).
- At most 8 boards stay mounted: the ones most recently shown. A board past that unmounts as a closed
  tab does (through the drain) and mounts again when its tab is shown.
- "+" opens a **New tab** that shows the home screen. Picking a board there turns that tab into the
  board, as Freeform's new tab does. "New board" stays in the sidebar, the home screen and ⌘K.

## How the other two apps do it

Both keep the tabs as plain data changed by pure, unit-tested functions (`tabsModel.ts`). A tab holds an
address and the title its page last set. Background tabs stay mounted inside React's `<Activity>`, only
the 8 most recently used, and panes are absolutely positioned in a fixed DOM order so reordering or
splitting never remounts a page. The address bar shows the active tab.

- **oritask** (`apps/web/src/components/layout/tabs`): Chrome-style groups (named, coloured,
  collapsible chip before their tabs), tab names and colours, and a split of one left pane beside a
  stacked right column. Each tab gets its own router, so a page's `router.push` moves only its tab.
  Drag with dnd-kit.
- **oribet-admin** (`src/layouts/components/tabs`): a group *is* a split, a layout tree of rows and
  columns of up to 3 panes, shown as one tab in its colour. Its own pointer drag: drop between tabs to
  move, onto one to split. "+" opens a New Tab page with search and favourites.

What Lifeboard does not take: `<Activity>` for boards. A hidden Activity runs its effects' cleanup,
which would close a board's sync connection and its pending writes. Boards keep the current scheme:
mounted, hidden with `data-hidden`, unmounted through the drain. And a board is open in at most one
tab, because there is one editor per board.

## Phase 1: the model, reorder, menu, new tab

Built 2026-11-26 (9ddfaf7).

- `app/tabsModel.ts`: a tab is `{ id, route }`, where the route is a board, the daily page (with the day
  it was on) or the home screen (a New tab). `activeId` is the tab on screen, or `null` on a page outside
  the strip. Pure functions for following a route, opening, closing, closing others or those to the
  right, and moving. The old saved list of board ids is read once and converted.
- `app/useTabs.ts` holds that state in `sessionStorage`. `App.tsx` follows the route into it, mounts
  boards from it, and keeps the 8 most recently shown boards mounted.
- The strip: drag a label along the row to move it, right-click for Close, Close other tabs, Close tabs
  to the right and Rename, and "+" opens a New tab.
- ⌘-click or middle-click a board in the sidebar or on the home screen opens it in a tab behind the
  current one.
- ⌘K: New tab, Close tab, Next tab, Previous tab, with no default keys (the browser owns ⌘W and ⌃Tab).
- Phone: the board pill reads the same state and otherwise works as it does now.

## Phase 2: groups (dropped)

Built and then removed at the user's word: groups are not relevant in Lifeboard.

## Phase 3: split tabs, as oritask's

Built 2026-11-26.

- The model (`TabSplit`, after oritask's): a split's first tab is the left column and the others stack
  in the right one; `size` is the left column's share. Its tabs sit together in the row and move as one
  label; the active tab is the focused pane. `splitTabs`, `openBeside`, `unsplit`, `resizeSplit` and
  `paneRects` are pure and tested. Closing the focused pane hands focus to a partner; a split left with
  one tab ends.
- Making one: Split with… in a tab's menu, or ⌥-click a board in the sidebar or on the home screen to
  open it beside the tab on screen (again to stack it in the right column). Exit split ends it.
- The page area (`app/SplitPanes.tsx`): below the tabs and clear of the sidebar and the agent panel,
  the panes are cards placed by position, so a board keeps its editor through every change. A press or
  the focus going into a pane focuses it. The divider drags or takes ← →.
- Everything that assumed one board on screen counts the visible ones instead: the GPU layer's
  `shown`, the eight boards kept mounted, the idle preview redraw, and leaving a board, so an untitled
  board isn't deleted when the focus moves to the other pane. A pane's board has its own safe insets
  (only its dock covers it) and `--fl-left`/`--fl-right` of 0, so its dock centres in the pane.
  `focusOnly`, ⌘K, the keymap, the agent and `window.editor` follow the focused pane through the route.
- The daily page and a New tab render in their panes from their own tab's route; a page laid out for a
  wider window scrolls in its pane.
- Not on a phone: there the split is kept but the route's page shows alone.

Each phase gets unit tests for the model and an e2e spec that opens boards, and its commands reach ⌘K,
Help and the README (`.claude/skills/extension-surfaces`).
