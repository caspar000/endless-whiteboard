#!/bin/sh
# Restart the container (in Arcane) to deploy: this fetches the deploy branch, builds it if it
# changed, and runs it. A build that fails leaves the previous one serving.
set -eu

: "${LIFEBOARD_REPO:?set LIFEBOARD_REPO in .env}"
: "${GITHUB_TOKEN:?set GITHUB_TOKEN in .env}"
BRANCH="${LIFEBOARD_BRANCH:-main}"
SRC=/app/src         # git checkout of the deploy branch
BUILDS=/app/builds   # one directory per built revision
CURRENT=/app/current # symlink to the build being served

log() { echo "[lifeboard] $*"; }

serve() {
	cd "$1"
	unset GITHUB_TOKEN
	LIFEBOARD_REVISION=$(cat REVISION) exec node --enable-source-maps apps/server/dist/main.js
}

# The token goes on the command line only, never into .git/config on the volume.
fetch() {
	[ -d "$SRC/.git" ] || git init --quiet "$SRC"
	git -C "$SRC" fetch --quiet --depth 1 "https://x-access-token:${GITHUB_TOKEN}@github.com/${LIFEBOARD_REPO}.git" "$BRANCH" &&
		git -C "$SRC" reset --quiet --hard FETCH_HEAD
}

# Chained with && because `set -e` does nothing inside the `if` that calls this.
build() {
	dir="$BUILDS/$1"
	rm -rf "$dir" && mkdir -p "$dir" &&
		git -C "$SRC" archive HEAD | tar -x -C "$dir" &&
		cd "$dir" &&
		pnpm install --frozen-lockfile --store-dir /app/.pnpm-store &&
		NODE_OPTIONS=--max-old-space-size=4096 pnpm build &&
		echo "$1" > REVISION
}

mkdir -p "$BUILDS"
current=$(cat "$CURRENT/REVISION" 2>/dev/null || echo none)

if fetch; then
	rev=$(git -C "$SRC" rev-parse HEAD)
else
	log "could not fetch $LIFEBOARD_REPO@$BRANCH"
	[ "$current" != none ] || exit 1
	rev=$current
fi

[ "$rev" = "$current" ] && log "serving $rev" && serve "$CURRENT"

# Keep the old build answering while the new one builds.
old=
if [ "$current" != none ]; then
	(serve "$CURRENT") &
	old=$!
fi
trap '[ -n "$old" ] && kill "$old" 2>/dev/null; exit 143' TERM INT

log "building $rev (was $current)"
if build "$rev"; then
	if [ -n "$old" ]; then kill "$old" && wait "$old" || true; fi
	ln -sfn "$BUILDS/$rev" "$CURRENT"
	for dir in "$BUILDS"/*; do [ "$dir" = "$BUILDS/$rev" ] || rm -rf "$dir"; done
	log "serving $rev"
	serve "$CURRENT"
fi

log "build of $rev failed; still serving $current"
[ -n "$old" ] || exit 1
wait "$old"
