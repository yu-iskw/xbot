import type { ReportSummary, ResearchReport, ResearchRun, RunStatus, TriggerType } from "../schemas/research";
import type { XPost } from "../schemas/x";
import type { PostCache, UsageStore } from "../x/budget";

export interface CreateRunInput {
  id: string;
  workflow: ResearchRun["workflow"];
  tenantId: string;
  topicId?: string;
  trigger: TriggerType;
  idempotencyKey?: string;
  input: unknown;
  startedAt: string;
}

export type AcquireRunResult =
  | { acquired: true; run: ResearchRun }
  /** Another run already owns the idempotency key. */
  | { acquired: false; run: ResearchRun };

export interface ListReportsOptions {
  tenantId: string;
  limit?: number;
  /** Case-insensitive text match on query and summary. */
  search?: string;
  topicId?: string;
}

export type EvidenceAvailability = "available" | "removed" | "unknown";

/**
 * Application persistence for research data. Kept separate from Mastra memory and workflow storage:
 * conversations and run snapshots live in Mastra; reports, citations, spend, and the post cache live here.
 */
export interface XbotStore extends UsageStore, PostCache {
  init(): Promise<void>;
  close(): Promise<void>;

  /**
   * Insert a run, or return the run already holding `idempotencyKey` for this tenant. A failed run with
   * that key is re-acquired. Callers that already inserted this id must load it with `getRun` instead.
   */
  acquireRun(input: CreateRunInput): Promise<AcquireRunResult>;
  updateRun(
    id: string,
    patch: {
      status?: RunStatus;
      plan?: unknown;
      reportId?: string;
      output?: unknown;
      error?: string;
      completedAt?: string;
    },
  ): Promise<void>;
  getRun(id: string, tenantId: string): Promise<ResearchRun | undefined>;
  listRuns(tenantId: string, limit?: number): Promise<ResearchRun[]>;

  saveReport(report: ResearchReport, tenantId: string, topicId?: string): Promise<void>;
  getReport(id: string, tenantId: string): Promise<ResearchReport | undefined>;
  /** Most recent report for a topic; the baseline for change detection. */
  latestReportForTopic(topicId: string, tenantId: string): Promise<ResearchReport | undefined>;
  listReports(options: ListReportsOptions): Promise<ReportSummary[]>;

  /** Compliance: drop cached content for a post and flag every report citing it. */
  purgePost(postId: string): Promise<{ cacheRows: number; citingReports: string[] }>;
  purgeExpiredPosts(nowIso: string): Promise<number>;
  evidenceStatus(reportId: string): Promise<{ postId: string; status: EvidenceAvailability }[]>;
  getCachedPosts(ids: string[], nowIso: string): Promise<XPost[]>;
}
