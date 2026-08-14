# @lifeboard/mcp-server

An MCP server that lets a coding agent read and change your Lifeboard boards — create boards, add
nodes, set properties, draw relations, query.

## How it fits together

```
  agent  ──stdio──▶  mcp-server  ──WebSocket──▶  Lifeboard tab  ──▶  the live tldraw editor
                     (this pkg)      127.0.0.1        (browser)
```

The app is the *client* even though it is the thing being driven, because a browser tab cannot
listen on a port. Operations run in the real editor, so the property sidecar, store migrations, undo
history and rendering all behave exactly as they do when you work by hand — and you watch it happen.

**This package contains no list of tools.** The connected tab reports the operations it offers and
the server projects them onto MCP, so an extension that contributes an operation contributes a tool.
Before any tab connects it serves `src/fallbackManifest.ts`, a committed copy generated from the
operation registry (`packages/node-kit/src/ops/manifest.test.ts` writes and guards it), so an agent
sees the tools at startup rather than an empty list.

## Setup

```sh
pnpm --filter @lifeboard/mcp-server build
```

Register it with your agent. For Claude Code:

```sh
claude mcp add lifeboard -- node /absolute/path/to/packages/mcp-server/dist/index.js
```

Then start it once by hand to read the token it prints, open Lifeboard, and paste that token into
**Settings → Agents** and switch it on.

Set `LIFEBOARD_AGENT_TOKEN` to keep the token stable across restarts — otherwise a new one is
generated each start and has to be re-pasted.

| Option | Env var | Default |
|---|---|---|
| `--port` | `LIFEBOARD_AGENT_PORT` | `8787` |
| `--token` | `LIFEBOARD_AGENT_TOKEN` | generated per start |
| `--origin` (repeatable) | — | any loopback origin |

## Security

A WebSocket on localhost is reachable by **any web page the browser has open**, so two gates stand
in front of it:

- **A token.** The app sends it on connect; a mismatch is refused and the socket closed. This is the
  real gate.
- **An `Origin` check.** Browser-enforced and forgeable by a non-browser client, so it is not the
  real gate — it is the cheap one that stops a drive-by page before the handshake. Loopback origins
  pass by default because the app may be served from a dev server, a preview server or an installed
  PWA on an arbitrary port; `--origin` replaces that default with an explicit list.

Beyond that: the listener binds `127.0.0.1` only, the bridge is **off by default** in Settings, one
tab is connected at a time, and an unauthenticated socket is dropped after ten seconds.

Everything an agent does lands in the board's undo history, one step per operation — except
`board.delete`, which destroys a board's canvas database and therefore asks for `confirm: true`.

## Notes for anyone changing this

- **stdout is the MCP protocol channel.** Every human-readable line goes to stderr; one stray
  `console.log` corrupts the JSON-RPC stream and the client disconnects with a parse error that
  looks nothing like its cause.
- **Tool names are not operation ids.** MCP tool names are restricted to `[A-Za-z0-9_-]`, so
  `board.list` is offered as `board_list`. That mapping is reversible only because operation ids
  never contain an underscore — a test in node-kit enforces it.
- `src/protocol.ts` is a deliberate structural duplicate of `apps/web/src/agent/protocol.ts`; see
  its doc comment for why, and bump `AGENT_PROTOCOL_VERSION` in both when the wire format changes.
