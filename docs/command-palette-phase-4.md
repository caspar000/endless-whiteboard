# Command palette — Phase 4

Status: **§1–§5 shipped. §6 (board modes) is deliberately not built — see the decision record at the
end.** Phases 1–3 shipped (`docs/command-palette-plan.md`); this is the
plan for the six items in issue #11. Written to be executed by an agent without prior context — every
step names its files and cites the existing code it must follow. The items are independent: pick one,
ship it, come back.

Read `docs/command-palette-plan.md` first — its "House rules" and "Gotchas checklist" apply
unchanged, and its Phase 2 design notes explain why the palette is built the way it is.

## The one constraint carried forward

Command ids are stable and namespaced (`board.new`, `view.zoom-fit`, `node.markdown.insert`). A
keymap, an expression, another extension and an agent's saved prompt all reference them, so renaming
one is a breaking change. The same is true of operation ids (`operations.ts` says so in its own
words) — and `commandFromOperation` deliberately keeps *one* id across both tables.

## The order it was done in

Not the issue's order. The issue ranks by value-per-effort; this ranked by value-per-effort **and
blast radius**, because two of these items could regress things that already worked. That ordering
earned its keep twice: the drill-in pages (§4) were in place before the keymap needed a picker, and
the keymap (§1) — the one item that changes who dispatches a keystroke — was done with every other
palette surface already covered by tests.

1. ~~**`@` find on board** (§2)~~ — **done**.
2. ~~**Drill-in pages** (§4)~~ — **done**.
3. ~~**`=` expressions** (§3)~~ — **done**, both halves.
4. ~~**Rebindable keymap** (§1)~~ — **done**.
5. ~~**Hooks** (§5)~~ — **done**.
6. **Board modes** (§6) — **not built, by decision.** The reasoning is recorded below; the useful
   third of it is available as "board defaults" whenever it is wanted.

---

## 1. Rebindable keymap — **shipped**

Built, and the plan's §1.1 called the design decision correctly but for an incomplete reason. Files:
`packages/node-kit/src/keymap.ts` (+ 15 tests), `apps/web/src/app/keymapStore.ts`,
`apps/web/src/app/useKeymap.ts`, `apps/web/src/canvas/toolKeys.ts` + `toolCommands.ts`,
`apps/web/src/canvas/tldrawUi.ts`, `apps/web/src/app/settings/KeymapPanel.tsx`, and a 5-case
`apps/web/e2e/keymap.spec.ts`.

**Nothing had to be deleted from tldraw's action map.** The plan assumed app-owned dispatch meant
deleting the claimed actions the way `toggle-grid` is deleted. Reading tldraw's source showed it
registers on `document.body` in the **bubble** phase, so a capture-phase `window` listener sees every
keystroke first and `stopPropagation()` is enough. tldraw's entries survive as the display half,
feeding its ⌘/ dialog — the exact inverse of the arrangement this started from, where `kbd` was
display-only and tldraw dispatched.

**The parity worry turned out to be a bug that already existed.** The plan said to "diff each against
tldraw's own `onSelect` before deleting it". Doing that found that `edit.duplicate` was
`editor.duplicateShapes(ids)` while tldraw's ⌘D computes a side-by-side offset (or the adjacent-shape
margin when the camera is locked), marks a history stopping point, and keeps `duplicateProps` so a
held ⌘D walks copies across the board — and `edit.delete` was missing tldraw's history mark and its
can-apply guards. So the palette's rows had *never* matched the keys. Rather than copy twenty lines of
internals, `canvas/tldrawUi.ts` publishes tldraw's `useActions()`/`useTools()` per editor and those
commands delegate. One implementation, three doors.

Two details of that bridge worth keeping: it is keyed **by editor** (hidden tabs keep theirs mounted,
so a single holder would point at an arbitrary background board, and an action closes over its own
editor), and it publishes **during render** rather than in an effect, because `onMount` reports the
editor to the shell in the same commit and an effect could land after it — leaving a window in which
⌘Z was bound to an action nothing could reach.

**A third match state the plan did not foresee: the retired default.** A chord can be (a) bound to a
command, (b) not claimed at all — falls through to tldraw, which is how every non-command shortcut
keeps working — or (c) *a default the user has moved away from*, which must be claimed and then do
nothing. Without (c), tldraw's own ⌘Z would keep undoing after the user rebound Undo, and the
rebinding would look ignored.

**`preventDefault` happens after the guards, not before.** Written the obvious way round this is a
bug with teeth: `edit.delete` is bound to Backspace, so taking the event before deciding not to act
stops Backspace deleting a character in the palette's own input.

**The typing guard is the group rule from §1.3, and it is one line looser than tldraw's.** tldraw
refuses every shortcut while a shape is being edited; this refuses only the ones about the board, so
⌘K still opens over a half-written note. No `scope` field was needed on `Command` — the escape hatch
the plan reserved stayed unused.

Deliberately not done: tldraw's ⌘/ dialog still lists *defaults*, because regenerating its action map
is what needs the remount. Settings → Keyboard and the Help page show the live bindings. Also, `⌘` and
`Ctrl` are one modifier, so a Mac user cannot bind a Control-only chord distinct from Command — the
price of one binding working on both platforms, and what ⌘K already did.

---

`Command.kbd` is a *default* and display-only today: tldraw dispatches canvas keys from
`canvas/uiOverrides.tsx`, `App.tsx:262-270` owns ⌘K, and the table only *records* what the keys are.
The goal is a user keymap that overrides `kbd`, with `uiOverrides.actions`/`tools` generated from the
table instead of hand-written.

### 1.1 The decision this item turns on: who dispatches

There are two viable shapes, and picking wrong costs a rewrite.

- **Keep tldraw as the canvas dispatcher, generate its `actions`/`tools` from the table.** Reads as
  the smaller change, and is not: `overrides.actions` runs once per editor mount (tldraw memoises the
  built action map), so a rebind would not take effect until the board remounts — and remounting a
  board inside tldraw's persistence throttle discards the pending write along with the camera and
  undo history (`Board.tsx:355-365` documents exactly this). Rebinding would need a remount or a
  reload. Rejected.
- **The app owns dispatch. Recommended.** One capture-phase `window` listener — the ⌘K listener,
  widened — matches every chord against the keymap and runs the command. Every tldraw action or tool
  binding the table claims is `delete`d from the overrides, the way `toggle-grid` already is
  (`uiOverrides.tsx`, with its rationale). One source of truth, rebinds live, and the Help page and
  palette cannot drift from what the keys do because all three read one table.

The cost of the recommended path is behavioural parity with the tldraw actions being deleted. The set
is small and enumerable — `undo`, `redo`, `zoom-to-fit`, `zoom-to-100`, `duplicate`, `delete`, plus
the tool bindings — and our commands already reimplement duplicate and delete. Diff each against
tldraw's own `onSelect` before deleting it, and note any difference in a comment.

### 1.2 Files

- `packages/node-kit/src/keymap.ts` (new) — the keymap, next to `commands.ts` and following it:
  - `normalizeKbd(kbd: string): string` — canonical chord: modifiers in a fixed order, lowercased
    key, so `'shift+cmd+z'` and `'cmd+shift+z'` are one binding. `paletteItems.ts`'s `formatKbd`
    already knows the modifier vocabulary; normalisation belongs here because two *dispatchers* must
    agree, and `formatKbd` should be refactored to consume it rather than re-split the string.
  - `setUserBindings(map: Readonly<Record<string, string | null>>)` / `getUserBindings()` — command
    id → chord, or `null` meaning "unbound, overriding the default".
  - `bindingFor(id: string): string | undefined` — the user's chord, else the command's `kbd`.
  - `getKeymap(): { kbd: string; commandId: string }[]` and `subscribeToKeymap` — stable snapshot
    between changes, chained off `subscribeToCommands` (`commands.ts` chains off
    `subscribeToNodeDefinitions` for the same reason).
  - `commandIdForEvent(event: KeyboardEvent): string | undefined` — the whole match, in one pure
    function so it is testable without a DOM event loop (take the four modifier booleans and `key`).
  - `conflictsFor(kbd, exceptId)` — two commands on one chord is a state the settings UI must show,
    not one it may silently resolve.
- `apps/web/src/app/keymapStore.ts` (new) — `localStorage` load/save under `lifeboard:keymap`,
  loaded synchronously from the composition root (`apps/web/src/extensions.ts`) exactly as
  `loadDisabledExtensions` is, so the first render already has the user's bindings. Same
  swallow-the-throw comment (private-mode Safari).
- `apps/web/src/app/useKeymap.ts` (new) — the dispatcher hook. Replaces the ⌘K effect in `App.tsx`;
  ⌘K becomes an ordinary row in the table (`view.palette`, `kbd: 'cmd+k'`, run = toggle the palette
  through `AppCommandApi`), which is the point.
- `apps/web/src/canvas/toolCommands.ts` (new) — tldraw's tool letters as commands (below).
- `apps/web/src/app/settings/KeymapPanel.tsx` (new) + a `keyboard` tab in
  `app/settings/sections.tsx` (`id` is the URL — `#/settings/keyboard` — so treat it as public).
- `apps/web/src/canvas/uiOverrides.tsx` — delete the claimed actions and tool bindings.
- `apps/web/src/app/help/sections/Shortcuts.tsx` — the hand-written "Reaching a tool" group goes
  away; it becomes generated once tool letters are commands. `formatKbd(bindingFor(id))`, not
  `formatKbd(cmd.kbd)`, everywhere — the page must show what the keys *are*.

### 1.3 The guard: what fires while you are typing

tldraw gates its shortcuts on `editor.getIsFocused()`; an app-owned dispatcher has to answer the
same question itself. The rule, which needs no change to `Command`:

- If the event target is editable (`input`, `textarea`, `[contenteditable]`) **or**
  `editor.getEditingShapeId() !== null`, dispatch only commands in the app-chrome groups
  (`Navigate`, `Boards`, `Appearance`). ⌘K and ⌘⇧A keep working over a note you are editing; ⌘Z goes
  to ProseMirror, and `d` types a `d`.
- Otherwise dispatch anything the keymap matches.

This mirrors a rule the palette already has — navigate mode offers only those same groups
(`paletteItems.ts`, `buildPaletteItems`) — so it is one idea in two places rather than two rules. If
it proves too coarse, the escape hatch is an optional `scope?: 'app' | 'board'` on `Command`: purely
additive, and every existing command keeps compiling.

Always `preventDefault()` **and** `stopPropagation()` on a match, in the capture phase, so tldraw and
CodeMirror never see a claimed chord (`App.tsx:253-261` explains why capture).

### 1.4 Tool letters become commands

Deliberately skipped in Phase 3 because the Help page's dock tour already documented them. Once
bindings are generated they have to live in the table anyway.

`registerToolCommands()` in `canvas/toolCommands.ts`, called from the composition root after
`registerNodeCommands()`: one command per tldraw tool (`select`, `hand`, `frame`, `arrow`, `draw`,
`eraser`, `text`, `note`) plus one per registered node type, group `Tools`, `when: onBoard`,
`run: ctx => ctx.editor?.setCurrentTool(toolIdForNodeType(type))`. The `kbd` values move here from
`uiOverrides.tsx`'s `NUMBER_KBDS` and each definition's `def.kbd` — a chord list, since a tool has a
letter *and* a digit (`'v,1'`). `normalizeKbd` must handle the comma-separated alternates form, and
`getKeymap` must expand it into one entry per chord.

Node tool commands are owned by the node's extension (`getNodeOwner(type)`), like the insert
commands, so one toggle takes the node, its "Add" command and its tool key together.

### 1.5 Settings → Keyboard

Every visible command, grouped with `groupInOrder` (already shared by the palette and Help — a third
view of the table must not order it a fourth way). Per row: title, the current chord as `.lb-kbd`
keycaps, a "record" button that captures the next chord, a reset-to-default, and a conflict warning
naming the other command. One global "Reset all". No new dependencies — capture with a keydown
handler on a focused button, the same hand-rolled register the rest of the app is in.

### 1.6 Tests

- `keymap.test.ts` — normalisation (order-insensitive, case-insensitive, alternates), override and
  unbind, `commandIdForEvent` for a chord and for a bare letter, conflict detection.
- `paletteItems.test.ts` — `formatKbd` still passes after it is refactored onto `normalizeKbd`.
- e2e (`apps/web/e2e/keymap.spec.ts`): rebind "Zoom to fit" in Settings → Keyboard, press the new
  chord on a board and assert the camera moved, press the old chord and assert it did not.
- e2e regression, the one that matters: on a board, open a note, type `dev` into it and assert the
  active tool is still `select` and the note contains `dev`.

---

## 2. `@` — find on board — **shipped**

Built as specced. `apps/web/src/app/findOnBoard.ts` holds `readBoardShapes` (the editor-and-geometry
half); `paletteItems.ts` gained the `find` mode, `BoardShapeRef`, `findItems` and `emptyMessage`;
`CommandPalette.tsx` gathers the shapes once on entering the mode rather than per keystroke. Six unit
tests and two e2e cases. Property values stay out of scope, for the reason in §2.4.

One thing the plan did not anticipate: the Help page needed *two* new rows rather than prose, one per
prefix, because the "Anywhere" group is a key reference and `⌘K >` / `⌘K @` are keys.

A third palette mode: search the shapes on the current board by label, select and animate-zoom to the
hit. Worth calling out as a differentiator — Excalidraw's palette does not search canvas content, and
an *endless* canvas is exactly where things get lost off-screen.

### 2.1 Files

- `apps/web/src/app/paletteItems.ts` — `parseQuery` gains one case (`FIND_PREFIX = '@'` → mode
  `'find'`); `PaletteItem` gains a `{ kind: 'shape'; shapeId: TLShapeId; ... }` member; `PaletteInput`
  gains `shapes: readonly BoardShapeRef[]`, defaulting to empty.
- `apps/web/src/app/findOnBoard.ts` (new) — `readBoardShapes(editor): BoardShapeRef[]`, the one
  impure part, kept out of `paletteItems.ts` so that file stays DOM- and editor-free.
- `apps/web/src/app/CommandPalette.tsx` — compute the candidate list only when the mode is `find`;
  a `run` branch that selects and zooms.

### 2.2 The candidates

`getPageFacts(editor).get()` is the answer: a `Map<shapeId, ShapeFacts>` whose `label` is already
`shapeLabel(editor, shape)` (`properties/labels.ts` — it names *any* shape, including tldraw's own,
via `ShapeUtil.getText`, and truncates), and which is cached per editor and usually already warm
because the board is rendering from it. Use `readPageFacts` only if profiling says otherwise; it
recomputes everything and leaves no cache entry.

`BoardShapeRef = { id: TLShapeId; type: string; label: string; center: { x: number; y: number } }`.
Take the centre from `editor.getShapePageBounds(id)` — it is what the ordering below needs.

Ordering, as a pure function so it is testable:

- With a needle: the same case-insensitive substring rule as everything else (`matches` in
  `paletteItems.ts`, and `suggest.ts` before it), then label-starts-with first, then by distance.
- With an empty `@`: nearest the viewport centre first, capped at `MAX_SHAPES = 12`. "What is around
  me" is the useful answer to a bare `@`, and unlabelled shapes are dropped rather than listed as
  blank rows.

Icon: `getNodeDefinition(shape.type)?.toolbarIcon`, else the palette's generic. Group:
`On this board`. Add it to `GROUP_ORDER`.

### 2.3 Running a hit

```ts
editor.select(item.shapeId)
editor.zoomToSelection({ animation: { duration: 320 } })
```

Select before zooming, so the animation lands on something already highlighted. Match the existing
durations (`view.zoom-fit` uses 220).

On a screen with no board, `@` shows one dim row, "Open a board to search its contents". Do not
silently fall back to navigate mode: a prefix that sometimes means something else is worse than a
prefix that says why it is empty.

### 2.4 Scope, and what is deliberately out

Labels only, this pass. Property *values* are the obvious next step (`ShapeFacts.values` is right
there) but they need a rule for how a match is displayed — "Price = 2,399" is a different row than a
label — and that is its own decision. Write the omission down; do not half-build it.

### 2.5 Tests

- `paletteItems.test.ts` — `parseQuery('@')`, `parseQuery('@ inv')`, find mode returns only shape
  items, filtering, the distance ordering, the cap.
- e2e (`commandPalette.spec.ts`, a new case): two notes with distinct text, ⌘K, `@` plus part of the
  second note's text, Enter, assert `editor.getSelectedShapeIds()` is that shape. Remember hidden
  tabs keep their editors mounted (`e2e/helpers.ts:103-104`).

---

## 3. `=` — expressions in the palette — **shipped**

Type `= sum price page` and see the answer live. Enter copies it; a second row drops it on the board.

### 3a. Evaluate, copy, drop — **shipped**

Built as specced, with one addition the plan got wrong. `evaluateExpression` is exported (it was
already there, privately); `apps/web/src/app/expressionMode.ts` holds the editor half;
`paletteItems.ts` renders the answer, the drop row and the completions.

**The plan's "append `page`" rule was right, and its reasoning was incomplete.** It framed the choice
as evaluator-mode vs string-transform and preferred the transform for consistency between preview
and drop. That is correct, but the *reason it is load-bearing* is the drop: the dropped text shape
re-evaluates `{…}` itself (`collections/shapeText.tsx`), on its own behalf, so a default held
anywhere but in the string would have made `{sum price}` quietly mean "arrows pointing at this
caption" — which is nothing.

**A bug the plan did not anticipate, caught by the e2e:** a query never includes its own shape
(`nodes/table/query.ts`), so passing the selected shape as `selfId` made `= count` answer
"everything except whatever you happened to have clicked". Fixed with `isAggregateExpression(body)`:
an aggregate question asked from the palette has **no** subject, because the palette is not a shape.
The bare-property form (`= price`) still reads the selection, which is the only thing it can mean.

`renderExpressions` (`collections/expressions.ts`) substitutes braces inside a document; the palette
wants one expression evaluated on its own. The private `evaluate(body, context)` is exactly that
function — **export it as `evaluateExpression`** and add it to the barrel. That is the whole node-kit
change: one export, no new parser, and the `{…}` menu, the note renderer and the palette then share
one evaluator by construction.

Context, built in the palette from things already exported (`index.ts` exports all of these):

```ts
{
  facts: getPageFacts(editor).get(),
  edges: getPageEdges(editor).get(),
  properties: propertyMap(readPropertyRegistry(editor)),
  rates: getCurrentRates(),
  selfId: editor.getOnlySelectedShape()?.id ?? '',
  values: …, units: …,   // from the selected shape, or empty
}
```

The one semantic decision: `EXPRESSION_SOURCES` defaults to `connected/in`, which is right inside a
note (the note is the subject) and wrong in the palette with nothing selected, where it would answer
`—` to every question. **With no selection and no trailing source keyword, the palette appends
`page`.** Implement it as a small exported helper beside `evaluateExpression` so the rule is written
down and tested once, not as an untested `+ ' page'` at a call site.

Rows, in order:

1. The result, big — `= sum price page` → `£12,480`. Enter copies it (`navigator.clipboard`, guarded;
   a copy that fails must not throw out of a keypress).
2. "Put it on the board" — creates a text shape at `editor.getViewportPageBounds().center` containing
   **the expression, not the result**: `useExpressionShape` (`collections/shapeText.tsx`) already
   substitutes `{…}` in tldraw's own text shapes, so the dropped shape stays live. That is the
   feature; a pasted dead number is what people already have.
3. Completions — `expressionSuggestions` (`collections/suggest.ts`) is what powers the `{…}` menu.
   Offer its ops, properties and sources as rows that complete the input rather than run. Same
   vocabulary, one place it is defined.

Unrecognised input shows nothing rather than an error, matching the evaluator's documented
forgiveness ("an unresolved `{…}` looks like what you typed").

### 3b. Named queries — **shipped**

The plan left the design open and it was decided during the build; this is the record of what was
chosen and why. Files: `packages/node-kit/src/collections/namedQueries.ts` (the registry),
the expansion in `collections/expressions.ts`, `Extension.queries`, `suggest.ts` offering the names,
and `apps/web/src/app/savedQueries.ts` for the user's own.

**A named query is a name bound to an expression *string*, expanded before evaluation.** Not a
`Collection` spec, and not a function. This is the decision everything else follows from. It means
there is no interpreter (which is what the issue asked for), user-saved queries are a few bytes of
JSON, an extension's are literals in its manifest, and nothing can be computed that could not be
written out longhand. A function-valued query would be more powerful and could not be saved by a
user, which would have made the user's half and the extension's half two different features.

**Only the whole body expands.** `{sum runway}` is not "the sum of the runway query" — a query is a
question, not a column. A rule that expanded fragments would make every expression's meaning depend
on a registry the person reading it cannot see.

**Precedence: a property always wins; verbs are refused at the door.** These are two different
mechanisms because the two collisions are knowable at different times. A verb (`sum`, `page`) is
knowable at registration, so `registerQuery` refuses the name and returns `false` — the palette shows
the reason in its footer as you type it. A property name is per-board and unknowable then, so the
check happens at expansion: if the body names a property, it is a property. Together these give the
property the strongest possible guarantee — **a named query can only ever resolve a `{…}` that
resolved to nothing before it existed**, so no note can change what it reports because someone
elsewhere saved a shorthand.

**Naming happens in the line, not on a page:** `= sum cash page as runway`. The drill-in stack from
§4 was right there and was the wrong tool — it would have been a mode whose only job was to collect
one word, with a state to be stranded in. The clause splits on the *last* ` as `, so a question
containing the word survives. A name that is refused produces **no row at all**; the reason goes in
the footer, because a row that explains itself and then does nothing when pressed is worse than no
row.

**The name, not its expansion, is what gets written to the board.** `expressionForBoard` deliberately
does *not* see through a name (unlike `isAggregateExpression`, which must). So dropping `{runway}` on
a board keeps it bound to the query, and redefining the query updates every shape that asked it. The
two functions previously shared one predicate and this is exactly where that broke — they now share
a private `startsWithOp` and differ on whether to expand first, with the reason written at both.

**Forgetting is contextual, not a management screen.** Typing a saved name on its own offers
"Forget". No Settings panel, no operation — and deliberately not an operation, which would have put
deleting the user's vocabulary on the agent's tool surface for the sake of a convenience.

**Cycles cost a dash.** `a` = `b` and `b` = `a` is a typo someone will make; expansion is capped at
four levels deep and the expression is then left as typed, which is what an unresolved `{…}` always
does.

Deliberately not built: an agent-facing `query.define`. Letting an agent teach the board a word is
appealing and is a product question — it widens the MCP surface — rather than a mechanical one.

---

The real prize, and a separate pass. "Register named queries in the same command table" is the wrong
table on inspection: `Command.run` returns `void` (that is deliberate, and `operations.ts` explains
why), so a command cannot *be* a value. What is wanted is a third small registry, built exactly like
`commands.ts`:

- `packages/node-kit/src/collections/namedQueries.ts` — `registerQuery({ id, name, description,
  collection })`, `getVisibleQueries()`, `subscribeToQueries`, owner-and-enablement gating.
- `Extension.queries?: readonly NamedQuery[]` — another optional field on the manifest, the same door
  `commands`, `operations`, `fileImports` and `actions` already come through, so no extension breaks.
- `evaluateExpression` resolves a leading token against the registry before `EXPRESSION_OPS`, so
  `{runway}` works in a note and `= runway` works in the palette — one namespace, both surfaces.
- User-defined ones: "Save this as…" in `=` mode, persisted in `localStorage` and registered at
  startup from the composition root. This is the bit that makes it feel like a language rather than a
  fixed vocabulary.

Precedence matters and must be tested: a user query named `sum` must not shadow the op. Register
queries *after* ops in the resolution order and say so in a comment.

### 3.4 Tests

- `expressions.test.ts` — `evaluateExpression` directly (it is currently only reached through
  `renderExpressions`), the no-selection `page` default, unknown input returning `null`.
- `namedQueries.test.ts` — registration, enablement gating, op precedence.
- e2e: `=` mode shows a number for a board with priced shapes; the drop row puts a text shape on the
  board whose *stored* text still contains the braces.

---

## 4. Nested / drill-in commands — **shipped**

Built as specced, over operations. `requiredParams(op)` (new, in `operations.ts`) is the seam the
pages generate from; `commandFromOperation` no longer refuses an operation with required parameters
and instead produces a doorway whose `run` reports rather than throws. `paletteItems.ts` holds the
reducer (`beginDrillIn`, `answerDrillIn`, `popDrillIn`, `drillInItems`, `drillInArgs`) — immutable
and answered positionally, so the current page is always `params[answers.length]`. Ten unit tests,
two e2e cases.

Two decisions the plan did not settle:

- **Failures stay in the panel.** The palette lives outside `<Tldraw>`, so tldraw's toasts — the
  app's only ones — are unreachable. On `ok: false` the palette stays open, shows the operation's own
  sentence, and drops back one page so the last answer can be retyped. That is better than a toast
  anyway.
- **Which operations get a row is curated, in `apps/web/src/app/operationCommands.ts`.** Projecting
  the whole table would bury the palette in agent-shaped rows (`view.select` takes shape ids). Two
  are projected today — `node.image` and `property.create` — both chosen because they are capability
  with no other palette door.

Still deferred, and named in §4.3 below: the theme and extension-toggle collapses need operations
that do not exist, and creating them would widen the MCP tool surface — a product call rather than a
mechanical one. `board.delete` needs a board-valued parameter, and `liveChoices` returns bare
strings, so a board id would render as a uuid; labelled choices are the missing piece.

---

Raycast's page stack, for commands that need an argument. Keeps the top level short.

### 4.1 The joint already exists

`commandFromOperation` (`operations.ts`) refuses an operation with required parameters, and its
comment names this issue: "there is nowhere to get them from until the palette grows the drill-in
page stack (issue #11), at which point that UI should be *generated* from `params` rather than
hand-written per command." Build that, not a bespoke page per command.

`ParamSpec` already carries everything a form needs: `type`, `description`, `required`, `choices`,
and `liveChoices` for sets only knowable at runtime (the enabled node types, the boards).

### 4.2 Design

- Relax `commandFromOperation` to accept required params, producing a command whose `run` is a
  logged no-op — parameterised capability is not invokable from a bare keypress.
- The palette, before running a command, checks `getOperation(command.id)`. A hit with required
  params opens an **argument page** instead of running. Zero schema change; the "one id across both
  tables" rule is what makes the lookup legal.
- A keybinding on a parameterised command **opens the palette on that command's first argument
  page** rather than doing nothing. This is where §1 and §4 pay each other back.
- Page stack in `CommandPalette.tsx`: `useState<PalettePage[]>([])`, with the reducer
  (`pushPage`, `popPage`, `collectArg`, `nextPage`) pure and in `paletteItems.ts` so it is testable.
  A breadcrumb above the input names the command and the collected arguments.
- Keys: Backspace on an **empty** input pops a page; Escape pops one page and closes at depth 0
  (the existing e2e case — Escape closes from the top level — must still pass); Enter accepts.
- Rendering a param: `choices`/`liveChoices` → one row each, filtered by the input;
  `boolean` → two rows; `string`/`number` → free text, Enter accepts, with `description` as the
  placeholder (it is written for a reader deciding what to type, which is exactly this).
- Confirmation is not a special case: it is a required `boolean` param named `confirm`, so
  "Delete board →" picks the board on page one and confirms on page two with no bespoke UI.

### 4.3 What to collapse onto it

Once it exists, three top-level piles get one row each: the three `view.theme.*` commands become
"Switch theme →", the extension toggles become "Toggle extension →" (`liveChoices` from the extension
registry), and "Delete board →" gains a confirm step. Do **not** delete the existing theme command
ids — they are frozen, they are what a keymap binds, and a drill-in is an addition to the surface,
not a replacement for the ids beneath it.

### 4.4 Tests

- `paletteItems.test.ts` — the page-stack reducer: push, pop, collect, "all required args present"
  → run.
- e2e: "Switch theme →", Enter, "Dark", Enter, `html[data-theme]` is dark; Backspace on an empty
  input returns to the top level.

---

## 5. Hooks — **shipped**

Files: `packages/node-kit/src/hooks.ts` (+7 tests), `ContentImport` in `extensions.ts`, the fire
points in `canvas/Board.tsx` and `canvas/FileImportHandler.tsx`,
`packages/note-markdown/src/linkDrop.ts` (+4 tests), and a 3-case `apps/web/e2e/hooks.spec.ts`.

**The issue's four hooks are two different contracts, and splitting them was the main design call.**
`onBoardOpen`, `onShapeCreate` and `onPropertyChange` are **reactions**: every enabled extension's
handler runs and none can claim the event. `onDrop` is a **claim** — exactly one extension gets the
content, because two extensions both turning a dropped link into a shape would produce two shapes.
A single mechanism doing both would have had to answer "what if two of you want it" with a coin toss.
So the drop half shipped as `ContentImport`, the claim-shaped sibling of the `FileImport` that already
existed, and it sits next to it rather than in `hooks.ts`.

**`onNodeCreate` is called `onShapeCreate`.** Universal properties mean the facts pipeline already
walks every shape rather than the registered types, so a sticky and a photo are as taggable as a note
— the same reason `shapeLabel` names any shape. A name saying "node" that fired for arrows would be a
lie; a hook that only cares asks `getNodeDefinition(shape.type)`.

**Reactions are synchronous, and that is a feature.** They run inside the store change that triggered
them, which is what puts a hook's write in the *same* undo entry as the user's action. The plan said
it: an auto-tag needing its own ⌘Z is worse than no auto-tag. The cost is that a hook cannot `await`;
it schedules its own async work and accepts that the later write is its own entry.

**One re-entrancy flag for all three, deliberately coarse.** While any reaction is firing, none fire.
A chain of one step is occasionally what someone wants, and a loop — create writes a property, the
property write creates a shape — is what they get instead if this is clever. The rule has to fit in a
sentence: hooks react to what the user did, not to each other.

**Both consumers are real, which was the plan's own condition.** The property-sidecar merge that
makes copying shapes between boards work moved from a bespoke `watchPastedProperties` installer to an
`onShapeCreate` hook — already covered by `smoke.spec.ts`, and it is what proves the fire point
catches a *paste*, which no creation helper is involved in. And dropping a link now makes a note
carrying a `Link` property rather than tldraw's bookmark card, because a card cannot hold a property,
join a table or stand in a view — which in this app is most of what content is for.

Two things the link import deliberately does not do. It **requires a scheme** (`https://…`) and a
single token: `normalizeUrl` would read "notes.txt" as a hostname, which is right when someone types
a link into a field and wrong when deciding whether a pasted paragraph was one. And it titles the
note with the **host**, because reading a page's own `<title>` cross-origin needs a server — tldraw's
bookmark card asks a backend for exactly that. Nothing about the shape changes when a real title
arrives later; it is one more write to the same property.

---

`onBoardOpen`, `onNodeCreate`, `onPropertyChange`, `onDrop`. This is what turns "extensions that add
node types" into "extensions that add *behaviour*" — auto-tagging, templates, "drop a URL → fetch its
metadata into properties".

### 5.1 Files and shape

- `packages/node-kit/src/hooks.ts` (new), built like `commands.ts`: a registry, an owner per entry,
  enablement checked **at fire time** (not registration) so switching an extension off in Settings
  stops its behaviour immediately — the rule `actionsForShape` and `fileImportFor` already follow.
- `Extension.hooks?: Partial<BoardHooks>` — the next optional manifest field.
- Every fire is inside a `try/catch` that logs and continues: one extension's bad hook must not take
  the board down, which is the rule the context-menu actions already state.

### 5.2 Where each one fires

The seams exist; none of these needs a new choke point.

- `onBoardOpen({ editor, boardId })` — `Board.tsx`'s `onMount`, alongside `trackBoardActivity`,
  `watchPastedProperties` and the other `stopX` installers, returning a disposer like they do.
- `onNodeCreate({ editor, shape })` — `editor.sideEffects.registerAfterCreateHandler('shape', …)`,
  which is what `watchPastedProperties` (`Board.tsx:218`) already uses, and which catches *every*
  path: the palette, the context menu, paste, duplicate, an agent operation, a file import. Firing
  from `createNodeShape` instead would miss most of them. Gate on `source === 'user'` for the same
  reason `watchPastedProperties` does — loading a board creates every shape, and re-running an
  auto-tagger over a whole board on open is a bug, not a feature.
- `onPropertyChange({ editor, shape, propertyId, before, after })` —
  `registerAfterChangeHandler('shape', …)`, diffing `readShapeProperties(prev)` against
  `readShapeProperties(next)` and firing once per changed id. Cheap because it returns early when
  `prev.meta === next.meta`.
- `onDrop({ editor, files, text, url, point })` — `canvas/FileImportHandler.tsx` already owns the
  `files` external-content handler and its "claimed vs the rest" split. Add `text` and `url`
  handlers there on the same terms: an enabled hook may claim the content, anything unclaimed
  continues into tldraw's default pipeline exactly as if the handler did not exist.

### 5.3 Re-entrancy — the trap

A hook that writes shapes re-enters the very handler that called it. Guard with a module-level
`firing` flag checked at the top of each fire, and run a hook's writes inside the same
`editor.run(...)` batch as the change that triggered it so ⌘Z takes back the create *and* its
auto-tag as one action. An auto-tag that needs its own undo entry is a worse feature than no
auto-tag.

### 5.4 Ship it with a consumer

Bare infrastructure rots untested. The motivating example is the one to build: an `onDrop` hook that
claims `http(s)` URLs, creates a bookmark-ish node and writes the fetched title into a property.
Land the registry and that consumer in one pass, and list hooks on the extension's own page in
Settings (`settings/ExtensionDetail.tsx` already enumerates contributions — a hook is one).

---

## 6. Board modes — **not built, by decision**

Issue #11 asks for: "A board declares a mode; the mode supplies default properties, a dock subset,
snapping behaviour, background and default collection." Investigated in full, then declined. This is
the record, so the next person does not have to redo the investigation to reach the same place.

**The five capabilities have very unequal value, and the word bundles them misleadingly.**

- **Default properties** — cheap and genuinely useful ("every card on this board has a Status and a
  Due date"). It is *exactly* an `onShapeCreate` hook, which §5 shipped: merge the definitions into
  the board's registry on open, attach empty values on create. Roughly thirty lines, no new concept.
- **Default collection** — cheap, modest value. Seed a new table's spec from the mode instead of
  `defaultCollection()`.
- **Dock subset** — cheaper than it looks, because `canvas/toolKeys.ts` and `canvas/toolCommands.ts`
  (§1) already are the dock as data, so a subset is a list of command ids each `ToolButton` checks.
  But it is *semantically unresolved*: the keymap dispatches from the command table, not from the
  dock, so hiding the pen leaves `d` still selecting it. Either a mode is cosmetic, or it must also
  gate commands' `when` — at which point modes change what is *available*, which is a much larger
  claim than "supplies a dock subset".
- **Snapping** — contradicts a documented decision. `app/canvasPrefs.tsx` keeps grid settings
  app-wide *precisely because* tldraw persists `isGridMode` per board, and "that is how one board
  ended up with a grid the others didn't have"; `app/App.tsx` re-applies the app-wide value to every
  editor on mount to defeat it. Per-board snapping reintroduces that by design and needs an answer to
  "does the mode win, or does my explicit setting win?" — and the user's setting is a plain boolean,
  so there is nowhere to record "I have not chosen". A tri-state preference comes first.
- **Background** — not a mode hook at all until there is something to select. The options today are
  dotted paper, tldraw's grid, or nothing; "moodboard: plain dark" is a new background *kind*.

**Three problems cut across all of it.**

1. **The word is taken.** `LayoutMode` already means how a collection is drawn — `value | table |
   kanban | calendar`. A *board* mode called "kanban" would sit beside a *view* mode called "kanban"
   meaning something else. In a codebase this careful about naming that is a real hazard.
2. **Where it lives is a genuine fork.** `BoardMeta.mode` is visible on the home screen and settable
   without opening the board, but has to be threaded into the canvas as a prop and is not part of
   exported content. Document meta (the `readRelationView` precedent) is reactive for free and travels
   with backups, but is invisible until the board is open — which undercuts "a board declares a mode"
   as something you could browse.
3. **No consumer.** With `Extension.modes` as the door, no first-party mode exists unless one is
   invented. Hooks and named queries both shipped with real consumers on purpose; a mode registry with
   none would be the dead infrastructure those two avoided.

**The decision.** The valuable third needs no "mode" concept: it is *board defaults*, applied through
machinery that now exists. The rest either fights settled behaviour or needs a product answer the code
cannot supply — which mode, hiding or disabling, whose setting wins. So §6 stays unbuilt, and what
would replace it is scoped and waiting:

> **Board defaults** — a board may declare default properties and a default collection view, stored
> in document meta beside the relation view, merged on open and attached by an `onShapeCreate` hook.
> No dock filtering, no snapping, no background. Named for what it is, so it does not collide with
> `LayoutMode`.

That is a small, self-contained change whenever someone wants it. What would justify the *full*
version instead is a concrete mode someone actually wants — "reading mode should do X" answers the
consumer question and, with it, most of the semantic ones.

## Surfaces every item must reach

The repo's `extension-surfaces` skill is the full checklist; the short version for this work:

- **⌘K** is generated from the table — nothing to do beyond registering the command.
- **Help** (`app/help/sections/Shortcuts.tsx`) generates bound-command rows, but the *modes* are
  hand-written prose: `@`, `=` and the drill-in stack each need a line in the palette's help copy,
  and §1 deletes the hand-written "Reaching a tool" group once tool letters are commands.
- **README** — the palette section lists what the prefixes mean; keymap and modes belong in the
  architecture notes.
- **Settings** — §1 added a Keyboard tab; §3b and §5 added rows to `settings/ExtensionDetail.tsx`
  ("Questions it teaches", "Dropped links and text").
- **Checks** — `pnpm -r typecheck`, `pnpm -r test`, then `pnpm test:e2e`. Whole-suite Playwright
  timeouts under load are load, not regressions; re-run the named spec alone before believing one.

---

## Where this leaves the command registry

Five of the six items shipped, and the registry ended up carrying more than the palette:

- **⌘K has four modes** — boards, `>` commands, `@` find-on-board, `=` ask-the-board — plus a
  drill-in page stack for commands that need arguments.
- **The table is authoritative for keys.** `Command.kbd` is a default; the keymap layers the user's
  answer over it and one capture-phase listener is the whole of dispatch.
- **Four registries, one discipline.** Commands (what a person can do), operations (what an agent can
  do), named queries (what the board can be asked), hooks (what happens because it changed). Each has
  owner-and-enablement gating, a stable snapshot, and replace-by-id semantics; three of the four are
  contributed through `Extension`.
- **Two joins, both one-directional.** Operations project onto commands (`commandFromOperation`), and
  the node registry projects onto both commands and tools. Capability is authored once.

The obligation that outlives all of it is unchanged: **command and operation ids are stable and
namespaced.** They are what a keymap, an expression, a saved agent prompt and another extension
reference. Renaming one is a breaking change.
