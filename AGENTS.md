# AGENTS.md

xbot is a TypeScript monorepo (pnpm workspaces) for a read-only X research agent built on Mastra. Instructions in [CLAUDE.md](CLAUDE.md) apply to all coding agents.

- Install: `pnpm install` (Node >= 22.13)
- Build: `pnpm build`
- Check: `pnpm typecheck && pnpm lint && pnpm test`
- Run locally without credentials: `node packages/cli/dist/bin.js research "<topic>" --mock`

Add a changeset (`pnpm changeset`) for user-facing changes to published `@yu-iskw/xbot-*` packages.
