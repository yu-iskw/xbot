import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { classifyQueryError, errorMessage } from "../errors";
import { engagement, extractThemes } from "../research/analyze";
import { recentSearchStart } from "../research/plan";
import { type DiscoveredTopic, DiscoveryInputSchema, DiscoveryResultSchema } from "../schemas/research";
import type { XPost } from "../schemas/x";
import type { XbotStore } from "../storage/store";
import type { BudgetedXReadClient } from "../x/budget";
import { admitWorkflowRun, discoveryReplay, failRun } from "./shared";

export const DISCOVERY_WORKFLOW_ID = "xbot-discovery";

export interface DiscoveryWorkflowDeps {
  x: BudgetedXReadClient;
  store: XbotStore;
  now: () => Date;
}

const PreparedSchema = z.object({
  runId: z.string(),
  input: DiscoveryInputSchema,
});

export const DiscoveryWorkflowOutputSchema = z.object({
  runId: z.string(),
  deduplicated: z.boolean(),
  runStatus: z.enum(["completed"]),
  result: DiscoveryResultSchema,
});
export type DiscoveryWorkflowOutput = z.infer<typeof DiscoveryWorkflowOutputSchema>;

/** Admit a discovery run that has not already been inserted under this id. */
export function admitDiscoveryRun(
  store: XbotStore,
  runId: string,
  input: z.output<typeof DiscoveryInputSchema>,
  now: Date,
) {
  return admitWorkflowRun(store, {
    id: runId,
    workflow: "discovery",
    workflowId: DISCOVERY_WORKFLOW_ID,
    tenantId: input.tenantId,
    trigger: input.trigger,
    ...(input.triggerEventId ? { triggerEventId: input.triggerEventId } : {}),
    input,
    keyInput: { interests: [...input.interests].sort(), accounts: [...input.accounts].sort() },
    now,
  });
}

/**
 * Discovery scans configured interests and accounts with bounded searches and ranks recurring terms
 * by spread across distinct authors and engagement. It never issues open-ended searches.
 */
export function createDiscoveryWorkflow(deps: DiscoveryWorkflowDeps) {
  const { x, store, now } = deps;

  const prepare = createStep({
    id: "prepare",
    inputSchema: DiscoveryInputSchema,
    outputSchema: PreparedSchema,
    execute: async ({ inputData, runId, bail }) => {
      const input = DiscoveryInputSchema.parse(inputData);
      const existing = await store.getRun(runId, input.tenantId);
      if (existing) {
        x.openRun(existing.id, input.maxCostUsd);
        return { runId: existing.id, input };
      }
      const acquired = await admitDiscoveryRun(store, runId, input, now());
      if (!acquired.acquired) return bail(discoveryReplay(acquired.run));
      x.openRun(acquired.run.id, input.maxCostUsd);
      return { runId: acquired.run.id, input };
    },
  });

  const scanAndRank = createStep({
    id: "scan-and-rank",
    inputSchema: PreparedSchema,
    outputSchema: DiscoveryWorkflowOutputSchema,
    execute: async ({ inputData, abortSignal }) => {
      const { runId, input } = inputData;
      try {
        const posts = new Map<string, XPost>();
        const limitations: string[] = [];
        const ctx = { runId, ...(abortSignal ? { signal: abortSignal } : {}) };
        const startTime = recentSearchStart(now(), input.windowDays);
        const sources = [
          ...input.interests.map((q) => `${q} -is:retweet`),
          ...input.accounts.map((a) => `from:${a.replace(/^@/, "")} -is:retweet`),
        ];
        for (const query of sources) {
          try {
            const res = await x.searchRecent(
              {
                query,
                maxResults: input.maxPostsPerInterest,
                maxPages: 1,
                startTime,
                sortOrder: "relevancy",
              },
              ctx,
            );
            for (const p of res.posts) posts.set(p.id, p);
          } catch (error) {
            const action = classifyQueryError(error, ["budget_exceeded"]);
            if (action === "abort") throw error;
            if (action === "stop") {
              limitations.push(`Stopped early: ${errorMessage(error)}`);
              break;
            }
            limitations.push(`Query "${query}" failed: ${errorMessage(error)}`);
          }
        }
        const sample = [...posts.values()];
        const engagementById = new Map(sample.map((p) => [p.id, engagement(p)]));
        const topics: DiscoveredTopic[] = extractThemes(sample, input.interests, input.maxTopics * 2)
          .map((t) => {
            const eng = t.postIds.reduce((sum, id) => sum + (engagementById.get(id) ?? 0), 0);
            return {
              label: t.term,
              score: Math.round((t.authors * 10 + Math.log10(1 + eng) * 5) * 100) / 100,
              mentions: t.postIds.length,
              distinctAuthors: t.authors,
              samplePostIds: t.postIds.slice(0, 3),
              rationale: `Mentioned in ${t.postIds.length} posts by ${t.authors} distinct accounts with ${eng} weighted interactions.`,
            };
          })
          .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
          .slice(0, input.maxTopics);
        const usage = x.closeRun(runId);
        const result = {
          runId,
          generatedAt: now().toISOString(),
          topics,
          postsScanned: sample.length,
          xRequests: usage.requests,
          estimatedXCostUsd: usage.costUsd,
          limitations: [
            "Topics are recurring terms in a bounded sample; they are signals to investigate, not trends.",
            ...(x.mode === "mock" ? ["Scanned deterministic mock fixtures, not live X data."] : []),
            ...limitations,
          ],
        };
        await store.updateRun(runId, {
          status: "completed",
          output: result,
          completedAt: now().toISOString(),
        });
        return { runId, deduplicated: false, runStatus: "completed" as const, result };
      } catch (error) {
        return failRun(deps, runId, error);
      }
    },
  });

  return createWorkflow({
    id: DISCOVERY_WORKFLOW_ID,
    description:
      "Discover recurring topics across configured interests and accounts with bounded X searches.",
    inputSchema: DiscoveryInputSchema,
    outputSchema: DiscoveryWorkflowOutputSchema,
  })
    .then(prepare)
    .then(scanAndRank)
    .commit();
}
