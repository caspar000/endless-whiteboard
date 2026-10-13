# Deploying Lifeboard

How a change gets from this repo to https://lifeboard.darkroomlab.net. Written for whoever does it,
person or agent. `deploy/darkroomlab/README.md` covers setting the server up in the first place.

## How it works

The app runs in one Docker container, `lifeboard`, on the Hetzner box, in the Compose project
`/opt/stacks/lifeboard` (Arcane lists it there). Every time the container starts, `start.sh` fetches
`main` from GitHub, builds it if the commit changed, and serves it. So **deploying is pushing to `main`
and restarting the container.** Changes reach `main` through a pull request from `develop`, once CI
is green.

While a new commit builds (a few minutes), the previous build keeps serving. If the build fails, the
previous build stays up and the container logs say why. The server and the web app deploy together.

## Before you start

- **Deploy only when the user asks.** It's live for everyone using the server.
- **Ask for a backup first** when the change touches stored data: the server's tables
  (`apps/server/src/accounts.ts`, `vault.ts`), or a board record's props or migrations (anything in
  `packages/` with a migration sequence). The user downloads one from Settings → Storage → *Download
  server backup (.zip)*. Board data lives in the `lifeboard_data` volume, and nothing else backs it up.

## Steps

1. **Check what you changed.** Work lands on `develop`. Before pushing, from the repo root:

   ```sh
   pnpm typecheck
   ```

   Then the unit tests of each package you touched (`pnpm --filter <package> test`) and the end-to-end
   specs for what you changed:

   ```sh
   cd apps/web
   LB_E2E_PORT=4391 pnpm exec playwright test e2e/<spec>.spec.ts          # the app
   pnpm exec playwright test -c playwright.server.config.ts               # with a real server
   ```

   The whole suite doesn't need to run locally: CI runs it (step 2).

2. **Pull request from `develop` into `main`.** CI (`.github/workflows/ci.yml`) runs on every pull
   request into `main`: typecheck and every package's unit tests, the whole app suite (Chromium and the
   iPhone WebKit specs) and the suite against a real server. Merge once it's green, with *Squash and
   merge* or *Rebase and merge*; merge commits are turned off.

   ```sh
   gh pr create --base main --head develop --title "<what ships>"
   gh pr checks --watch
   gh pr merge --squash   # or --rebase
   ```

   Either way `main` gets new commits that `develop` doesn't have, so merge `main` back into
   `develop` straight after, or the next pull request carries this one's changes again. The content
   is the same on both sides, so it merges cleanly, and nothing pushed to `develop` meanwhile is lost:

   ```sh
   git switch develop && git pull && git merge origin/main && git push
   ```

   When one spec fails in CI, read its trace (the run's `e2e-results` artifact) before calling it a
   regression: under load, timeouts are common. GitHub sometimes rejects a push with
   `Internal Server Error`; it's on GitHub's side, so wait half a minute and push again.

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

`git revert` the bad commit on `develop`, take it through a pull request, and restart (steps 2 to 4).
If it can't wait for CI, revert on `main` directly and push, then merge `main` into `develop`. The server always serves the head of
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
