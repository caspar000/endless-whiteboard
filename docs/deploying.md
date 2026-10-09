# Deploying Lifeboard

How a change gets from this repo to https://lifeboard.darkroomlab.net. Written for whoever does it,
person or agent. `deploy/darkroomlab/README.md` covers setting the server up in the first place.

## How it works

The app runs in one Docker container, `lifeboard`, on the Hetzner box, in the Compose project
`/opt/stacks/lifeboard` (Arcane lists it there). Every time the container starts, `start.sh` fetches
`main` from GitHub, builds it if the commit changed, and serves it. So **deploying is pushing to `main`
and restarting the container.**

While a new commit builds (a few minutes), the previous build keeps serving. If the build fails, the
previous build stays up and the container logs say why. The server and the web app deploy together.

## Before you start

- **Deploy only when the user asks.** It's live for everyone using the server.
- **Ask for a backup first** when the change touches stored data: the server's tables
  (`apps/server/src/accounts.ts`, `vault.ts`), or a board record's props or migrations (anything in
  `packages/` with a migration sequence). The user downloads one from Settings → Storage → *Download
  server backup (.zip)*. Board data lives in the `lifeboard_data` volume, and nothing else backs it up.

## Steps

1. **Check.** From the repo root:

   ```sh
   pnpm typecheck
   pnpm lint
   ```

   Then the unit tests of each package you touched (`pnpm --filter <package> test`) and the end-to-end
   specs for what you changed:

   ```sh
   cd apps/web
   LB_E2E_PORT=4391 pnpm exec playwright test e2e/<spec>.spec.ts          # the app
   pnpm exec playwright test -c playwright.server.config.ts               # with a real server
   ```

   The whole app suite (no spec named) takes about 8 minutes. When a run of the whole suite fails one
   spec, run that spec alone before calling it a regression: under load, timeouts are common.

2. **Commit to `main` and push.** GitHub sometimes rejects a push with `Internal Server Error`; it's on
   GitHub's side, so wait half a minute and push again.

3. **Restart the container:**

   ```sh
   ssh -i ~/.ssh/hetzner -o IdentitiesOnly=yes deploy@188.245.42.86 'cd /opt/stacks/lifeboard && docker compose restart'
   ```

   Use exactly this user and key. If it fails, **stop and ask the user**: don't try other users or
   keys, because repeated failed logins get the user's IP banned by fail2ban.

4. **Wait until the new commit is served.** `/api/status` needs no login and reports the revision:

   ```sh
   rev=$(git rev-parse HEAD)
   until curl -s https://lifeboard.darkroomlab.net/api/status | grep -q "$rev"; do sleep 15; done
   ```

   This usually takes 2 to 5 minutes. If it hasn't changed after 10, read the logs:

   ```sh
   ssh -i ~/.ssh/hetzner -o IdentitiesOnly=yes deploy@188.245.42.86 \
     'docker logs --since 15m lifeboard 2>&1 | grep -E "\[lifeboard\]|rror" | tail -20'
   ```

   `[lifeboard] building <commit>` then `[lifeboard] serving <commit>` is a good deploy. A build error
   there means the previous commit is still serving: fix, commit, push and restart again.

5. **Tell the user how to get it.** The app is cached for offline use. Their browser picks up the new
   version when they click *A new version is ready* in the sidebar, or close every Lifeboard tab and
   open it again. A plain reload keeps the old version.

## Rolling back

`git revert` the bad commit, push, and restart (steps 2 to 4). The server always serves the head of
`main`.

## Never

- Print, copy or commit anything from `/opt/stacks/lifeboard/.env`: it holds the session secret and
  the first account's password hash.
- Delete the `lifeboard_data` volume. It holds every board, file and account. (`lifeboard_app`, the
  checkout and builds, is safe to delete; the next start rebuilds.)
- Edit files on the box to change the app. Change the repo and deploy.
- Edit the server's SQLite files by hand to fix data. Go through the server's API, which validates
  what it stores.
- Touch the Caddy stack (`/opt/stacks/caddy`): other sites on the box share it.
