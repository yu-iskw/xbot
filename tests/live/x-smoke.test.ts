import { createXbotRuntime, LiveXReadClient, XPostSchema, XUserSchema } from "@yu-iskw/xbot-core";
import { describe, expect, it } from "vitest";

const token = process.env.X_BEARER_TOKEN;
const enabled = process.env.XBOT_LIVE_TEST === "1" && Boolean(token);

// Explicitly enabled, budget-limited checks against the real X API (auth, access, response shape).
describe.skipIf(!enabled)("live X API", () => {
  it("authenticates and returns posts in the normalized schema", async () => {
    const client = new LiveXReadClient({ bearerToken: token! });
    const res = await client.searchRecent({ query: "typescript -is:retweet lang:en", maxResults: 10 });
    for (const p of res.posts) XPostSchema.parse(p);
    for (const u of res.users) XUserSchema.parse(u);
    expect(res.pages).toBe(1);
  });

  it("runs a research workflow within a tiny budget", async () => {
    const runtime = await createXbotRuntime({
      x: { mode: "live", bearerToken: token! },
      storage: { url: ":memory:" },
      budgets: { perRunUsd: 0.2, perRequestUsd: 0.2, dailyUsd: 0.5, monthlyUsd: 1 },
    });
    const { report } = await runtime.research({ query: "TypeScript", maxPosts: 10, windowDays: 1 });
    expect(report.methodology.xMode).toBe("live");
    expect(report.methodology.estimatedXCostUsd).toBeLessThanOrEqual(0.2);
    await runtime.close();
  });
});
