---
name: deploy
description: Use when the user asks to deploy, ship, release or put changes live on lifeboard.darkroomlab.net, or asks how deploying works. Points to the repo's deploy procedure (checks, push, container restart, confirming the new commit is served, rollback) and the things never to touch on the server.
---

# Deploying Lifeboard

Follow `docs/deploying.md` in this repo, step by step. It is the single source; don't deploy from memory.

The short version: run the checks, push `main`, restart the `lifeboard` container over SSH with the exact
user and key given there, then poll `https://lifeboard.darkroomlab.net/api/status` until its `revision` is
the commit you pushed. Deploy only when the user asks; ask for a server backup first when the change
touches stored data. If SSH fails once, stop and ask the user.
