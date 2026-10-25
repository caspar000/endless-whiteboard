# Deploying Lifeboard

How a change gets from this repo to https://lifeboard.darkroomlab.net. Written for whoever does it,
person or agent. `deploy/darkroomlab/README.md` covers setting the server up in the first place.

## How it works

The app runs in one Docker container, `lifeboard`, on the Hetzner box, in the Compose project
`/opt/stacks/lifeboard` (Arcane lists it there). Every time the container starts, `start.sh` fetches
`main` from GitHub, builds it if the commit changed, and serves it.

**Every push to `main` deploys itself.** `.github/workflows/deploy.yml` restarts the container over
SSH, with a key that can do nothing else, and waits until `/api/status` reports the new commit. The
run goes red in the Actions tab if it doesn't. Changes reach `main` through a pull request from
`develop`, once CI is green, so merging that pull request is the deploy.

While a new commit builds (a few minutes), the previous build keeps serving. If the build fails, the
previous build stays up and the container logs say why. The server and the web app deploy together.

## Before you start

- **Merge into `main`, or push to it, only when the user asks.** That is a deploy, live for everyone
  using the server.
- **Ask for a backup before merging** when the change touches stored data: the server's tables
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
   iPhone WebKit specs) and the suite against a real server. Merge once it's green, with *Create a
   merge commit*:

   ```sh
   gh pr create --base main --head develop --title "<what ships>"
   gh pr checks --watch
   gh pr merge --merge
   ```

   Use a merge commit for this pull request, never *Squash and merge* or *Rebase and merge*. Those
   two give `main` copies of `develop`'s commits under new ids, and the next pull request from
   `develop` then conflicts with those copies. With a merge commit, `develop` is never rewritten and
   nothing has to be synced afterwards. Feature branches into `develop` can merge any way.

   When one spec fails in CI, read its trace (the run's `e2e-results` artifact) before calling it a
   regression: under load, timeouts are common. GitHub sometimes rejects a push with
   `Internal Server Error`; it's on GitHub's side, so wait half a minute and push again.

3. **Watch the deploy.** The merge starts the *Deploy* workflow:

   ```sh
   gh run watch "$(gh run list --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
   ```

   It usually takes 2 to 5 minutes. When it fails, the previous build is still serving. Read the
   container logs to see why:

   ```sh
   ssh -i ~/.ssh/hetzner -o IdentitiesOnly=yes deploy@188.245.42.86 \
     'docker logs --since 15m lifeboard 2>&1 | grep -E "\[lifeboard\]|rror" | tail -20'
   ```

   `[lifeboard] building <commit>` then `[lifeboard] serving <commit>` is a good deploy. A build error
   there means the previous commit is still serving: fix it on `develop` and take it through a pull
   request again. Use exactly this user and key. If the login fails, **stop and ask the user**: don't
   try other users or keys, because repeated failed logins get the user's IP banned by fail2ban.

4. **Restart by hand** only if the workflow can't (GitHub down, the deploy key revoked), or to run the
   same commit again:

   ```sh
   ssh -i ~/.ssh/hetzner -o IdentitiesOnly=yes deploy@188.245.42.86 'cd /opt/stacks/lifeboard && docker compose restart'
   ```

   *Run workflow* on the Deploy workflow in the Actions tab does the same from GitHub.

5. **Tell the user how to get it.** The app is cached for offline use. Their browser picks up the new
   version when they click *A new version is ready* in the sidebar, or close every Lifeboard tab and
   open it again. A plain reload keeps the old version.

## Rolling back

`git revert` the bad commit on `develop` and take it through a pull request (step 2); the merge
deploys it. If it can't wait for CI, revert on `main` directly and push, which deploys at once, then
merge `main` into `develop`. The server always serves the head of `main`.

## Never

- Print, copy or commit anything from `/opt/stacks/lifeboard/.env`: it holds the session secret and
  the first account's password hash.
- Delete the `lifeboard_data` volume. It holds every board, file and account. (`lifeboard_app`, the
  checkout and builds, is safe to delete; the next start rebuilds.)
- Edit files on the box to change the app. Change the repo and deploy.
- Edit the server's SQLite files by hand to fix data. Go through the server's API, which validates
  what it stores.
- Touch the Caddy stack (`/opt/stacks/caddy`): other sites on the box share it.
- Use the deploy key (`DEPLOY_SSH_KEY`) for anything else. Its line in `deploy@`'s
  `~/.ssh/authorized_keys` is pinned to `docker compose restart`; to revoke it, delete that line
  (the one ending `github-actions-deploy@lifeboard`).
