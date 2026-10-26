# @yu-iskw/xbot-core

Mastra runtime for xbot, a read-only X research agent: agents, research and discovery workflows, read-only X tools, budgets, storage, and Zod schemas.

```ts
import { createXbotRuntime, renderReportMarkdown } from "@yu-iskw/xbot-core";

const runtime = await createXbotRuntime({ x: { mode: "mock" }, storage: { url: ":memory:" } });
const { report } = await runtime.research({ query: "AI agent frameworks" });
console.log(renderReportMarkdown(report));
```

See the [repository README](https://github.com/yu-iskw/xbot#readme) and [architecture notes](https://github.com/yu-iskw/xbot/blob/main/docs/architecture/README.md).
