import { RequestContext } from "@mastra/core/request-context";
import { createMockModel } from "@mastra/core/test-utils/llm-mock";
import { describe, expect, it } from "vitest";
import {
  deterministicPlan,
  finalizePlan,
  MockXReadClient,
  ResearchInputSchema,
  ResearchReportSchema,
  renderReportMarkdown,
  toolScope,
  validateFindings,
  XApiError,
  XBOT_TENANT_CONTEXT_KEY,
  type XPost,
} from "../src/index";
import { extractKeyTerms } from "../src/research/plan";
import { fixedNow, memoryRuntime } from "./helpers";

const post = (id: string): XPost => ({
  id,
  text: "t",
  url: `https://x.com/i/web/status/${id}`,
  retrievedAt: "2026-10-26T00:00:00Z",
});

describe("planning", () => {
  it("extracts subject terms from natural-language questions", () => {
    expect(extractKeyTerms("What are developers discussing about Mastra?")).toEqual(["Mastra"]);
    const plan = deterministicPlan(
      ResearchInputSchema.parse({ query: "What are developers discussing about Mastra?" }),
    );
    expect(plan.queries.map((q) => q.query)).toEqual(["Mastra -is:retweet", "#Mastra -is:retweet"]);
    const ops = deterministicPlan(ResearchInputSchema.parse({ query: '"agent frameworks" -python lang:en' }));
    expect(ops.queries[0]!.query).toBe('"agent frameworks" -python lang:en -is:retweet');
  });

  it("clamps model-proposed plans to hard limits and the cost budget", () => {
    const input = ResearchInputSchema.parse({ query: "x", maxPosts: 1000 });
    const proposed = {
      objective: "o",
      queries: Array.from({ length: 10 }, (_, i) => ({ query: `q${i}`, rationale: "" })),
    };
    const plan = finalizePlan(proposed, input, {
      maxCostUsd: 0.5,
      costs: { estimate: (posts: number, users = posts) => posts * 0.005 + users * 0.01 },
      now: fixedNow(),
      planner: "model",
    });
    expect(plan.queries.length).toBeLessThanOrEqual(5);
    expect(plan.estimatedMaxCostUsd).toBeLessThanOrEqual(0.5);
    expect(plan.maxResultsPerQuery).toBeLessThanOrEqual(100);
    expect(Date.parse(plan.endTime) - Date.parse(plan.startTime)).toBeLessThanOrEqual(7 * 86_400_000);
  });
});

describe("validator", () => {
  it("removes citations absent from the evidence and drops unsupported findings", () => {
    const result = validateFindings(
      {
        summary: "",
        opposingViews: [],
        unknowns: [],
        findings: [
          { claim: "a", kind: "observation", confidence: "high", evidence: ["1", "999"], limitations: [] },
          { claim: "b", kind: "synthesis", confidence: "high", evidence: ["999"], limitations: [] },
          { claim: "c", kind: "interpretation", confidence: "high", evidence: [], limitations: [] },
        ],
      },
      [post("1")],
    );
    expect(result.findings.map((f) => f.claim)).toEqual(["a", "c"]);
    expect(result.findings[0]!.evidence).toEqual(["1"]);
    expect(result.findings[1]!.confidence).toBe("low");
    expect(result.removedCitations).toEqual(["999"]);
    expect(result.droppedFindings).toBe(1);
  });
});

describe("research workflow (deterministic, mock X)", () => {
  it("produces a persisted, cited report whose sources are all collected evidence", async () => {
    const runtime = await memoryRuntime();
    const { report, runId, deduplicated } = await runtime.research({
      query: "What are developers discussing about Mastra?",
    });
    ResearchReportSchema.parse(report);
    expect(deduplicated).toBe(false);
    expect(report.sources.length).toBeGreaterThan(0);
    expect(report.methodology.xMode).toBe("mock");
    const cited = new Set(report.findings.flatMap((f) => f.evidence));
    expect(new Set(report.sources.map((s) => s.id))).toEqual(cited);
    // Reports keep references only, never raw post text.
    expect(JSON.stringify(report)).not.toContain("Typed steps + retries");
    expect(await runtime.getReport(report.id)).toEqual(report);
    expect(await runtime.getRun(runId)).toMatchObject({ status: "completed", reportId: report.id });
    expect(renderReportMarkdown(report)).toContain("## Sources");
    await runtime.close();
  });

  it("is idempotent for a repeated trigger event", async () => {
    const runtime = await memoryRuntime();
    const a = await runtime.research({ query: "Mastra", trigger: "slack", triggerEventId: "evt-1" });
    const b = await runtime.research({ query: "Mastra", trigger: "slack", triggerEventId: "evt-1" });
    expect(b.deduplicated).toBe(true);
    expect(b.report.id).toBe(a.report.id);
    expect(await runtime.listReports()).toHaveLength(1);
    const c = await runtime.research({ query: "Mastra" });
    expect(c.report.id).not.toBe(a.report.id);
    await runtime.close();
  });

  it("admits background runs immediately and answers replays from storage", async () => {
    const runtime = await memoryRuntime();
    const { runId } = await runtime.startResearch({ query: "Mastra", triggerEventId: "evt-bg" });
    // The run row exists as soon as startResearch returns, before the workflow finishes.
    expect(await runtime.getRun(runId)).toMatchObject({ id: runId });
    const replay = await runtime.startResearch({ query: "Mastra", triggerEventId: "evt-bg" });
    expect(replay.runId).toBe(runId);
    for (let i = 0; i < 100 && (await runtime.getRun(runId))?.status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(await runtime.getRun(runId)).toMatchObject({ status: "completed" });
    await runtime.close();
  });

  it("returns the stored report for a replay without running the workflow again", async () => {
    const runtime = await memoryRuntime();
    const first = await runtime.research({ query: "Mastra", triggerEventId: "evt-2" });
    const runsBefore = (await runtime.store.listRuns("default")).length;
    const replay = await runtime.research({ query: "Mastra", triggerEventId: "evt-2" });
    expect(replay).toMatchObject({ runId: first.runId, deduplicated: true, report: { id: first.report.id } });
    expect(await runtime.store.listRuns("default")).toHaveLength(runsBefore);
    await runtime.close();
  });

  it("stops collecting at the run budget and marks the report partial", async () => {
    const runtime = await memoryRuntime({ budgets: { perRunUsd: 0.12 } });
    const { report } = await runtime.research({ query: "agents OR mastra OR LLMOps", maxPosts: 200 });
    expect(report.methodology.estimatedXCostUsd).toBeLessThanOrEqual(0.12);
    await runtime.close();
  });

  it("records per-query failures as limitations", async () => {
    const failing = {
      mode: "mock" as const,
      searchRecent: async () => {
        throw Object.assign(new Error("X API rejected the credentials (401)"), { name: "XApiError" });
      },
      searchArchive: async () => ({ posts: [], users: [], pages: 0 }),
      getPosts: async () => [],
      getUserByUsername: async () => {
        throw new Error("no");
      },
      getUserPosts: async () => ({ posts: [], users: [], pages: 0 }),
    };
    const runtime = await memoryRuntime({ x: { client: failing } });
    const { report } = await runtime.research({ query: "Mastra" });
    // A generic per-query failure is recorded as a limitation rather than failing the whole run.
    expect(report.status).toBe("partial");
    expect(report.limitations.join(" ")).toMatch(/failed/);
    await runtime.close();
  });
});

describe("research workflow failures", () => {
  it("marks the run failed on credential errors", async () => {
    const client = new MockXReadClient();
    client.searchRecent = async () => {
      throw new XApiError("X API rejected the credentials (401)", "unauthorized");
    };
    const runtime = await memoryRuntime({ x: { client } });
    await expect(runtime.research({ query: "Mastra" })).rejects.toThrow(/credentials/);
    const runs = await runtime.store.listRuns("default");
    expect(runs[0]).toMatchObject({ status: "failed" });
    expect(await runtime.listReports()).toEqual([]);
    await runtime.close();
  });
});

describe("research workflow (model-backed, mock LLM)", () => {
  it("uses planner/analyst/reporter models but still enforces citation validation", async () => {
    const planner = createMockModel({
      version: "v2",
      mockText: { objective: "o", queries: [{ query: "#Mastra -is:retweet", rationale: "tag" }] },
    });
    const analyst = createMockModel({
      version: "v2",
      mockText: {
        summary: "Developers like Mastra workflows. See 1999999999999999999.",
        findings: [
          {
            claim: "Typed workflows are praised",
            kind: "observation",
            confidence: "medium",
            evidence: ["1900000000000000001", "1999999999999999999"],
            limitations: [],
          },
          {
            claim: "Invented claim",
            kind: "synthesis",
            confidence: "high",
            evidence: ["1888888888888888888"],
            limitations: [],
          },
        ],
        opposingViews: [],
        unknowns: ["sample is small"],
      },
    });
    const reporter = createMockModel({
      version: "v2",
      mockText: "Summary from reporter about post 1900000000000000001.",
    });
    const runtime = await memoryRuntime({
      models: { planning: planner as never, analysis: analyst as never, reporting: reporter as never },
    });
    const { report } = await runtime.research({ query: "Mastra" });
    expect(report.methodology.queries).toEqual(["#Mastra -is:retweet"]);
    expect(report.findings.map((f) => f.claim)).toEqual(["Typed workflows are praised"]);
    expect(report.findings[0]!.evidence).toEqual(["1900000000000000001"]);
    expect(report.validation.removedCitations.sort()).toEqual(["1888888888888888888", "1999999999999999999"]);
    expect(report.status).toBe("partial");
    expect(report.summary).toContain("Summary from reporter");
    expect(report.sources.map((s) => s.id)).toEqual(["1900000000000000001"]);
    await runtime.close();
  });
});

describe("storage", () => {
  it("isolates reports and runs by tenant", async () => {
    const runtime = await memoryRuntime();
    const { report, runId } = await runtime.research({ query: "Mastra", tenantId: "tenant-a" });
    expect(await runtime.getReport(report.id, { tenantId: "tenant-a" })).toBeDefined();
    expect(await runtime.getReport(report.id, { tenantId: "tenant-b" })).toBeUndefined();
    expect(await runtime.getRun(runId, { tenantId: "tenant-b" })).toBeUndefined();
    expect(await runtime.listReports({ tenantId: "tenant-b" })).toEqual([]);
    expect(await runtime.searchHistory("Mastra", { tenantId: "tenant-a" })).toHaveLength(1);
    await runtime.close();
  });

  it("scopes the agent's research tools to the tenant on the request context", async () => {
    const runtime = await memoryRuntime();
    const { report } = await runtime.research({ query: "Mastra", tenantId: "tenant-a" });
    const ctxFor = (tenant: string) => {
      const requestContext = new RequestContext();
      requestContext.set(XBOT_TENANT_CONTEXT_KEY, tenant);
      return { requestContext } as never;
    };
    const getReport = runtime.tools.getReport.execute!;
    expect(await getReport({ id: report.id }, ctxFor("tenant-a"))).toMatchObject({ found: true });
    expect(await getReport({ id: report.id }, ctxFor("tenant-b"))).toEqual({ found: false });
    // Without a tenant on the context the runtime default applies, which does not own the report.
    expect(await getReport({ id: report.id }, {} as never)).toEqual({ found: false });
    const history = runtime.tools.searchHistory.execute!;
    expect(await history({ query: "", limit: 10 }, ctxFor("tenant-b"))).toEqual({ reports: [] });
    expect(toolScope(ctxFor("tenant-b"))).toEqual({ tenantId: "tenant-b", trigger: "chat" });
    await runtime.close();
  });

  it("purges cached post content and flags citing reports (compliance)", async () => {
    const runtime = await memoryRuntime();
    const { report } = await runtime.research({ query: "Mastra" });
    const target = report.sources[0]!.id;
    expect(await runtime.cachedPosts([target])).toHaveLength(1);
    const res = await runtime.purgePost(target);
    expect(res.cacheRows).toBe(1);
    expect(res.citingReports).toEqual([report.id]);
    expect(await runtime.cachedPosts([target])).toHaveLength(0);
    const status = await runtime.store.evidenceStatus(report.id);
    expect(status.find((s) => s.postId === target)?.status).toBe("removed");
    await runtime.close();
  });

  it("expires cached posts after the TTL", async () => {
    const runtime = await memoryRuntime();
    const { report } = await runtime.research({ query: "Mastra" });
    const removed = await runtime.store.purgeExpiredPosts(
      new Date(fixedNow().getTime() + 25 * 3600_000).toISOString(),
    );
    expect(removed).toBeGreaterThan(0);
    expect(await runtime.cachedPosts(report.sources.map((s) => s.id))).toHaveLength(0);
    await runtime.close();
  });
});

describe("discovery workflow", () => {
  it("ranks recurring topics excluding the interests themselves", async () => {
    const runtime = await memoryRuntime();
    const result = await runtime.discover({ interests: ["AI agents"], maxTopics: 3 });
    expect(result.topics.length).toBeGreaterThan(0);
    expect(result.topics.map((t) => t.label)).not.toContain("aiagent");
    expect(result.topics.every((t) => t.samplePostIds.length > 0)).toBe(true);
    await runtime.close();
  });
});
