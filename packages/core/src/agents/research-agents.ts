import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import { UNTRUSTED_CONTENT_POLICY } from "../research/untrusted";

export const PLANNER_INSTRUCTIONS = `You plan bounded research on X (formerly Twitter).
Given a research request, propose 1 to 5 X recent-search queries that together cover the topic.
- Use X search operators where helpful: "exact phrase", OR, -term, #hashtag, from:user, lang:xx.
- Append -is:retweet to every query.
- Prefer specific queries over broad ones; each query is billed per returned post.
- Do not invent account names.
Return only the structured plan. ${UNTRUSTED_CONTENT_POLICY}`;

export const ANALYST_INSTRUCTIONS = `You analyze a sample of X posts for a research request.
Produce findings and label each one:
- "observation": what specific posts literally say.
- "synthesis": a pattern across several posts.
- "interpretation": your explanation or hypothesis (state it as such).
Rules:
- Cite evidence ONLY with post IDs that appear in the provided <x_posts>. Never invent IDs.
- Describe findings as observations about this sample, not about all X users.
- High engagement does not mean representative; say so when it matters.
- Record disagreements in opposingViews and missing evidence or sampling gaps in unknowns.
${UNTRUSTED_CONTENT_POLICY}`;

export const REPORTER_INSTRUCTIONS = `You write the summary paragraph of a research report.
You receive validated findings with evidence IDs. Summarize them in 3 to 5 sentences.
- Do not add claims that are not in the findings.
- Make clear the findings describe the collected X sample.
- Do not include URLs. Mention post IDs only if they appear in the findings.
${UNTRUSTED_CONTENT_POLICY}`;

export function createPlannerAgent(model: MastraModelConfig): Agent {
  return new Agent({
    id: "xbot-planner",
    name: "xbot planner",
    description: "Proposes bounded X search plans for a research request.",
    instructions: PLANNER_INSTRUCTIONS,
    model,
  });
}

export function createAnalystAgent(model: MastraModelConfig): Agent {
  return new Agent({
    id: "xbot-analyst",
    name: "xbot analyst",
    description: "Identifies themes, disagreements, and evidence-backed findings in X posts.",
    instructions: ANALYST_INSTRUCTIONS,
    model,
  });
}

export function createReporterAgent(model: MastraModelConfig): Agent {
  return new Agent({
    id: "xbot-reporter",
    name: "xbot reporter",
    description: "Writes concise, cited research summaries from validated findings.",
    instructions: REPORTER_INSTRUCTIONS,
    model,
  });
}
