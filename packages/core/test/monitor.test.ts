import { describe, expect, it } from "vitest";
import { diffReports, type ResearchReport, topicQuery } from "../src/index";
import { memoryRuntime } from "./helpers";

const topics = [
  {
    id: "mastra",
    description: "Mastra framework",
    keywords: ["Mastra", "#Mastra"],
    accounts: ["fixture_ana"],
  },
  { id: "plain", description: "agent security" },
];

describe("topicQuery", () => {
  it("ORs keywords and accounts, falling back to the description", () => {
    expect(topicQuery({ ...topics[0]!, keywords: ["Mastra"], accounts: ["@fixture_ana"] })).toBe(
      "Mastra OR from:fixture_ana",
    );
    expect(topicQuery({ id: "p", description: "agent security", keywords: [], accounts: [] })).toBe(
      "agent security",
    );
  });
});

describe("diffReports", () => {
  const report = (id: string, sources: string[], claims: string[]): ResearchReport =>
    ({
      id,
      generatedAt: `2026-10-2${id.length}T00:00:00Z`,
      sources: sources.map((s) => ({ id: s, url: `https://x.com/i/web/status/${s}`, retrievedAt: "t" })),
      findings: claims.map((claim) => ({
        claim,
        kind: "observation",
        confidence: "low",
        evidence: [],
        limitations: [],
      })),
    }) as unknown as ResearchReport;

  it("reports new sources, new findings, and findings no longer observed", () => {
    const prev = report("a", ["1", "2"], ['"agent" recurs across 3 of 8 posts.', "Old finding"]);
    const curr = report("bb", ["2", "3"], ['"agent" recurs across 5 of 12 posts.', "Brand new finding"]);
    const diff = diffReports(curr, prev);
    expect(diff.newSources).toEqual(["3"]);
    // Counts differ between runs, but the same finding is still recognized.
    expect(diff.newFindings).toEqual(["Brand new finding"]);
    expect(diff.noLongerObserved).toEqual(["Old finding"]);
    expect(diff.summary).toMatch(/1 newly cited post/);
  });

  it("describes a first report", () => {
    expect(diffReports(report("a", ["1"], ["x"]), undefined).summary).toMatch(/First report/);
  });
});

describe("monitor workflow", () => {
  it("compares each topic run with the topic's previous report", async () => {
    const runtime = await memoryRuntime({ topics });
    const first = await runtime.monitor({ topicId: "mastra" });
    expect(first.previousReportId).toBeUndefined();
    expect(first.summary).toMatch(/First report/);
    expect(first.newSources.length).toBeGreaterThan(0);

    const second = await runtime.monitor({ topicId: "mastra" });
    expect(second.previousReportId).toBe(first.reportId);
    expect(second.reportId).not.toBe(first.reportId);
    // Fixtures are static, so nothing changed between runs.
    expect(second.newSources).toEqual([]);
    expect(second.newFindings).toEqual([]);

    const report = await runtime.getReport(second.reportId);
    expect(report?.query).toBe("Mastra OR #Mastra OR from:fixture_ana");
    expect(await runtime.listReports({ topicId: "mastra" })).toHaveLength(2);
    await runtime.close();
  });

  it("does not rerun an occurrence that was already processed", async () => {
    const runtime = await memoryRuntime({ topics });
    const a = await runtime.monitor({ topicId: "plain", trigger: "schedule", triggerEventId: "fire-1" });
    const b = await runtime.monitor({ topicId: "plain", trigger: "schedule", triggerEventId: "fire-1" });
    expect(b.reportId).toBe(a.reportId);
    expect(b.summary).toMatch(/already processed/);
    await runtime.close();
  });

  it("rejects unknown topics and lists configured schedules", async () => {
    const runtime = await memoryRuntime({
      topics: [{ ...topics[0]!, schedule: { cron: "0 9 * * *", timezone: "Asia/Tokyo" } }],
    });
    await expect(runtime.monitor({ topicId: "nope" })).rejects.toThrow(/Unknown topic/);
    // Schedules are only registered when explicitly enabled (server/worker processes).
    expect(runtime.info.schedules).toEqual([]);
    await runtime.close();
  });
});
