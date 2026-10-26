# Quickstart

## 1. Mock mode (no credentials)

```bash
pnpm install && pnpm build
alias xbot="node $(pwd)/packages/cli/dist/bin.js"
xbot research "What are developers discussing about Mastra?" --mock
xbot history list
```

## 2. Add a model

Choose model IDs from the [Mastra model catalog](https://mastra.ai/models) and set the provider's API key:

```bash
export XBOT_MODEL="<provider>/<model-id>"      # used for every role
export <PROVIDER>_API_KEY=...
xbot chat --mock
```

With a model configured, research uses the planner, analyst, and reporter agents. Use per-role variables (`XBOT_MODEL_PLANNING`, `XBOT_MODEL_ANALYSIS`, `XBOT_MODEL_REPORTING`, `XBOT_MODEL_CHAT`) to send each task to a different model.

REPL commands: `/research <q>`, `/history`, `/report <id>`, `/thread`, `/new`, `/tools on|off`, `/budget`, `/exit`. Resume a conversation with `xbot chat --thread <id>`.

## 3. Use live X data

Create an app in the X Developer Console, buy pay-per-use credits, and copy the app's **bearer token** (app-only OAuth 2.0). xbot never needs user-context or write credentials.

```bash
export X_BEARER_TOKEN=...
export XBOT_BUDGET_DAILY_USD=2     # pick budgets before the first run
xbot doctor
xbot research "Mastra adoption" --max-posts 30 --window-days 3
```

## 4. Config file (optional)

`xbot.config.json` in the working directory, or `--config <path>`. Keep secrets out of it.

```json
{
  "models": { "default": "<provider>/<model-id>" },
  "budgets": { "perRunUsd": 0.5, "dailyUsd": 2, "monthlyUsd": 20 },
  "topics": [
    {
      "id": "ai-agents",
      "description": "AI agent frameworks",
      "keywords": ["\"AI agents\"", "#AIagents"],
      "schedule": { "cron": "0 9 * * *", "timezone": "Asia/Tokyo" }
    }
  ]
}
```

Precedence: defaults < config file < environment < CLI flags.

`xbot monitor` lists topics, and `xbot monitor ai-agents` researches one and reports what changed since its previous report. Schedules run only in a long-running server with `XBOT_ENABLE_SCHEDULES=true`.

## 5. Mastra Studio

```bash
pnpm --filter @xbot/dev dev     # http://localhost:4111
```
