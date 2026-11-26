# Tabs: reorder, new tab, groups and split view

The tab strip shows the open boards and the daily page as folder labels after a pinned "All Boards"
label. This plan brings over what the tabs of oritask and oribet-admin do that Lifeboard's don't, in the
folder-label look and the `--lb-*` / `--tab-*` tokens.

Agreed with the user on 2026-11-26: all four phases, in order, stopping to report after each.

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

## Phase 2: groups

Chrome-style groups drawn as folder labels: a small label in the group's colour before its tabs, which
folds them away when clicked. Name and colour from the tab menu (Add to new group, Add to group, Remove
from group) and from the group label's own menu (Rename, Colour, Ungroup, Close group). Colours from the
chip tokens. A group's tabs stay together when moved.

## Phase 3: a board beside a page

A split of one board beside the daily page or another non-board view: one editor on screen, so the
GPU layer, focus and ⌘K need no change. Panes are placed by position, with a divider to resize them
and a ring on the focused pane. Shown as one label holding both names.

## Phase 4: two boards side by side

Everything that assumes one board on screen becomes per pane: the GPU layer's `shown`, `focusOnly`,
the keymap's and ⌘K's editor, the agent panel's context, `window.editor`, safe insets, and where the
dock and the floating controls sit. The focused pane owns them.

Each phase gets unit tests for the model and an e2e spec that opens boards, and its commands reach ⌘K,
Help and the README (`.claude/skills/extension-surfaces`).
