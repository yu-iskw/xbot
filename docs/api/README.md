# Interfaces

All interfaces call the same core runtime, so budgets, read-only enforcement, idempotency, and tenant scoping apply everywhere.

## HTTP (`@yu-iskw/xbot-http`)

```bash
XBOT_HTTP_TOKENS="<token-a>:tenant-a,<token-b>:tenant-b" xbot-http   # PORT=4111, HOST=127.0.0.1
```

Tokens must be at least 16 characters. The server refuses to start without tokens unless `XBOT_HTTP_INSECURE_NO_AUTH=true`.

| Method | Path                             | Purpose                                                                                                                                                                                           |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/health`                     | Health (public)                                                                                                                                                                                   |
| POST   | `/v1/research`                   | Start research. Body: `query`, `maxPosts?`, `windowDays?`, `maxCostUsd?`, `language?`, `topicId?`, `idempotencyKey?`, `wait?`. Returns 202 `{ runId }`, or 201 with the report when `wait: true`. |
| GET    | `/v1/research/:id`               | Run status, plus the report once completed                                                                                                                                                        |
| GET    | `/v1/reports/:id`                | Report JSON (`?format=markdown` for Markdown)                                                                                                                                                     |
| GET    | `/v1/reports?q=&topicId=&limit=` | Search report history                                                                                                                                                                             |
| POST   | `/v1/discovery`                  | Run discovery. Body: `interests`, `accounts?`, `maxTopics?`, `windowDays?`, `idempotencyKey?`                                                                                                     |
| GET    | `/v1/topics`                     | Configured topics                                                                                                                                                                                 |
| POST   | `/v1/topics/:id/monitor`         | Research a topic and return what changed since its previous report. Body: `windowDays?`, `idempotencyKey?`                                                                                        |
| GET    | `/v1/budget`                     | Remaining X budget                                                                                                                                                                                |
| POST   | `/v1/chat`                       | Server-sent events (`thread`, `text`, `tool-call`, `tool-result`, `done`). Body: `message`, `threadId?`                                                                                           |

Errors look like `{ "error": { "code", "message" } }`: 400 for invalid input, 401 unauthorized, 402 budget exceeded, 429 rate limited, 502 upstream.

Mastra's built-in `/api/*` routes are off by default. They are not tenant-aware, so `XBOT_HTTP_MASTRA_API=true` mounts them behind a separate admin token list (`XBOT_HTTP_ADMIN_TOKENS`, comma-separated); tenant tokens are rejected there. List `limit` values are clamped to 1–200. `XBOT_ENABLE_SCHEDULES=true` starts topic schedules in this process.

## MCP (`@yu-iskw/xbot-mcp`)

```bash
xbot-mcp                 # stdio (add --mock for fixtures)
XBOT_MCP_TOKENS="<token>:tenant" xbot-mcp --http --port 4112   # Streamable HTTP at /mcp
```

Tools: `xbot_search_posts`, `xbot_get_post`, `xbot_research`, `xbot_discover_topics`, `xbot_get_report`, `xbot_search_history`. Resources: `xbot://topics` and `xbot://reports/{id}` (Markdown). Over HTTP, the bearer token selects the tenant, and DNS-rebinding protection allows only `localhost` by default (`XBOT_MCP_ALLOWED_HOSTS`).

Claude Desktop / Cursor example:

```json
{
  "mcpServers": {
    "xbot": { "command": "npx", "args": ["-y", "@yu-iskw/xbot-mcp"], "env": { "X_BEARER_TOKEN": "..." } }
  }
}
```

The `@mastra/mcp` 2.x line implements the MCP `2026-07-28` revision. Pin and test client compatibility before publishing.

## Slack (`@yu-iskw/xbot-slack`)

```bash
SLACK_BOT_TOKEN=... SLACK_SIGNING_SECRET=... XBOT_MODEL=<provider>/<model-id> xbot-slack   # PORT=4113
```

Set the Slack app's event and interactivity URL to `https://<host>/api/agents/xbot-research-agent/channels/slack/webhook` (see the [Mastra Slack guide](https://mastra.ai/docs/channels) for the app manifest). This process serves only that route and `/healthz`; every other Mastra route returns 404.

- `XBOT_SLACK_ALLOWED_USERS=U123,U456` restricts who can use the bot. `XBOT_SLACK_DAILY_MESSAGES` (default 30) caps messages per user per UTC day.
- Slack research uses the `slack` tenant by default (override with `XBOT_TENANT`), separate from CLI and HTTP history.
- Posting replies to Slack is allowed. Posting anything to X is not, and isn't possible.
