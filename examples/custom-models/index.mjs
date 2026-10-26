// Route each task to a different model using Mastra's provider/model strings.
// Model IDs below come from environment variables; pick real IDs from the Mastra model catalog.
import { createXbotRuntime } from "@yu-iskw/xbot-core";

const required = ["XBOT_MODEL_CHAT", "XBOT_MODEL_PLANNING", "XBOT_MODEL_ANALYSIS", "XBOT_MODEL_REPORTING"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Set ${missing.join(", ")} (format: provider/model-id) and the provider API keys.`);
  process.exit(1);
}

const runtime = await createXbotRuntime({
  x: { mode: process.env.X_BEARER_TOKEN ? "live" : "mock", bearerToken: process.env.X_BEARER_TOKEN },
  models: {
    chat: process.env.XBOT_MODEL_CHAT,
    planning: process.env.XBOT_MODEL_PLANNING,
    analysis: process.env.XBOT_MODEL_ANALYSIS,
    reporting: process.env.XBOT_MODEL_REPORTING,
  },
  storage: { url: "file:./xbot-example.db" },
  budgets: { perRunUsd: 0.5, dailyUsd: 2, monthlyUsd: 20 },
});

const { report } = await runtime.research({ query: "What are developers saying about MCP servers?" });
console.log(JSON.stringify(report, null, 2));
await runtime.close();
