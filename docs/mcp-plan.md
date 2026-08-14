# MCP server (agent access to the board) — implementation plan

Status: **Done — all five phases.** The operation registry ships, the 20-operation core surface runs
against a live editor, the app connects and dispatches, `packages/mcp-server` serves those
operations as MCP tools over stdio, and an agent can build a board end to end. Verified by driving a
built server through a real `initialize` + `tools/list` + `tools/call` exchange, and by
`apps/web/e2e/agent.spec.ts`, which drives the real app through the real protocol with a WebSocket
server in the test process. Kept as the record of why each piece is shaped the way it is; the
remaining ideas are under "Deliberately not in scope" and "Where this goes next".

## What is already done (do not redo)

- `packages/node-kit/src/operations.ts` — the registry. `Operation`/`Params`/`Args<P>`,
  `toJsonSchema`, `coerceArgs`, `runOperation` (the single choke point: look up → gate → validate →
  run → catch), `operationManifest`, `commandFromOperation`. Tests in `operations.test.ts`.
- `packages/node-kit/src/boardBridge.ts` — `BoardBridge`/`setBoardBridge`, the app-capability seam.
  Implemented by `apps/web/src/agent/boardBridge.ts`.
- `packages/node-kit/src/relations.ts` — `connectShapes`/`disconnectShapes`. `addQuoteToBoard` is
  refactored onto it.
- `packages/node-kit/src/nodes/insert.ts` — `createNodeShape` (shared with the app's `insertNode`,
  which keeps selection and edit mode on top) and `textPropFor`.
- `packages/node-kit/src/ops/` — the 20 operations, plus `fakeBoard.ts` and `ops.test.ts` (48 cases).
  Registered by `registerCoreOperations()`, which the host must call **after** installing a bridge.
- `packages/node-kit/src/nodes/rollup/engine.ts` — `shapeFacts` and `readPageFacts` extracted, so a
  one-shot caller can read the page without standing up tldraw's computed-cache machinery.
- `apps/web/src/agent/protocol.ts` — the wire format and `parseServerMessage`, the only way a frame
  becomes a typed value. Tests in `protocol.test.ts`.
- `apps/web/src/agent/boardBridge.ts` — the app's `BoardBridge`, capability through a module-level
  holder App re-points each render (the `appCommands.ts` pattern). `open` polls for the mount.
- `apps/web/src/agent/bridge.ts` — the WebSocket client, backoff, and `handleServerMessage` (split
  out so dispatch is testable without a socket). Tests in `bridge.test.ts`.
- `apps/web/src/agent/prefs.ts` — enabled/port/token, off by default, as a subscribable store.
- `apps/web/src/app/settings/AgentsPanel.tsx` — the Agents tab, built from the settings page's own
  `Toggle` control, registered in `settings/sections.tsx`. `ExtensionDetail` lists an extension's
  operations alongside its nodes and commands, so "what it adds" stays derived from the manifest.
- Wired in `apps/web/src/extensions.ts` (bridge import, then `registerCoreOperations()`) and
  `App.tsx` (`setAgentBoardApi`, `setAgentEditorSource`, and the connection's lifecycle).

- `packages/mcp-server/` — the Node process. `protocol.ts` (structural duplicate of the app's, see
  its doc comment), `bridge.ts` (the WebSocket host: token, `Origin` check, handshake timeout,
  one-client-at-a-time, id-correlated invokes with a timeout), `tools.ts` (the `.` → `_` tool-name
  mapping), `server.ts` (MCP wiring + `list_changed`), `index.ts` (entry point; **stderr only**).
  `fallbackManifest.ts` is generated and guarded by `packages/node-kit/src/ops/manifest.test.ts`.
  Tests in `bridge.test.ts` (real sockets) and `tools.test.ts`. See the package README for setup.

- `apps/web/e2e/agent.spec.ts` — the app half end to end: a real `ws` server in the Playwright
  process drives the real bridge. Covers the handshake and manifest, building a board (create →
  insert → property → connect → find → list → query), undo granularity, the failure messages, and a
  refused token. **This caught a bug nothing else could**: `useBoards.create` writes the index and
  then `setState`s, so the agent api holder's `boards` array was one render stale for the whole of
  the operation that had just created a board — `board.create` then failed to open what it made.
  The agent path now reads the board index from the store (`AgentBoardApi.list`), not React state.
- Read-only mode: `AgentPrefs.readOnly`, `offeredOperations()` (withholds mutating operations from
  the manifest) plus a refusal in `handleServerMessage` (the manifest filter is UX; the refusal is
  the gate). Settings → Agents has the toggle.
- README: an "Agents (MCP)" section; `packages/mcp-server/README.md` covers setup and the threat
  model.

Verified: `pnpm -r typecheck` and `pnpm -r test` (690 tests) pass, `pnpm test:e2e` (85 tests) passes,
and a built server answers `tools/list` with all 20 tools and `tools/call` with the not-connected
guidance.

## Where this goes next

Additive, and none of it changes an operation id:

- **Hooks** (issue #11 §5) — `onNodeCreate`/`onPropertyChange` firing for agent writes too, which is
  what turns "an agent that edits" into "an agent whose edits trigger your automations".
- **A richer `board.query`** as a *second* operation. The current one flattens `TableSource` into
  named scalars so an agent can fill it in first time; the full selector is a nested object and
  wants its own entry rather than a widening of this one.
- **tldraw's own shapes** in `node.insert` (sticky, text, frame). Registered node types only, today.
- **Batched operations** — one call, several writes, one undo entry. Worth it only once there is
  evidence agents are round-tripping enough for it to matter.

Goal: an MCP server my coding agents can point at, so they can list and create boards, put nodes on
them, set properties, draw relations and read the result back.

## The finding that shapes this plan

Command palette Phase 4 (issue #11) is **not** a prerequisite. It is a sibling, and building it
first would leave the agent surface at exactly zero. Two things block MCP, and neither is in that
issue:

1. **No process can host an MCP server and see the data.** Everything is client-side: the board
   index is in idb-keyval (`apps/web/src/boards/boardIndex.ts:17`), canvas content is in tldraw's own
   IndexedDB, one database per board (`apps/web/src/persistence/tldrawLocalDb.ts:14-40`), written on a
   350 ms throttle that the same file documents as leaving recent edits in memory only. An MCP server
   is a Node stdio process; Node cannot open IndexedDB.
2. **`Command` is the wrong shape and Phase 4 deliberately keeps it that way.**
   `run: (ctx: CommandContext) => void | Promise<void>` (`packages/node-kit/src/commands.ts:55`) takes
   no arguments and returns nothing; `CommandContext` is `{ editor, view }` (`commands.ts:19-23`).
   Issue #11 states the constraint outright: "none needs a change to `Command` or `CommandContext`".
   An agent needs *"create a note titled X at (80,140) with Price=2399, connect it to Y, return its
   id"*. A command can only be **fired**, like pressing a button.

So the prerequisite is a second table — **operations** — that are parameterised, schema'd and
result-returning. Same registry discipline the node and command registries already enforce; the MCP
server is only its first consumer, exactly as the palette was only the command registry's first.

The overlap with Phase 4 is thin and mostly runs *backwards*: #4 (nested/drill-in commands) is the
Raycast-style UI for a command that needs an argument, and once `Operation.params` exists that UI is
**generated** from it rather than hand-written per command. Build operations first and Phase 4 #4
gets cheaper, not the other way round. #2's find-on-board primitives (`shapeLabel`, `getPageFacts`)
already exist and are what a `node.find` operation reads. #5 (hooks) matters *after* this lands, so
agent writes trigger extension behaviour. #1 and #6 are unrelated.

## Architecture in one paragraph

One table of parameterised operations (`packages/node-kit/src/operations.ts`) that every *programmatic*
surface reads as a view: the MCP server now, drill-in palette commands and a future scripting API
later. Operations run **in the live browser tab** against the mounted tldraw `Editor` — a local
WebSocket bridge carries requests from a Node-side MCP server to whichever tab has Lifeboard open.
That choice is load-bearing: running in the real editor means the property sidecar, store migrations,
undo history, auto-height and rendering all just work, and nothing gets reimplemented headlessly.

## Transport decision (settled)

**WebSocket bridge to a live tab.** The two alternatives, and why not:

- *Headless store in Node* (`createTLStore` + snapshots off-DOM) — the data still lives in browser
  IndexedDB, so it only reaches exported snapshots, and it races a live tab. More work, less
  capability.
- *Bring forward the sync server* (README lists it as Phase 2, not started) — the right long-term
  answer and it makes MCP a first-class client, but it blocks MCP behind all of it.

The bridge is not wasted work under either: operations are the durable artefact, and a sync server
would just become a second place they can run.

---

## Phase 1 — the operation registry (`@lifeboard/node-kit`)

New: `packages/node-kit/src/operations.ts`, `operations.test.ts`. Export from `index.ts`.

Model it on `commands.ts` — read that file first; this is deliberately its sibling, not its
replacement. Copy the parts that are already decided there: replace-by-id registration (HMR), an
`ownerById` map so an extension's operations disappear when it is toggled off, a cached stable
snapshot for `getVisibleOperations()`, and `subscribeToOperations` chained off
`subscribeToNodeDefinitions`.

### 1.1 Parameters — typed, not JSON Schema by hand

MCP wants JSON Schema. Writing it by hand would be unchecked strings, and CLAUDE.md forbids `any`.
Declare a small spec and **generate** the JSON Schema from it with one pure function, so the
TypeScript type of `args` and the schema the agent sees can never drift:

```ts
export interface ParamSpec {
	type: 'string' | 'number' | 'boolean' | 'string[]'
	/** Shown to the agent. Write it as documentation, not as a label — this is the whole UX. */
	description: string
	required?: boolean
	/** Closed set, when there is one. Becomes `enum` in the generated schema. */
	choices?: readonly string[]
}

export type Params = Readonly<Record<string, ParamSpec>>
```

Map `Params` to an args object type, and pair it with a `defineOperation` helper for inference — the
codebase already has this shape in `defineNode` (`packages/node-kit/src/extensions.ts`). Optional
params map to `T | undefined`, required ones to `T`.

`toJsonSchema(params)` is a pure function with its own tests. It is the only place JSON Schema is
spoken.

### 1.2 Results must be JSON

```ts
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }
export type OperationResult = { ok: true; data: JsonValue } | { ok: false; error: string }
```

`ok: false` is a *normal* answer, never a throw — same discipline as
`PlatformAdapter.fetchExchangeRates` returning `null` (`apps/web/src/platform/PlatformAdapter.ts:57`).
An agent that gets "no board is open" as a result can act on it; one that gets a stack trace cannot.

### 1.3 `OperationContext` and the app-capability seam

An operation needs more than a command does: it can target a board that is not the open one. But
node-kit must not learn about the app's board store. Use the seam pattern the package already uses
three times — `setNetworkBridge` (`network.ts`), `setAssetBridge` (`assets.ts`), `setAppCommandApi`
(`apps/web/src/app/appCommands.ts:33`):

```ts
export interface BoardBridge {
	list(): Promise<{ id: string; name: string; updatedAt: number }[]>
	create(name: string): Promise<{ id: string; name: string }>
	rename(id: string, name: string): Promise<void>
	remove(id: string): Promise<void>
	/** Opens the board and resolves once its editor is mounted — writes need a live editor. */
	open(id: string): Promise<Editor | null>
	/** The mounted editor for a board, or null. Never `window.editor` — see Phase 3.2. */
	editorFor(id: string): Editor | null
}
export interface OperationContext {
	/** The active board's editor; null when the app is on Home/Settings/Help. */
	editor: Editor | null
	boards: BoardBridge
}
```

### 1.4 Extensions contribute operations

Add `operations?: readonly Operation[]` to `Extension` (`packages/node-kit/src/extensions.ts`),
registered with the extension id as owner — identical to how `Extension.commands` already works, and
it means a plugin's operations become MCP tools with no change to the server.

### 1.5 One table, not two — the command adapter

Add `commandFromOperation(op, defaults?)` so a zero-parameter operation can be registered as a
command instead of being written twice. Do **not** migrate the existing commands; they are fine and
command ids are frozen (issue #11's carried-forward constraint). This exists so *new* capability is
authored once.

**Tests** (`operations.test.ts`): registration/replace-by-id, owner-based visibility through
`setExtensionEnabled`, `toJsonSchema` for every param type including `choices` and optionality,
result serialisability, and that `commandFromOperation` refuses an operation with required params.

---

## Phase 2 — the operations themselves

New: `packages/node-kit/src/ops/` (editor-only operations) and
`apps/web/src/agent/appOperations.ts` (board CRUD + navigation, module-scope registration through a
module-level api holder — copy `appCommands.ts:22-35` exactly, including its rationale comment).

Register from the composition root (`apps/web/src/extensions.ts`) after `registerNodeCommands()`.

### 2.1 The missing primitive: relations

There is **no shared helper for connecting two shapes.** A relation is a tldraw arrow with a binding
on both ends — `getPageEdges` counts exactly that and nothing else
(`packages/node-kit/src/nodes/rollup/engine.ts:144-155`), and the only code that creates one is
inlined at `packages/book-reader/src/quote/createQuote.ts:89`.

Write `packages/node-kit/src/relations.ts`:

```ts
connectShapes(editor, fromId, toId, opts?): TLShapeId | null   // the arrow's id
disconnectShapes(editor, arrowId): void
```

and **refactor `createQuote.ts` onto it**. Two callers is exactly when a copied implementation starts
diverging — the argument `insertNode.ts:14-17` already makes for the context menu and the palette.

### 2.2 The operation surface

Each is one row in the table. Names are namespaced and, like command ids, **stable forever** — an
agent's saved prompt references them.

| Operation | Built on |
|---|---|
| `board.list`, `board.create`, `board.rename`, `board.delete`, `board.open` | `boardIndex.ts`, `deleteBoard.ts`, the `BoardBridge` |
| `node.insert(type, x?, y?, text?, properties?)` → id | `apps/web/src/canvas/insertNode.ts`, `updateShapeProperties` |
| `node.find(query?, type?, hasProperty?)` → id, label, type, bounds, properties | `getPageFacts`, `shapeLabel` |
| `node.get(id)`, `node.update(id, …)`, `node.delete(id)` | editor primitives |
| `property.list`, `property.create`, `property.set(shapeId, values)` | `readPropertyRegistry`, `createProperty`, `updateShapeProperties` |
| `relation.connect(from, to)`, `relation.list(id?, direction?)`, `relation.delete(arrowId)` | §2.1, `getPageEdges`, `edgesTouching` |
| `board.query(source, columns, groupBy?, sorts?)` → rows | `queryTable` / `runCollection` — already pure |
| `view.select(ids)`, `view.zoomToFit` | editor — so the human watching *sees* what the agent did |

`view.select` is not decoration. The whole appeal of an agent on a canvas is watching it work; an
operation that changes the board without moving the viewport is invisible.

### 2.3 Rules every write operation follows

- Wrapped in `editor.run(() => { editor.markHistoryStoppingPoint('agent: <op id>'); … })`. **One
  stopping point per operation**, so a human can ⌘Z an agent one action at a time. `seedDemoBoard`
  (`apps/web/src/boards/demoBoard.ts:51`) is the precedent and its comment says why.
- Properties are set **after** the shape is created, via `updateShapeProperties` — it is the one path
  that keeps values and the definition sidecar in step (`demoBoard.ts:169-171`).
- Property definitions must exist before shapes reference them (`demoBoard.ts:52-53`).
- Result rows are capped. `DEFAULT_MAX_ROWS` is the existing precedent; an unbounded `node.find` on a
  big board is a context-window incident.

---

## Phase 3 — the bridge

### 3.1 Node side — `packages/mcp-server/src/bridge.ts`

Hosts a WebSocket on `127.0.0.1` at a configurable port. Loopback only. One connected tab at a time
(second connection replaces the first — a reload must not lock you out). Request/response with an
`id`, plus a `hello` on connect carrying the tab's operation manifest (§4.2).

### 3.2 App side — `apps/web/src/agent/bridge.ts`

Connects when enabled, with backoff. Executes an operation and replies.

**Do not route through `window.editor`.** It is a documented debug/test seam
(`apps/web/src/canvas/Board.tsx:318-324`) that points at whichever board mounted last, and hidden
tabs keep their editors mounted (`apps/web/e2e/helpers.ts:103-104`), so it is ambiguous by
construction and it is deleted on unmount. Go through the `BoardBridge` backed by App's real editor
map and its `openBoard` (`App.tsx`) — the same reason the palette uses `openBoard` and never `navigate`.

Board-targeted operations on a board that is not open must **open it first** and await the mount;
`readBoardSnapshot` reaches other boards but is read-only.

Where an agent needs durability before reporting success, await `waitForPersistFlush()`
(`persistence/tldrawLocalDb.ts:32`) — the 350 ms throttle means a just-written shape can exist only
in memory.

### 3.3 Security — this is the part to get right

A WebSocket on localhost is reachable by **any web page** open in the same browser. Without this,
any site you visit can rewrite your boards.

- The server generates a token at startup and prints it; Settings has a field to paste it. No token,
  no session.
- The app sends it on connect; the server checks it **and** checks the `Origin` header against the
  app's own origin.
- Off by default. The Settings → Agents tab (`apps/web/src/app/settings/AgentsPanel.tsx`) owns the toggle, the
  token, connection status and a kill switch.
- A visible indicator while a session is live. An agent editing your board silently is the failure
  mode to design against.

---

## Phase 4 — the MCP server

New package `packages/mcp-server`. `@modelcontextprotocol/sdk`, stdio transport.

### 4.1 The one sanctioned new dependency

The app has zero UI deps by design and the palette plan forbids adding any. This package never ships
to the browser — it is a Node process — so the SDK is fine here and **only** here. Nothing in
`apps/web` or `packages/node-kit` may import it.

### 4.2 Tools are generated, never listed

The server does not contain a list of tools. It asks the connected tab for its operation manifest and
registers one MCP tool per row, with `toJsonSchema(op.params)` as the input schema. An extension that
contributes operations therefore contributes MCP tools with zero server changes — the same rule the
dock, context menu and palette already follow for node types.

Cold start: ship a committed fallback manifest (generated by a script from the core operations) so
tools exist before any tab connects, then refresh and emit `notifications/tools/list_changed` when a
tab connects with more.

When no tab is connected, every tool returns a clear "Lifeboard is not open — open it and enable the
agent bridge in Settings" rather than hanging. An agent can act on that sentence.

### 4.3 Resources

Expose boards as MCP resources too (`lifeboard://board/<id>`), served from `readBoardSnapshot` so
*reading* a board works without opening it. Cheap, and it keeps an agent from having to mutate the
UI just to look.

---

## Phase 5 — tests and docs

- Unit (node-kit): the registry, `toJsonSchema`, `connectShapes`/`disconnectShapes`, and each
  operation against a stub editor where one suffices.
- Unit (mcp-server): manifest → tool generation, the no-tab-connected path, token rejection.
- e2e (`apps/web/e2e/agent.spec.ts`): a fake bridge client driving a board end to end — create board,
  insert two notes, set a property, connect them, `node.find` returns both, `relation.list` returns
  the edge, ⌘Z undoes the connect as one step. Use `gotoFresh` (`helpers.ts:8`).
- README: an Agents section, and the operation registry under the architecture notes.
- Verify with `pnpm -r typecheck` and `pnpm -r test`. Do not run dev or builds.

## Deliberately not in scope

- Headless/offline operation. Requires the tab.
- Multi-tab arbitration beyond last-connection-wins.
- Runtime-loaded plugins contributing operations (the compile-time path works; sandboxing is
  the separate not-started item the README lists).

## Gotchas checklist (read before coding)

- [ ] Never `window.editor` — use the `BoardBridge`.
- [ ] One `markHistoryStoppingPoint` per operation; agent edits stay undoable.
- [ ] Property defs before shapes; values via `updateShapeProperties` only.
- [ ] Results are JSON and failures are `ok: false`, never throws.
- [ ] Token **and** `Origin` check; off by default; visible while live.
- [ ] Cap every list-returning operation.
- [ ] Operation ids are stable forever, like command ids.
- [ ] `@modelcontextprotocol/sdk` in `packages/mcp-server` only.
- [ ] StrictMode: module-scope registration, no effects.
