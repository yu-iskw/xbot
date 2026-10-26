import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  type DiscoveryInput,
  type DiscoveryResult,
  DiscoveryResultSchema,
  type ResearchInput,
  type ResearchReport,
  ResearchReportSchema,
  type TriggerType,
  TriggerTypeSchema,
} from "../schemas/research";
import type { ReportSummary } from "../storage/store";

/** RequestContext keys interfaces set so shared tools act for the right tenant and trigger. */
export const XBOT_TENANT_CONTEXT_KEY = "xbot.tenantId";
export const XBOT_TRIGGER_CONTEXT_KEY = "xbot.trigger";

/** Who a tool call acts for. Undefined tenant means the runtime default. */
export interface ToolScope {
  tenantId?: string;
  trigger: TriggerType;
}

/** Operations the research tools delegate to. Implemented by the runtime. */
export interface ResearchOperations {
  research(input: ResearchInput): Promise<{ report: ResearchReport }>;
  discover(input: DiscoveryInput): Promise<DiscoveryResult>;
  getReport(id: string, scope: ToolScope): Promise<ResearchReport | undefined>;
  searchHistory(query: string, limit: number, scope: ToolScope): Promise<ReportSummary[]>;
}

interface ScopeSource {
  requestContext?: { get(key: string): unknown };
  mcp?: { extra?: { authInfo?: { extra?: Record<string, unknown> } } };
}

/**
 * Resolve the tenant from trusted request state, never from model input: an interface-set context key
 * (HTTP chat, Slack) or the authenticated MCP transport. Falls back to the runtime default tenant.
 */
export function toolScope(ctx: ScopeSource | undefined): ToolScope {
  const fromContext = ctx?.requestContext?.get(XBOT_TENANT_CONTEXT_KEY);
  const authInfo =
    ctx?.mcp?.extra?.authInfo ??
    (ctx?.requestContext?.get("authInfo") as { extra?: Record<string, unknown> } | undefined);
  const tenant = fromContext ?? authInfo?.extra?.tenantId;
  const trigger =
    ctx?.requestContext?.get(XBOT_TRIGGER_CONTEXT_KEY) ?? (authInfo || ctx?.mcp ? "mcp" : "chat");
  return {
    ...(typeof tenant === "string" && tenant ? { tenantId: tenant } : {}),
    trigger: TriggerTypeSchema.catch("chat").parse(trigger),
  };
}

export const ReportSummarySchema = z.object({
  id: z.string(),
  runId: z.string(),
  query: z.string(),
  summary: z.string(),
  status: z.enum(["completed", "partial"]),
  generatedAt: z.string(),
  sources: z.number(),
});

export function createResearchTools(ops: ResearchOperations) {
  const runResearch = createTool({
    id: "xbot-research",
    description:
      "Run a bounded, evidence-backed research workflow on X for a topic and save the report. " +
      "Use for questions that need a structured, cited answer rather than a quick search.",
    inputSchema: z.object({
      query: z.string().min(1).max(500),
      maxPosts: z.number().int().min(10).max(200).default(50),
      windowDays: z.number().int().min(1).max(7).default(7),
      language: z.string().min(2).max(8).optional(),
    }),
    outputSchema: ResearchReportSchema,
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
    execute: async (input, ctx) => (await ops.research({ ...input, ...toolScope(ctx) })).report,
  });

  const discoverTopics = createTool({
    id: "xbot-discover-topics",
    description: "Discover recurring topics on X across a set of interests (and optional accounts).",
    inputSchema: z.object({
      interests: z.array(z.string().min(1).max(200)).min(1).max(10),
      accounts: z.array(z.string().min(1).max(16)).max(10).default([]),
      maxTopics: z.number().int().min(1).max(10).default(5),
    }),
    outputSchema: DiscoveryResultSchema,
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
    execute: async ({ interests, accounts, maxTopics }, ctx) =>
      ops.discover({ interests, accounts, maxTopics, ...toolScope(ctx) }),
  });

  const getReport = createTool({
    id: "xbot-get-report",
    description: "Retrieve a saved research report by ID.",
    inputSchema: z.object({ id: z.string().min(1) }),
    outputSchema: z.object({ found: z.boolean(), report: ResearchReportSchema.optional() }),
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    execute: async ({ id }, ctx) => {
      const report = await ops.getReport(id, toolScope(ctx));
      return report ? { found: true, report } : { found: false };
    },
  });

  const searchHistory = createTool({
    id: "xbot-search-history",
    description: "Search previously saved research reports by keyword.",
    inputSchema: z.object({
      query: z.string().max(200).default(""),
      limit: z.number().int().min(1).max(50).default(10),
    }),
    outputSchema: z.object({ reports: z.array(ReportSummarySchema) }),
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    execute: async ({ query, limit }, ctx) => ({
      reports: await ops.searchHistory(query, limit, toolScope(ctx)),
    }),
  });

  return { runResearch, discoverTopics, getReport, searchHistory };
}
