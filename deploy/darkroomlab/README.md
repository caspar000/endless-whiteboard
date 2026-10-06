# Lifeboard on the Hetzner box

The stack follows the box's convention: a Compose project in `/opt/stacks/lifeboard`, which Arcane lists
because it lives there, behind the shared Caddy container on `proxy-net`.

**To deploy, restart the container in Arcane.** On every start, `start.sh` fetches the branch named in
`.env`, builds it if the commit changed, and serves it. While a new commit builds (a few minutes), the
previous build keeps serving. If the build fails, the previous build stays up and the container logs
say why.

## First-time setup

On your machine:

```sh
pnpm --filter @lifeboard/server hash-password   # prints the LIFEBOARD_PASSWORD_HASH line
openssl rand -hex 32                            # the session secret
```

The repo is public, so the box needs no GitHub token. If it becomes private, make a fine-grained token
with read-only **Contents** access and set `GITHUB_TOKEN` in `.env`.

On the box (`ssh -i ~/.ssh/hetzner -o IdentitiesOnly=yes deploy@188.245.42.86`):

1. Create `/opt/stacks/lifeboard/` with `compose.yaml` and `start.sh` from this folder, and a `.env`
   made from `.env.example`. Run `chmod 600 .env`.
2. Point `lifeboard.darkroomlab.net` at the box in DNS, if a wildcard record doesn't already cover it.
3. Append `Caddyfile.snippet` to `/opt/stacks/caddy/Caddyfile`, then
   `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`.
4. In Arcane, open the `lifeboard` project and **Deploy**. The first start builds from scratch, so give it
   several minutes before the healthcheck turns green.

## Day to day

- **Deploy:** push to the deploy branch, then **Restart** in Arcane.
- **Change the password:** generate a new hash, replace it in `.env`, and **Redeploy** in Arcane so the
  container picks up the new environment. Every logged-in device is logged out.
- **Log every device out:** change `LIFEBOARD_SESSION_SECRET` the same way.
- **What's running:** `https://lifeboard.darkroomlab.net/api/status` reports the deployed commit.

## Volumes

- `lifeboard_app`: the git checkout, the builds and the pnpm store. Safe to delete; the next start
  rebuilds everything.
- `lifeboard_data`: board data, once server vaults exist. **Not** safe to delete, and not backed up.
