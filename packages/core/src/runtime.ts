import type { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { Memory } from "@mastra/memory";
import type { z } from "zod";
import { createResearchAgent } from "./agents/research-agent";
import { createAnalystAgent, createPlannerAgent, createReporterAgent } from "./agents/research-agents";
import type { XbotConfig } from "./config";
import { describeModel, MODEL_ROLES, type ModelRole, resolveModel } from "./models";
import {
  type DiscoveryInput,
  DiscoveryInputSchema,
  type DiscoveryResult,
  DiscoveryResultSchema,
  type MonitorInput,
  MonitorInputSchema,
  type MonitorResult,
  type ResearchInput,
  ResearchInputSchema,
  type ResearchReport,
  type ResearchRun,
  ResearchTopicSchema,
} from "./schemas/research";
import type { XPost } from "./schemas/x";
import { openStorage } from "./storage/open";
import type { ListReportsOptions, ReportSummary, XbotStore } from "./storage/store";
import { createResearchTools, type ResearchOperations } from "./tools/research-tools";
import { createXTools } from "./tools/x-tools";
import { admitDiscoveryRun, createDiscoveryWorkflow } from "./workflows/discover";
import { createMonitorWorkflow, type ScheduleEntry } from "./workflows/monitor";
import { admitResearchRun, createResearchWorkflow, type ResearchWorkflowOutput } from "./workflows/research";
import { BudgetedXReadClient } from "./x/budget";
import { readOnlyFacade } from "./x/guard";
import { LiveXReadClient } from "./x/live";
import { MockXReadClient } from "./x/mock";
import type { XClientMode, XReadClient } from "./x/port";

export interface ResearchOutcome {
  runId: string;
  report: ResearchReport;
  /** True when an idempotent replay returned an earlier report instead of running again. */
  deduplicated: boolean;
}

export interface TenantScope {
  tenantId?: string;
}

export interface XbotRuntimeInfo {
  xMode: XClientMode;
  storageUrl: string;
  storageProvider: "libsql" | "postgres";
  tenantId: string;
  models: Partial<Record<ModelRole, string>>;
  chatAvailable: boolean;
  schedules: string[];
}

export interface XbotRuntime {
  readonly info: XbotRuntimeInfo;
  readonly mastra: Mastra;
  /** Conversational research agent; undefined when no chat model is configured. */
  readonly agent: Agent | undefined;
  /** Read-only, budgeted X client shared by every interface. */
  readonly x: BudgetedXReadClient;
  readonly store: XbotStore;
  /** Configured research topics (validated). */
  readonly topics: z.output<typeof ResearchTopicSchema>[];
  /** Mastra tools for embedding xbot into other agents or MCP servers. */
  readonly tools: ReturnType<typeof createXTools> & ReturnType<typeof createResearchTools>;

  research(input: ResearchInput): Promise<ResearchOutcome>;
  /** Start research in the background; poll with getRun(). */
  startResearch(input: ResearchInput): Promise<{ runId: string }>;
  discover(input: DiscoveryInput): Promise<DiscoveryResult>;
  /** Research a configured topic and report what changed since its previous report. */
  monitor(input: MonitorInput): Promise<MonitorResult>;
  getRun(runId: string, scope?: TenantScope): Promise<ResearchRun | undefined>;
  getReport(reportId: string, scope?: TenantScope): Promise<ResearchReport | undefined>;
  listReports(options?: Omit<ListReportsOptions, "tenantId"> & TenantScope): Promise<ReportSummary[]>;
  searchHistory(query: string, options?: { limit?: number } & TenantScope): Promise<ReportSummary[]>;
  /** Cached post content for rendering excerpts; empty when the cache expired or was purged. */
  cachedPosts(ids: string[]): Promise<XPost[]>;
  /** Compliance: remove a deleted/protected post from the cache and flag reports that cite it. */
  purgePost(postId: string): Promise<{ cacheRows: number; citingReports: string[] }>;
  budgetStatus(): Promise<{ dailyUsd: number; monthlyUsd: number; limits: BudgetedXReadClient["limits"] }>;
  close(): Promise<void>;
}

/** Build the xbot runtime: X client, storage, Mastra agents and workflows, behind a small stable API. */
export async function createXbotRuntime(config: XbotConfig = {}): Promise<XbotRuntime> {
  const now = config.now ?? (() => new Date());
  const tenantId = config.tenantId ?? "default";
  const storage = await openStorage(config.storage);
  const { store } = storage;

  const inner = readOnlyFacade(createXClient(config, now));
  const x = new BudgetedXReadClient({
    inner,
    usage: store,
    cache: store,
    cacheTtlSeconds: config.x?.cacheTtlSeconds ?? 24 * 60 * 60,
    ...(config.budgets ? { limits: config.budgets } : {}),
    ...(config.x?.pricing ? { pricing: config.x.pricing } : {}),
    enforcePeriodLimits: inner.mode === "live",
    now,
  });

  const model = (role: ModelRole) => resolveModel(config.models, role);
  const modelIds: Partial<Record<ModelRole, string>> = Object.fromEntries(
    MODEL_ROLES.map((r) => [r, describeModel(model(r))]).filter(([, id]) => id),
  );
  const planningModel = model("planning");
  const analysisModel = model("analysis");
  const reportingModel = model("reporting");
  const chatModel = model("chat");
  const agents = {
    ...(planningModel ? { planner: createPlannerAgent(planningModel) } : {}),
    ...(analysisModel ? { analyst: createAnalystAgent(analysisModel) } : {}),
    ...(reportingModel ? { reporter: createReporterAgent(reportingModel) } : {}),
  };
  const { chat: _chat, ...modelMetadata } = modelIds;

  const topics = (config.topics ?? []).map((t) => ResearchTopicSchema.parse(t));
  const schedule = config.enableSchedules ? topicSchedules(topics, tenantId) : [];
  const researchWorkflow = createResearchWorkflow({
    x,
    store,
    agents,
    modelMetadata,
    evidence: new Map(),
    now,
  });
  const discoveryWorkflow = createDiscoveryWorkflow({ x, store, now });
  // Topic schedules fire the monitor workflow, so scheduled research always yields change detection.
  const monitorWorkflow = createMonitorWorkflow({
    store,
    topics,
    research: (input) => runResearch(input),
    schedule,
  });

  // Background runs, tracked only so close() can wait for them.
  const inFlight = new Set<Promise<unknown>>();
  function track<T>(promise: Promise<T>): Promise<T> {
    inFlight.add(promise);
    promise.then(
      () => inFlight.delete(promise),
      () => inFlight.delete(promise),
    );
    return promise;
  }

  /**
   * Admit a run before starting its workflow, so the run row (and its canonical id) exists immediately
   * and idempotent replays are answered from storage without starting a workflow at all.
   */
  async function admitResearch(input: ResearchInput) {
    const parsed = ResearchInputSchema.parse({ tenantId, ...input });
    const admission = await admitResearchRun(store, crypto.randomUUID(), parsed, now());
    return { parsed, ...admission };
  }

  async function existingResearch(run: ResearchRun): Promise<ResearchOutcome> {
    const report = run.reportId ? await store.getReport(run.reportId, run.tenantId) : undefined;
    if (report) return { runId: run.id, report, deduplicated: true };
    throw new Error(
      run.status === "running"
        ? `An identical research run (${run.id}) is already in progress`
        : `Research run ${run.id} produced no report`,
    );
  }

  /** Run an admitted workflow; any non-success leaves the run marked failed rather than running. */
  async function executeWorkflow<T>(
    workflow: {
      createRun(o: { runId: string }): Promise<{ start(o: { inputData: never }): Promise<unknown> }>;
    },
    runId: string,
    inputData: { tenantId: string },
    label: string,
  ): Promise<T> {
    const run = await workflow.createRun({ runId });
    const result = (await run.start({ inputData: inputData as never })) as {
      status: string;
      result?: T;
      error?: { message?: string };
    };
    if (result.status === "success") return result.result as T;
    const message = result.error?.message ?? `workflow ${result.status}`;
    const current = await store.getRun(runId, inputData.tenantId);
    if (current?.status === "running") {
      await store.updateRun(runId, { status: "failed", error: message, completedAt: now().toISOString() });
    }
    throw new Error(`${label} failed: ${message}`);
  }

  async function runResearch(input: ResearchInput): Promise<ResearchOutcome> {
    const { parsed, acquired, run } = await admitResearch(input);
    if (!acquired) return existingResearch(run);
    const output = await executeWorkflow<ResearchWorkflowOutput>(
      researchWorkflow,
      run.id,
      parsed,
      "Research",
    );
    if (!output.report) return existingResearch((await store.getRun(output.runId, parsed.tenantId)) ?? run);
    return { runId: output.runId, report: output.report, deduplicated: output.deduplicated };
  }

  // Tools resolve the tenant per call from trusted request state (see toolScope), not at construction.
  const ops: ResearchOperations = {
    research: (input) => runResearch(input),
    discover: (input) => discover(input),
    getReport: (id, scope) => store.getReport(id, scope.tenantId ?? tenantId),
    searchHistory: (query, limit, scope) =>
      store.listReports({ tenantId: scope.tenantId ?? tenantId, ...(query ? { search: query } : {}), limit }),
  };
  const tools = { ...createXTools(x), ...createResearchTools(ops) };

  const memory =
    config.memory === false
      ? undefined
      : new Memory({ options: { lastMessages: config.memory?.lastMessages ?? 20 } });
  const agent = chatModel
    ? createResearchAgent({
        model: chatModel,
        tools,
        ...(memory ? { memory } : {}),
        ...(config.agentChannels ? { channels: config.agentChannels } : {}),
      })
    : undefined;

  const mastra = new Mastra({
    agents: { ...(agent ? { researchAgent: agent } : {}), ...agents },
    workflows: { researchWorkflow, discoveryWorkflow, monitorWorkflow },
    storage: storage.mastra,
    ...(config.logging ? {} : { logger: false as const }),
  });

  async function discover(input: DiscoveryInput): Promise<DiscoveryResult> {
    const parsed = DiscoveryInputSchema.parse({ tenantId, ...input });
    const { acquired, run } = await admitDiscoveryRun(store, crypto.randomUUID(), parsed, now());
    if (!acquired) {
      const prior = DiscoveryResultSchema.safeParse(run.output);
      if (prior.success) return prior.data;
      throw new Error(
        `An identical discovery run (${run.id}) is ${run.status === "running" ? "already in progress" : "without a result"}`,
      );
    }
    const output = await executeWorkflow<{ runId: string; result?: DiscoveryResult }>(
      discoveryWorkflow,
      run.id,
      parsed,
      "Discovery",
    );
    if (!output.result) throw new Error(`Discovery run ${output.runId} produced no result`);
    return output.result;
  }

  return {
    info: {
      xMode: x.mode,
      storageUrl: redactUrl(storage.url),
      storageProvider: storage.provider,
      tenantId,
      models: modelIds,
      chatAvailable: agent !== undefined,
      schedules: schedule.map((s) => `${s.id} (${s.cron}${s.timezone ? ` ${s.timezone}` : ""})`),
    },
    mastra,
    agent,
    x,
    store,
    topics,
    tools,
    research: (input) => runResearch(input),
    async startResearch(input) {
      const { parsed, acquired, run } = await admitResearch(input);
      if (acquired) {
        // Failures are recorded on the run row; callers observe them through getRun.
        track(executeWorkflow(researchWorkflow, run.id, parsed, "Research")).catch(() => undefined);
      }
      return { runId: run.id };
    },
    discover,
    async monitor(input) {
      const parsed = MonitorInputSchema.parse({ tenantId, ...input });
      const run = await monitorWorkflow.createRun();
      const result = await run.start({ inputData: parsed });
      if (result.status !== "success") {
        throw new Error(
          `Monitoring failed: ${result.status === "failed" ? result.error?.message : result.status}`,
        );
      }
      return result.result;
    },
    getRun: (runId, scope) => store.getRun(runId, scope?.tenantId ?? tenantId),
    getReport: (id, scope) => store.getReport(id, scope?.tenantId ?? tenantId),
    listReports: (options = {}) => store.listReports({ ...options, tenantId: options.tenantId ?? tenantId }),
    searchHistory: (query, options = {}) =>
      store.listReports({
        tenantId: options.tenantId ?? tenantId,
        ...(query ? { search: query } : {}),
        limit: options.limit ?? 20,
      }),
    cachedPosts: (ids) => store.getCachedPosts(ids, now().toISOString()),
    purgePost: (postId) => store.purgePost(postId),
    async budgetStatus() {
      return { ...(await x.remaining()), limits: x.limits };
    },
    async close() {
      await Promise.allSettled([...inFlight]);
      await storage.close();
    },
  };
}

function createXClient(config: XbotConfig, now: () => Date): XReadClient {
  if (config.x?.client) return config.x.client;
  const mode = config.x?.mode ?? (config.x?.bearerToken ? "live" : "mock");
  if (mode === "mock") return new MockXReadClient({ now });
  if (!config.x?.bearerToken) {
    throw new Error("Live X mode requires an app-only bearer token (set X_BEARER_TOKEN), or use mock mode.");
  }
  return new LiveXReadClient({
    bearerToken: config.x.bearerToken,
    ...(config.x.baseUrl ? { baseUrl: config.x.baseUrl } : {}),
    now,
  });
}

function topicSchedules(topics: z.output<typeof ResearchTopicSchema>[], tenantId: string): ScheduleEntry[] {
  return topics
    .filter((t) => t.schedule)
    .map((t) => ({
      id: t.id,
      cron: t.schedule!.cron,
      ...(t.schedule!.timezone ? { timezone: t.schedule!.timezone } : {}),
      inputData: MonitorInputSchema.parse({ topicId: t.id, trigger: "schedule", tenantId }),
    }));
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    u.searchParams.delete("authToken");
    return u.toString();
  } catch {
    return url;
  }
}
