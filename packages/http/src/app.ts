import { RequestContext } from "@mastra/core/request-context";
import { type HonoBindings, type HonoVariables, MastraServer } from "@mastra/hono";
import {
  DiscoveryInputSchema,
  MonitorInputSchema,
  renderReportMarkdown,
  ResearchInputSchema,
  XApiError,
  XBOT_TENANT_CONTEXT_KEY,
  XBOT_TRIGGER_CONTEXT_KEY,
  type XbotRuntime,
} from "@yu-iskw/xbot-core";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { type AuthVariables, bearerAuth, type TokenTenantMap } from "./auth";

export interface XbotHttpOptions {
  runtime: XbotRuntime;
  /** Token → tenant map. Required unless `insecureNoAuth` is set. */
  tokens?: TokenTenantMap;
  /** Local development only: serve without authentication. */
  insecureNoAuth?: boolean;
  /**
   * Also mount Mastra's built-in agent/workflow routes under /api. They are not tenant-aware,
   * so treat any token that can reach them as an administrator. Off by default.
   */
  mastraApi?: boolean;
}

/** Client-supplied event id; replays with the same id return the original report. */
const IdempotencyKeySchema = z.string().min(1).max(200).optional();

const ResearchBody = ResearchInputSchema.pick({
  query: true,
  maxCostUsd: true,
  language: true,
}).extend({
  // HTTP is stricter than the workflow schema on page size and topic ids.
  maxPosts: z.number().int().min(10).max(500).optional(),
  windowDays: z.number().int().min(1).max(7).optional(),
  topicId: z.string().max(100).optional(),
  idempotencyKey: IdempotencyKeySchema,
  /** Wait for the report instead of returning 202 with a run id. */
  wait: z.boolean().default(false),
});

const DiscoveryBody = DiscoveryInputSchema.pick({
  interests: true,
  accounts: true,
  maxTopics: true,
  windowDays: true,
}).extend({ idempotencyKey: IdempotencyKeySchema });

const MonitorBody = MonitorInputSchema.pick({ windowDays: true }).extend({
  idempotencyKey: IdempotencyKeySchema,
});

const ChatBody = z.object({
  message: z.string().min(1).max(8000),
  threadId: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,100}$/)
    .optional(),
});

type Env = { Bindings: HonoBindings; Variables: HonoVariables & AuthVariables };

/** Build the xbot HTTP API as a Hono app. Interfaces call the shared runtime; no research logic lives here. */
export async function createXbotHttpApp(options: XbotHttpOptions): Promise<Hono<Env>> {
  const { runtime } = options;
  const tokens = options.tokens && Object.keys(options.tokens).length > 0 ? options.tokens : undefined;
  if (!tokens && !options.insecureNoAuth) {
    throw new Error(
      "Refusing to start without API tokens. Set XBOT_HTTP_TOKEN(S) or pass insecureNoAuth for local development.",
    );
  }
  const app = new Hono<Env>();

  // Registered before auth, and it returns without calling next(), so health stays public.
  app.get("/v1/health", (c) =>
    c.json({ status: "ok", xMode: runtime.info.xMode, chat: runtime.info.chatAvailable }),
  );

  // Everything other than health is authenticated, including Mastra's own routes when mounted.
  if (tokens) {
    const auth = bearerAuth<Env>(tokens);
    app.use("/v1/*", auth);
    app.use("/api/*", auth);
  } else {
    app.use("*", async (c, next) => {
      c.set("tenantId", runtime.info.tenantId);
      await next();
    });
  }

  app.onError((error, c) => {
    if (error instanceof z.ZodError) {
      return c.json(
        { error: { code: "invalid_request", message: "Invalid request body", issues: error.issues } },
        400,
      );
    }
    if (error instanceof SyntaxError) {
      return c.json({ error: { code: "invalid_request", message: "Malformed JSON" } }, 400);
    }
    if (error instanceof XApiError) {
      const status = error.code === "budget_exceeded" ? 402 : error.code === "rate_limited" ? 429 : 502;
      return c.json({ error: { code: error.code, message: error.message } }, status);
    }
    // Never echo internal errors: they may contain upstream details.
    return c.json({ error: { code: "internal", message: "Internal error" } }, 500);
  });

  app.post("/v1/research", async (c) => {
    const body = ResearchBody.parse(await c.req.json());
    const tenantId = c.get("tenantId");
    const input = {
      query: body.query,
      trigger: "http" as const,
      tenantId,
      ...(body.maxPosts ? { maxPosts: body.maxPosts } : {}),
      ...(body.windowDays ? { windowDays: body.windowDays } : {}),
      ...(body.maxCostUsd ? { maxCostUsd: body.maxCostUsd } : {}),
      ...(body.language ? { language: body.language } : {}),
      ...(body.topicId ? { topicId: body.topicId } : {}),
      ...(body.idempotencyKey ? { triggerEventId: body.idempotencyKey } : {}),
    };
    if (body.wait) {
      const outcome = await runtime.research(input);
      return c.json(
        {
          runId: outcome.runId,
          status: "completed",
          deduplicated: outcome.deduplicated,
          report: outcome.report,
        },
        201,
      );
    }
    const { runId } = await runtime.startResearch(input);
    return c.json({ runId, status: "pending", links: { run: `/v1/research/${runId}` } }, 202);
  });

  app.get("/v1/research/:id", async (c) => {
    const tenantId = c.get("tenantId");
    const run = await runtime.getRun(c.req.param("id"), { tenantId });
    if (!run) return c.json({ error: { code: "not_found", message: "Run not found" } }, 404);
    const report = run.reportId ? await runtime.getReport(run.reportId, { tenantId }) : undefined;
    return c.json({
      runId: run.id,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      ...(run.status === "failed" ? { error: "Research run failed" } : {}),
      ...(report ? { report } : {}),
    });
  });

  app.get("/v1/reports/:id", async (c) => {
    const report = await runtime.getReport(c.req.param("id"), { tenantId: c.get("tenantId") });
    if (!report) return c.json({ error: { code: "not_found", message: "Report not found" } }, 404);
    if (c.req.query("format") === "markdown" || c.req.header("accept")?.includes("text/markdown")) {
      return c.body(renderReportMarkdown(report), 200, { "content-type": "text/markdown; charset=utf-8" });
    }
    return c.json(report);
  });

  app.get("/v1/reports", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 200);
    const q = c.req.query("q");
    const topicId = c.req.query("topicId");
    const reports = await runtime.listReports({
      tenantId: c.get("tenantId"),
      limit,
      ...(q ? { search: q } : {}),
      ...(topicId ? { topicId } : {}),
    });
    return c.json({ reports });
  });

  app.post("/v1/discovery", async (c) => {
    const body = DiscoveryBody.parse(await c.req.json());
    const result = await runtime.discover({
      interests: body.interests,
      trigger: "http",
      tenantId: c.get("tenantId"),
      ...(body.accounts ? { accounts: body.accounts } : {}),
      ...(body.maxTopics ? { maxTopics: body.maxTopics } : {}),
      ...(body.windowDays ? { windowDays: body.windowDays } : {}),
      ...(body.idempotencyKey ? { triggerEventId: body.idempotencyKey } : {}),
    });
    return c.json(result);
  });

  app.get("/v1/topics", (c) => c.json({ topics: runtime.topics }));

  app.post("/v1/topics/:id/monitor", async (c) => {
    const topicId = c.req.param("id");
    if (!runtime.topics.some((t) => t.id === topicId)) {
      return c.json({ error: { code: "not_found", message: "Topic not found" } }, 404);
    }
    const raw = await c.req.text();
    const body = MonitorBody.parse(raw.trim() ? JSON.parse(raw) : {});
    const result = await runtime.monitor({
      topicId,
      trigger: "http",
      tenantId: c.get("tenantId"),
      ...(body.windowDays ? { windowDays: body.windowDays } : {}),
      ...(body.idempotencyKey ? { triggerEventId: body.idempotencyKey } : {}),
    });
    return c.json(result);
  });

  app.get("/v1/budget", async (c) => c.json(await runtime.budgetStatus()));

  // Streams the research agent's answer as server-sent events. Threads are namespaced per tenant.
  app.post("/v1/chat", async (c) => {
    const agent = runtime.agent;
    if (!agent) return c.json({ error: { code: "unavailable", message: "No chat model configured" } }, 503);
    const body = ChatBody.parse(await c.req.json());
    const tenantId = c.get("tenantId");
    const threadId = `${tenantId}:${body.threadId ?? crypto.randomUUID()}`;
    return streamSSE(c, async (sse) => {
      const abort = new AbortController();
      sse.onAbort(() => abort.abort());
      // Shared research tools read the tenant from the request context, so the agent can only
      // reach this caller's reports and history.
      const requestContext = new RequestContext();
      requestContext.set(XBOT_TENANT_CONTEXT_KEY, tenantId);
      requestContext.set(XBOT_TRIGGER_CONTEXT_KEY, "http");
      const stream = await agent.stream(body.message, {
        memory: { thread: threadId, resource: `tenant:${tenantId}` },
        requestContext,
        abortSignal: abort.signal,
      });
      await sse.writeSSE({
        event: "thread",
        data: JSON.stringify({ threadId: threadId.slice(tenantId.length + 1) }),
      });
      for await (const chunk of stream.fullStream as AsyncIterable<{
        type: string;
        payload?: Record<string, unknown>;
      }>) {
        if (chunk.type === "text-delta") {
          await sse.writeSSE({ event: "text", data: JSON.stringify({ text: chunk.payload?.text ?? "" }) });
        } else if (chunk.type === "tool-call") {
          await sse.writeSSE({ event: "tool-call", data: JSON.stringify({ tool: chunk.payload?.toolName }) });
        } else if (chunk.type === "tool-result") {
          await sse.writeSSE({
            event: "tool-result",
            data: JSON.stringify({ tool: chunk.payload?.toolName, error: Boolean(chunk.payload?.isError) }),
          });
        }
      }
      await sse.writeSSE({ event: "done", data: "{}" });
    });
  });

  if (options.mastraApi) {
    const server = new MastraServer({ app, mastra: runtime.mastra });
    await server.init();
  }

  return app;
}
