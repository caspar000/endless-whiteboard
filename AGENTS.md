# Notes for agents working in this repo

- **Deploying** to https://lifeboard.darkroomlab.net: follow `docs/deploying.md`. Deploy only when the
  user asks, and ask them for a server backup first when a change touches stored data.
- **What the app is, and what to know before changing it:** `README.md`, especially *Things worth
  knowing before you change something*.
- **Adding something the user can do** (a node type, a command, an import): `.claude/skills/extension-surfaces/SKILL.md`
  lists every place it has to reach (⌘K, Help, README).
- **Package manager:** pnpm. After changing `packages/canvas-editor` or `packages/canvas`, rebuild their
  type declarations (`pnpm types:canvas`) before typechecking the apps.
