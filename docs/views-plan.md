# Views for collections — implementation plan

Status: **Done.** All five phases have shipped and are verified against a running board — four views,
both drag gestures, and the surfaces. What follows is the record: each phase's "as built" notes say
where reality diverged from the sketch below and why, and the sketch is kept as the reasoning. The rest
of the view list (gallery, timeline, relation graph, two-axis matrix, chart, spatial cluster) is
deferred, with a note at the end on what each would need.

### Phase 5, as built

- **The Help section became `sections/Views.tsx`**, and its *id* did not: `#/help/tables` is a URL
  someone may have bookmarked, so the id stays `tables` while the label reads "Tables & views". The
  page opens on what a view *is* (a saved question), then on the thing nobody guesses — that two of the
  four move the real cards — with an animated kanban demo carrying both directions and a static week
  beside it.
- **The row-cap section grew a second paragraph.** "+N more" is something a table can say about rows it
  is drawing and a kanban cannot say about cards that are standing there, so the cap is now explicitly a
  table-view rule rather than a property of the node.
- **Shortcuts gained a gestures group.** Command bindings generate themselves from the registry; a drag
  is not a command, so a reference listing every keystroke and none of the gestures would be missing the
  feature entirely.
- **A switch fills in what the view needs** (`ViewDefinition.prepare`), added after review: choosing "a
  calendar" and landing on *"group by a date to show a calendar"* is correct and useless when the board
  has exactly one date property. The calendar takes it, bucketed by day, and states its span; a kanban
  finds a status (preferred over a select, because its stages order the lanes). Part of the same write,
  so switching-and-working is one undo entry. A view already configured usefully is left alone.
- **The calendar's date field shows the day it is drawing, not what is stored.** "Preselect today" and
  "follow today" are in tension: storing today's date makes the field look right and pins the card to
  this week forever, so a board revisited next week opens on the wrong one. The field therefore displays
  the *resolved* anchor and stores nothing until you change it, with a **Today** button appearing once it
  is pinned to put it back.
- **Nothing was needed for the agent.** `node.configure` validates against the node's own props, so
  `span`, `anchor`, `lanes` and `valueColumn` were drivable the moment the validator accepted them —
  pinned now by a test that says so, since that is a surface with no UI to notice it breaking.
- **`Overview.tsx` is untouched**, correctly: `DOCK_GROUPS` mirrors the toolbar, and views added no node
  type.

### Phase 4, as built

The calendar shipped twice. The first version drew its rows as **chips** — a readout you could drop on
but which arranged nothing — on the reasoning that a month cell is a hundred pixels wide and a sticky is
not. Shown it, the user's answer was that it should be a kanban whose lanes are days: *"days will be
boxes like in kanban, and the entire week will be on a single row, and when you drag inside the day the
content will snap to the day"*. The second version is that, and it is better for a reason worth
recording — a chip is a picture of a card, and this board is built so that the card can just be there.

- **A week is the default span, and it follows today.** A week is what a board can be *worked* in: seven
  columns wide enough to stand real cards in, showing the days being decided about. A month is four to
  six rows of the same thing, for looking at rather than working in, so it is an answer rather than the
  default. An absent anchor means today, so a calendar opens on the week you are in.
- **A month spans the weeks it needs — four to six, not a fixed four.** The user asked for four rows;
  a month that begins on a Saturday needs six, and drawing four would leave its last week with nowhere
  to stand its cards. The row count is derived, and the e2e pins six for August 2026.
- **Rows are uniform, set by the busiest day anywhere in the span.** A calendar whose weeks were
  different heights because one of them was busy reads as a rendering fault, where a kanban with one long
  lane plainly does not. It also means the chrome and the drop target can both work out where a row
  starts from the card's own `h`, which is the only thing they are given.
- **`ViewDefinition` grew `placement` and `defaultWidth`.** `placement.ts` had been kanban-shaped —
  lanes, lane keys, lane boxes — and a second placing view was the moment to make it ask the view where
  things go instead. It now decides only *which* shapes may be moved (ownership, locks, what is in hand),
  groups them by the key the query bucketed them under, and hands them over. `mode.ts` likewise asks the
  view how wide it wants to be rather than knowing about lanes.
- **The calendar reads its date from `groupBy`**, as `date:<propertyId>` beside the existing `currency:`
  prefix — so `buildGroups` buckets by day and a calendar is configured exactly the way a kanban is, by
  choosing what to group by. `layout.dateProperty` from the sketch is therefore gone; only `span` and
  `anchor` landed. A grouped *table* gets a bucket-per-day out of the same change.
- **`groupProperty` had to exist.** The date prefix worked in `buildGroups` and not in `neededKeys`, so
  every cell came back `undefined` and every row fell into the empty bucket. Three places have to agree
  on what property a grouping reads; now one function answers.
- **`DropTarget` grew its `values` map** — the plan predicted this for the two-axis matrix, and the
  calendar needed it a phase early: a lane writes a status, a day writes a date. Each view answers for
  its own geometry through `ViewDefinition.dropAt`, and `applyViewDrop` became generic over the result.
- **`fills`, not `placesMembers`, is what pins auto-height off.** Found by running it: the calendar
  collapsed to the height of its title strip and drew forty-two day cells one pixel tall — present in
  the DOM, invisible on screen, impossible to drop on. A view that lays itself out against the card's
  box needs the box to *be* a box, whether or not it also arranges shapes.
- **Local time everywhere.** `new Date('2026-08-13')` parses as UTC midnight, so west of Greenwich it is
  the 12th — the one bug a calendar cannot have. Every date in `calendarLayout.ts` is built from parts,
  and the only clock read is `calendarAnchor`'s "today", which is injectable and tested as such.
- **`useAutoHeight` gained a fifth guard**, and it was found by the full e2e suite rather than by
  reasoning: the measurement checks whether auto-height is on, then defers its write by a frame, and the
  flag can be switched off inside that frame. Switching a card to a calendar sets `h` and pins the flag
  in one write, and a measurement taken a moment earlier landed on top of it — a 145px calendar with day
  cells too short to hold a chip, in the suite but never when run alone. The write now asks again.

### Phase 3, as built

`apps/web/e2e/views.spec.ts` covers all of it, and every claim below was found *by running it*.

- **The drop seam is one field, `NodeDefinition.drop`** (`accepts` / `targetAt` / `apply` / `hover`),
  not the two functions §3.1 sketched. `accepts` had to exist because tldraw's gate
  (`canReceiveNewChildrenOfType`) is asked per shape and defaults to **false** — the plan had it
  backwards, and with the default answer the drop callback is never called at all.
- **The hooks live on a subclass** built only for a definition that declares `drop`, since tldraw picks
  its target by testing whether the util *has* them. `views.spec.ts` pins the consequence: a plain note
  must not stop a frame adopting what is dropped on it.
- **`onDragShapesIn` is needed as well as `onDragShapesOver`.** The hint never appeared in the e2e, and
  the reason is in tldraw's `DragAndDropManager`: `onDragShapesOver` only fires on ticks where the
  *cursor moved*. Dragging into a lane and pausing before letting go — precisely when someone is
  looking for confirmation — produced no highlight at all.
- **The hint atom lives in its own leaf module** (`views/dropHint.ts`). With it in `interaction.ts` the
  view registry transitively imported the query engine and the node definition, and since the
  definition builds its commands from the registry at module scope, the cycle closed on a
  half-initialised `VIEWS` and every import threw. Found by a unit test, not by reasoning.
- **A drop records the home itself**, at the drop point and marked `drop`, rather than leaving it to the
  placement pass. Otherwise the pass would record the *post-drop* position as the shape's home, so
  "release" would mean "jump back to inside the lens".
- **Dragging a member out removes its property** — the reverse of §3.5 as planned, changed after trying
  it: a board that accepts a card by drag and refuses to give it back reads as broken, not careful. See
  §3.5 for the two guards that keep it a gesture rather than a geometry rule.

Also: `fakeEditor` gained `markHistoryStoppingPoint` and a `marks` counter, which is the sharper way to
assert "one user action, one undo entry" — nested `run`s join the outer batch, so counting `run`s
proves less than counting marks.

### Phase 2, as built

Five differences from the sketch below:

- **`placement.ts` was split into a pure core and a reactive shell** — `placementPatches(env)` carries
  every rule and returns patches; `placeViewMembers(editor)` is fifteen lines that feed it a live
  editor. The plan asked for a test against `properties/fakeEditor.ts`, and that turned out to be
  impossible: the pass needs `getTableResult`, which is a `createComputedCache` over a real store. The
  split is the same one `query.ts` and `engine.ts` already have, for the same reason, and it is what
  made the fifteen tests in `placement.test.ts` possible.
- **Verified on a real board** by `apps/web/e2e/views.spec.ts`, which was the point of writing it: the
  pass writes positions and every write re-triggers it, so a missing no-op guard is an infinite loop
  that looks perfectly fine on screen. The spec samples the board a second apart and fails if anything
  is still moving.
- **No animation.** §2.4 wanted adopted cards to fly in, on the grounds that a teleporting sticky is
  alarming. Two things killed it: `animateShapes` writes a position per frame, and this pass *reads*
  positions to decide what to write — so an animation would re-trigger it, which would restart the
  animation. And the user's own description of the feature was "it will automatically disappear from
  where it was and appear in the kanban column", which is a teleport. It can come back later behind an
  in-flight set.
- **`ViewDefinition` gained `fills`, a third field beyond the plan's two.** A view whose geometry has
  to line up with shapes *outside* its DOM cannot afford an offset that is the sum of a padding, a
  header's line-height and a flex gap — one stylesheet edit would move every card on the board. A
  `fills` view replaces the shared chrome, so the distance from the card's top edge to the first card
  in a lane is a number `KANBAN_METRICS` chose.
- **A placing view pins `autoHeight` off**, and the pass repairs the flag rather than trusting the
  switch to have set it. This was a real trap, found by reasoning rather than by test: with the
  measurement running, it and the placement disagree by the card's 2px border and grow the shape by 2px
  *per pass, forever*. `mode.ts` is only the user's door — `node.configure` writes props directly, so
  an agent can create exactly that state.
- **Lane width is derived from the card's width** (as decided during Phase 1's review), so resizing is
  ordinary `resizeBox` with no factory seam. Switching to a kanban widens the card once instead.

Also worth knowing: **no per-lane totals.** §2.3 wanted the group's own summaries in each lane heading,
and it cannot have them yet. `columnsFor` has to replace the user's columns with `[name, lane property]`
to make membership mean "carries a Status" — and `queryTable`'s membership rule is an OR across
columns, so keeping the user's columns as well would make a kanban grouped by Status with a Price column
adopt everything priced, including the shopping list on the other side of the board. Per-lane totals
need a way to say "carries this property **and** any of those", which is a filter operator
(`carries`) rather than a view concern.

### Phase 1, as built

Three differences from the sketch below, all in the same direction — less speculative machinery:

- **`LAYOUT_MODES` was *not* widened to four.** §1.1 said to add `kanban` and `calendar` up front and
  have the switcher offer them behind a `blockedReason`. That would have meant a switcher with two
  dead entries, and worse: `node.config` validates against `LAYOUT_MODES`, so an agent could have
  written `mode: 'kanban'` into a board that has no kanban to render it with. A mode is now added in
  the same change as its view, and `views/index.test.ts` pins that in both directions — every mode has
  a view, every view has a mode. Phase 2 adds `'kanban'` to the enum and one entry to the registry.
- **The `<select>` stayed a `<select>`** rather than becoming a segmented control. It is populated from
  `getViewDefinitions()`, which was the actual point; the control itself was cosmetic, would have
  needed new CSS, and three e2e specs drive it as `getByLabel('Show as').selectOption('value')`. Four
  options read fine as a dropdown in a 340px popover. If the segmented look is wanted, it is one
  component.
- **`ViewDefinition` ships three fields, not six.** `placesMembers` and `columnsFor` are named in a
  comment where they will go and are absent until Phase 2 gives them a consumer; `defaultSize` turned
  out to be unnecessary for table↔value, since auto-height already resizes the card.

What did land, beyond the extraction: `layout.valueColumn`, so the big number can be chosen rather
than inferred (with a fallback when the chosen column loses its summary — a stale setting must not be
able to blank a card); the zoom collapse re-expressed as "fall back to the `value` view", which is
what it always was; and one `Show as …` command per view, generated from the registry.

A view is one third of a **lens**: `QuerySpec + ViewSpec + InteractionSpec`.

- **QuerySpec** — what is in scope. Already built: `TableSource` + `groupBy` + `sorts`
  (`nodes/table/spec.ts`), executed by `queryTable` (`nodes/table/query.ts`).
- **ViewSpec** — how the answer is drawn. Half-built: `layout.mode: 'value' | 'table'` is a ViewSpec
  with two members. This plan widens it to four and gives it a seam.
- **InteractionSpec** — what a gesture on the drawing writes back to the board. Not built at all.
  This is the whiteboard-specific part, and Phases 2–3 are mostly about it.

"Lens" is the concept's name in prose only. **In code these are `view`s** — `lens` already means the
tracing lens on this board (`canvas/tracing.ts`, `TraceLayer.tsx`, `docs/relations-plan.md`), and a
second meaning would make the word useless in both places.

## What exists already (do not rebuild)

| Thing | Where | Note |
|---|---|---|
| The selector | `nodes/table/spec.ts` → `TableSource` | page / frame / connected, arrow direction and label, signed edges, ANDed filters |
| The query | `nodes/table/query.ts` → `queryTable` | rows, groups, summaries, money provenance. Pure, no store access, 878 lines of tests |
| Grouping into buckets | `query.ts` → `buildGroups` | list values land in **every** bucket they carry; `—` for empty, sorted last |
| The cache | `nodes/table/engine.ts` | `createComputedCache` + structural `areTableResultsEqual` |
| Two views | `TableNodeComponent.tsx` → `Grid`, `Headline` | `layout.mode` picks between them |
| Status stages | `properties/types.ts` → `STATUS_STAGES`, `PropertyDef.stages` | to-do / in progress / done, a fixed vocabulary |
| Option colours | `properties/options.ts` → `optionStyle`, `stageStyle`, `stageForOption` | hue derived from the label unless the property overrides it |
| Writing a value | `properties/values.ts` → `updateShapeProperties` | one undo entry, rebuilds the definition sidecar |
| Agent config | `ops/config.ts` → `node.config` | generic over a definition's own validators, so new view props are agent-drivable for free |

**There is no open issue and no prior doc for this** — `gh issue list` has five open issues, none
about collections or views. This file is the record.

## The idea, in the user's words

> If I have a kanban view, let's say I have a todo column, and I drop a sticky to the todo column, it
> should snap to the todo column and update the status. If I update the status outside the todo
> column on a sticky which I have not dragged into view, then it will automatically disappear from
> where it was and appear in the kanban column.

So a kanban is **not a picture of the board, it is a part of the board**. The cards in a lane are the
real shapes — the same stickies, notes and images that were sitting out on the canvas — moved there
by the view. Two directions, one rule:

- Change a shape's status **anywhere** → it flies into the matching lane.
- Drag a shape **into** a lane → its status is set to that lane.

Space is an input and an output at once. That is the whole feature, and it is why this is worth
building on a whiteboard rather than adopting Notion's version of it.

## Architecture in one paragraph

`layout.mode` grows from two members to four, and the branch in `TableNodeComponent` becomes a small
**view registry** — one entry per view, declaring its component, its label and whether it *places*
its members. Table and single value draw a readout and place nothing, which is what they do today.
Kanban draws lane chrome and places its members: a reaction turns the query result into desired
positions and writes them. Because a placed shape is a real shape, there is no card component to
build, no mirror to keep in sync and no fight with `pointer-events` — the card is a sticky, drawn by
tldraw, carrying its own property strip. Dragging one into another lane is an ordinary shape drag
that ends over the view, and tldraw's own drop hooks tell us where it landed.

## The invariant that makes placement safe

**Position is an output of a view, never an input to one.**

`facts.ts` says facts "deliberately exclude anything positional… so dragging a shape rewrites x/y but
leaves its facts identical, and nothing downstream recomputes during a drag". Placement writes x/y.
If membership were ever decided by geometry — "the cards inside my bounds are mine" — that write
would change the answer, the answer would change the write, and the board would oscillate at sixty
frames a second. It does not, and it must not:

- Membership comes from `queryTable` alone: shape type, frame *parenting*, arrows, filters, and
  carrying the group property. Never from bounds, containment or overlap.
- The placement reaction reads geometry (each member's `w`/`h`, the view's `x`/`y`) but **feeds none
  of it back into the query**. It is a layout pass, like a flexbox, not a selector.
- Placement writes go through `editor.run(fn, { history: 'ignore' })`. They are derived state; ⌘Z
  should undo *the status change you made*, and then watch the card walk back on its own.

The second-order version of the same rule: a view must not adopt a shape it does not own, or two
kanbans that both match a sticky will drag it back and forth forever. Ownership is explicit and
stored — see §2.5.

## Verified against tldraw 5.2.5 (do not re-derive)

Read out of the pinned `.d.ts` and source under `node_modules/.pnpm/@tldraw+editor@5.2.5…`. Add
anything further to `docs/tldraw-api-notes.md`, which is where this kind of fact lives.

1. **`ShapeUtil` has drag-and-drop hooks**: `onDragShapesIn`, `onDragShapesOver`, `onDragShapesOut`,
   `onDropShapesOver`, plus `canReceiveNewChildrenOfType` as the gate — which **defaults to `false`**,
   so a util must override it or the drop callback never fires. Fully written up in
   `docs/tldraw-api-notes.md`, including the two consequences found while building Phase 3: a drop
   target shadows a frame beneath it, and answering `true` also makes the shape a paste parent.
2. **The drop target is whatever is under the cursor** — `DragAndDropManager.dropShapes` calls
   `editor.getDraggingOverShape(editor.inputs.getCurrentPagePoint(), shapes)`. So the *pointer*
   decides the lane, not the dragged shape's centre. That is the behaviour we want and it is free.
3. **`getDraggingOverShape` returns the first shape under the point whose util defines *any* of the
   four hooks.** This is a trap: if `createNodeShapeUtil` defined them unconditionally, every node
   would become a drop target and would shadow the frame underneath it. Attach them only when the
   definition asks for them (§3.2).
4. **The info objects carry no positions** — `TLDropShapesOverInfo` is
   `{ initialDraggingOverShapeId, initialParentIds, initialIndices }`. Nothing to restore a position
   from; we do not need one, because a dropped card stays in the lane it was dropped on.
5. `onDragShapesOver` fires on the first frame over the shape and again on every cursor move, which
   is what makes a live lane highlight possible.
6. Present and used below: `editor.getPointInShapeSpace(shape, point)`, `editor.getShapePageBounds`,
   `editor.animateShapes(partials, { animation: { duration } })`, `editor.setHintingShapes`,
   `editor.run(fn, { history: 'ignore' })`.
7. **`canScroll` applies only to the shape being edited** and display mode sets `pointer-events:
   none` on the shape container — see `docs/tldraw-api-notes.md`. This is precisely why a kanban must
   place real shapes rather than draw its own draggable cards: HTML inside a node cannot be dragged
   without first double-clicking into it.

## House rules (from CLAUDE.md and the codebase)

- No `any`. Never run the dev server or a build; `pnpm typecheck`, `pnpm test`, `pnpm lint`.
- Simpler is better — if a step below can be done with less, say so in the PR and do the smaller thing.
- **One props change ships one migration** (`registry.tsx`), *unless* every added field is optional,
  which is the precedent `TableSource.direction` / `edgeLabel` / `signed` already set: tldraw
  validates props on load, so a required new field turns every persisted table into a broken shape.
  Phase 1 is deliberately additive-optional and needs **no migration entry**.
- Comments explain *why*, in prose, at the density of the surrounding files. Do not narrate the code.
- Disabling an extension hides, never removes.

---

# Phase 1 — The view seam

No new behaviour except a switcher. The point is that Phases 2 and 4 become "add an entry to a
table", not "add another branch to a component".

### 1.1 The spec — `packages/node-kit/src/nodes/table/spec.ts`

Add the fields the new views need, **all optional**. The sketch below adds all four modes at once;
**as built, each mode arrives with its own view** and only `valueColumn` landed in Phase 1 — see
"Phase 1, as built". The rest of this block is what Phases 2 and 4 add, kept here as the design:

```ts
export const LAYOUT_MODES = ['value', 'table', 'kanban', 'calendar'] as const

export interface TableLayout {
  mode: LayoutMode
  maxRows: number
  /** `value`: which column to headline. Absent keeps today's heuristic — see `Headline`. */
  valueColumn?: string | null
  /** `kanban`: lanes to draw even when empty, in this order. Absent derives them — see `laneKeys`. */
  lanes?: string[] | null
  /** `calendar`: the date property that places a row on a day. Absent draws an empty month. */
  dateProperty?: string | null
  /** `calendar`: `month` or `week`. Absent means month. */
  span?: 'month' | 'week'
  /** `calendar`: ISO date inside the shown period. Absent follows today, which is what most boards want. */
  anchor?: string | null
}
```

Validators get `.optional()` for each. `maxRows` stays required — every persisted table has one.

### 1.2 The registry — `packages/node-kit/src/nodes/table/views/index.ts` (new)

```ts
export interface ViewDefinition {
  mode: LayoutMode
  /** Shown in the config switcher and the ⌘K command. */
  label: string
  icon?: NodeToolbarIcon
  component: ComponentType<ViewProps>
  /**
   * Whether this view moves its members into position on the board. `false` for a readout — a table
   * describes shapes, a kanban rearranges them, and only the second kind may write x/y.
   */
  placesMembers?: boolean
  /**
   * What the query needs beyond the user's own columns. A kanban must add its group property as a
   * column, or `queryTable`'s row-membership rule ("carry at least one column property") is vacuous
   * and the view adopts every drawing on the page — see the gotchas.
   */
  columnsFor?(props: TableNodeProps): TableColumn[] | null
  /** Why this view cannot draw yet — "Pick a property to make lanes". `null` when it is ready. */
  blockedReason?(props: TableNodeProps, properties: ReadonlyMap<string, PropertyDef>): string | null
}
```

`views/table.tsx` and `views/value.tsx` are the existing `Grid` and `Headline` moved out of
`TableNodeComponent.tsx` unchanged, minus the `collapsed` decision, which stays in the parent.
`TableNodeComponent` becomes: run the query, look up the view, render `blockedReason` or the
component. The zoom collapse (`COLLAPSE_ZOOM = 0.35`) stays where it is and keeps meaning "draw the
headline instead", for every view.

`views/value.tsx` gains `layout.valueColumn`: when set, headline that column; when absent, today's
"prefer a summary that produces a value over one that merely counts" heuristic, unchanged.

### 1.3 The switcher — `nodes/table/TableConfig.tsx`

The `<select>` at line 114 becomes a segmented control over `getViewDefinitions()`, and each view's
own settings render under it (the lane order for kanban, the date property and span for calendar).
One `update({ layout: … })` call per change, as now.

Switching *to* a view whose natural size is different resizes the shape once, in the same
`editor.run` as the mode change — a kanban in a 360×220 box is unreadable, and an auto-size that
fought the user's own resize would be worse. Table → kanban sets `w` to lane count ×
`DEFAULT_LANE_WIDTH`.

### 1.4 ⌘K — the `tablesExtension`'s `commands` (`nodes/table/definition.tsx`)

The extension has no commands today. Add one per view: `node.table.view.kanban` and friends, titled
"Show as kanban", group `'View'`, `when: ctx => exactly one selected shape of type node.table`. This
is the seam the repo skill calls out — a verb that only means something with a shape selected cannot
be generated, so it must be written.

The extension's `label` becomes `Tables & views`, its `description` and `details` updated to say
there are four. The **id stays `lifeboard.tables`** — enablement is persisted against it.

### 1.5 Tests

- `views/index.test.ts`: every `LAYOUT_MODES` member has a registry entry (the check that stops a
  fifth view being added without one) and every entry's mode is unique.
- `spec.test.ts`: a persisted `layout` with only `{ mode, maxRows }` still validates.
- Existing `query.test.ts` and the table's rendering tests must pass untouched. If one needs
  editing, the extraction was not a move.

### Review gate

Boards open. A table looks and behaves exactly as before. The switcher offers every view that exists,
and each also has a `Show as …` command in ⌘K with a table selected. `pnpm typecheck && pnpm test`
clean.

---

# Phase 2 — Kanban: lanes, and the board files itself

The magic moment lands here, before any new gesture exists: set a sticky's Status in the properties
panel and watch it fly into the lane.

**Start by adding `'kanban'` to `LAYOUT_MODES`** (`spec.ts`) together with its registry entry, plus
`lanes?: string[] | null` from §1.1. `views/index.test.ts` fails until both halves are in, which is
the point of it. `ViewDefinition` gains `placesMembers` and `columnsFor` here, where they get their
first consumer.

### 2.1 Lane keys — `views/lanes.ts` (new, pure, tested)

```ts
export function laneKeys(
  def: PropertyDef | null,
  groups: readonly TableGroup[],
  override: readonly string[] | null | undefined
): string[]
```

Order, in precedence:

1. `override` (`layout.lanes`) when set — the user dragged the lane headers into an order.
2. For a `status` property: by stage, `todo → active → done` (`stageForOption`), then by the order
   in `def.options` within a stage. This is what makes a status property worth having: a board that
   read "Done, Blocked, To-do" because those were the biggest buckets would be nonsense.
3. For a `select`: `def.options` order.
4. Otherwise: the query's own order (biggest bucket first), which `buildGroups` already produces.

Then: any value present in `groups` but absent from `options` is appended (options are "a convenience
list, never a constraint" — `properties/types.ts`), and `—` goes last, always, because it is an
absence and not a category.

**Empty lanes are drawn.** A to-do lane that vanishes when you finish the last card is a board that
lies about what it is for.

### 2.2 The layout — `views/kanbanLayout.ts` (new, pure, tested)

One function, used by *both* the chrome and the placement, so what is drawn and where cards land can
never disagree. This is the `arrowAnchor.ts` pattern: geometry as a pure function with unit tests.

```ts
export interface LaneBox { key: string; x: number; width: number }
export interface KanbanLayout {
  lanes: LaneBox[]
  /** Shape-space y of the first card. Below the lane heading. */
  contentTop: number
  /** Page-space slots, in lane order then sort order. */
  slots(members: readonly { id: string; w: number; h: number }[]): Map<string, { x: number; y: number }>
  /** What the shape must be for the lanes to fit. */
  size: { w: number; h: number }
}
```

**Lane width is derived, not stored**: `(w - gutters) / lanes.length`. So resizing a kanban is
ordinary `resizeBox` — no new seam in `createNodeShapeUtil`, no prop to migrate, and widening the
shape widens every lane, which is what dragging a side handle looks like it should do. The cost is
that adding a lane narrows the others; the clamp below is what stops that going somewhere silly.

A card is placed at the lane's left edge at its own size — the view never resizes a member, because a
sticky's size is the user's and shrinking it to fit would lose text. A card wider than its lane
overhangs, visibly, which is the honest failure and the hint to widen the shape. Cards stack top to
bottom in the order `sorts` produced, each after the previous one's own height plus a gap.

The shape's own size follows its content, in one write per change and never during a drag: `h` from
the tallest lane (`autoHeight` already does this — `definition.tsx`), and `w` pushed up when the
derived lane width would fall below `MIN_LANE_WIDTH`. That second one is the same bargain auto-height
already makes — a box whose size is unrelated to its content is either clipping or padding.

**A kanban has no `maxRows`.** "+N more" is a thing you can say about rows you are drawing; you
cannot say it about shapes that exist. Twenty cards in a lane make a tall shape on an infinite
canvas, which is fine.

### 2.3 The chrome — `views/kanban.tsx` (new)

Lane headings, counts, a column background, and the group's own summaries where a table would put
them (`TableGroup.summaries` is already computed per group — a kanban that could not total the
points in a lane would be throwing away work the query has done). Nothing else: **the cards are the
shapes**, drawn by tldraw at their own coordinates, on top.

Lane heading colours come from `choiceStyle` / `stageStyle` (`properties/options.ts`), so a lane
matches the chip on the card.

Z-order: the view must sit *behind* its members. On switching a view to kanban, send the shape to the
back once (`editor.sendToBack`) in the same `editor.run` as the mode change. Doing it per placement
would churn indices on every layout pass.

### 2.4 Placement — `views/placement.ts` (new)

```ts
/** Installs the placement reaction. Returns a disposer, like `deleteRelationsWithShapes`. */
export function placeViewMembers(editor: Editor): () => void
```

Installed from `Board.tsx`'s `onMount`, beside `stopCascadingDeletes` — that is where this app puts
store-level behaviour that belongs to node-kit.

For each `node.table` shape whose view `placesMembers`:

1. Read its result from `getTableResult` — the same cached query the component renders, so the
   lanes and the placement can never disagree.
2. Build the desired positions from `kanbanLayout`.
3. Write only the shapes whose position is actually wrong (compare to a pixel), in one
   `editor.run(…, { history: 'ignore' })`.
4. Newly adopted shapes are **animated** into place (`editor.animateShapes`, ~200 ms). A sticky that
   teleports out from under the pointer reads as a bug; one that flies reads as filing. Shapes that
   are merely re-flowed because a card above them grew move without animation.

Coalescing: react on the query result and the view's geometry, but **defer the write** to the next
frame and skip entirely while a pointer drag is in progress (`editor.inputs.getIsDragging()`),
running once when it ends. Placement during a drag would fight the translate session for the same
x/y. This is the only place in the codebase allowed to write positions it did not ask the user for,
so keep it small enough to read in one sitting.

### 2.5 Ownership and release — `views/ownership.ts` (new)

One flat meta key on the *member*, per the `values.ts` rule about one-level merges:

```ts
// lifeboard:viewHome
{ viewId: string; x: number; y: number; adopted: 'query' | 'drop' }
```

- **Written when a shape is adopted**, recording where it was standing.
- **A view only places shapes that are unowned or owned by it.** First view to adopt wins; a second
  kanban matching the same sticky leaves it alone and draws its lane one card short. Without this,
  two views own one shape and the board oscillates.
- **Release** happens when the shape stops matching, when the view switches away from a placing
  view, and when the view is deleted — `editor.sideEffects.registerBeforeDeleteHandler('shape', …)`,
  the same manager `deleteRelationsWithShapes` hangs its binding cleanup on (`relations.ts`), and
  *before* rather than after because the doomed shape's own props are what say which members to free.
- On release, `adopted: 'query'` **goes home** — animated back to the recorded x/y — and
  `adopted: 'drop'` **stays where it is**. The rule in one line: *the view gives back what it took,
  and keeps what you handed it.* A card you dragged in has no home to return to; a card that was
  hoovered off your canvas by a status change does, and taking it away permanently would make
  changing a status feel dangerous.
- The key is cleared on release. A stale `viewId` naming a deleted shape reads as unowned.

### 2.6 Tests

- `lanes.test.ts`: stage ordering beats bucket size; unknown values appended; `—` last; an override
  wins; an empty `options` list still yields the buckets that exist.
- `kanbanLayout.test.ts`: slot positions for ragged lanes; a card taller than the lane pushes the
  next one down; a wider shape widens every lane; a shape too narrow for its lane count reports a
  bigger `size.w` than it was given (the `MIN_LANE_WIDTH` clamp).
- `placement.test.ts` (fake editor, `properties/fakeEditor.ts`): a shape whose group value changes
  gets a new position; a shape already in position is **not** written (the no-op guard, which is what
  keeps this off the undo stack and out of the persistence throttle); a shape owned by another view
  is skipped.
- One regression test worth writing by hand: run the placement, then assert the facts map compares
  equal before and after (`areFactsMapsEqual`). That is the invariant in §"The invariant", pinned.

### Review gate

On a real board: a kanban with a Status property draws its lanes; setting a sticky's status in the
properties panel flies it into the lane; clearing the status flies it home. Dragging the *view*
around does not scatter its cards. `__rollupStats.aggregateRecomputes` does not move while dragging
an unrelated shape.

---

# Phase 3 — The drop gesture

### 3.1 The definition seam — `packages/node-kit/src/registry.tsx`

Two optional fields on `NodeDefinition`, deliberately narrow — a node says what a drop *means*, not
what happens to the store:

```ts
/** Something dragged over this node. Return the drop target under the pointer, or null. */
getDropTarget?(ctx: { editor: Editor; shape: NodeShape<Props>; point: VecLike }): DropTarget | null
/** Shapes released over this node, on the target `getDropTarget` last reported. */
onDropShapes?(ctx: { editor: Editor; shape: NodeShape<Props>; shapes: TLShape[]; target: DropTarget }): void
```

`DropTarget` is `{ key: string; label: string }` — the lane key or the ISO day, plus what to call it
in a hint.

### 3.2 Factory wiring — `createNodeShapeUtil`

Attach `onDragShapesOver` / `onDragShapesOut` / `onDropShapesOver` to the util's prototype **only
when the definition declares `onDropShapes`**. Verified fact 3 above: a util that defines any of
these becomes a drop target for everything, so an unconditional definition would make every note on
the board shadow the frame it sits in.

`canReceiveNewChildrenOfType` stays default — the name is about children, and we are not creating
any, but it is the gate tldraw filters the dropped shapes through.

Nothing is reparented. A member stays a child of the page (or of whatever frame it was in), because
`parentId` is a *fact* — `scope: 'frame'` queries read it — and silently reparenting a shape into a
view would change what every frame-scoped table on the board says.

### 3.3 The write — `views/interaction.ts` (new)

```ts
export function applyDrop(editor, view: NodeShape<TableNodeProps>, shapes, target): void
```

One `editor.run` with one `markHistoryStoppingPoint('drop into view')`:

1. `updateShapeProperties(editor, shape, { [groupBy]: target.key })` per dropped shape — the same
   function the panel uses, so the definition sidecar is rebuilt and pasting elsewhere still works.
2. A shape that does not yet carry the property **gains it** (`attachProperty` semantics). Dropping a
   plain sticky into "To-do" is how a sticky joins the board — the Notion move, and the reason
   membership requires carrying the group property (§gotchas).
3. Mark it `adopted: 'drop'` (§2.5), so releasing it later leaves it where it stands.
4. The `—` lane clears the value rather than writing the string `'—'`.

Placement then puts it in the slot on the next frame — one code path for "dropped" and "changed
elsewhere", which is what the user asked for.

⌘Z undoes the property write; the placement follows on its own because it is `history: 'ignore'`.
That is the intended reading of undo here: you take back the *decision*, and the board rearranges.

### 3.4 The hint

`onDragShapesOver` → resolve the lane under the pointer → store it in a module-scope signal keyed by
view id → the kanban component reads it and lights that lane. Cleared on `onDragShapesOut` and on
drop. Module-scope and *not* on the shape: which lane you are hovering is not board data, and writing
it would put a store transaction on every mouse move.

`editor.setHintingShapes([viewShape])` alongside it, so the view gets tldraw's own target outline for
free.

### 3.5 Dragging a card out — **built, and it is the inverse gesture**

The plan said "the view wins": a card dragged off its lane walks back, and the way out is to change the
property. That lasted until someone tried it. Filing a card by dragging it *in* makes the reverse
gesture the obvious one, and a board that accepts a card but refuses to give it back reads as broken
rather than careful.

So: **drag a card out of the lanes and drop it on open canvas, and the lane property is removed.**

- **Removed, not blanked.** A card carrying an empty Status still *carries* it, and membership is
  "carries the lane property" — so blanking would pull it straight back into the empty lane.
- **Its home is cleared with it**, so nothing sends it anywhere afterwards. It stays where it was put.
- **One history entry**, so ⌘Z gives the status back and the card walks into its lane on its own.
- The toast-confirmation idea is dropped. Undo *is* the confirmation, and it is already there.

`watchViewDragOut` (`views/interaction.ts`, installed from `Board.tsx`) recognises the gesture from
`inputs.getIsDragging()` rather than a tldraw hook: `onDragShapesOut` fires mid-drag, and a release over
empty canvas reaches no shape at all, so there is no callback to hang this on. Two guards make it a
*gesture* rather than a geometry rule, and both matter:

- **It must have moved.** `isDragging` is set for marquee-selecting and resizing too. Without this,
  brushing a selection across the board would strip the status off every card it touched — pinned by an
  e2e test that does exactly that and asserts nothing changed.
- **Its centre must have ended outside the view** (the same test tldraw's paste-reparenting uses), so a
  card dropped on another lane, or left half-hanging off the edge of one, stays a member.

### 3.6 Tests

- `interaction.test.ts` (fake editor): drop writes the lane's value; a shape without the property
  gains it; the `—` lane clears it; a multi-shape drop is one history entry.
- e2e (`apps/web/e2e/views.spec.ts`, new): create a kanban, drag a sticky over a lane, release, and
  assert **from the store** that its `lifeboard:props` changed and that it ended up inside the lane's
  page bounds. The store assertion is the point — a DOM assertion would pass on a card that merely
  looks right. `window.editor` is already exposed for this (`Board.tsx`).
- The e2e is also where fact 3 gets pinned: a second test drags a sticky onto a *note* inside a frame
  and asserts the frame still adopts it, which fails loudly if the drop hooks are ever attached
  unconditionally.

### Review gate

Drag a sticky into "Doing" — it snaps into the lane and its Status reads Doing. ⌘Z puts the status
back and the card leaves. Dragging over lanes highlights them one at a time. Dropping a sticky into a
frame elsewhere on the board still works.

---

# Phase 4 — Calendar

A calendar is a kanban whose lanes are days, with two differences that matter.

### 4.1 It buckets by day, and the query already can

Add a `date:` grouping prefix beside `currency:` (`spec.ts` — `CURRENCY_GROUP_PREFIX` is the
precedent, including the reasoning for a namespace over a reserved id). `groupBy: 'date:due'` buckets
rows by the ISO day of their `due` value, so `buildGroups` does the work and the view fills a grid
from the buckets. Empty days come from the grid, not the query — a month has 30 cells whatever the
board contains.

`views/calendarLayout.ts`: month (6×7 cells) or week (1×7), anchored on `layout.anchor` or today.
Pure, tested, same shape as `kanbanLayout`.

### 4.2 It draws chips, not shapes — **superseded, see "Phase 4, as built"**

`placesMembers: false` for month span. A day cell in a month grid is ~100px wide; a real sticky does
not fit in one, and shrinking members to make them fit breaks the rule that a view never resizes what
it did not create. So a month calendar is a **readout**: each day lists its rows as chips, labelled
and coloured, with "+N more" — which a readout is allowed to say.

The drop gesture still works, and this is the interesting part: `getDropTarget` returns the day under
the pointer, and `onDropShapes` writes the **date** rather than a lane key. Drag a note onto the 14th
and it is due on the 14th, without the note going anywhere. Space as an input, with no adoption.

Week span is where adoption earns its place (a 7-column week is a kanban with dates for lanes) — put
it behind the same `placesMembers` flag and ship it only if the week view looks right.

### 4.3 Tests

- `calendarLayout.test.ts`: month grids starting on each weekday; a 6-week month; week spans across a
  month boundary; the anchor defaulting to today (injected, never `Date.now()` inside the pure fn).
- `interaction.test.ts`: dropping on a day writes an ISO date the `date` property's own formatter
  reads back unchanged.

### Review gate

A calendar shows the current month with its cards on the right days; dragging a card to another day
changes its date; a board with no date property says so instead of drawing an empty month.

---

# Phase 5 — Surfaces and documentation

Per `.claude/skills/extension-surfaces`, worked in order.

- **`apps/web/src/app/help/sections/Tables.tsx`** — rewrite around the four views. Add a demo per
  view built from `help/kit.tsx` and the `lb-demo__*` classes (mock-ups from app tokens, never
  screenshots). The kanban demo must show the two-way rule, because that is the thing nobody will
  guess: a card moving *into* a lane and a status change moving one *out*.
- **`sections/Shortcuts.tsx`** — command bindings appear by themselves; add rows only for the drag
  gestures, which are not commands.
- **`sections/Overview.tsx`** — `DOCK_GROUPS` is unchanged: no new node type, so the dock is unchanged.
- **`README.md`** — the Nodes & extensions table row for Tables becomes Tables & views, with the four
  named.
- **The extension's own copy** (`nodes/table/definition.tsx`) — `description` and `details`, which are
  what Settings → Extensions renders.
- **Agent surface** — nothing to write. `node.config` is generic over a definition's validators, so
  `{"layout":{"mode":"kanban"},"groupBy":"status"}` already works. Verify it once and say so in the PR;
  if the JSON turns out to be hard for a model to get right, that is an argument for a
  `view.set` operation, not for hand-coding table knowledge into `ops/config.ts`.
- **The drag-out-to-remove gesture** (§3.5), with a toast confirmation, if it still seems wanted after
  living with Phase 3.

---

## Deferred — the rest of the view list

Tracked as **issue #24**, which carries the current version of this table plus the three smaller
deferred items (per-lane totals, the adoption animation, a lane-reordering UI). Kept here because the
seam below was judged against these, not because they get built now: each is a `ViewDefinition` plus a
layout module, and none needs a change to the query.

| View | What it needs beyond the seam |
|---|---|
| **Gallery** | An image per row — a `getThumbnail` on the node definition, or reading the shape's own asset. `placesMembers: false`. |
| **Timeline** | Two date properties (start, end) and a horizontal scale. The layout is `kanbanLayout` with a time axis instead of lanes. |
| **Two-axis matrix** | Two numeric properties, and an InteractionSpec that writes **both** on one drop — the first target that is a point rather than a bucket. `DropTarget` grows a `values: Record<string, PropertyValue>` for this; do not force it into `{ key }`. |
| **Relation graph** | Reads `getPageEdges`, not `queryTable` groups. Placement is a force layout, which is a genuinely different beast and probably its own node type. |
| **Chart** | Summaries per group are already computed (`TableGroup.summaries`); this is a renderer, and the `dataviz` skill applies. |
| **Spatial cluster** | The only one that would break the invariant — it wants to *read* positions. It can, as long as it never writes them: a view is allowed to be one-way. |

## Gotchas checklist (read before coding)

1. **A kanban must add its group property as a column.** `queryTable`'s membership rule is "carry at
   least one of the table's column properties… a table with no property columns at all keeps every
   match" (`query.ts`, the comment above the `columnKeys.length` check). A kanban whose user has
   chosen no columns therefore matches *every shape on the page* — drawings, frames, the intro note —
   and would adopt them all. `columnsFor` (§1.2) exists for exactly this and is not optional.
2. **Never attach the tldraw drop hooks to every node** (verified fact 3). Guard on the definition.
3. **Placement writes are `history: 'ignore'`**, and must be skipped entirely when nothing moved. A
   write per frame during a drag would spam tldraw's persistence throttle and could cost a board its
   pending write on unmount (see `DRAIN_MS`, `app/App.tsx`).
4. **Do not reparent members.** `parentId` is a fact and `scope: 'frame'` reads it.
5. **Do not put positions into the query.** Not in `TableSource`, not in `ShapeFacts`, not as a
   render-time filter over the result. See the invariant.
6. **A view never resizes a member.** Overhang is the honest failure.
7. **`meta` is untyped JSON** — parse `lifeboard:viewHome` defensively and treat malformed as absent,
   the same posture as every read in `properties/`.
8. **The view excludes itself** — `queryTable` already refuses `id === selfId`, but a *second* view on
   the page is an ordinary shape to the first. It carries no property values (no `extractValues`), so
   rule 1 keeps it out. Test it anyway.
9. **`Date.now()` stays out of the pure layout modules.** The calendar's "today" is a parameter, or
   the tests cannot be written.
10. **One undo entry per user action.** A drop is one: the property write, the ownership mark, and the
    attach all go in one `editor.run`.
