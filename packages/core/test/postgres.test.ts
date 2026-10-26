import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createXbotRuntime, type XbotRuntime } from "../src/index";
import { toPositional } from "../src/storage/postgres";
import { fixedNow } from "./helpers";

const adminUrl = process.env.XBOT_TEST_POSTGRES_URL;

// Runs against a real PostgreSQL server when XBOT_TEST_POSTGRES_URL is set (CI provides one).
describe.skipIf(!adminUrl)("PostgreSQL storage", () => {
  const dbName = `xbot_test_${process.pid}_${Date.now()}`;
  let url: string;
  let runtime: XbotRuntime;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const u = new URL(adminUrl!);
    u.pathname = `/${dbName}`;
    url = u.toString();
    runtime = await createXbotRuntime({
      storage: { url },
      x: { mode: "mock" },
      now: fixedNow,
      topics: [{ id: "mastra", description: "Mastra", keywords: ["#Mastra"] }],
    });
  });

  afterAll(async () => {
    await runtime?.close();
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  it("selects the postgres provider from the URL", () => {
    expect(runtime.info.storageProvider).toBe("postgres");
    expect(toPositional("a = ? AND b = ?")).toBe("a = $1 AND b = $2");
  });

  it("runs research end to end and persists reports, runs, and evidence", async () => {
    const { report, runId } = await runtime.research({ query: "Mastra", tenantId: "pg-a" });
    expect(report.sources.length).toBeGreaterThan(0);
    expect(await runtime.getReport(report.id, { tenantId: "pg-a" })).toEqual(report);
    expect(await runtime.getReport(report.id, { tenantId: "pg-b" })).toBeUndefined();
    expect(await runtime.getRun(runId, { tenantId: "pg-a" })).toMatchObject({ status: "completed" });
    // ILIKE: search is case-insensitive like SQLite's LIKE.
    const hits = await runtime.searchHistory("mastra", { tenantId: "pg-a" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sources).toBe(report.sources.length);
  });

  it("enforces idempotency with the unique constraint", async () => {
    const a = await runtime.research({ query: "LLMOps", tenantId: "pg-a", triggerEventId: "evt-pg" });
    const b = await runtime.research({ query: "LLMOps", tenantId: "pg-a", triggerEventId: "evt-pg" });
    expect(b).toMatchObject({ deduplicated: true, runId: a.runId });
  });

  it("purges posts and tracks spend", async () => {
    const { report } = await runtime.research({ query: "security", tenantId: "pg-a" });
    const target = report.sources[0]!.id;
    const purged = await runtime.purgePost(target);
    expect(purged.citingReports).toContain(report.id);
    expect(await runtime.cachedPosts([target])).toEqual([]);
    const spent = await runtime.store.periodCost("2000-01-01T00:00:00Z", "2000-01-01T00:00:00Z", "mock");
    expect(spent.month).toBeGreaterThan(0);
  });

  it("monitors topics using the latest topic report", async () => {
    const first = await runtime.monitor({ topicId: "mastra" });
    const second = await runtime.monitor({ topicId: "mastra" });
    expect(second.previousReportId).toBe(first.reportId);
  });
});
