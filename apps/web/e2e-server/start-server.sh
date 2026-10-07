#!/usr/bin/env bash
# Builds the app and the server, and serves both from a throwaway vault with the password "lifeboard-e2e-password", for
# the tests that need a real server (playwright.server.config.ts).
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm build >/dev/null
pnpm --filter @lifeboard/server build >/dev/null
# The tool prints a whole `.env` line; the hash is what's inside its quotes.
export LIFEBOARD_PASSWORD_HASH="$(printf lifeboard-e2e-password | node ../server/src/hashPasswordCli.ts | sed -E "s/^[A-Z_]+='(.*)'$/\1/")"
export LIFEBOARD_SESSION_SECRET="e2e-session-secret-that-is-long-enough-0123456789"
export LIFEBOARD_DATA_DIR="$(mktemp -d)"
export LIFEBOARD_WEB_DIR="$PWD/dist"
export LIFEBOARD_INSECURE_COOKIES=1
export PORT="${LB_E2E_SERVER_PORT:-4393}"
export HOST=127.0.0.1
exec node --enable-source-maps ../server/dist/main.js
