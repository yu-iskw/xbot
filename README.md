# xbot

A modular, open-source **X (Twitter) research agent** built on [Mastra](https://mastra.ai).

xbot researches public conversations on X and produces **structured, evidence-backed reports** with citations. It is **strictly read-only on X**: it can search and read posts, but there is no code path that posts, replies, likes, reposts, or modifies anything on X.

The research agent is a library. The CLI, HTTP API, MCP server, and Slack bot are separate packages that use the same agent and workflows.

```text
 CLI (REPL + commands)   HTTP (REST + SSE)   MCP (stdio + HTTP)   Slack (Mastra Channels)
            \                    |                   |                    /
             └──────────── @yu-iskw/xbot-core (Mastra runtime) ──────────┘
                    agents · workflows · tools · memory · budgets
                         /                              \
              X read-only adapter                 persistence (libSQL)
              (official SDK / mock)
```

## Packages

| Package                                 | What it is                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`@yu-iskw/xbot-core`](packages/core)   | Mastra agents, research and discovery workflows, read-only X tools, budgets, storage, schemas |
| [`@yu-iskw/xbot-cli`](packages/cli)     | `xbot` command: interactive REPL, one-shot research, history, workflows, `doctor`             |
| [`@yu-iskw/xbot-http`](packages/http)   | `xbot-http`: authenticated REST API with SSE chat streaming                                   |
| [`@yu-iskw/xbot-mcp`](packages/mcp)     | `xbot-mcp`: MCP server over stdio or authenticated Streamable HTTP                            |
| [`@yu-iskw/xbot-slack`](packages/slack) | `xbot-slack`: Slack bot via Mastra Channels, with user allowlists and quotas                  |

Interfaces depend only on core; core never imports an interface. `pnpm lint` enforces this.

## Quickstart (no credentials needed)

```bash
pnpm install
pnpm build
node packages/cli/dist/bin.js research "What are developers discussing about Mastra?" --mock
```

This runs the real Mastra research workflow (plan → collect → analyze → validate → save) against deterministic X fixtures, prints a cited Markdown report, and saves it to `~/.xbot/xbot.db`. No model, X credentials, server, or Slack are needed: without a model, planning and analysis use deterministic implementations.

```bash
xbot research "LLMOps trends" --format json --out report.json
xbot history list
xbot history show <reportId>
xbot workflow run discover --interest "AI agents" --interest "LLMOps"
xbot monitor <topicId>   # research a configured topic and show what changed since last time
xbot chat            # needs a chat model (XBOT_MODEL)
xbot doctor
```

To use real data and models, see [docs/quickstart](docs/quickstart/README.md). The main settings:

| Variable                                      | Purpose                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `X_BEARER_TOKEN`                              | App-only OAuth 2.0 bearer token. When set, X mode is live.                                                                |
| `XBOT_MODEL`                                  | Default model in Mastra `provider/model-id` format. `XBOT_MODEL_{CHAT,PLANNING,ANALYSIS,REPORTING}` override it per task. |
| `XBOT_DB_URL`                                 | libSQL URL (default `file:~/.xbot/xbot.db` for the CLI) or `postgres://` connection string for production.                |
| `XBOT_BUDGET_{RUN,REQUEST,DAILY,MONTHLY}_USD` | X spending limits (defaults: $1 / $0.50 / $5 / $50).                                                                      |

See [.env.example](.env.example) for the full list.

## Library usage

```ts
import { createXbotRuntime, renderReportMarkdown } from "@yu-iskw/xbot-core";

const runtime = await createXbotRuntime({
  x: { mode: "mock" },
  models: { default: process.env.XBOT_MODEL }, // optional
  storage: { url: "file:./xbot.db" },
});
const { report } = await runtime.research({ query: "AI agent frameworks", maxPosts: 50 });
console.log(renderReportMarkdown(report));
await runtime.close();
```

## Guarantees

- **Read-only on X, enforced in code.** Only five GET operations exist (`searchRecent`, `searchArchive`, `getPosts`, `getUserByUsername`, `getUserPosts`). The runtime exposes them through a frozen allowlisted facade, and a network guard installed under the official SDK refuses anything other than the allowlisted GET endpoints. Only app-only bearer tokens are accepted.
- **Evidence-backed reports.** A deterministic validator removes any citation that is not in the collected evidence and drops findings left unsupported. Reports store post IDs, URLs, and timestamps, not post text.
- **Bounded spending.** Every X request is checked against per-run, per-request, daily, and monthly budgets before it is sent. LLM-proposed plans are clamped by code.
- **Idempotent triggers.** Runs started by an event (Slack event, schedule occurrence, HTTP idempotency key) return the original report when replayed.
- **Tenant isolation.** Runs, reports, and chat threads are scoped by tenant in every interface.
- **Untrusted content.** Post text reaches models only inside delimited data blocks, and nothing a post says can grant new capabilities.

## Development

```bash
pnpm install
pnpm build         # all packages (tsup)
pnpm typecheck
pnpm lint          # Biome + dependency boundary check
pnpm test          # vitest: unit, workflow, interface, and end-to-end (mock X, mock models)
pnpm --filter @xbot/dev dev   # Mastra Studio on http://localhost:4111
```

Live X tests run only in the manually started `Live X smoke test` workflow.

## Documentation

- [Architecture](docs/architecture/README.md)
- [Quickstart](docs/quickstart/README.md)
- [HTTP, MCP, and Slack interfaces](docs/api/README.md)

## License

Apache-2.0
