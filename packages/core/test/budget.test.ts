import { describe, expect, it } from "vitest";
import { BudgetedXReadClient, LibSqlXbotStore, MockXReadClient } from "../src/index";
import { fixedNow } from "./helpers";

async function setup(limits = {}, enforcePeriodLimits = true) {
  const store = new LibSqlXbotStore({ url: ":memory:" });
  await store.init();
  const client = new BudgetedXReadClient({
    inner: new MockXReadClient({ now: fixedNow }),
    usage: store,
    cache: store,
    limits,
    enforcePeriodLimits,
    now: fixedNow,
  });
  return { store, client };
}

describe("BudgetedXReadClient", () => {
  it("rejects a request whose worst case exceeds the run budget, before calling X", async () => {
    const { client } = await setup({ perRunUsd: 0.1 });
    client.openRun("r1");
    await expect(
      client.searchRecent({ query: "mastra", maxResults: 100 }, { runId: "r1" }),
    ).rejects.toMatchObject({
      code: "budget_exceeded",
    });
    expect(client.runUsage("r1")).toMatchObject({ requests: 0, costUsd: 0 });
  });

  it("tracks per-run spend and refuses once exhausted", async () => {
    const { client } = await setup({ perRunUsd: 0.5 });
    client.openRun("r1");
    await client.searchRecent({ query: "the", maxResults: 10 }, { runId: "r1" });
    const used = client.runUsage("r1")!;
    expect(used.costUsd).toBeGreaterThan(0);
    expect(used.requests).toBe(1);
    // A run-level request override can only lower the configured cap.
    client.openRun("r2", 100);
    await expect(
      client.searchRecent({ query: "the", maxResults: 100, maxPages: 1 }, { runId: "r2" }),
    ).rejects.toMatchObject({
      code: "budget_exceeded",
    });
  });

  it("caps requests made outside a run", async () => {
    const { client } = await setup({ perRequestUsd: 0.05 });
    await expect(client.searchRecent({ query: "the", maxResults: 10 })).rejects.toMatchObject({
      code: "budget_exceeded",
    });
  });

  it("enforces the daily budget across consumers using the shared ledger", async () => {
    const { client, store } = await setup({ dailyUsd: 0.2, perRequestUsd: 1 });
    await store.recordUsage({
      operation: "seed",
      posts: 0,
      users: 0,
      costUsd: 0.15,
      mode: "mock",
      at: fixedNow().toISOString(),
    });
    await expect(client.searchRecent({ query: "the", maxResults: 10 })).rejects.toThrow(/Daily X budget/);
    expect((await client.remaining()).dailyUsd).toBeCloseTo(0.05);
  });

  it("can skip period limits (mock development mode)", async () => {
    const { client, store } = await setup({ dailyUsd: 0.01, perRequestUsd: 1 }, false);
    await store.recordUsage({
      operation: "seed",
      posts: 0,
      users: 0,
      costUsd: 5,
      mode: "mock",
      at: fixedNow().toISOString(),
    });
    await expect(client.searchRecent({ query: "the", maxResults: 10 })).resolves.toBeDefined();
  });

  it("serves previously retrieved posts from cache without spending", async () => {
    const { client, store } = await setup({ perRequestUsd: 1 });
    const res = await client.searchRecent({ query: "#Mastra", maxResults: 10 });
    const before = (await store.periodCost("2000-01-01T00:00:00Z", "2000-01-01T00:00:00Z", "mock")).month;
    client.openRun("r1");
    const posts = await client.getPosts(
      res.posts.map((p) => p.id),
      { runId: "r1" },
    );
    expect(posts).toHaveLength(res.posts.length);
    expect((await store.periodCost("2000-01-01T00:00:00Z", "2000-01-01T00:00:00Z", "mock")).month).toBe(
      before,
    );
    expect(client.runUsage("r1")?.cacheHits).toBe(res.posts.length);
  });
});
