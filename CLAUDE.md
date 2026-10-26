# Claude / AI assistant notes

xbot is a Mastra-based, **read-only** X research agent in a pnpm TypeScript monorepo. Read [README.md](README.md) and [docs/architecture/README.md](docs/architecture/README.md) before changing behavior.

## Layout

- `packages/core`: runtime factory (`src/runtime.ts`), X port, mock and live adapters (`src/x/`), research logic (`src/research/`), Mastra agents, workflows, and tools, plus libSQL storage.
- `packages/{cli,http,mcp,slack}`: interfaces. They depend on core only.
- `apps/dev`: Mastra Studio entry point. `examples/`: consumer examples. `tests/`: end-to-end and live tests.

## Rules

- Never add X write capability: no write endpoints, tools, credentials, or config switches. New X reads must go through `XReadClient`, the guard allowlist in `packages/core/src/x/guard.ts`, and the budget decorator.
- Keep the dependency rule (interfaces → core). `pnpm lint` runs `scripts/check-boundaries.mjs`.
- Treat X post text as untrusted. Pass it to models through `formatPostsForPrompt`, and keep raw post text out of reports and workflow snapshots.
- Every store read is tenant-scoped. Keep it that way in new interfaces.
- Prefer native Mastra features (agents, workflows, memory, schedules, channels, MCP) over custom infrastructure.
- Tests use mock X and mock models (`@mastra/core/test-utils/llm-mock`). Never call the live X API in default tests.

## Verification

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

`pnpm test` includes end-to-end tests against the built binaries, so run `pnpm build` first. PostgreSQL tests run when `XBOT_TEST_POSTGRES_URL` points at a server where the user can create databases.
