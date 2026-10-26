# Architecture

## Dependency rule

```text
interfaces (cli, http, mcp, slack)  →  core  →  X port / storage port
```

No reverse dependencies, and no interface depends on another. `scripts/check-boundaries.mjs` (run by `pnpm lint`) checks package manifests and imports, and also keeps CLI, HTTP-server, MCP, and Slack libraries out of core. Removing the Slack package does not affect anything else.

## Core runtime

`createXbotRuntime(config)` builds and wires:

| Piece     | Implementation                                                                                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X access  | `XReadClient` port → `LiveXReadClient` (official `@xdevplatform/xdk`) or `MockXReadClient` (fixtures), wrapped by `readOnlyFacade` and `BudgetedXReadClient`                                  |
| Agents    | `xbot-research-agent` (chat, tools, Mastra Memory); `xbot-planner`, `xbot-analyst`, `xbot-reporter` (structured output). Each exists only when its model role is configured.                  |
| Workflows | `xbot-research` (prepare → plan → collect → analyze → report), `xbot-discovery` (prepare → scan-and-rank), and `xbot-monitor` (baseline → research → diff), all Mastra workflows              |
| Tools     | `x-search-posts`, `x-get-posts`, `x-get-user`, `x-get-user-posts`, `xbot-research`, `xbot-discover-topics`, `xbot-get-report`, `xbot-search-history`                                          |
| Storage   | `SqlXbotStore` (libSQL or PostgreSQL) for runs, reports, evidence references, the usage ledger, and the post cache; Mastra `LibSQLStore` or `PostgresStore` for memory and workflow snapshots |

The public API is small: `research`, `startResearch`, `discover`, `getRun`, `getReport`, `listReports`, `searchHistory`, `purgePost`, `budgetStatus`, plus `mastra`, `agent`, and `tools` for embedding.

## Research workflow

1. **prepare**: validates input, derives the idempotency key, and acquires the run row (a unique constraint makes replays return the existing run). Opens the run budget.
2. **plan**: the planner model (or the deterministic planner) proposes queries; `finalizePlan` clamps them to at most 5 queries, 3 pages per query, 100 results per page, the 7-day recent-search window, and the run's cost cap.
3. **collect**: runs recent search with pagination, deduplicates by ID and normalized text, and stops cleanly when a budget or rate limit is hit. Raw posts stay in process memory and the TTL-bound post cache; only IDs enter the workflow snapshot.
4. **analyze**: the analyst model (or a deterministic lexical analysis) labels findings as observation, synthesis, or interpretation, with evidence post IDs.
5. **report**: the deterministic validator removes citations that aren't in the evidence and drops unsupported findings. The reporter model optionally rewrites the summary from the validated findings only. The report is saved and the run marked completed.

Model failures fall back to the deterministic step and are recorded in the report's limitations. A failed collect, auth error, or persistence error marks the run `failed`; a failed run can be re-acquired by the same idempotency key.

## Model routing

```ts
models: { default?, chat?, planning?, analysis?, reporting? }
```

Values are Mastra model router strings (`provider/model-id`) or model instances. `default` fills unset roles. With no models, workflows run deterministically and chat is unavailable.

## Budgets and cost

`BudgetedXReadClient` estimates the worst-case cost of each request (`posts × $0.005 + users × $0.010` by default, configurable) and refuses it if it would exceed the run cap (requests inside a run), the per-request cap (requests outside a run, such as chat tool calls), or the remaining UTC daily or monthly budget. The estimate is reserved until the request settles or fails, so overlapping calls cannot spend the same remaining balance. Actual spend is written to `xbot_usage`, which every interface shares. Mock mode keeps run caps but skips daily and monthly limits. Estimates ignore X's 24-hour deduplication window, so they err high. Post lookup counts one user read per distinct author, because the request expands authors.

## Persistence

| Data                               | Store                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| Conversation memory                | Mastra Memory (libSQL)                                                             |
| Workflow snapshots                 | Mastra workflow storage (libSQL)                                                   |
| Runs, reports, evidence references | `xbot_runs`, `xbot_reports`, `xbot_evidence`                                       |
| Retrieved post content             | `xbot_post_cache` (expires after 24h by default; `purgePost`, `purgeExpiredPosts`) |
| Spend ledger                       | `xbot_usage`                                                                       |

Reports contain post IDs, URLs, authors, and timestamps, but no post text. Markdown rendering shows excerpts only while the cache still holds them. `purgePost(id)` deletes the cached content and marks every citing report's evidence as `removed`, which supports X's deletion and protection obligations. Retention and redistribution still need review against the X Developer Agreement before running a public service.

Both backends share one implementation, `SqlXbotStore`, over a small driver interface; a `SqlDialect` holds the differences (DDL types, JSON array length, case-insensitive `LIKE`).

- **libSQL** (default): local file, `:memory:`, or remote `libsql://`. Best for the CLI and development.
- **PostgreSQL** (production): set `XBOT_DB_URL=postgres://...` (or `storage.provider: "postgres"`). xbot's tables and Mastra's `PostgresStore` (memory and workflow snapshots) share one `pg` pool. `pg` and `@mastra/pg` are optional peer dependencies of core, loaded only when PostgreSQL is selected. The unique constraint on `idempotency_key` gives idempotent admission across concurrent workers without a distributed lock.

Schema creation is `CREATE TABLE IF NOT EXISTS` at startup. There is no migration tool yet; add one before changing table shapes in a deployed database.

## Scheduling and durable execution

Topics with a `schedule` become entries in the **monitor** workflow's native Mastra `schedule` when `enableSchedules` is set (the HTTP server enables it with `XBOT_ENABLE_SCHEDULES=true`). The monitor workflow researches the topic (its keywords and accounts OR-ed together) and diffs the new report against the topic's previous one: newly cited posts, new findings, and findings no longer observed. Claims are compared after normalizing case, punctuation, and counts, so this is a heuristic. Scheduled fires use the fire minute as the trigger event id, so overlapping fires don't produce duplicate reports.

## Run admission

The runtime admits a run before starting its workflow: it derives the idempotency key and inserts the run row, so the canonical run id exists the moment `research`/`startResearch`/`discover` is called. Replays are answered from storage without starting a workflow. A workflow started directly (Mastra Studio, the workflow API, or a topic schedule) admits inside `prepare` instead. `prepare` continues a run it already inserted and does not insert that id again. The monitor workflow nests the research workflow, so a scheduled fire is admitted once, by research `prepare`. If a workflow ends in anything but success, the run is marked `failed`. The CLI never starts the scheduler. A terminated CLI process does not resume work: long-running autonomous work needs a running server or worker with shared storage.

## Security model

- Read-only enforcement happens in code, not prompts: a frozen facade, an allowlisted GET-only network guard installed inside the SDK client (it fails closed if the SDK internals change), no write tools, app-only credentials only, and tests asserting all of this.
- Post text is untrusted. It reaches models inside `<x_posts>` blocks that the content can't close, under a standing policy that embedded instructions are data.
- Errors are mapped to coded `XApiError`s without response bodies or tokens. The HTTP layer returns a generic 500 for anything unexpected.
- Tenant isolation: every store read takes a tenant. HTTP and MCP tokens map to tenants, chat threads are tenant-prefixed, and Slack uses its own tenant.
