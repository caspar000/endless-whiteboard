# Dice on the board — implementation plan

Status: **Done.** All four phases have shipped. What follows is the record: each phase's "as built"
notes say where reality diverged from the sketch and why, and the sketch is kept as the reasoning.
Read the as-built notes before touching any of it — between them they record seven bugs that were
invisible until something specific was checked for, and several were in code that looked obviously
correct.

A tray of dice down the right edge of the canvas. Click `d6` twice and `d12` once and you are holding
`2d6 + 1d12` — the cursor says so. Click the board and they land there and roll, in 3D, on the paper,
where you dropped them.

Four decisions were taken before this was written, and they set the shape of everything below:

| Decision | Chosen |
|---|---|
| What survives the roll | **Ephemeral, with a setting.** The dice fade; a pref makes each roll leave a card behind |
| Renderer | **three.js + cannon-es**, in a chunk loaded on the first roll and never before |
| Roll semantics | **Plain dice only** — since revisited: a flat modifier was added via ⌘K (see "Added after the fact") |
| Where it rolls | **Anchored to the board.** Page coordinates, camera synced to tldraw's, stays put on a pan |

---

## What the codebase already gives us, and the one thing it doesn't

Almost all of this feature has a precedent to copy.

- **Floating canvas chrome** — `CanvasToolbar` floats at the bottom of the canvas, inside the board's
  own area rather than the app shell's grid. The dice tray floats at the right edge the same way, which
  is why it needs **no shell layout change** and coexists with the agent panel (a real column,
  `grid-column: 3`, so it shrinks the canvas and the tray moves with it).
- **An overlay that tracks the board through pans and zooms** — `canvas/AgentPresence.tsx`, rendered in
  tldraw's `InFrontOfTheCanvas` slot, reading `editor.getCamera()` through `useValue` and converting
  with `pageToViewport`. That slot is screen space, above the shapes, which is exactly where a WebGL
  canvas wants to be.
- **Board-adjacent UI state that isn't board data** — `canvas/tracing.ts`: module-scope tldraw atoms,
  a `stopTracing()` the board calls on unmount so the next board doesn't open holding stale state. The
  loaded-dice tray is precisely this, and it carries the same obligation.
- **Preferences** — `app/canvasPrefs.tsx`: localStorage, a try/catch around every read and write
  because private-mode Safari throws, a default that applies when there is no record.
- **An extension with real dependencies of its own** — `packages/book-reader` pulls `pdfjs-dist`,
  `node-unrar-js` and four font packages. A dice package depending on `three` is not novel.

The one thing missing is the door. `Extension` (`packages/node-kit/src/extensions.ts`) contributes
`nodes`, `commands`, `operations`, `fileImports` and `actions`. A tray, a cursor and a roll overlay are
none of those — they are *canvas chrome*, and an extension has no way to contribute any. The type's own
comment anticipates this ("later contribution kinds are added as optional fields, so existing
extensions keep compiling"), so the fix is the intended one rather than a workaround. That is Phase 0,
and it is the only change outside the new package and the app's composition.

Two smaller findings worth writing down before they surprise someone:

- **tldraw's `setCursor` takes a closed union of cursor types.** There is no custom-image cursor. The
  "holding glove" has to be drawn by us — which the sketch already implies, since it shows dice badges
  beside an ordinary pointer. `AgentPresence` is the precedent for drawing a cursor.
- **`threejs-dice` cannot be a dependency.** It is MIT and it is the right algorithm, but it is a UMD
  script written against `THREE.Geometry`, removed from three.js in r125. Its geometry tables and its
  method get **ported**, not installed. Same for `@3d-dice/dice-box`: MIT, but it pins Babylon 5.57,
  was last published in Aug 2024, is 10.9 MB unpacked and expects assets copied into `public/`.

---

## Phase 0 — the seam

`CanvasOverlay`, a new contribution kind in node-kit.

```ts
export interface CanvasOverlay {
  /** Namespaced like an extension id: `<extension>.<name>`. */
  id: string
  /**
   * Rendered inside tldraw's `InFrontOfTheCanvas` slot — screen space, above every shape, inside the
   * editor context, so it may call `useEditor` and `useValue`.
   *
   * It gets no props. Everything it needs it reads from the editor context or from its own
   * module-scope state, which is what keeps this contribution from growing a field per feature (the
   * same rule `CommandContext` is held to).
   */
  Component: ComponentType
}
```

- `Extension` gains `overlays?: readonly CanvasOverlay[]`.
- `getVisibleCanvasOverlays()` alongside `getVisibleCommands()`, filtered by `isExtensionEnabled` and
  invalidated off `subscribeToNodeDefinitions` — the same store every other enablement view chains off,
  so switching the extension off in Settings takes the tray away live, with no board remount.
- The app renders them in `CanvasOverlays` (`canvas/Board.tsx`), beside `SelectionToolbar` and
  `AgentPresence`, through `useSyncExternalStore`.
- `ExtensionDetail.tsx` gains a "Canvas" row in its manifest-derived "what it adds" list, so an
  extension that contributes chrome says so on its own page for free.

Verifiable on its own: a stub overlay appears, and disappears when the extension is toggled off.

**Why not a tldraw tool instead.** The obvious alternative is a custom `StateNode` — `dice.idle`,
`dice.pointing` — so that pointer-down on the canvas while loaded is a roll rather than a selection.
It is rejected for two reasons. Tools are fixed at editor mount (`nodeTools.ts` says so, and works
around it by registering every node tool always and letting enablement gate the UI), so a tool
contributed by an extension needs that same always-on treatment plus a *second* new contribution kind.
And it isn't necessary: while dice are loaded, the overlay puts up a transparent full-viewport layer
with `pointer-events: auto`, which swallows the click and converts it to a roll at
`editor.screenToPage(...)`. That guarantees a click can never draw a shape, needs nothing from the
state chart, and — because `InFrontOfTheCanvas` renders *inside* tldraw's container — leaves wheel
zoom working, since the wheel event still bubbles to tldraw's own listener.

> **The last sentence of that paragraph is wrong, and the layer it describes was removed.**
> `InFrontOfTheCanvas` is a *sibling* of `.tl-canvas`, not a descendant, and `.tl-canvas` is where the
> wheel gesture is bound — so the layer broke pan and zoom. Kept here because the *conclusion* (no
> custom tool) still holds and the reasoning for it is still the reasoning; see "Phases 0 and 1, as
> built" below for what replaced the layer.

---

## Phase 1 — the tray, the holding, the roll (no 3D at all)

`packages/dice` → `@lifeboard/dice`, extension id `lifeboard.dice`.

The whole interaction, with the animation stubbed to nothing: release, and the numbers appear. This is
deliberate — **the feature is fully usable and fully end-to-end testable before any 3D exists**, and
Phase 2 then has nothing to prove except that it looks good.

- **`hand.ts`** — module-scope tldraw atoms, `tracing.ts`'s pattern: `Map<DieKind, number>` of what is
  loaded, `load(kind)`, `unload(kind)`, `clear()`, `notation()` (`'2d6 + 1d12'`). Cleared when the
  board unmounts, for the reason `tracing.ts` documents. Never a store write, so nothing here can spend
  an undo entry or wake the facts pipeline.
- **`DiceTray.tsx`** — the overlay's tray: one button per kind, `d4 d6 d8 d10 d12 d20 d100`, each with
  a loaded count badge. Right-click or shift-click a button to unload one. lucide has `Dice1`…`Dice6`
  and nothing polyhedral, so the icons are small SVG die silhouettes in the package — which is what the
  sketch draws anyway.
- **`HeldDice.tsx`** — the badge cluster beside the pointer, following `pointermove`, and the
  transparent release layer under it. `Escape` clears the hand (see `docs/tldraw-api-notes.md` §"Escape
  is the one key that leaks out of a focused input" before wiring that key).
- **`roll.ts`** — the pure part, and the only part with a fairness argument in it. `crypto.getRandomValues`
  with **rejection sampling**, because `% 20` over a byte is biased toward the low faces. Returns
  `{ kind, value }[]` and a total. Unit-tested for range, for uniformity over a large sample, and for
  the rejection branch actually being taken.
- **Commands** — `dice.load.d20` &c., `dice.roll`, `dice.clear`, in a `Dice` group. Group as a string
  by value, not imported: a package must not depend on the app's `paletteItems.ts`.
- **An operation** — `dice.roll { notation: string }` → the faces and the total. Cheap, and it is the
  half of this an agent can reach: "roll me a d20" becomes a tool call, and it comes with an MCP tool
  automatically because the server holds no list.

CSS goes in `apps/web/src/styles.css`. That is the app's single stylesheet — `packages/book-reader`
ships no CSS of its own and its 159 rules live there — so this follows the convention rather than
introducing a second one.

### Phases 0 and 1, as built

Everything above shipped as sketched, plus the Help section and README rows that the plan had parked in
Phase 4 — a tray nobody can find is not finished. Four things came out differently.

- **The release layer had to go, and its replacement is the interesting part.** The plan said a
  transparent full-viewport layer with `pointer-events: auto` would catch the throw, and asserted that
  wheel events would still reach tldraw because the overlay renders inside its container. **The second
  half is wrong.** `InFrontOfTheCanvas` renders as a *sibling* of `.tl-canvas`, and `.tl-canvas` is
  where `DefaultCanvas` binds the wheel gesture (`useGestureEvents(rCanvas)`) — so the layer became the
  hit-target for wheel events that then had nowhere to go, and **pan and zoom silently stopped working
  for as long as you held a die.** The throw is now claimed by a capture-phase `pointerdown` listener on
  `window`, which puts no element over the board at all. `e2e/dice.spec.ts` pins it, control case first
  so a wheel that does nothing in *either* case fails loudly rather than passing the half that matters.
- **Suppressing the board's context menu is not one event.** Right-clicking to drop the dice fires
  **two** `contextmenu` events. Dropping the dice on the first emptied the hand, which flipped the
  `holding` flag, which ran the effect cleanup and unbound the listeners — so the second event reached
  Radix and opened the board's menu over the dice being put away. The listeners are therefore bound for
  as long as the *overlay* is mounted rather than for as long as dice are held, and read the hand at
  event time: a listener whose lifetime depends on the state it reads cannot survive its own side
  effect. A latch set on the right-button pointerdown and cleared on the *next* pointerdown makes the
  number of trailing events stop mattering.
- **The tray had to stop taking focus.** Clicking a die moved `document.activeElement` onto the button
  and off tldraw's container. `preventDefault` on the button's `pointerdown` — which suppresses focus
  without costing the click — is what the selection toolbar already does, for the same reason.
- **The "grab" cursor is a class with `!important`, not `editor.setCursor`.** tldraw's cursor is state
  that the select tool reasserts as the pointer crosses shapes, so a cursor set once flicked back to an
  arrow over the first sticky note.

Two notes on what was *not* needed. `hand.ts` and `rolls.ts` use a plain listener set rather than tldraw
atoms, following `registry.tsx`'s reasoning about two copies of the signal library — no behaviour
depends on that choice, but it is the reason the code looks unlike `canvas/tracing.ts`. And the overlay
clears its own state on unmount, so unlike the tracing lens the app never had to learn this extension
exists.

---

## Phase 2 — the roll itself

A chunk that does not exist until you roll for the first time: `await import('./three/scene')` behind
the release handler. `three` (0.185.1, MIT) and `cannon-es` (0.20.0, MIT) as dependencies of the
package. **Estimated at roughly 180 KB gzip** — that is an estimate, and `pnpm build` writes
`apps/web/stats.html` specifically so it can be checked rather than assumed.

`cannon-es` has had no release since 2022. It is taken anyway: it is 740 KB unpacked, it is the
de-facto three.js rigid-body engine, and convex dice on a flat plane is the case it is least likely to
be wrong about. The maintained alternative, `@dimforge/rapier3d-compat`, inlines ~1.5 MB of wasm as
base64 into the bundle, which is the wrong trade for a two-second cosmetic moment.

### The physics world is in page coordinates

This is what makes the roll "on the board" rather than over it, and it collapses most of the hard
parts into one decision. One page unit is one physics unit. A die is ~48 page units across. Then:

- The camera is a `OrthographicCamera` whose frustum is set each frame from
  `editor.getViewportPageBounds()`. Pan and zoom are handled by construction — there is no mapping code
  to get wrong, and the dice scale with the board because they are *measured* in the board's units.
- The camera looks **straight down**. A tilted camera would look more dramatic and would break the
  mapping (a die at the top of the screen would project off its page point), and looking straight down
  is also how you read a number off a die. The 3D read comes from the tumble and the lighting, not the
  camera angle. A far-away narrow-FOV perspective camera is a polish knob if the flatness bothers us;
  the projection error is bounded and small.
- The floor is the page plane at z=0, so dice roll *on* the paper. Four invisible walls a few hundred
  units out around the release point keep them from sliding away.
- A directional light plus a soft shadow on the paper. The shadow is what sells contact.

### Predetermined outcome, physics as theatre

The number comes from `roll.ts` (Phase 1). The simulation is decoration. The technique is the one
`threejs-dice` uses — `getUpsideValue()` to read the settled face by comparing each face normal, rotated
by the body quaternion, against the up vector, then `shiftUpperValue(toValue)` to shift the material
indices so the wanted number is the one facing up:

1. Throw with randomised initial position, orientation and impulse.
2. Step the world headlessly to settle — ~180 steps at 1/60 for ≤10 convex bodies, single-digit
   milliseconds, so this is a synchronous call with no jank.
3. Read each die's up face. If any is **cocked** (best normal · up below cos 15°, which is a die resting
   against another one), discard and re-throw from step 1. Bounded attempts, all invisible.
4. Relabel each die so its up face carries the number `roll.ts` already drew.
5. Rewind to the initial state and play the same simulation visibly. Deterministic given a fixed
   timestep, so it lands where the headless run said it would.

Three things fall out of this that are worth having. The result is provably uniform and testable
without a renderer. A die can never come to rest on an edge. And `prefers-reduced-motion` — plus the
e2e path — is just "skip step 5", with an identical outcome.

### Phase 2, as built

Shipped as sketched — headless simulation, keyframe playback, predetermined outcome, page-unit world,
straight-down orthographic camera — and measured at **158 KB gzip** in its own chunk, under the 180 KB
the sketch estimated. Five things came out differently, and every one of them was found by a test or a
screenshot rather than by reading the code.

- **`world.fixedStep()` is not a fixed step.** It derives its own delta from the wall clock, so driving
  it from a tight headless loop advances the simulation by almost nothing: the dice hung in the air at
  their drop height and every throw "settled" instantly. `world.step(dt)` is the one that takes the
  caller's clock. The whole test file ran in 67 ms, which was the tell.
- **A d4 can never have a face up**, so reading one by face marked every throw cocked and the retry
  limit was hit every time. A tetrahedron at rest sits on a face and points a *vertex* at the ceiling —
  which is why real four-siders print a number at each corner and you read the apex. There is now a
  `readingMode` per die, and the d4's textures carry three numerals apiece.
- **A percentile die is two ten-siders.** `roll.ts` gives a d100 a uniform 1–100 and a pentagonal
  trapezohedron has ten faces; printing "37" on one of them would have been a prop. `physical.ts` expands
  one rolled d100 into a tens die and a units die, `00`+`0` reading as 100, as at a real table.
- **The d10's kites are only planar at one waist offset**, and it is not the 0.105 the source tables
  carry. Solving it — `h = (2 − φ)/(2 + φ)` — let the planarity *and* convexity tests run with no
  tolerance at all, which is what then caught the d4's reversed winding.
- **Negating one axis is a reflection, not a rotation.** Mapping page y to scene y by negating it
  flipped the handedness of the whole scene: the dice rendered as though seen from underneath a glass
  table, and the face the card named was not the face on top. Transforming each die's *rotation* to
  compensate was the wrong fix twice over — first with a formula that is only correct about z, then in
  principle, because a mirrored world with correctly-mirrored dice in it is still mirrored. There is now
  one right-handed world and a single flip of the page *origin*, in `three/space.ts`.

- **A cannon-es `ConvexPolyhedron` cannot be shared between bodies**, and caching one per die kind is the
  obvious thing to do. It caches *world-space* vertices and face normals **on the shape**, recomputed from
  whichever body is currently being tested — so four d20s collided against geometry positioned for each
  other. It did not present as a physics bug: the dice interpenetrated, came to rest in poses that were
  not resting on anything, failed the cocked check, burned all eight retries (seconds of blocked main
  thread), and finally fell through to "accept whatever came up" — landing at angles where the face the
  simulation called upward was not the face a person reads. What it looked like was **the numbers on the
  dice not matching the card, worse with more dice at once**. Fixed by building a fresh hull per body and
  sharing only the vertex arrays; pinned by "does not need retry after retry to find a flat landing",
  which counts *rejections* rather than timing.
- **Two things that were not the bug**, recorded because a lot of time went into them. A `readFaces()`
  debug hook reported the card and the dice agreeing, because it computes "up" with the same function the
  labelling uses — it can only prove the pipeline is self-consistent, never what is on screen. And
  numerals were separately too large for their faces (sized against the *texture* rather than the face's
  incircle), which made five side faces of a d20 as loud as the top one and was a real legibility problem
  — but it was not what made the numbers wrong.

Two smaller notes. The bevel is **painted into each face's texture** rather than chamfered into the
geometry: at 44 page units across, a real chamfer is a pixel or two wide, and the collision hull stays
the honest convex solid. And the result card had to be **gated on the dice settling** and placed above
the resting pile — it appears at the release point, which is now exactly where the dice land, so it was
covering the thing it describes.

### Geometry — the biggest single chunk of work, and where to cut if needed

Per die kind: a vertex table, a face table, one geometry group per face, and N small `CanvasTexture`
materials carrying the numerals. Cached at module scope and shared across every die of that kind. Up
to 20 draw calls per die is nothing for a handful of dice.

three.js's built-in `TetrahedronGeometry`/`OctahedronGeometry`/&c. are not usable: they triangulate the
faces and give neither per-face groups nor UVs you can number. And there is no built-in for the d10, a
pentagonal trapezohedron.

- **Chamfering** — the ~60-line bevel that is most of why a die looks premium rather than papercraft.
  It is in the core here, and it is also **the first thing to cut** if it fights us: sharp-edged
  flat-shaded polyhedra read perfectly well, and the bevel can land later without touching anything
  else.
- **The d4 has no up face** — it rests on one and points a vertex at you. Real d4s solve this by
  printing three numbers per face. The plan is the simpler convention: put one number per face and read
  the **down** face. Worth knowing it is a choice, because someone will notice.
- **The d100** is a d10 read as tens. It shares the d10's geometry and gets its own numerals.

Unit tests for all of it, since it is pure: vertex and face counts per kind, every value `1..N`
appearing exactly once, and `upFaceFor(quaternion)` inverting the rotation that produced it.

### One rule this must not break

`e2e/perf.spec.ts` asserts **exactly zero** re-aggregations during a drag on a 500-node board, and the
README calls it out. The roll loop must therefore touch the store on **no** frame: it reads
`getViewportPageBounds()` and writes to a WebGL canvas, and that is all. The one write — the result
card, if the pref is on — happens once, after the dice have stopped.

---

## Phase 3 — the settings, and the card

### Dice appearance — **shipped**

Three settings, and one rule that is not a setting. Delivered through a new contribution kind,
`Extension.settings`: the host owns the extension's page in Settings and the extension owns one panel on
it. That seam had to exist — everything else on that page is *derived* from the manifest, and "add a tab
to the app's Settings" is not something a third-party plugin can be allowed to do.

The preferences live in `packages/dice/src/prefs.ts`, **outside** the lazily-loaded 3D chunk, so Settings
can show and change them without pulling three.js in; the renderer reads them rather than holding a copy,
and the preference values are part of the texture cache key so a change cannot leave a stale texture
behind. The preview is flat `DieIcon` silhouettes for the same reason — loading a WebGL scene and a
physics world to show somebody a colour would be absurd.

- **A colour for the dice.** One colour applied to the whole set. The body colour is currently the bone
  constant `BODY` in `three/mesh.ts`.
- **“Colourful dice”**, a boolean: when on, each *kind* gets its own colour rather than the set sharing
  one — the d20 amber, the d12 magenta, and so on, the way a bought set arrives.
- **The edge highlight**: on or off, and its own colour when on. `DiceStyle.edges` already models exactly
  that — `true` follows the numerals (the default, and what a real die looks like), a colour string
  overrides them, `false` turns it off.
- **The numerals follow the body, and are not a third choice.** A dark die must get light numerals or it
  is unreadable, and no amount of letting someone pick would fix that. `inkOn` in `three/mesh.ts`
  already does this: relative luminance of the body decides between a dark and a light ink, and
  `resultInk` mixes the result's red-or-blue from whichever of the two applies. It is in place and
  exercised by the current bone body; the setting only has to feed it a colour.

The result colour ramp mixes from `inkOn(body)` rather than from a fixed near-black, which is what keeps
it working on a dark die: the neutral end of the ramp is whatever that die's numerals are.

### The palette needed a hint

`> roll` on its own used to offer nothing, on the reasoning that a row which does nothing is worse than
no row. That was wrong about the *empty* case: silence reads as the feature not existing, and there is no
way to discover that a command takes an argument from a blank list. `Command` gained `hint` (secondary
text) and `runnable` (shown, but inert), so `> roll` now offers **Roll a d20** and teaches the notation
beside it, and `> roll 2d7` shows *why* it will not roll instead of vanishing. A row marked `runnable:
false` does not close the palette either — being ejected mid-expression is the opposite of helpful.

### The icons became projections of the real solids

The tray started with flat silhouettes — a triangle, a square, a rhombus, a kite, a pentagon, a hexagon
— which were legible and were not dice, and two of which were the same shape: a d8 and a d10 are both
"a diamond" in outline, which is why the face count had to be printed inside to tell them apart at all.

`dieOutline.ts` now projects the *same* vertex and face tables the rolling dice are built from, keeping
the silhouette and the visible creases, so an icon is a true picture of the die it stands for and a solid
added later gets a correct icon for free. It loads no three.js: the tables are plain data, which is what
lets the tray, the palette, Settings and the result card all share one component.

Three things took two attempts:

- **No tilt.** The first version added a few degrees "to make it look solid" and made every icon look
  skewed and every facet look like scribble. What makes a polyhedral die legible at icon size is its
  *symmetry* — a front face in the middle with its neighbours fanned evenly around it — and a tilt is
  exactly what destroys that.
- **A deliberate `up`.** Left to the vertex order, the d4 pointed downwards. Each view now aims a known
  vertex at the top, so every die sits the way you would hand it to someone.
- **Three view kinds, not one.** Face-on for most; corner-on for the cube, which face-on is a square
  with no interior edges at all; equator-on for the trapezohedron, which down a kite's normal is a lumpy
  decagon rather than the pointed diamond a d10 looks like.

The numeral is dead centre with a halo (`paint-order: stroke fill`), which is what lets one icon work on
the tray, over its own creases, and on a card of any colour. Below 18px it is dropped: at palette size
two digits and a halo over twelve facets made the rows unreadable in both directions, and there the icon
sits beside a label that already names the die. Tray buttons went from 34px to 38px, because the
wireframes carry detail a silhouette did not.

### The result card, as built

`node.roll`, off by default, written when the dice settle. The full node-type checklist came with it —
props validators, an (empty) migration sequence from v1, a `TLGlobalShapePropsMap` augmentation in the
package's own `shape-types.ts`, `strips: 'below'` because the card is a readout rather than a text
surface. No new snapshot fixture: fixtures pin *released* schemas, and adding a type cannot break one.

Four things worth knowing:

- **Its dice are a string.** Props are bounded to JSON scalars, so the faces are encoded `d20:14,d6:3`
  (`card/encode.ts`) — the same constraint that makes a quote encode its highlight rectangles. Decoding
  is lenient, because it parses *stored* text: a card that renders the dice it understands beats one
  that refuses to render.
- **The total is a property**, attached with `createProperty` + `updateShapeProperties`. That is the
  entire reason to keep a roll rather than watch it fade: a number the property system knows about is
  one a table can group, total and filter on.
- **One history entry.** `createNodeShape` opens its own `editor.run` and the property write is a
  second, so both are wrapped in one — otherwise ⌘Z after a roll undid the total and left a blank card.
- **The card replaces the readout** rather than joining it. The card *is* the result; a floating copy
  of it over the top would read as two rolls.

It also puts a **Roll button in the dock**, because the dock is registry-driven and every node type gets
one. That is the same trade the quote card already makes, and `Overview.tsx`'s tour says so rather than
pretending otherwise. Registering the type also generates an `Add roll` command, which is why the
palette test scopes to a row instead of asserting there is only one.

## Phase 3 — the sketch it was built from

Kept below the "as built" notes above, as the rest of this document's sketches are. Ephemeral is the
default: the dice fade a beat after they settle, the total shows, nothing persists.

The pref that changes that lives in **two places for one piece of state**:

- A pin toggle at the foot of the tray ("Keep results on the board"), because that is where you are
  when you form the opinion.
- And on the extension's own Settings page, because that is where you go looking for it later. That
  needs one more small node-kit addition — `Extension.settingsPanel?: { title, Component }`, rendered
  by `ExtensionDetail.tsx` above the derived "what it adds" list. Every third-party extension will
  eventually want it, so it is worth doing properly rather than smuggling a second preferences store
  into the app. If it has to be cut, the tray pin alone is sufficient and the feature is complete
  without it.

Storage is `app/canvasPrefs.tsx`'s pattern — localStorage, try/catch on both sides, default applies
when there is no record.

When it is on, a settled roll writes **`node.roll`** at the release point: the notation, each die's
face, the total. That brings the full node-type checklist with it, and none of it is optional —

- Props validators and `migrations` from v1, per the README's rule that every props change ships one.
- A `shape-types.ts` `TLGlobalShapePropsMap` augmentation, imported from the package barrel as a side
  effect, or tldraw's schema never learns the type.
- A snapshot fixture, because `persistence/snapshot-fixtures.test.ts` fails a missing migration and is
  verified to catch it.
- `strips: 'below'` — a roll card is a readout, so property rows belong under it, not over it, for the
  same reason a book's cover gets them below.
- One `markHistoryStoppingPoint`, so ⌘Z takes back the roll and not some fragment of it.

The payoff for it being a real node rather than a picture: the total is a typed property, so a table
can group and sum your rolls like anything else on the board.

---

## Phase 4 — the surfaces

Per the repo's `extension-surfaces` skill. Generated for free: the `Add roll` command per node type,
and every command's row on the Help shortcut list. Written by hand:

- `apps/web/src/extensions.ts` — one `registerExtension(diceExtension)` line, above
  `registerNodeCommands()`.
- `app/help/sections/Dice.tsx` + an entry in `sections.tsx` under `Extensions`. The `id` is the URL
  (`#/help/dice`), so it is public. Demos are mock-ups from the app's tokens, never screenshots and
  never a mounted editor — `help/kit.tsx` has the pieces.
- `Shortcuts.tsx` — a row for `Escape` clears the hand, since that is a key the overlay binds rather
  than a command.
- `Overview.tsx` — **untouched, correctly**, if Phase 3's `node.roll` gets no `toolbarIcon`. Its
  `DOCK_GROUPS` mirrors the real dock, and the roll card is created by rolling, not from the dock.
- `README.md` — the extension table under **Nodes & extensions**, and the `packages/` line under
  **Layout**.
- The extension's own `description` and `details`, including what turning it off does: the tray and the
  commands go, roll cards already on boards keep rendering.

---

## Testing

| What | How |
|---|---|
| `roll.ts` | Unit. Range, uniformity over a large sample, the rejection-sampling branch |
| Geometry | Unit. Vertex/face counts, every value once, `upFaceFor` inverts its own rotation |
| Settle + relabel | Unit, headless. The chosen number is the one facing up; a cocked throw is retried |
| `hand.ts` | Unit. Load/unload/clear, notation formatting |
| Tray → hold → release → result | e2e, on the reduced-motion path — Chromium headless renders WebGL through SWiftShader, and asserting on pixels of a physics animation is a flake generator |
| Zero store writes mid-roll | Extend the existing counter assertion in `e2e/perf.spec.ts` |

---

## Added after the fact

**A flat modifier, typed into ⌘K.** "Plain dice only" was the original decision and was revisited once
the rest worked: `> roll 2d20 + 10` and `> roll 1d6 + 2d4 + 1d20 + 4` throw immediately into the middle
of the view. It needed a genuinely new seam — `CommandSource` in node-kit, a query-driven source of
ordinary commands — because a `Command` is a zero-argument button by design and widening it would have
cost every other surface something. The tray still has no modifier: there is no picking `+10` off a
shelf, and notation is how everyone writes it anyway.

**The result face is inked once the dice stop.** From straight above you can see the top face and the
ring of faces around it, all legible, so nothing distinguished the answer. It is coloured on *settling*
rather than at build time, because a tinted face mid-tumble gave the result away before it landed.

**The dice were made to look like a set.** Built at one circumradius they did not: a d20 is nearly a
ball and a d4 is mostly empty space, so they read as a big die beside a small one. They are now matched
by **volume**, which is how real sets are matched and is computed from the face tables rather than
eyeballed (`sizeScale`). Two things had to follow: the throw's spawn spacing is measured in the *widest*
die in the hand, because a gap in bare radii put the now-larger d4 inside its neighbour and the
separation impulse fired it out of the arena; and the invisible walls were made tall enough to cover the
whole stack, since a die could otherwise spawn above them and leave sideways.

**Numerals fill about 70% of their face**, sized against the face's *incircle* — and centred on the
incircle rather than the centroid, which differ on the d10's kites. `6` and `9` are underlined, because
on a die that can rest at any angle they are the same glyph upside down. The d4 keeps smaller marks of
its own: it carries three per face, and sizing them as though each had the face to itself produced a
tangle of nine numbers.

**Inking the result is by *label*, not by face** — the d4's again. Its answer is a vertex, and that
vertex's numeral is printed on all three faces around it, so inking "the face" coloured three unrelated
numbers and left the answer black.

## What is deliberately not here

DC checks with success/failure, advantage/disadvantage, and criticals — the BG3-iconic parts of a
*check* rather than a *roll*.

Sound. BG3's clack is half of its dice, and the app has no audio anywhere today — no `AudioContext`, no
asset pipeline for it, and no mute setting to hang it off. Worth its own decision later.

Also deferred: dice themes/colours, per-board dice, re-rolling a result card, and rolling from an
expression (`{2d6}` in a sticky), which the expression system could host but which would make every
board with dice in it non-deterministic on re-render.
