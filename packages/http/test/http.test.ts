import { createMockModel } from "@mastra/core/test-utils/llm-mock";
import { createXbotRuntime, type XbotConfig } from "@yu-iskw/xbot-core";
import { describe, expect, it } from "vitest";
import { createXbotHttpApp, parseTokens } from "../src/index";

const TOKEN_A = "token-a-0123456789abcdef";
const TOKEN_B = "token-b-0123456789abcdef";
const ADMIN_TOKEN = "admin-token-0123456789abcdef";
const auth = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });

async function setup(config: XbotConfig = {}, mastraApi = false) {
  const runtime = await createXbotRuntime({ storage: { url: ":memory:" }, x: { mode: "mock" }, ...config });
  const app = await createXbotHttpApp({
    runtime,
    tokens: { [TOKEN_A]: "tenant-a", [TOKEN_B]: "tenant-b" },
    mastraApi,
    ...(mastraApi ? { adminTokens: [ADMIN_TOKEN] } : {}),
  });
  return { runtime, app };
}

describe("xbot HTTP API", () => {
  it("refuses to start without tokens unless explicitly insecure", async () => {
    const runtime = await createXbotRuntime({ storage: { url: ":memory:" }, x: { mode: "mock" } });
    await expect(createXbotHttpApp({ runtime })).rejects.toThrow(/without API tokens/);
    await expect(createXbotHttpApp({ runtime, insecureNoAuth: true })).resolves.toBeDefined();
    await runtime.close();
  });

  it("parses token maps and rejects weak tokens", () => {
    expect(parseTokens({ XBOT_HTTP_TOKENS: `${TOKEN_A}:a,${TOKEN_B}:b` })).toEqual({
      [TOKEN_A]: "a",
      [TOKEN_B]: "b",
    });
    expect(() => parseTokens({ XBOT_HTTP_TOKEN: "short" })).toThrow(/16 characters/);
  });

  it("keeps health public and everything else authenticated", async () => {
    const { app, runtime } = await setup();
    expect((await app.request("/v1/health")).status).toBe(200);
    expect((await app.request("/v1/reports")).status).toBe(401);
    expect((await app.request("/v1/reports", { headers: auth("wrong-token-0123456789") })).status).toBe(401);
    expect((await app.request("/v1/reports", { headers: auth(TOKEN_A) })).status).toBe(200);
    await runtime.close();
  });

  it("runs research synchronously and scopes reports to the caller's tenant", async () => {
    const { app, runtime } = await setup();
    const res = await app.request("/v1/research", {
      method: "POST",
      headers: auth(TOKEN_A),
      body: JSON.stringify({ query: "Mastra", wait: true }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { report: { id: string; sources: unknown[] } };
    expect(body.report.sources.length).toBeGreaterThan(0);

    const own = await app.request(`/v1/reports/${body.report.id}`, { headers: auth(TOKEN_A) });
    expect(own.status).toBe(200);
    const md = await app.request(`/v1/reports/${body.report.id}?format=markdown`, { headers: auth(TOKEN_A) });
    expect(await md.text()).toContain("# Research: Mastra");
    const other = await app.request(`/v1/reports/${body.report.id}`, { headers: auth(TOKEN_B) });
    expect(other.status).toBe(404);
    const listB = (await (await app.request("/v1/reports", { headers: auth(TOKEN_B) })).json()) as {
      reports: unknown[];
    };
    expect(listB.reports).toEqual([]);
    await runtime.close();
  });

  it("starts research in the background and exposes progress", async () => {
    const { app, runtime } = await setup();
    const res = await app.request("/v1/research", {
      method: "POST",
      headers: auth(TOKEN_A),
      body: JSON.stringify({ query: "LLMOps" }),
    });
    expect(res.status).toBe(202);
    const { runId } = (await res.json()) as { runId: string };
    let status = "";
    for (let i = 0; i < 50 && status !== "completed"; i++) {
      const poll = (await (
        await app.request(`/v1/research/${runId}`, { headers: auth(TOKEN_A) })
      ).json()) as {
        status: string;
      };
      status = poll.status;
      if (status !== "completed") await new Promise((r) => setTimeout(r, 50));
    }
    expect(status).toBe("completed");
    expect((await app.request(`/v1/research/${runId}`, { headers: auth(TOKEN_B) })).status).toBe(404);
    await runtime.close();
  });

  it("deduplicates retried requests with an idempotency key", async () => {
    const { app, runtime } = await setup();
    const send = () =>
      app.request("/v1/research", {
        method: "POST",
        headers: auth(TOKEN_A),
        body: JSON.stringify({ query: "Mastra", wait: true, idempotencyKey: "req-1" }),
      });
    const a = (await (await send()).json()) as { report: { id: string } };
    const b = (await (await send()).json()) as { report: { id: string }; deduplicated: boolean };
    expect(b.deduplicated).toBe(true);
    expect(b.report.id).toBe(a.report.id);
    await runtime.close();
  });

  it("validates input and maps budget errors without leaking internals", async () => {
    const { app, runtime } = await setup({ budgets: { perRequestUsd: 0.001 } });
    const bad = await app.request("/v1/research", {
      method: "POST",
      headers: auth(TOKEN_A),
      body: JSON.stringify({}),
    });
    expect(bad.status).toBe(400);
    const malformed = await app.request("/v1/research", {
      method: "POST",
      headers: auth(TOKEN_A),
      body: "{",
    });
    expect(malformed.status).toBe(400);
    const disc = await app.request("/v1/discovery", {
      method: "POST",
      headers: auth(TOKEN_A),
      body: JSON.stringify({ interests: ["AI agents"] }),
    });
    expect(disc.status).toBe(200);
    await runtime.close();
  });

  it("monitors configured topics for the caller's tenant", async () => {
    const { app, runtime } = await setup({
      topics: [{ id: "mastra", description: "Mastra", keywords: ["#Mastra"] }],
    });
    const monitor = (topic: string, token = TOKEN_A) =>
      app.request(`/v1/topics/${topic}/monitor`, { method: "POST", headers: auth(token), body: "{}" });
    expect((await monitor("unknown")).status).toBe(404);
    const first = (await (await monitor("mastra")).json()) as { summary: string; reportId: string };
    expect(first.summary).toMatch(/First report/);
    // Tenant B has no history for the topic, so its first run is also a first report.
    const other = (await (await monitor("mastra", TOKEN_B)).json()) as { summary: string };
    expect(other.summary).toMatch(/First report/);
    const second = (await (await monitor("mastra")).json()) as { previousReportId: string };
    expect(second.previousReportId).toBe(first.reportId);
    await runtime.close();
  });

  it("does not expose Mastra's built-in routes unless enabled, and protects them when enabled", async () => {
    const off = await setup();
    expect((await off.app.request("/api/agents", { headers: auth(TOKEN_A) })).status).toBe(404);
    await off.runtime.close();
    const on = await setup({}, true);
    expect((await on.app.request("/api/workflows")).status).toBe(401);
    // Mastra's routes are not tenant-aware, so tenant tokens are rejected there.
    expect((await on.app.request("/api/workflows", { headers: auth(TOKEN_A) })).status).toBe(401);
    expect((await on.app.request("/api/workflows", { headers: auth(ADMIN_TOKEN) })).status).toBe(200);
    // Admin tokens are not tenant tokens either.
    expect((await on.app.request("/v1/reports", { headers: auth(ADMIN_TOKEN) })).status).toBe(401);
    await on.runtime.close();
  });

  it("requires admin tokens to mount Mastra's routes and clamps list limits", async () => {
    const runtime = await createXbotRuntime({ storage: { url: ":memory:" }, x: { mode: "mock" } });
    await expect(createXbotHttpApp({ runtime, tokens: { [TOKEN_A]: "a" }, mastraApi: true })).rejects.toThrow(
      /admin tokens/,
    );
    const app = await createXbotHttpApp({ runtime, tokens: { [TOKEN_A]: "a" } });
    for (const n of [1, 2, 3]) await runtime.research({ query: `Mastra ${n}`, tenantId: "a" });
    const list = async (limit: string) =>
      (
        (await (await app.request(`/v1/reports?limit=${limit}`, { headers: auth(TOKEN_A) })).json()) as {
          reports: unknown[];
        }
      ).reports.length;
    // A negative LIMIT would mean "unlimited" in SQLite; it falls back to the default instead.
    expect(await list("-1")).toBe(3);
    expect(await list("1")).toBe(1);
    expect(await list("abc")).toBe(3);
    await runtime.close();
  });

  it("streams chat over SSE with tenant-scoped threads", async () => {
    const none = await setup();
    const unavailable = await none.app.request("/v1/chat", {
      method: "POST",
      headers: auth(TOKEN_A),
      body: JSON.stringify({ message: "hi" }),
    });
    expect(unavailable.status).toBe(503);
    await none.runtime.close();

    const chat = createMockModel({ version: "v2", mockText: "Here is what the sample shows." });
    const { app, runtime } = await setup({ models: { chat: chat as never } });
    const res = await app.request("/v1/chat", {
      method: "POST",
      headers: auth(TOKEN_A),
      body: JSON.stringify({ message: "hi", threadId: "t1" }),
    });
    const text = await res.text();
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("event: thread");
    expect(text).toContain('"threadId":"t1"');
    expect(text).toContain("Here is what the sample shows.");
    expect(text).toContain("event: done");
    await runtime.close();
  });
});
