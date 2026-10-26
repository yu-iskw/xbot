// Programmatic use of the xbot core library. Runs against mock X data with no credentials.
import { createXbotRuntime, renderReportMarkdown } from "@yu-iskw/xbot-core";

const runtime = await createXbotRuntime({
  x: { mode: "mock" },
  // Optional: set XBOT_MODEL (e.g. "provider/model-id") to use model-backed planning and analysis.
  ...(process.env.XBOT_MODEL ? { models: { default: process.env.XBOT_MODEL } } : {}),
  storage: { url: process.env.XBOT_DB_URL ?? ":memory:" },
});

const { report } = await runtime.research({ query: "AI agent frameworks", maxPosts: 50 });
console.log(renderReportMarkdown(report));
if (report.sources.length === 0) {
  console.error("expected at least one cited source");
  process.exitCode = 1;
}
await runtime.close();
