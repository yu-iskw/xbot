import { classifyQueryError, errorMessage } from "../errors";
import type { ResearchPlan } from "../schemas/research";
import type { XPost } from "../schemas/x";
import type { XReadClient } from "../x/port";

export interface Evidence {
  posts: XPost[];
  queriesRun: string[];
  /** Non-fatal problems encountered while collecting (budget stops, failed queries...). */
  issues: string[];
  duplicatesRemoved: number;
}

/**
 * Run a validated plan: search, paginate within limits, normalize, and deduplicate.
 * Exact duplicates are removed by ID, near-duplicates (copy-paste spam) by normalized text.
 */
export async function collectEvidence(
  client: XReadClient,
  plan: ResearchPlan,
  ctx: { runId: string; signal?: AbortSignal },
): Promise<Evidence> {
  const byId = new Map<string, XPost>();
  const textKeys = new Set<string>();
  const queriesRun: string[] = [];
  const issues: string[] = [];
  let duplicatesRemoved = 0;

  for (const { query } of plan.queries) {
    if (byId.size >= plan.maxPosts) break;
    ctx.signal?.throwIfAborted();
    try {
      const result = await client.searchRecent(
        {
          query,
          maxResults: plan.maxResultsPerQuery,
          maxPages: plan.maxPagesPerQuery,
          startTime: plan.startTime,
          endTime: plan.endTime,
          sortOrder: "relevancy",
        },
        { runId: ctx.runId, ...(ctx.signal ? { signal: ctx.signal } : {}) },
      );
      queriesRun.push(query);
      for (const post of result.posts) {
        const key = textKey(post.text);
        if (byId.has(post.id) || textKeys.has(key)) {
          duplicatesRemoved += 1;
          continue;
        }
        if (byId.size >= plan.maxPosts) break;
        byId.set(post.id, post);
        textKeys.add(key);
      }
    } catch (error) {
      const action = classifyQueryError(error, ["budget_exceeded", "rate_limited"]);
      if (action === "abort") throw error;
      if (action === "stop") {
        issues.push(`Stopped collecting before "${query}": ${errorMessage(error)}`);
        break;
      }
      issues.push(`Query "${query}" failed: ${errorMessage(error)}`);
    }
  }

  return { posts: [...byId.values()], queriesRun, issues, duplicatesRemoved };
}

function textKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}#@]+/gu, " ")
    .trim();
}
