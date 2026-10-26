import { z } from "zod";

export const TriggerTypeSchema = z.enum(["cli", "http", "mcp", "slack", "schedule", "api", "chat"]);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export const ResearchInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  /** Upper bound on posts collected across every planned query. */
  maxPosts: z.number().int().min(10).max(1000).default(50),
  /** Research window ending now. Recent search covers at most 7 days. */
  windowDays: z.number().int().min(1).max(7).default(7),
  /** Optional per-run X spending cap in USD; defaults to the runtime budget. */
  maxCostUsd: z.number().positive().optional(),
  language: z.string().min(2).max(8).optional(),
  topicId: z.string().optional(),
  trigger: TriggerTypeSchema.default("api"),
  /**
   * Stable identity of the triggering event (Slack event id, schedule occurrence, webhook id...).
   * When present it makes the run idempotent: replays return the original report.
   */
  triggerEventId: z.string().optional(),
  /** Explicit idempotency key. Overrides the key derived from triggerEventId. */
  idempotencyKey: z.string().optional(),
  tenantId: z.string().default("default"),
});
export type ResearchInput = z.input<typeof ResearchInputSchema>;
export type ResolvedResearchInput = z.output<typeof ResearchInputSchema>;

export const PlannedQuerySchema = z.object({
  query: z.string().min(1).max(512),
  rationale: z.string().max(500).default(""),
});
export type PlannedQuery = z.infer<typeof PlannedQuerySchema>;

/** A plan as proposed by the planner (LLM or deterministic). Validated before execution. */
export const ProposedPlanSchema = z.object({
  objective: z.string().max(500),
  queries: z.array(PlannedQuerySchema).min(1).max(10),
});
export type ProposedPlan = z.infer<typeof ProposedPlanSchema>;

/** A plan after application code clamped it to time, query, page, and cost limits. */
export const ResearchPlanSchema = ProposedPlanSchema.extend({
  startTime: z.string(),
  endTime: z.string(),
  maxResultsPerQuery: z.number().int(),
  maxPagesPerQuery: z.number().int(),
  maxPosts: z.number().int(),
  estimatedMaxCostUsd: z.number(),
  maxCostUsd: z.number(),
  planner: z.enum(["model", "deterministic"]),
});
export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;

export const FindingKindSchema = z.enum(["observation", "synthesis", "interpretation"]);
export type FindingKind = z.infer<typeof FindingKindSchema>;

export const FindingSchema = z.object({
  claim: z.string().min(1),
  kind: FindingKindSchema,
  confidence: z.enum(["low", "medium", "high"]),
  /** Post IDs from the collected evidence that support the claim. */
  evidence: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([]),
});
export type Finding = z.infer<typeof FindingSchema>;

/** What the analyst produces before validation. */
export const AnalysisSchema = z.object({
  summary: z.string(),
  findings: z.array(FindingSchema),
  opposingViews: z.array(z.string()).default([]),
  unknowns: z.array(z.string()).default([]),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

/** A citation. Deliberately excludes post text: reports keep references, not X content. */
export const SourceReferenceSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  authorUsername: z.string().optional(),
  createdAt: z.string().optional(),
  retrievedAt: z.string(),
});
export type SourceReference = z.infer<typeof SourceReferenceSchema>;

export const ModelMetadataSchema = z.object({
  planning: z.string().optional(),
  analysis: z.string().optional(),
  reporting: z.string().optional(),
});

export const ResearchReportSchema = z.object({
  id: z.string(),
  runId: z.string(),
  query: z.string(),
  status: z.enum(["completed", "partial"]),
  generatedAt: z.string(),
  window: z.object({ startTime: z.string(), endTime: z.string() }),
  summary: z.string(),
  findings: z.array(FindingSchema),
  opposingViews: z.array(z.string()),
  unknowns: z.array(z.string()),
  limitations: z.array(z.string()),
  sources: z.array(SourceReferenceSchema),
  methodology: z.object({
    queries: z.array(z.string()),
    postsCollected: z.number().int(),
    postsCited: z.number().int(),
    xRequests: z.number().int(),
    estimatedXCostUsd: z.number(),
    xMode: z.enum(["live", "mock"]),
    selection: z.string(),
  }),
  validation: z.object({
    droppedFindings: z.number().int(),
    removedCitations: z.array(z.string()),
  }),
  modelMetadata: ModelMetadataSchema,
});
export type ResearchReport = z.infer<typeof ResearchReportSchema>;

/** List/search row. Report bodies stay out of this shape. */
export const ReportSummarySchema = z.object({
  id: z.string(),
  runId: z.string(),
  query: z.string(),
  summary: z.string(),
  status: z.enum(["completed", "partial"]),
  generatedAt: z.string(),
  sources: z.number(),
});
export type ReportSummary = z.infer<typeof ReportSummarySchema>;

export const RunStatusSchema = z.enum(["running", "completed", "failed"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const ResearchRunSchema = z.object({
  id: z.string(),
  workflow: z.enum(["research", "discovery"]),
  tenantId: z.string(),
  topicId: z.string().optional(),
  trigger: TriggerTypeSchema,
  status: RunStatusSchema,
  idempotencyKey: z.string().optional(),
  input: z.unknown(),
  plan: z.unknown().optional(),
  reportId: z.string().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
});
export type ResearchRun = z.infer<typeof ResearchRunSchema>;

export const DiscoveryInputSchema = z.object({
  interests: z.array(z.string().min(1).max(200)).min(1).max(20),
  accounts: z.array(z.string().min(1).max(50)).max(20).default([]),
  maxTopics: z.number().int().min(1).max(20).default(5),
  maxPostsPerInterest: z.number().int().min(10).max(100).default(25),
  windowDays: z.number().int().min(1).max(7).default(1),
  maxCostUsd: z.number().positive().optional(),
  trigger: TriggerTypeSchema.default("api"),
  triggerEventId: z.string().optional(),
  tenantId: z.string().default("default"),
});
export type DiscoveryInput = z.input<typeof DiscoveryInputSchema>;
export type ResolvedDiscoveryInput = z.output<typeof DiscoveryInputSchema>;

export const DiscoveredTopicSchema = z.object({
  label: z.string(),
  score: z.number(),
  mentions: z.number().int(),
  distinctAuthors: z.number().int(),
  samplePostIds: z.array(z.string()),
  rationale: z.string(),
});
export type DiscoveredTopic = z.infer<typeof DiscoveredTopicSchema>;

export const DiscoveryResultSchema = z.object({
  runId: z.string(),
  generatedAt: z.string(),
  topics: z.array(DiscoveredTopicSchema),
  postsScanned: z.number().int(),
  xRequests: z.number().int(),
  estimatedXCostUsd: z.number(),
  limitations: z.array(z.string()),
});
export type DiscoveryResult = z.infer<typeof DiscoveryResultSchema>;

export const ResearchTopicSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string(),
  keywords: z.array(z.string()).default([]),
  accounts: z.array(z.string()).default([]),
  schedule: z
    .object({
      cron: z.string(),
      timezone: z.string().optional(),
    })
    .optional(),
});
export type ResearchTopic = z.input<typeof ResearchTopicSchema>;

export const MonitorInputSchema = z.object({
  topicId: z.string().min(1),
  maxPosts: z.number().int().min(10).max(1000).default(50),
  windowDays: z.number().int().min(1).max(7).default(1),
  trigger: TriggerTypeSchema.default("api"),
  triggerEventId: z.string().optional(),
  tenantId: z.string().default("default"),
});
export type MonitorInput = z.input<typeof MonitorInputSchema>;

export const MonitorResultSchema = z.object({
  topicId: z.string(),
  runId: z.string(),
  reportId: z.string(),
  previousReportId: z.string().optional(),
  previousGeneratedAt: z.string().optional(),
  /** Cited posts that the previous report did not cite. */
  newSources: z.array(z.string()),
  /** Findings whose claim does not appear in the previous report. */
  newFindings: z.array(z.string()),
  /** Previous findings with no counterpart in the new report. */
  noLongerObserved: z.array(z.string()),
  summary: z.string(),
});
export type MonitorResult = z.infer<typeof MonitorResultSchema>;
