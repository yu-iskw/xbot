import { createXbotRuntime, loadConfigFromEnv, mergeConfig } from "@yu-iskw/xbot-core";

// Mastra Studio loads this module and reads the exported `mastra` instance.
// The dev server runs from .mastra/output, so the database path is relative to it.
// Uses mock X data unless X_BEARER_TOKEN is set; set XBOT_MODEL to enable the chat agent.
const runtime = await createXbotRuntime(
  mergeConfig({ storage: { url: "file:../xbot-dev.db" }, logging: true }, loadConfigFromEnv()),
);

export const mastra = runtime.mastra;
