# Self-hosting — implementation plan

Status: **Phases 0–2 built, nothing deployed.** Boards, saved queries and extension toggles sync
through the server. Phase 3 (images) is next. Deploying needs a tldraw licence key.

Lifeboard runs on a personal server at `lifeboard.darkroomlab.net`, and the same boards open from any
browser. A desktop app comes next, then mobile. This plan covers the server and the hosted web app only.
The model is Obsidian's: the app is free and works with no server at all; a server vault adds sync.

Decisions taken before this was written:

| Decision | Chosen |
|---|---|
| Who the server is for | **One owner.** Every server row carries a `vault_id`, so sharing or hosted customers later are additions, not rewrites |
| Vault kinds | **Local and server.** Local is today's IndexedDB. Server boards sync through the server |
| Sync engine | **`@tldraw/sync`**, one `TLSocketRoom` per board, SQLite storage. Live, server-authoritative |
| Offline | **Not for server vaults yet.** `useSync` keeps no local copy (tldraw #5505, #6424). Revisit in the mobile phase with a local snapshot plus delta reconnect (#9927) |
| Vaults per server | **One in the UI**, many in the data model |
| Login | **App-level, single owner.** Argon2 hash in `.env`, no signup, 30-day session cookie, rate-limited. The whole origin sits behind it |
| Server shape | **One `apps/server`** (Fastify): serves the built web app, `/api/*` and the sync websockets |
| Assets | **Local disk**, content-addressed, same `asset:<hash>` srcs as today |
| Agent panel | **Not on the server.** Stays a local dev feature for now |
| Apple Health | **Removed from main** and parked on `experiment/health` |
| Backups | **No paid backups.** The existing "last backup" reminder covers server vaults and downloads the server's export |
| tldraw licence | **A key is required to deploy at all.** On a public `https:` origin with no key, tldraw hides the canvas after 5 s, whoever uses it. A free Hobby key (watermark, non-commercial) fits a private instance |
| Deploy | **Arcane, admin-configurator style.** Restart in Arcane fetches the deploy branch and rebuilds |

---

## What the codebase gives us

- **Assets are already out of the documents.** Every blob is `asset:<sha256>` in one content-addressed
  store, referenced from tldraw asset records and from shape props (book files, covers, quote images).
  Documents never need rewriting when a board moves between vaults.
- **Almost nothing reads across boards.** Queries, views, relations, ⌘K find and book highlights work on
  the open board only. Property definitions live in each board's document meta. The two exceptions
  are asset GC after a board is deleted (`boards/deleteBoard.ts`) and backup export
  (`persistence/backup.ts`). Both read other boards' IndexedDB directly, and both move to the server,
  which can read every room.
- **Store migrations run before validation** on every load path, so retiring a node type is a
  store-scoped migration. `itemsToNotes` and `rollupsToTables` are the precedent.
- **`PlatformAdapter`** is already the port surface for storage, files and network.

## Vault-level state

The server stores, per vault: the board index, saved queries (`lifeboard:queries` today), the
disabled-extensions set (`lifeboard:disabledExtensions`) and board thumbnails. Clients read them over
REST and refetch on focus. A board list does not need live push.

Everything else stays per device: theme, grid, keymap, sidebar state, reader and dice prefs, the rates
cache and open tabs.

## Assets in a server vault

- Upload: `PUT /api/assets/<hash>`. Idempotent, so a re-upload costs nothing.
- Resolve: `/api/assets/<hash>`, served `immutable`. Clients cache blobs in the existing IndexedDB store.
- GC: a nightly mark-and-sweep on the server across all rooms, with a grace period for fresh uploads.
- Export: the existing zip format (v1) as a download endpoint.

## Moving boards between vaults

On first login, one prompt: "Move these N local boards to your server?" After that, every board's menu
has **Move to server** / **Make local**. The server seeds the new room from the board's snapshot, the
same mechanism as `pendingRestore`, after the client uploads any assets the server is missing.

## Deploy

Follows the box's convention (see `/opt/stacks/admin-configurator` for the pattern):

```
/opt/stacks/lifeboard/
├── compose.yaml   # copy of deploy/darkroomlab/compose.yaml
└── .env           # mode 600, edited in Arcane
```

- The container fetches the deploy branch with `GITHUB_TOKEN` on start, then builds and runs it. If the
  build fails, the last good build keeps serving, and a status file feeds the healthcheck.
- `proxy-net` (external), no published ports, `restart: unless-stopped`, a named volume for data.
- `deploy/darkroomlab/` in this repo holds the compose file, `Caddyfile.snippet` and `.env.example`.
- The server deploys together with the web app it serves, so sync's client/server version check
  (`CLIENT_TOO_OLD` / `SERVER_TOO_OLD`) cannot drift.

---

## Phases

### Phase 0 — clear the ground

- Cut `experiment/health` from main, then delete all health code from main: `packages/health`,
  `health-core`, `health-service`, the Vite proxy, the adapter methods, the health docs.
- A store migration deletes every `node.health.*` shape, its bindings and its children.
- Upgrade tldraw 5.2.5 → 5.5.2, so the sync packages match.

### Phase 1 — an empty server, deployed

- `apps/server`: Fastify, owner login, serves the built web app.
- `deploy/darkroomlab/`: compose, `start.sh`, Caddy snippet, `.env.example`.
- Deployed to `lifeboard.darkroomlab.net` while it still does nothing else.

**As built:**

- **No build step for the server.** Node 26 runs `src/*.ts` directly (type stripping), so `tsc` only
  typechecks. Phase 2 may change this: the server will import extension schemas, and those packages
  contain `.tsx`.
- **No session table.** The cookie holds when the session began, signed with the session secret *and*
  the password hash. A new password or a new secret logs out every device.
- **Argon2id from `node:crypto`**, so no native dependency. Hashes are standard PHC strings.
- **The service worker must not answer `/login`, `/logout` or `/api/*`**, or the login page becomes
  unreachable once it's installed (`navigateFallbackDenylist` in `apps/web/vite.config.ts`).
- **For phase 2:** the installed service worker serves the app shell from cache, so an expired session
  doesn't reach the login page by itself. The first `401` from `/api/*` has to send the app there.
- **The image is only Node, git and pnpm.** `start.sh` fetches and builds the app on start, with the
  token passed on the command line so it never lands in `.git/config` on the volume.

### Phase 2 — sync rooms

- Schema-only entry points for every extension, so the server can build the same `TLSchema` without
  React or DOM code.
- `TLSocketRoom` per board on `SQLiteSyncStorage`.
- A server vault in the client: `<Board>` gets a `useSync` store instead of `persistenceKey`.
- Vault-level state over REST.

**As built:**

- **No schema-only entry points.** The extensions import fine in plain Node (the app's unit tests
  already did it), so the server *bundles* them instead: `apps/server` is built with Vite's SSR mode,
  everything inlined. `@lifeboard/schema` is the one list of shipped extensions and the store
  migrations; the app registers from it and the server builds its schema from it.
  `canvas/boardSchema.test.ts` fails if the two schemas ever differ.
- **Server layout:** `data/vault.sqlite` holds the board index; `data/rooms/<board>.sqlite` holds one
  board each (`node:sqlite`, no native dependency). A room opens on first connect and closes a few
  seconds after the last client leaves. The server bumps a board's "last edited" from the edits it
  receives, so clients don't.
- **The client** merges both lists in `useBoards`. New boards go to the server when one answered.
  The server list is refetched on window focus. Local boards are marked "only on this device" in the
  sidebar when both kinds are listed.
- **Asset GC is off in any browser that has ever seen a server.** Server boards keep their images in
  the local blob store until phase 3, and no local snapshot of theirs exists to mark from. Remembered in
  localStorage, so an offline session can't sweep either.
- **Until phase 3, images on a server board show only in the browser that added them.**
- **Saved queries and switched-off extensions follow the vault** (`app/vaultSettings.ts`).
  localStorage stays the cache, so the first render needs no network; the server's copy wins once it
  answers, and is pulled again on window focus. The first device to connect seeds a vault that has none.
- **Dev:** run `apps/server` with `LIFEBOARD_INSECURE_COOKIES=1`, then
  `LIFEBOARD_SERVER_URL=http://127.0.0.1:8790 pnpm dev`. Without the variable, `pnpm dev` is the
  local-only app.
- **The preview browser can't show live sync**: it barely runs `requestAnimationFrame`, which tldraw's
  sync client sends and applies changes on. Headless Playwright shows edits arriving in ~30 ms.

### Phase 3 — assets and safety

- Asset endpoints, the server-backed asset bridge and `TLAssetStore`.
- Server GC and export. The backup reminder covers server vaults.

### Phase 4 — moving boards

- The first-login prompt, then **Move to server** / **Make local**.

## Deferred

- Desktop app (Tauri), then mobile, with offline for server vaults.
- The agent on the server.
- Selling hosting: a commercial tldraw licence, off-site backups (restic), S3-backed assets.
