# @lifeboard/agent-host

Runs Claude Code against your boards, so the agent lives in a panel inside Lifeboard instead of in a
terminal somewhere else.

## How it fits together

```
  you  ──▶  agent panel  ──WebSocket──▶  agent-host  ──▶  claude  (Claude Code)
            (in the app)     127.0.0.1    (this pkg)         │
                  ▲                            │             │ in-process MCP
                  └────── turn events ─────────┘◀────────────┘
                                               │
                                          the live editor
```

This is the sibling of `@lifeboard/mcp-server`, and the difference between them is the whole point:

| | `mcp-server` | `agent-host` (this) |
|---|---|---|
| Launched by | an agent, over stdio | you |
| Runs a model | no — it relays | **yes** |
| The app is | driven from outside | driven from its own sidebar |

Both answer the same handshake on the same port, so the app's end of the bridge is identical for
either. It learns which one it reached from the `chat` flag in the welcome, and shows the panel's
text box only when there is something behind it.

Under the dev server the host takes an ephemeral port, so it no longer *contends* for 8787 with a
stdio relay — but the two still contend for the **tab**, which holds one bridge connection at a
time. The managed host wins it, and Settings → Agents says so. That is the correct constraint
rather than a limitation to work around: the tab drives one conversation, and two processes both
claiming to be that conversation is not a state worth supporting.

Set `LIFEBOARD_NO_AGENT=1` to stop the dev server starting one at all.

## Setup

None. `pnpm dev` builds this package and the dev server starts it
(`apps/web/vite/agentHost.ts`) — open the panel from the toggle at the right of the tab strip, or
with `⌘⇧A`, and type.

That works because the dev server is the only thing already running that can start a process for a
browser tab: it spawns the host on an **ephemeral port**, hands the app the port and token over
`/__lifeboard/agent-host` on its own origin, and kills it on shutdown. Nothing is pasted, and
nothing is persisted — the credentials are new on every dev-server restart, which is exactly why
storing them would be worse than not.

It signs in with your existing Claude Code login, so there is no API key either.

**Running it by hand** — for a built app, where there is no dev server to own a process, or to point
the app at a specific port:

```sh
pnpm agent   # builds mcp-server + agent-host, then starts the host on 8787
```

Then paste the token it prints into **Settings → Agents** and switch the bridge on.

| Option | Env var | Default |
|---|---|---|
| `--port` (`0` binds an ephemeral one and reports it) | `LIFEBOARD_AGENT_PORT` | `8787` |
| `--token` | `LIFEBOARD_AGENT_TOKEN` | generated per start |
| `--model` (a *fallback* — the panel sends a model per turn) | `LIFEBOARD_AGENT_MODEL` | whatever Claude Code would pick |
| `--origin` (repeatable) | — | any loopback origin |

## What the agent can and cannot do

It gets the operations the connected tab offers, plus `WebSearch` and `WebFetch` so it can research
something and put the answer on the board. It gets **nothing else** — no shell, no filesystem, no
subagents.

That boundary is one pure function, `decidePermission` in `session.ts`, and it is asserted directly
in `session.test.ts` rather than inferred from how the model behaves. A model declining to read a
file proves it was well behaved, not that it was prevented, and those are very different properties.

Two decisions hold the boundary up:

- **`allowedTools` is deliberately empty.** A bare name there auto-approves a tool *before*
  `canUseTool` is consulted, which would leave two places deciding what may run and only one of them
  auditable. Everything reaches the gate instead.
- **`settingSources: []`.** Your own `CLAUDE.md` and Claude Code settings are not loaded. They
  describe whatever repository you last worked in, and their permission rules could re-enable the
  very tools the gate exists to withhold.

Everything the agent does lands in the board's undo history, one step per operation — the same as
the MCP path, because it is the same operations.

## Notes for anyone changing this

- **A conversation is one long-lived streaming-input `query()`**, not a fresh query per turn. That
  is what gives it an open input channel — so a follow-up can be queued mid-turn and steer work
  already running — and it is what makes the SDK's control requests available at all. The two things
  the per-turn shape used to buy are recovered rather than given up: the tool list follows the live
  manifest through `setMcpServers`, and the *gate* re-reads the manifest per call, so a withdrawn
  operation is refused from that instant; and "stop" is `Query.interrupt()`, which halts at a safe
  boundary and leaves the conversation able to carry on.
- **Model and reasoning effort arrive with every prompt**, chosen in the panel's composer. A change
  is applied to the *running* conversation with `setModel` and `applyFlagSettings` rather than by
  starting a new one, because the context somebody is halfway through is precisely what they do not
  want to lose when they reach for a stronger model. `session.ts` compares the request against what
  the conversation is already running, so an unchanged selection costs nothing;
  `selection.test.ts` pins all of that against a mocked SDK.
- **The SDK wants a Zod shape; the manifest carries JSON Schema.** `tools.ts` translates between
  them, and refuses anything outside node-kit's closed parameter space rather than approximating it.
  A parameter shown inaccurately produces a call that validates in the host and fails in the app.
- **The board tools are `alwaysLoad`, not deferred behind tool search.** The SDK's default is to tell
  the model a server exists and make it call `ToolSearch` to learn what that server offers — the right
  trade for a machine with twenty servers attached, the wrong one for the single server this panel
  exists to drive. Every conversation was opening with a search for tools it was always going to use.
  `tools.ts` sets `_meta['anthropic/alwaysLoad']` on each tool, which is what
  `createSdkMcpServer({ alwaysLoad: true })` does; this server is a raw `McpServer`, so it sets it
  directly.
- **Each turn is prefixed with a `<lifeboard-context>` block** naming the open board and the user's
  selection (`formatTurnContext`). The panel knows both, so making the agent call `board.list` and
  `view.selection` to find out was spending a model turn on what was already on screen. Those
  operations still exist, for the cases the block cannot cover — a background board, or a selection
  the user changed mid-turn.
- **The context-window figure comes from two different fields, and mixing them up is the hazard.**
  `result.usage` is *per-turn* in a streaming-input session, which is what "how full is the window"
  means; `result.modelUsage` is *cumulative*, so it is read only for `contextWindow`. Cache reads
  count toward the window — a cached prefix is still in front of the model. `contextUsageFrom` in
  `session.ts` is the one place that does this, and `context.test.ts` pins it.
- **Text arrives twice** — as `delta` while the model writes, then as one authoritative `text` when
  the block closes. Deltas can be shed under load, so the transcript is built from `text` and
  `delta` is only ever a preview. See `ChatEvent` in `mcp-server/src/protocol.ts`.
- `AGENT_PROTOCOL_VERSION` is checked on every handshake and lives in two structural duplicates —
  this package imports `mcp-server`'s copy; the app has its own. Bump both when the wire changes.
