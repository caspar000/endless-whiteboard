# Relations, made usable — implementation plan

Status: **Phases 1–4 are done**, Phase 4 awaiting review. One phase remains (documentation). Written
to be executed without prior context: every step names its files and cites the code it must follow.

### Phase 4, as built

- **The aura is a drawn outline, not a filter.** §4.4 offered two techniques; neither survived
  contact. Technique A's convex hull could not produce the reference sketch's *pinched* envelope, and
  technique B (the metaball filter) is a full filter pass per frame. What shipped is A's machinery
  applied per shape: each traced shape gets its own outline, and each traced relation gets a line
  drawn along the one tldraw actually drew. So it is **one aura per traced thing rather than one
  envelope around the group** — the visible difference from the sketch, and on a hub with six
  neighbours it is the better answer. The metaball variant is still the way to the exact sketch.
- **Sums of sines were replaced by fractal noise** (`noise.ts`) after review: however many waves are
  added, a harmonic sum stays periodic and the eye finds the period, so it read as "amplitude
  manipulation" rather than as a drawn line. What generates natural outlines is **fBm** — octaves of
  gradient noise at doubling frequency and shrinking amplitude — with **domain warping**
  (`fbm(p + fbm(p))`), which is what turns roughness into *shapes*: inlets, peninsulas, curls.
  - The closure trick is worth knowing: each point on the outline maps to a point on a **circle**
    through the noise field, so going once round the shape arrives back at the value it started from.
    That makes the curve seamless *structurally*, for any settings — where the sine version needed
    whole numbers of cycles arranged by hand. Animation slides the circle's centre through the field,
    so the pattern evolves continuously and **never repeats**.
  - fBm is normalised by the sum of its own octave amplitudes, so it cannot leave [-1, 1]. That is
    what keeps `auraReach` knowable, and the layer pads its SVG by exactly that.
- **The preset became a signal with a slider panel** (`auraPreset.ts`, `settings/AuraAdvanced.tsx`).
  Taste settled by describing numbers to each other converges slowly; a slider per parameter converges
  in one sitting. It started as a floating panel on the canvas and moved, after review, to
  Settings → Canvas → Advanced behind a closed disclosure — with a **live animated preview**, because
  Settings is a page of its own and the canvas is not on screen to look at. Defaults are the values
  that came back from that session.
- **The outline is filled** at 10% of the stroke colour (`fill-opacity`, so it needs no `color-mix`).
  The layer is behind the shapes, so what this tints is the ring between the outline and the card —
  and a *transparent* shape lets it through, which reads correctly.
- **No blur filter.** The path is rebuilt thirty times a second, so a filter would be re-run on every
  frame; `softness` is on the preset for experiment but defaults to 0, which skips the pass entirely.
- **`filter: opacity()` for the dim, not `opacity`.** tldraw writes each shape's opacity as an inline
  style, so a stylesheet rule would lose to it. Going through `filter` also composes correctly: a
  shape the user set to 50% ends up at half the dim.
- **The lens survives switching boards** but not closing one. It is a way of working, like a chosen
  tool, and an open tab keeps its editor mounted — a mode that switched itself off whenever you
  glanced at another board would be worse than one that persisted. What must not travel is the
  *root*, and it cannot: the trace is guarded on the shape still being on this board.
- **The wire is a drawn line, tapered to nothing at both ends** so it meets the arrow's terminals
  rather than wandering off them. It started as a wide soft glow, which needed to be much wider than
  first written to show past the arrow's own stroke at all — and then went away entirely when the
  crisp preset landed. Only visible by looking; no test would have caught either.

### Phase 3, as built

- **tldraw does the geometry.** §3.1 called for a hand-written midpoint per arrow kind; it turned out
  `Geometry2d.interpolateAlongEdge(t)` is public and walks a straight edge, an arc and an elbow route
  identically, so there is no per-kind branch to get wrong. The label box likewise arrives as a child
  of the arrow's geometry marked `isLabel` — so following a *dragged* label needs no code at all.
  What is left in `arrowAnchor.ts` is the rule (label → hang off its underside; none → the point on
  the line where a label would go), which is what the unit tests are about.
- **`width: max-content` is load-bearing, not cosmetic.** `.tl-html-layer` is `width: 1px`, so a
  strip with no explicit width shrink-to-fits against nothing and lands on *min*-content — every
  property name rendered as "Am…". A strip under a shape never hit this because it is given the
  shape's width inline.
- **The strip is lifted above the shape layer.** `OnTheCanvas` is inside the camera transform but
  painted *before* the shapes, so the arrow was drawn over its own card and the line cut through the
  values. The z-index is derived from tldraw's own scheme (`maxShapesPerPage * 3`, just past the
  range shapes occupy) rather than being a large guess. Consequence worth noting: an arrow's strip
  now paints over any shape its midpoint happens to sit on — the same bargain tldraw makes for its
  own arrow labels.

### Phase 2, as built

- **The view model went into node-kit** (`relationView.ts`), not the app as §2.2 sketched. The agent
  operation needs it too, and operations live in node-kit — so the app-side file is now just the
  `getShapeVisibility` callback (`canvas/relationVisibility.ts`).
- **`alt+r` was already taken** by tldraw (rotate — `uiOverrides.tsx` says so in a comment written
  long before this). The cycle is `alt+shift+r`, and it is registered as a **tldraw action**: the
  command registry's `kbd` is display-only, and nothing else on the canvas hears keystrokes.
- **Setting the view is `history: 'ignore'`.** Changing what you look at is not an edit; without this
  you hide the wiring, spot a typo, press ⌘Z and get the arrows back instead of the typo.
- **Hidden shapes are deselected** (`deselectHiddenShapes`, one reaction in `relationVisibility.ts`).
  Not in the original plan, and needed by the *primary* gesture: without it, clicking a relation and
  pressing the eye button leaves a selection ring and a toolbar floating over empty canvas. One
  reaction covers every door in — button, ⌘K, keyboard, agent.
- **Board thumbnails follow the view**, as §2.5 predicted: a board captured in `none` has no
  relations in its preview. Left as is — the preview should show what the board looks like.

### Phase 1, as built

Three things were built slightly differently from the sketch below, and the differences are worth
keeping:

- **`relationEnds` was extracted** (`relations.ts`) and `getPageEdges` now calls it. The rule "both
  ends bound, no self-loops" was about to have a second copy in the selection toolbar, which is the
  exact drift the file's own header warns about. One definition, two readers.
- **The hidden flag stores `false` rather than being deleted** when a relation is shown again: a
  shape partial cannot remove a meta key, because tldraw merges `meta` entry by entry, so an
  `undefined` would be written as `undefined` and fail validation.
- **An e2e spec was added** (`apps/web/e2e/relations.spec.ts`), which §1.5 did not ask for. It is
  there for one claim only — that shift-drag still *binds*. Verified by disabling the §1.3 override
  and watching the test fail with `bound: 0`, which is what that failure looks like in the wild: an
  arrow that appears correct and is not a relation at all.

## The problem, from a real board

A weekly-meals board with thirteen relations is unreadable. Every arrow is drawn at full strength
whether or not you are currently thinking about it, so the canvas reads as a ball of string; and each
arrow's properties (`Amount → 200 g`) are rendered at the bottom-left corner of the arrow's *bounding
box*, which for a long diagonal is nowhere near the line — a column of stray `Amount` labels floating
in empty space, belonging to nothing you can identify.

Three fixes, in the order they depend on each other:

1. A relation can be **hidden**: the connection is real and still counts, it just isn't drawn.
2. Hidden relations can be **brought back** — board-wide (a three-state view) or one node at a time
   (a tracing lens that glows a node, its relations and its neighbours).
3. An arrow's **properties move to the middle of the line**, under its label, where they can be read
   as belonging to that arrow.

## Architecture in one paragraph

Three features, one seam. A relation gets **one bit of stored state** — `meta['lifeboard:relHidden']`
on the arrow shape — and everything else is a *view* over it: whether tldraw draws the arrow
(`getShapeVisibility`), how it is drawn (a dash derived at render time and never stored), and what
glows (a traced-id set). Nothing here touches `edges.ts` or the facts pipeline (§4.3): a hidden
relation is still an edge, so tables, rollups, collections and `{…}` expressions keep counting it.
That is the entire point of hiding — the data stays, the clutter goes.

## The invariant that keeps this cheap

**`Edge` does not gain a `hidden` field, and `getPageEdges` does not learn about visibility.**

`edges.ts` says an edge holds "nothing positional" so that dragging cannot invalidate a query. The
same discipline applies to visibility: hiding a relation is a *view* decision, and if it reached the
edge index then `areEdgeIndexesEqual` would report a change and every table on the board would
re-query because someone tidied up their arrows. Worse, it would invite a future reader to filter
hidden edges out of a rollup, which would make "hide" mean "delete" — the opposite of the feature.

Consumers that legitimately need the bit (the selection toolbar, the agent's `relation.list`) read it
off the arrow shape directly. There is exactly one function that answers the question
(`isHiddenRelation`), so there is one definition to disagree with.

## Verified against tldraw 5.2.5 (do not re-derive)

| Fact | Evidence | Why it matters |
|---|---|---|
| `<Tldraw getShapeVisibility={(shape, editor) => 'hidden' \| 'inherit' \| 'visible'}>` exists | `TldrawEditorBaseProps`, `TLEditorOptions` in `@tldraw/editor` | The whole hiding mechanism. View-only: nothing is written to the store, so no undo entries and no sync churn. |
| A hidden shape is not rendered, not hit-tested, not hoverable, not brush-selectable | `Editor.js` — `isShapeHidden` guards in `getShapeAtPoint`, `getShapesAtPoint`, the rendering shape list | Hidden relations get out of the way completely, with no work from us. |
| `getCurrentPageShapes()` does **not** filter hidden shapes | `Editor.js:4463` | `getPageEdges` still sees hidden relations, so rollups and tables are unaffected **by construction**. This is the load-bearing fact of the whole plan. |
| `getIsShapeHiddenCache()` is `@computed`, and the per-shape entry is a computed keyed on the shape record | `Editor.js:578-590`, `__decorateClass([computed], …, "getIsShapeHiddenCache")` | Signals read inside our callback are tracked, so flipping a view mode repaints without any manual invalidation — but the callback must stay **cheap**, because it re-runs for every shape tldraw asks about. |
| Shift during arrow creation snaps the dragged handle to 15° steps around the other handle | `DraggingHandle.js:233-247` (`snapAngle(angle, 24)`) | This is the conflict with "shift = hidden", and §1.3 is how it is resolved. |
| The binding target is chosen from the (snapped) handle point | `ArrowShapeUtil.onTerminalHandleDrag` → `updateArrowTargetState({ pointInPageSpace: … })` | Left alone, shift-drawing would sometimes fail to bind at all — the arrow would silently stay a doodle. |
| `getArrowInfo(editor, shape)` is public; arc/straight arrows expose `middle` | `index.d.ts:2428`, `TLArcArrowInfo.middle` | Phase 3's anchor point. |
| `TLComponents.ShapeWrapper` is an overridable slot; the default renders `data-shape-id` | `index.d.ts:8215`, `DefaultShapeWrapper.js:45` | Phase 4's glow attaches here — a data attribute plus CSS, no injected stylesheets and no per-shape-util changes. |
| Per-board state belongs in `editor.getDocumentSettings().meta` | `properties/schema.ts:26` (`readPropertyRegistry`) does exactly this | The board's relation-view mode gets the same home the property registry already has. |

## House rules (from CLAUDE.md and the codebase)

- pnpm. Never `any`. **No new dependencies.** Don't run `pnpm dev` or builds; verify with
  `pnpm -r typecheck` and `pnpm -r test` (and `pnpm --filter @lifeboard/web test:e2e` where a phase
  adds one).
- tldraw is pinned at exactly `5.2.5`. Do not touch its version.
- Comments explain *why*, densely. Match that register — this codebase reads like prose.
- Styling: hand-written `lb-*` classes in `apps/web/src/styles.css`, colours only through `--lb-*`
  tokens, working in both themes.
- Every phase ends green and shippable on its own. A phase that needs the next one to be usable is
  mis-scoped.

---

# Phase 1 — Two kinds of relation

**What lands:** you can mark any relation hidden, and a hidden relation draws as a dashed arrow.
Shift-drag creates one directly, with the dash appearing live as you draw.

**Deliberately not in this phase:** nothing actually disappears yet. Marking and hiding are separated
so the dashed look can be judged before anything vanishes, and so Phase 1 cannot strand a board full
of arrows nobody can find.

### 1.1 The bit — `packages/node-kit/src/relations.ts`

Extend the module that already owns "drawing and undrawing a relation":

```ts
export const HIDDEN_RELATION_META = 'lifeboard:relHidden'
export function isHiddenRelation(shape: TLShape): boolean
export function setRelationHidden(editor, arrowId, hidden, opts?): boolean
export interface ConnectOptions { markHistory?: boolean; hidden?: boolean }  // hidden added
```

`connectShapes` writes the meta at creation when asked. `setRelationHidden` refuses anything that is
not an arrow and returns `false`, the same way `disconnectShapes` does — the callers here are an
agent operation that must produce a readable failure and a UI control that must do nothing.

Export all three from `packages/node-kit/src/index.ts`.

### 1.2 The look — `apps/web/src/canvas/expressionShapeUtils.tsx`

`ExpressionArrowShapeUtil` already hands its parent a *derived* shape (`useExpressionShape`) whose
text has been substituted without anything reaching the store. The dash rides the same seam:

```ts
override component(shape: TLArrowShape) {
  return super.component(useRelationDash(useExpressionShape(this.editor, shape)))
}
```

`useRelationDash` returns the same object reference unless the shape is a hidden relation, in which
case it returns `{…shape, props: {…shape.props, dash: 'dashed'}}`. Derived rather than stored,
because the meta flag must stay the single source of truth: storing `dash` too would let a user
change the dash style and half-unhide their relation.

Do the same for the **indicator** (`getIndicatorPath` is unaffected — it's the component that draws
the line, so this is one override, not two). Verify the arrowhead still renders dashed-adjacent; if
tldraw's dashed arrowhead reads badly at `size: s`, note it for review rather than fixing it here.

### 1.3 The gesture — shift-drag draws a hidden relation

This is the one genuinely fiddly part, and it has two halves.

**Making shift mean something new.** tldraw already uses shift while dragging an arrow handle to lock
the angle to 15° steps *around the opposite handle* (`DraggingHandle.js:243`). That state is not
exported, so it cannot be subclassed cleanly — but it does not need to be. The angle lock is applied
to the handle point *before* `ArrowShapeUtil.onHandleDrag` is called, and we already own an
`ArrowShapeUtil` subclass. Override `onHandleDrag` and, **only when the opposite terminal is already
bound to a shape** — i.e. you are drawing a relation, not a doodle — replace `info.handle` with the
true pointer position (`editor.inputs.getCurrentPagePoint()`, mapped into shape space via
`editor.getShapePageTransform(shape.id).clone().invert()`) before delegating to `super`.

Two things make this defensible rather than a hack:

- Angle-locking a relation is *already* meaningless: once both ends are bound, tldraw recomputes the
  line from the two shapes' bounds every frame and throws the dragged geometry away. The lock's only
  observable effect on a relation is the harmful one — an endpoint snapped off its target so the
  binding never forms.
- Shift keeps its normal meaning for every arrow that is not a relation, which is the only case where
  a locked angle survives.

**Making it stick.** The same override adds `meta: { [HIDDEN_RELATION_META]: true }` to the partial it
returns when shift is held (and removes it when not), so the flag is written by the same
`editor.updateShapes` call that is already running on every pointer move. That gives the live dashed
preview for free — §1.2 derives the dash from the flag, so preview and result are the same code path
— and puts the flag inside the creation's history mark, so one undo removes the whole thing.

Known edge: releasing shift without moving the pointer won't repaint until the next move, because
`onHandleDrag` is driven by pointer events. Acceptable; revisit only if it reads badly.

### 1.4 Flipping an existing relation

- **Selection toolbar** (`apps/web/src/canvas/SelectionToolbar.tsx`): when the only selected shape is
  an arrow bound at both ends, show a toggle button (lucide `Waypoints` / `EyeOff`, decide by look)
  before the properties button. It must be gated on *being a relation* — offering "hide relation" on
  a doodle would promise something that does nothing.
- **⌘K** (`apps/web/src/app/appCommands.ts`): `relation.toggle-hidden`, group `CANVAS_GROUP`, with a
  `when` that checks the selection is a single bound arrow. Per the palette's own rule, a command
  that cannot apply is not offered rather than offered-and-failing.
- **Agent** (`packages/node-kit/src/ops/relation.ts`): `relation.connect` gains a `hidden` boolean
  param; `relation.list` reports `hidden` per relation; a new `relation.set-hidden` takes the arrow
  id and a boolean. Descriptions must explain the *meaning* ("still counted by tables; just not
  drawn"), because that is the thing an agent will otherwise get wrong.

### 1.5 Tests

`packages/node-kit/src/relations.test.ts` already asserts the round trip "what `connectShapes` writes
is what `getPageEdges` reads back". Extend it with the claim this phase actually makes:

- `connectShapes(…, { hidden: true })` produces an arrow that `isHiddenRelation` recognises **and**
  that still appears in the edge index built the same way `getPageEdges` builds it.
- `setRelationHidden` round-trips, refuses non-arrows, and refuses a missing id.
- `ops.test.ts`: `relation.connect` with `hidden`, `relation.list` reporting it, `relation.set-hidden`
  failing readably on a bad id.

### Review gate

Draw a few relations with and without shift; toggle some from the toolbar and from ⌘K. Judge: does
the dashed weight read as "quieter" rather than "broken"? Does shift-drag bind reliably to small
targets (the case §1.3 exists to protect)? Is one undo enough to remove a shift-drawn relation?

---

# Phase 2 — Hiding, and the board's three-state view

**What lands:** hidden relations actually disappear, and the board gets a three-state relation view —
**All** (everything drawn, hidden ones dashed) → **Normal** (each relation's own setting is respected)
→ **None** (no relations drawn at all).

The third state is what makes hiding safe: before the tracing lens exists, **All** is how you find a
relation you hid and forgot about.

### 2.1 The resolution rule — `packages/node-kit/src/relations.ts`

One pure function, unit-tested, that nothing else may second-guess:

```ts
export const RELATION_VIEWS = ['all', 'normal', 'none'] as const
export type RelationView = (typeof RELATION_VIEWS)[number]
export function isRelationDrawn(view: RelationView, hidden: boolean, traced: boolean): boolean
```

`traced` is Phase 4's input, wired now and always `false` until then — the alternative is editing this
function twice and getting the precedence wrong the second time. Precedence: a traced relation is
always drawn, then the view mode, then the relation's own flag.

### 2.2 Per-board storage — `apps/web/src/canvas/relationView.ts` (new)

`editor.getDocumentSettings().meta['lifeboard:relationView']`, read/written exactly the way
`properties/schema.ts` reads and writes the property registry (`updateDocumentSettings`, merging the
existing meta). Per board, survives reload, syncs across tabs for free, and needs no atom — document
settings are a store record, so a computed that reads it is invalidated when it changes.

Parse defensively (`'normal'` for anything unrecognised): the same rule the property registry uses —
one bad value must cost that value, never the board.

### 2.3 Wiring — `apps/web/src/canvas/Board.tsx`

Add `getShapeVisibility` to `<Tldraw>`. **It must be a module-scope constant**, not an inline arrow:
Board.tsx already documents that props feeding the Editor constructor remount the editor when their
identity changes, and a remount inside tldraw's persistence throttle window discards the pending
write along with camera, selection and undo history.

```ts
const getShapeVisibility = (shape: TLShape, editor: Editor) =>
  shape.type === 'arrow' && !isRelationDrawn(...) ? 'hidden' : 'inherit'
```

Inside it, cheapness is the constraint (see the verified-facts table). Two rules:

- Decide "is this arrow a relation?" with `editor.getBindingsFromShape(shape, 'arrow')` — two bound
  terminals — **not** with `getPageEdges`. An arrow with a loose end is a drawing, and the relation
  view must not make someone's sketch vanish.
- Never build a set or walk the page here. Phase 4's traced ids arrive as a prepared `Set` for
  exactly this reason.

### 2.4 The control

- **Canvas toolbar** (`CanvasToolbar.tsx`): a three-state button in the dock, cycling on click, with
  the icon carrying the state (lucide `Waypoints` / `Spline` + a slash for None). It is a view
  control, not a tool, so it belongs visually apart from the tool buttons — propose placement in the
  PR rather than guessing here.
- **⌘K**: `view.relations.all` / `.normal` / `.none`, plus `view.relations.cycle` with a keybinding
  (suggest `alt+r` — verify against tldraw's own bindings first; the palette displays `kbd` but
  tldraw dispatches it, so a clash is silent).
- **Agent**: `view.relations` operation taking a mode, in `ops/view.ts`. The rationale in that file's
  header applies directly — an agent that draws ten relations onto a board in **None** mode has done
  invisible work.

### 2.5 The two things that break if forgotten

- `ForeignPropertyStrips.tsx` renders a strip for every shape carrying properties, arrows included.
  A hidden arrow must be skipped (`editor.isShapeHidden(shape)`), or the board keeps a floating
  `Amount 200 g` with no line under it. (Phase 3 relocates these strips, but Phase 2 must not ship
  the orphan.)
- Board thumbnails and image export both go through tldraw's renderer, so a board captured in
  **None** mode has no relations in its preview. That is arguably correct — it is what the board
  looks like — but it must be a decision, not a surprise. Record it in the PR.

### 2.6 Tests

- Unit: `isRelationDrawn` across all nine combinations (3 views × hidden/visible, plus traced).
- Unit: the document-settings read/write round trip, including the bad-value fallback.
- e2e (`apps/web/e2e/`): draw two relations, hide one, cycle the view, and assert on **store state**
  (`editor.isShapeHidden(id)`) rather than the DOM — the pattern `smoke.spec.ts` and `perf.spec.ts`
  already use via the `window.editor` seam.
- e2e regression, and the one that matters most: **a table scoped to `connected` returns the same rows
  with the relation hidden as with it visible.** That is the whole invariant, asserted end to end.

### Review gate

Hide half the arrows on a busy board and see whether it reads better. Check the cycle is discoverable
and that **All** genuinely rescues a forgotten relation.

---

# Phase 3 — Properties in the middle of the arrow

**What lands:** an arrow's property strip moves from the bounding-box corner to the middle of the
line, stacked directly under the arrow's own label.

### 3.1 The anchor — `apps/web/src/canvas/arrowAnchor.ts` (new, pure, tested)

A function from an arrow's `getArrowInfo` result to a page point:

- `straight` / `arc`: `info.middle`, transformed to page space with
  `editor.getShapePageTransform(shape.id)`.
- `elbow`: walk `info.route` accumulating segment lengths and take the point at half the total. Worth
  the twenty lines — an elbow arrow's naive midpoint can land outside the route entirely.
- Respect `props.labelPosition` (0–1) when it isn't the default: the label has been dragged along the
  line, and the properties belong with it, not at the geometric middle.

Pure and separately tested because it is geometry, which is precisely what the repo's own guidance
says to unit-test.

### 3.2 The placement — `ForeignPropertyStrips.tsx`

Arrows stop going through the generic "bottom-left of the bounds" path and get their own:

- Positioned at the anchor point, translated by `-50%` horizontally so the strip is *centred* on the
  line rather than starting at it.
- Offset downward by the label's height when the arrow has a label, so the two stack (label on top,
  properties under it) around one shared anchor. Read the label's presence from the shape's rich text;
  measure with the same auto-height approach `useAutoHeight.ts` uses, or — simpler and probably
  enough — a fixed offset derived from the arrow's `size` style. Start simple; the review will say.
- The strip needs to be legible over the line it sits on: a background pill from `--lb-*` tokens
  rather than bare text on the canvas. Keep `pointer-events: none` — the existing comment in
  `styles.css` explains why (swallowing clicks would break dragging the shape it belongs to).

Keep the strip *hidden* while the arrow is being dragged or its handle moved, if it flickers — check
before adding the complexity.

### 3.3 Tests

- Unit: the anchor function over straight, arc, elbow, and a dragged `labelPosition`.
- e2e: give a relation a property and assert the strip's screen position is within a few pixels of the
  line's midpoint — i.e. that it moved off the corner. This is the one visual claim of the phase and
  it is cheap to pin.

### Review gate

The meals board from the screenshot, reloaded: can you now tell which `Amount` belongs to which arrow?

---

# Phase 4 — The tracing lens

**What lands:** a mode you switch on; while it is on, clicking a shape reveals the relations touching
it (hidden ones included, still dashed) and wraps that shape, those relations and the shapes at their
far ends in one **animated hand-drawn aura** (§4.4) — the whole traced group inside a single wobbling
envelope, drifting slowly. One hop. Everything else on the board dims.

### 4.1 State — `apps/web/src/canvas/tracing.ts` (new)

Two module-scope signals, following `propertiesTarget.ts` exactly (including its warning: module-scope
state must be cleared on board unmount, or the next board traces a shape that isn't on it).

```ts
const tracingOn = atom<boolean>('lifeboard:tracing', false)
const traceRoot = atom<TLShapeId | null>('lifeboard:traceRoot', null)
```

The traced sets are **derived**, not stored: a `computed` over `getPageEdges(editor)` and `traceRoot`
producing `{ root, nodes: Set<TLShapeId>, arrows: Set<TLShapeId> }`. Derived means a relation drawn
while tracing lights up on its own, and — because `getPageEdges` is guarded by `areEdgeIndexesEqual` —
it does not recompute while anything is merely being dragged.

One hop: `edgesTouching(index, rootId, 'either')` gives the arrows, `otherEnd` gives the far nodes.
Both already exist in `edges.ts`; do not write a second traversal.

### 4.2 Revealing — the `traced` argument from §2.1

`getShapeVisibility` reads `arrows.has(shape.id)` — an O(1) set lookup, which is why the set is
prepared rather than computed inside the callback. A traced hidden relation is drawn, and stays
dashed, so you can see *that* it was hidden while you look at it.

### 4.3 Dimming and marking — `TLComponents.ShapeWrapper`

Override the wrapper (verified overridable; the default adds `data-shape-id`) with one that reads the
traced sets and adds `data-lb-trace="root" | "near" | "arrow"`, delegating everything else to
`DefaultShapeWrapper`. The *un*-traced treatment then lives in `styles.css` as attribute selectors:

```css
.lb-tracing .tl-shape { opacity: .3; transition: opacity .18s }
.lb-tracing .tl-shape[data-lb-trace] { opacity: 1 }
```

Chosen over injecting generated stylesheets because it is declarative, needs no per-shape-util change,
and is CSS the review can argue with directly. Every shape wrapper subscribes to the trace signal,
which is a lot of subscribers — but they fire only when the trace changes, which is a deliberate user
action. If a large board stutters on the *first* click, memoise the wrapper on its own
`data-lb-trace` value before reaching for anything cleverer.

### 4.4 The aura — an animated, hand-drawn envelope

The traced subgraph is wrapped in **one continuous wobbling outline** that flows around both nodes and
the arrow between them, drifting slowly as if drawn by hand — the reference sketch, animated. Not a
static drop-shadow: the movement is the point, and a still glow reads as a selection highlight rather
than as a lens.

Both viable techniques below produce the *merged* envelope in the sketch — one blob around the whole
traced group, not a ring per shape. Build **A** first; it is the closer match to the app's drawn
aesthetic and the cheaper of the two to reason about.

**A — a generated path, perturbed per frame.** Take the union of the traced shapes' page bounds plus
the arrow's own path, sample a closed hull around it at a fixed number of points, and offset each
point along its normal by smooth 1-D noise whose phase advances with time. Render it as one SVG
`<path>` in an `OnTheCanvas` layer (already inside the camera transform, so it pans and zooms for
free), stroked with `--lb-glow` and blurred underneath. One `requestAnimationFrame` loop rewrites one
`d` attribute — no filter passes, no layout, and the wobble amplitude, wavelength and drift speed are
three numbers the review can tune. The hull is exactly the kind of geometry that goes in a pure,
unit-tested function (`traceHull.ts`), which also keeps the animation loop free of maths.

**B — an SVG metaball filter.** Draw the traced silhouettes into a hidden layer, then
`feGaussianBlur` → `feColorMatrix` alpha-contrast (this is what merges neighbours into one blob) →
`feTurbulence` + `feDisplacementMap` for the organic edge → `feMorphology erode` + `feComposite out`
to keep only the outline. Animate by driving the displacement `scale`/offset rather than the
turbulence `seed`, so the noise itself is generated once instead of every frame. Truer to the sketch's
irregularity, but it is a full filter pass per frame and the one thing here that could plausibly cost
frames on a big board.

Guardrails, whichever wins:

- The layer renders **only while tracing is on**. No loop, no listener, no cost when it is off.
- Bound the work to the traced group, never the viewport: with B, set the filter region explicitly.
- Cap to ~30fps and stop on `document.hidden` — a whiteboard left open must not spin a rAF loop.
- Honour `prefers-reduced-motion`: fall back to the same envelope, drawn once and held still.
- Add `--lb-glow` to both themes; on the light canvas the aura wants to be a saturated colour, not
  white, or it disappears into the paper.

This is the phase's showpiece and it is taste, not correctness — expect at least one round of
"more/less wobble" before it is right.

### 4.4a A merged aura — **done, nodes and relations**

Two requests from review, which turn out to be the same request: **auras should combine** when shapes
are near each other, and **a relation's aura should stand off its line** instead of wobbling along it.
Both are answered by treating the trace as one field rather than as a list of outlines.

**Built** (`auraField.ts`). Shapes go into the field as rounded rectangles, relations as **capsules** —
thick line segments — and the outline is contoured out of the smooth union of the lot. So:

- Shapes close together share one envelope with a pinched waist (a 60px gap fuses, 800px does not, and
  an enclosed gap comes back as a hole — all pinned by tests).
- A relation's outline **stands off its line** by the capsule's radius plus the offset, instead of being
  drawn along the centreline and lost under the arrow's own stroke. The separate wire path is gone; so
  is the `wire` preset, replaced by `ribbon`.
- A traced group is therefore normally **one** envelope, with a ribbon running between its shapes —
  which is the original reference sketch, arrived at from the other direction.

Worth knowing when tuning: halfway across a gap of `g` both shapes are `g/2` away and the blend pulls
the field down by `merge/4`, so they fuse when `g/2 - merge/4 <= offset`.

**The one hazard found in the process, and it is worth reading before touching
`getShapeVisibility` again.** Asking `isRelation` inside that callback — which goes through
`getBindingsFromShape`, a store query — makes each shape's cached visibility depend on the binding
index, and tldraw consults that cache from inside its rendering and hit-testing paths. It was enough to
destabilise rich-text editing: `e2e/ui.spec.ts`'s sticky-suggestion test lost keystrokes, reproducibly,
and got them back when the query stopped running. Bisected against a worktree at the base commit and
against a trivial callback. The fix is ordering — decide from the arrow's own record first, and only ask
what it is bound to if the answer could still come out "hidden" — so the default view on a board with
nothing hidden never reaches the query. **Keep that callback free of store queries.**

**The approach: smooth-union SDF, contoured, then displaced.**

1. Build a signed-distance field over the traced group — `sdRoundRect` per node, `sdCapsule` per
   relation, combined with a **smooth minimum** rather than `Math.min`. The smooth minimum is what
   makes two nearby shapes fuse into one envelope with a pinched waist, and it is one line of maths.
2. Extract the outline with **marching squares** at the iso-level `-offset`, which puts the line that
   far outside the surface. This returns *one closed loop per cluster*, so merging is not a special
   case — it is what the algorithm does.
3. Displace that loop with the existing noise, along its normals, exactly as today.

**It is affordable, and the reason is that steps 1–2 do not run per frame.** Measured on this machine
over a 1200×800 trace (three cards, two relations):

| Work | 6px cells | 8px cells |
|---|---|---|
| SDF union pass | 2.9 ms | 1.6 ms |
| Marching squares | 0.14 ms | 0.05 ms |
| …with noise *in* the field, 1 octave | 12.9 ms | 7.1 ms |
| …with noise in the field, 4 octaves | 46.5 ms | 26.5 ms |

So: **do not put the noise in the field.** Union and contour on geometry change only (~3 ms), then
displace the extracted contour per frame — which is ~300 points, *fewer* than the ~900 the current
per-shape outlines already rebuild at 30fps. The animation gets cheaper, not dearer.

What it also fixes for free: the relation's stand-off (its capsule has its own radius), the fill (one
closed loop, `fill-rule` does the rest), and the arrow-versus-node inconsistency (there is one outline,
so there is nothing to be inconsistent about).

**The risk worth deciding before building it.** Because relations are in the field, everything in a
trace is connected — so a trace is always exactly *one* envelope. On a hub with thirteen relations
that is one amoeba across half the board, which is worse than what ships today. Three ways out, and
the choice is taste:

- Keep the capsule radius small, so the envelope pinches to a narrow ribbon along each relation — the
  original sketch, and it reads as "these things are joined" rather than as one blob.
- Limit the smooth minimum's blend width, so only things genuinely close together fuse.
- A preset knob: merge off / near / always.

**Rejected: the SVG filter metaball** (blur → alpha threshold → turbulence). Merging is free, but it is
a raster effect: the crisp stroke and the drawn line quality that the settled preset is *made of*
cannot survive it, and it costs a full filter pass every frame. It was the right idea when the aura was
a soft glow; it is the wrong one now.

**Stopgap if the relation's stand-off is wanted before the merge lands:** draw the wire as a capsule
outline — two offset polylines joined by end caps — rather than as a displaced centreline. An hour's
work, and thrown away by the merge.

### 4.4b A relation does not outlive its shapes

Reported from use: deleting a node left its arrows behind, pointing at the empty space the node used to
occupy. Every query had already stopped counting them — `edges.ts` needs both ends bound — so what was
left was not a broken relation but litter.

Fixed in `relations.ts` as `deleteRelationsWithShapes`, registered in `Board.tsx`. **It watches
bindings, not shapes,** and that is not a preference:

- The obvious version is a `beforeDelete` handler on the *shape* that looks up what is bound to it. It
  finds nothing, every time, because tldraw's own binding cleanup is registered first and has already
  removed them. Confirmed by instrumenting the handler — it fires, with zero bindings to report.
- What survives is the binding's own removal, and it carries the discriminator: if the shape it pointed
  at is **gone**, the binding died with it and the arrow should follow; if the shape is **still there**,
  somebody dragged the arrow's end off it, which is how a relation becomes a drawing and must delete
  nothing.

The rule this settles on is "an *attached* arrow goes with what it was attached to" rather than "a
relation goes with its endpoints". Simpler, and it avoids an impossible retroactive question: when both
ends are deleted at once, both bindings vanish, and there is no longer any way to ask whether the arrow
*had been* bound at both ends. A free sketch has no bindings at all, so nothing here ever hears about
it.

One undo restores the node and its relations together, because the cascade runs inside the deletion's
own transaction. Worth knowing when testing this: a deletion made through the API rather than the UI
has no history mark before it, so undo jumps further back than it appears to — the e2e test presses
Backspace for that reason.

### 4.5 Entering, clicking and leaving

- **Toggle**: dock button + ⌘K (`view.tracing`) + a shortcut. While on, the canvas should say so —
  the mode is modal and an invisible mode is a trap.
- **Clicking**: while tracing, a single click sets `traceRoot`. Do not fight tldraw's selection; let
  selection happen and follow it (`editor.getOnlySelectedShape()`), which keeps every existing
  gesture — drag, multi-select, context menu — working unchanged.
- **Leaving**: Escape exits the mode (not just the trace), clicking empty canvas clears the root,
  switching boards clears both. Turning the mode off must restore normal opacity even if a render is
  mid-transition.

### 4.6 Tests

- Unit: the traced-set derivation — one hop only, both directions, no self, and a node with no
  relations traces to just itself.
- e2e: turn tracing on, click a node with one hidden relation, assert the hidden arrow is no longer
  hidden (`editor.isShapeHidden`) and that a shape two hops away is not in the traced set.

### Review gate

The lens on the meals board: click *Spinach* and see whether the three arrows feeding into it are
instantly legible. Is the dim too strong, the glow too weak? This phase is where taste, not
correctness, decides — expect one iteration.

---

# Phase 5 — Documentation and surfaces

Per `.claude/skills/extension-surfaces`, a feature that works but is undiscoverable is half done.
Held to the end deliberately: the Help page's relations section wants **one coherent rewrite** rather
than four partial edits, and by now the vocabulary has stopped moving.

- **`apps/web/src/app/help/sections/Relations.tsx`** — a new section after "There is no linking mode",
  covering hidden relations, the three-state view and the lens. Follow the file's own conventions: a
  `useDemo`-driven mock-up built from `lb-demo__*` classes and app tokens, never a screenshot and
  never a mounted editor. The existing `ArrowsDemo` (an arrow becoming a relation) is the model —
  the new one shows the same arrow going dashed and then vanishing, with the total underneath **not
  changing**. That single beat is the feature's whole idea and no paragraph explains it as well.
- **`help/sections/Shortcuts.tsx`** — command bindings appear by themselves; add rows only for what
  is *not* a command, which here means the shift-drag gesture.
- **`help/sections/Overview.tsx`** — its `DOCK_GROUPS` mirrors the real dock. Phases 2 and 4 both add
  dock buttons, so the tour is wrong until this is updated.
- **`README.md`** — the relations paragraph, and the agent-operations line (three new operations).
- **`docs/tldraw-api-notes.md`** — add `getShapeVisibility`, `ShapeWrapper` and the
  `DraggingHandle` shift-snap behaviour to the "confirmed present" table. Phase 1.3 depends on an
  internal detail of a state we cannot subclass; the next tldraw upgrade needs to be told to look.
- Update this file's status line, the way `command-palette-plan.md` records its own.

---

## Gotchas checklist (read before coding)

1. **Never filter hidden relations out of `getPageEdges`.** Hiding is a view; the edge stays. If a
   table's total changes when you hide an arrow, the feature is broken.
2. **`getShapeVisibility` must be module-scope and cheap.** A changing identity remounts the editor
   and can lose a pending persistence write; an expensive body runs per shape, per invalidation.
3. **Only relations obey the relation view.** An arrow with a loose end is a drawing — check the
   bindings, not just the shape type.
4. **Derive the dash, don't store it.** One source of truth (`meta`), or the two disagree the first
   time someone edits an arrow's style.
5. **Shift is already taken.** §1.3 is not optional polish; without it, shift-drawn relations
   sometimes fail to bind and silently stay doodles.
6. **Module-scope signals must be cleared on unmount** (`propertiesTarget.ts` says why).
7. **Don't rebuild the tldraw components map per render** — it remounts everything it names.
8. **`hasStripsBelow` returns `true` for unregistered types**, arrows included. Phase 3 changes where
   an arrow's strip goes; it must not change any other shape's.
