import type { Agent } from "@mastra/core/agent";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { errorMessage } from "../errors";
import { deterministicAnalysis } from "../research/analyze";
import { collectEvidence } from "../research/collect";
import { newId } from "../research/idempotency";
import { deterministicPlan, finalizePlan } from "../research/plan";
import { buildReport } from "../research/report";
import { formatPostsForPrompt } from "../research/untrusted";
import { scrubUnknownIds } from "../research/validate";
import {
  type Analysis,
  AnalysisSchema,
  type ModelMetadataSchema,
  type ProposedPlan,
  ProposedPlanSchema,
  ResearchInputSchema,
  ResearchPlanSchema,
  ResearchReportSchema,
  type ResolvedResearchInput,
} from "../schemas/research";
import type { XPost } from "../schemas/x";
import type { XbotStore } from "../storage/store";
import type { BudgetedXReadClient } from "../x/budget";
import { admitWorkflowRun, failRun, researchReplay } from "./shared";

export const RESEARCH_WORKFLOW_ID = "xbot-research";

export interface ResearchWorkflowDeps {
  x: BudgetedXReadClient;
  store: XbotStore;
  agents: { planner?: Agent; analyst?: Agent; reporter?: Agent };
  modelMetadata: z.infer<typeof ModelMetadataSchema>;
  now: () => Date;
}

const PreparedSchema = z.object({
  runId: z.string(),
  input: ResearchInputSchema,
});

const PlannedSchema = PreparedSchema.extend({
  plan: ResearchPlanSchema,
  notes: z.array(z.string()),
});

const CollectedSchema = PlannedSchema.extend({
  postIds: z.array(z.string()),
  queriesRun: z.array(z.string()),
  issues: z.array(z.string()),
  duplicatesRemoved: z.number().int(),
});

const AnalyzedSchema = CollectedSchema.extend({ analysis: AnalysisSchema });

export const ResearchWorkflowOutputSchema = z.object({
  runId: z.string(),
  runStatus: z.enum(["completed"]),
  deduplicated: z.boolean(),
  reportId: z.string(),
  report: ResearchReportSchema,
});
export type ResearchWorkflowOutput = z.infer<typeof ResearchWorkflowOutputSchema>;

/** Admit a research run that has not already been inserted under this id. */
export function admitResearchRun(
  store: XbotStore,
  runId: string,
  input: z.output<typeof ResearchInputSchema>,
  now: Date,
) {
  return admitWorkflowRun(store, {
    id: runId,
    workflow: "research",
    workflowId: RESEARCH_WORKFLOW_ID,
    tenantId: input.tenantId,
    ...(input.topicId ? { topicId: input.topicId } : {}),
    trigger: input.trigger,
    ...(input.triggerEventId ? { triggerEventId: input.triggerEventId } : {}),
    ...(input.idempotencyKey ? { explicitKey: input.idempotencyKey } : {}),
    input,
    keyInput: {
      query: input.query.toLowerCase(),
      maxPosts: input.maxPosts,
      windowDays: input.windowDays,
      language: input.language,
      topicId: input.topicId,
    },
    now,
  });
}

export function createResearchWorkflow(deps: ResearchWorkflowDeps) {
  const { x, store, agents, now } = deps;
  // Raw post text stays in this process. Workflow snapshots only carry post ids.
  const evidenceByRun = new Map<string, XPost[]>();

  function fail(runId: string, error: unknown): Promise<never> {
    evidenceByRun.delete(runId);
    return failRun(deps, runId, error);
  }

  const prepare = createStep({
    id: "prepare",
    description: "Validate input, enforce idempotency, and open the run budget",
    inputSchema: ResearchInputSchema,
    outputSchema: PreparedSchema,
    execute: async ({ inputData, runId, bail }) => {
      const input = ResearchInputSchema.parse(inputData);
      const existing = await store.getRun(runId, input.tenantId);
      if (existing) {
        x.openRun(existing.id, input.maxCostUsd);
        return { runId: existing.id, input };
      }
      const acquired = await admitResearchRun(store, runId, input, now());
      if (!acquired.acquired) return bail(await researchReplay(store, acquired.run));
      x.openRun(acquired.run.id, input.maxCostUsd);
      return { runId: acquired.run.id, input };
    },
  });

  const plan = createStep({
    id: "plan",
    description: "Propose a research plan and clamp it to time, query, page, and cost limits",
    inputSchema: PreparedSchema,
    outputSchema: PlannedSchema,
    execute: async ({ inputData }) => {
      const { runId, input } = inputData;
      try {
        const notes: string[] = [];
        const plannerAgent = agents.planner;
        let usedModel = false;
        const proposed = plannerAgent
          ? await orDeterministic(
              "Planner model failed; used the deterministic plan",
              notes,
              deterministicPlan(input),
              async () => {
                const plan = await proposePlanWithModel(plannerAgent, input);
                usedModel = true;
                return plan;
              },
            )
          : deterministicPlan(input);
        const planner = usedModel ? "model" : "deterministic";
        const finalized = finalizePlan(proposed, input, {
          maxCostUsd: x.runLimit(input.maxCostUsd),
          costs: x,
          now: now(),
          planner,
        });
        await store.updateRun(runId, { plan: finalized });
        return { ...inputData, plan: finalized, notes };
      } catch (error) {
        return fail(runId, error);
      }
    },
  });

  const collect = createStep({
    id: "collect",
    description: "Search X within the plan's limits, then normalize and deduplicate evidence",
    inputSchema: PlannedSchema,
    outputSchema: CollectedSchema,
    execute: async ({ inputData, abortSignal }) => {
      const { runId, plan: researchPlan } = inputData;
      try {
        const evidence = await collectEvidence(x, researchPlan, { runId, signal: abortSignal });
        evidenceByRun.set(runId, evidence.posts);
        return {
          ...inputData,
          postIds: evidence.posts.map((p) => p.id),
          queriesRun: evidence.queriesRun,
          issues: evidence.issues,
          duplicatesRemoved: evidence.duplicatesRemoved,
        };
      } catch (error) {
        return fail(runId, error);
      }
    },
  });

  const analyze = createStep({
    id: "analyze",
    description: "Identify themes, disagreements, and evidence-backed findings",
    inputSchema: CollectedSchema,
    outputSchema: AnalyzedSchema,
    execute: async ({ inputData }) => {
      const { runId, input } = inputData;
      try {
        const posts = await loadEvidence(deps, evidenceByRun, runId, inputData.postIds);
        const notes = [...inputData.notes];
        const fallback = deterministicAnalysis(input.query, posts, inputData.queriesRun);
        const analyst = agents.analyst;
        const analysis =
          analyst && posts.length > 0
            ? await orDeterministic(
                "Analyst model failed; used deterministic analysis",
                notes,
                fallback,
                () => analyzeWithModel(analyst, input, inputData.plan.objective, posts),
              )
            : fallback;
        return { ...inputData, notes, analysis };
      } catch (error) {
        return fail(runId, error);
      }
    },
  });

  const report = createStep({
    id: "report",
    description: "Validate citations, write the summary, and persist the report",
    inputSchema: AnalyzedSchema,
    outputSchema: ResearchWorkflowOutputSchema,
    execute: async ({ inputData }) => {
      const { runId, input } = inputData;
      try {
        const posts = await loadEvidence(deps, evidenceByRun, runId, inputData.postIds);
        const usage = x.runUsage(runId) ?? { requests: 0, costUsd: 0 };
        const built = buildReport({
          id: newId("rpt"),
          runId,
          query: input.query,
          plan: inputData.plan,
          evidence: {
            posts,
            queriesRun: inputData.queriesRun,
            issues: [...inputData.issues, ...inputData.notes],
            duplicatesRemoved: inputData.duplicatesRemoved,
          },
          analysis: inputData.analysis,
          xMode: x.mode,
          xRequests: usage.requests,
          estimatedXCostUsd: usage.costUsd,
          generatedAt: now().toISOString(),
          modelMetadata: deps.modelMetadata,
        });
        const reporter = agents.reporter;
        if (reporter && built.findings.length > 0) {
          built.summary = await orDeterministic(
            "Reporter model failed; kept the analysis summary",
            built.limitations,
            built.summary,
            async () => scrubUnknownIds(await summarizeWithModel(reporter, built), posts),
          );
        }
        await store.saveReport(built, input.tenantId, input.topicId);
        await store.updateRun(runId, {
          status: "completed",
          reportId: built.id,
          output: { reportId: built.id, usage: x.closeRun(runId) },
          completedAt: now().toISOString(),
        });
        evidenceByRun.delete(runId);
        return {
          runId,
          runStatus: "completed" as const,
          deduplicated: false,
          reportId: built.id,
          report: built,
        };
      } catch (error) {
        return fail(runId, error);
      }
    },
  });

  return createWorkflow({
    id: RESEARCH_WORKFLOW_ID,
    description:
      "Bounded, evidence-backed research on X: plan, collect, analyze, validate, and save a cited report.",
    inputSchema: ResearchInputSchema,
    outputSchema: ResearchWorkflowOutputSchema,
  })
    .then(prepare)
    .then(plan)
    .then(collect)
    .then(analyze)
    .then(report)
    .commit();
}

async function orDeterministic<T>(
  label: string,
  notes: string[],
  fallback: T,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    notes.push(`${label} (${errorMessage(error)}).`);
    return fallback;
  }
}

async function loadEvidence(
  deps: ResearchWorkflowDeps,
  evidenceByRun: Map<string, XPost[]>,
  runId: string,
  ids: string[],
): Promise<XPost[]> {
  const memo = evidenceByRun.get(runId);
  if (memo) return memo;
  // After a process restart the in-memory evidence is gone; fall back to the TTL-bound post cache.
  const cached = await deps.store.getCachedPosts(ids, deps.now().toISOString());
  const order = new Map(ids.map((id, i) => [id, i]));
  return cached.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

async function proposePlanWithModel(agent: Agent, input: ResolvedResearchInput): Promise<ProposedPlan> {
  const prompt = [
    `Research request: ${JSON.stringify(input.query)}`,
    `Window: last ${input.windowDays} day(s). Post budget: ${input.maxPosts} posts in total.`,
    input.language ? `Language: ${input.language}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const res = await agent.generate(prompt, { structuredOutput: { schema: ProposedPlanSchema } });
  return ProposedPlanSchema.parse(res.object);
}

async function analyzeWithModel(
  agent: Agent,
  input: ResolvedResearchInput,
  objective: string,
  posts: XPost[],
): Promise<Analysis> {
  const prompt = [
    `Research request: ${JSON.stringify(input.query)}`,
    `Objective: ${objective}`,
    `The sample contains ${posts.length} posts. Cite only their IDs.`,
    formatPostsForPrompt(posts),
  ].join("\n\n");
  const res = await agent.generate(prompt, { structuredOutput: { schema: AnalysisSchema } });
  return AnalysisSchema.parse(res.object);
}

async function summarizeWithModel(
  agent: Agent,
  report: z.infer<typeof ResearchReportSchema>,
): Promise<string> {
  const prompt = JSON.stringify({
    query: report.query,
    findings: report.findings.map((f) => ({
      claim: f.claim,
      kind: f.kind,
      confidence: f.confidence,
      evidence: f.evidence,
    })),
    opposingViews: report.opposingViews,
    postsCollected: report.methodology.postsCollected,
  });
  const res = await agent.generate(prompt);
  const text = res.text.trim();
  if (!text) throw new Error("empty summary");
  return text;
}
