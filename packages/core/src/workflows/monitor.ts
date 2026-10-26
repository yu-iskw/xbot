import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { topicQuery } from "../research/topics";
import {
  MonitorInputSchema,
  MonitorResultSchema,
  ResearchInputSchema,
  type ResearchReport,
  type ResearchTopicSchema,
} from "../schemas/research";
import type { XbotStore } from "../storage/store";
import { type createResearchWorkflow, ResearchWorkflowOutputSchema } from "./research";

export const MONITOR_WORKFLOW_ID = "xbot-monitor";

export interface ScheduleEntry {
  id: string;
  cron: string;
  timezone?: string;
  inputData: z.output<typeof MonitorInputSchema>;
}

export interface MonitorWorkflowDeps {
  store: XbotStore;
  topics: z.output<typeof ResearchTopicSchema>[];
  /** Nested research workflow. Its prepare step admits the run, including scheduled fires. */
  researchWorkflow: ReturnType<typeof createResearchWorkflow>;
  schedule?: ScheduleEntry[];
}

const BaselineSchema = z.object({
  input: MonitorInputSchema,
  query: z.string(),
  previousReportId: z.string().optional(),
});

/** Normalize a claim for comparison: case, punctuation, and numbers vary between runs of the same finding. */
function claimKey(claim: string): string {
  return claim
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^\p{L}#]+/gu, " ")
    .trim();
}

/** Compare a topic's new report with its previous one. */
export function diffReports(current: ResearchReport, previous: ResearchReport | undefined) {
  const prevSources = new Set(previous?.sources.map((s) => s.id) ?? []);
  const prevClaims = new Set(previous?.findings.map((f) => claimKey(f.claim)) ?? []);
  const currClaims = new Set(current.findings.map((f) => claimKey(f.claim)));
  const newSources = current.sources.map((s) => s.id).filter((id) => !prevSources.has(id));
  const newFindings = current.findings.map((f) => f.claim).filter((c) => !prevClaims.has(claimKey(c)));
  const noLongerObserved = (previous?.findings ?? [])
    .map((f) => f.claim)
    .filter((c) => !currClaims.has(claimKey(c)));
  const summary = previous
    ? `Since ${previous.generatedAt}: ${newSources.length} newly cited post(s), ${newFindings.length} new finding(s), ` +
      `${noLongerObserved.length} finding(s) no longer observed.`
    : `First report for this topic: ${current.sources.length} cited post(s), ${current.findings.length} finding(s).`;
  return { newSources, newFindings, noLongerObserved, summary };
}

/**
 * Monitor a configured topic: research it now and report what changed since its previous report.
 * Topic schedules run this workflow, so scheduled research always yields change detection.
 */
export function createMonitorWorkflow(deps: MonitorWorkflowDeps) {
  const baseline = createStep({
    id: "baseline",
    description: "Resolve the topic and its previous report",
    inputSchema: MonitorInputSchema,
    outputSchema: BaselineSchema,
    execute: async ({ inputData }) => {
      const input = MonitorInputSchema.parse(inputData);
      const topic = deps.topics.find((t) => t.id === input.topicId);
      if (!topic) throw new Error(`Unknown topic "${input.topicId}"`);
      const previous = await deps.store.latestReportForTopic(topic.id, input.tenantId);
      return { input, query: topicQuery(topic), ...(previous ? { previousReportId: previous.id } : {}) };
    },
  });

  const diff = createStep({
    id: "diff",
    description: "Compare the new report with the previous one",
    inputSchema: ResearchWorkflowOutputSchema,
    outputSchema: MonitorResultSchema,
    execute: async ({ inputData, getStepResult }) => {
      const { input, previousReportId } = getStepResult(baseline);
      const { runId, reportId, report } = inputData;
      if (previousReportId === reportId) {
        // Nested research replayed an occurrence that was already processed.
        return {
          topicId: input.topicId,
          runId,
          reportId,
          newSources: [],
          newFindings: [],
          noLongerObserved: [],
          summary: "This occurrence was already processed; no new research was run.",
        };
      }
      const previous = previousReportId
        ? await deps.store.getReport(previousReportId, input.tenantId)
        : undefined;
      return {
        topicId: input.topicId,
        runId,
        reportId,
        ...(previous ? { previousReportId: previous.id, previousGeneratedAt: previous.generatedAt } : {}),
        ...diffReports(report, previous),
      };
    },
  });

  return createWorkflow({
    id: MONITOR_WORKFLOW_ID,
    description: "Research a configured topic and report what changed since its previous report.",
    inputSchema: MonitorInputSchema,
    outputSchema: MonitorResultSchema,
    ...(deps.schedule && deps.schedule.length > 0 ? { schedule: deps.schedule } : {}),
  })
    .then(baseline)
    .map(async ({ inputData }) =>
      ResearchInputSchema.parse({
        query: inputData.query,
        topicId: inputData.input.topicId,
        maxPosts: inputData.input.maxPosts,
        windowDays: inputData.input.windowDays,
        trigger: inputData.input.trigger,
        tenantId: inputData.input.tenantId,
        ...(inputData.input.triggerEventId ? { triggerEventId: inputData.input.triggerEventId } : {}),
      }),
    )
    .then(deps.researchWorkflow)
    .then(diff)
    .commit();
}
