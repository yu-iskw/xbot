import type { Analysis, ResearchPlan, ResearchReport } from "../schemas/research";
import type { XPost } from "../schemas/x";
import type { XClientMode } from "../x/port";
import type { Evidence } from "./collect";
import { scrubUnknownIds, validateFindings } from "./validate";

export interface BuildReportInput {
  id: string;
  runId: string;
  query: string;
  plan: ResearchPlan;
  evidence: Evidence;
  analysis: Analysis;
  xMode: XClientMode;
  xRequests: number;
  estimatedXCostUsd: number;
  generatedAt: string;
  modelMetadata: ResearchReport["modelMetadata"];
}

/** Assemble a report from validated pieces. Only cited posts become sources. */
export function buildReport(input: BuildReportInput): ResearchReport {
  const { evidence, analysis } = input;
  const validation = validateFindings(analysis, evidence.posts);
  const cited = new Set(validation.findings.flatMap((f) => f.evidence));
  const sources = evidence.posts
    .filter((p) => cited.has(p.id))
    .map((p) => ({
      id: p.id,
      url: p.url,
      ...(p.authorUsername ? { authorUsername: p.authorUsername } : {}),
      ...(p.createdAt ? { createdAt: p.createdAt } : {}),
      retrievedAt: p.retrievedAt,
    }));

  const limitations = [
    "Findings describe the retrieved X sample only and are not generalizable to all X users.",
    "Highly engaged posts are over-weighted in selection and are not necessarily representative.",
    `Search was limited to ${input.plan.queries.length} quer${input.plan.queries.length === 1 ? "y" : "ies"} and at most ${input.plan.maxPosts} posts between ${input.plan.startTime} and ${input.plan.endTime}.`,
    ...(evidence.posts.length < 20
      ? [`Small sample: only ${evidence.posts.length} posts were collected.`]
      : []),
    ...evidence.issues,
    ...(input.xMode === "mock" ? ["Evidence came from deterministic mock fixtures, not live X data."] : []),
  ];

  const partial = evidence.issues.length > 0 || validation.droppedFindings > 0;
  return {
    id: input.id,
    runId: input.runId,
    query: input.query,
    status: partial ? "partial" : "completed",
    generatedAt: input.generatedAt,
    window: { startTime: input.plan.startTime, endTime: input.plan.endTime },
    summary: scrubUnknownIds(analysis.summary, evidence.posts),
    findings: validation.findings,
    opposingViews: analysis.opposingViews.map((v) => scrubUnknownIds(v, evidence.posts)),
    unknowns: analysis.unknowns,
    limitations,
    sources,
    methodology: {
      queries: evidence.queriesRun,
      postsCollected: evidence.posts.length,
      postsCited: sources.length,
      xRequests: input.xRequests,
      estimatedXCostUsd: input.estimatedXCostUsd,
      xMode: input.xMode,
      selection:
        "Posts were retrieved with X recent search (relevancy order), excluding reposts, deduplicated by ID " +
        "and normalized text, then capped at the plan's post limit.",
    },
    validation: {
      droppedFindings: validation.droppedFindings,
      removedCitations: validation.removedCitations,
    },
    modelMetadata: input.modelMetadata,
  };
}

export interface RenderOptions {
  /** Cached posts used to show short excerpts next to citations. Never persisted with the report. */
  posts?: XPost[];
}

export function renderReportMarkdown(report: ResearchReport, options: RenderOptions = {}): string {
  const byId = new Map((options.posts ?? []).map((p) => [p.id, p]));
  const sourceIndex = new Map(report.sources.map((s, i) => [s.id, i + 1]));
  const cite = (ids: string[]) =>
    ids.map((id) => (sourceIndex.has(id) ? `[${sourceIndex.get(id)}]` : "")).join("");
  const lines: string[] = [];
  lines.push(`# Research: ${report.query}`, "");
  lines.push(
    `_Generated ${report.generatedAt} · window ${report.window.startTime} → ${report.window.endTime} · ` +
      `status: ${report.status} · X data: ${report.methodology.xMode}_`,
    "",
  );
  lines.push("## Summary", "", report.summary, "");
  lines.push("## Findings", "");
  if (report.findings.length === 0) lines.push("_No evidence-backed findings._");
  for (const f of report.findings) {
    lines.push(`- **${f.kind}** (${f.confidence}): ${f.claim} ${cite(f.evidence)}`.trimEnd());
    for (const l of f.limitations) lines.push(`  - _limitation:_ ${l}`);
  }
  lines.push("");
  if (report.opposingViews.length > 0) {
    lines.push("## Opposing views", "", ...report.opposingViews.map((v) => `- ${v}`), "");
  }
  if (report.unknowns.length > 0) {
    lines.push("## Unknowns", "", ...report.unknowns.map((u) => `- ${u}`), "");
  }
  lines.push("## Limitations", "", ...report.limitations.map((l) => `- ${l}`), "");
  lines.push("## Sources", "");
  if (report.sources.length === 0) lines.push("_None cited._");
  report.sources.forEach((s, i) => {
    const author = s.authorUsername ? `@${s.authorUsername}` : "unknown author";
    const excerpt = byId.get(s.id)?.text;
    lines.push(
      `${i + 1}. ${author} — ${s.url} (retrieved ${s.retrievedAt})` +
        (excerpt ? `\n   > ${truncate(excerpt.replace(/\s+/g, " "), 200)}` : ""),
    );
  });
  lines.push("");
  lines.push("## Methodology", "");
  lines.push(`- Queries: ${report.methodology.queries.map((q) => `\`${q}\``).join(", ") || "none"}`);
  lines.push(
    `- Posts collected: ${report.methodology.postsCollected}; cited: ${report.methodology.postsCited}; ` +
      `X requests: ${report.methodology.xRequests}; estimated X cost: $${report.methodology.estimatedXCostUsd.toFixed(3)}`,
  );
  lines.push(`- Selection: ${report.methodology.selection}`);
  if (report.validation.droppedFindings > 0 || report.validation.removedCitations.length > 0) {
    lines.push(
      `- Validation: dropped ${report.validation.droppedFindings} unsupported finding(s); ` +
        `removed ${report.validation.removedCitations.length} citation(s) not in the evidence.`,
    );
  }
  const models = Object.entries(report.modelMetadata).filter(([, v]) => v);
  lines.push(
    `- Models: ${models.length ? models.map(([k, v]) => `${k}=${v}`).join(", ") : "none (deterministic)"}`,
  );
  lines.push(`- Report ID: \`${report.id}\` · Run ID: \`${report.runId}\``);
  return `${lines.join("\n")}\n`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
