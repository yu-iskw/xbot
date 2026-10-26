import { createMockModel } from "@mastra/core/test-utils/llm-mock";
import { RESEARCH_AGENT_ID } from "@yu-iskw/xbot-core";
import { describe, expect, it } from "vitest";
import {
  createSlackAccessControl,
  createXbotSlackRuntime,
  slackWebhookPath,
  startXbotSlackServer,
} from "../src/index";

const msg = (userId: string, extra = {}) => ({ author: { userId, ...extra } });

describe("Slack access control", () => {
  it("enforces an allowlist, ignores bots, and applies a daily per-user quota", () => {
    let now = new Date("2026-10-26T10:00:00Z");
    const access = createSlackAccessControl({
      allowedUserIds: ["U1", "U2"],
      maxMessagesPerUserPerDay: 2,
      now: () => now,
    });
    expect(access.check(msg("U9"))).toEqual({ allowed: false, reason: "not_allowed" });
    expect(access.check(msg("U1", { isBot: true }))).toEqual({ allowed: false, reason: "bot" });
    expect(access.check(msg("U1")).allowed).toBe(true);
    expect(access.check(msg("U1")).allowed).toBe(true);
    expect(access.check(msg("U1"))).toEqual({ allowed: false, reason: "quota_exceeded" });
    expect(access.check(msg("U2")).allowed).toBe(true);
    now = new Date("2026-10-27T00:00:01Z");
    expect(access.check(msg("U1")).allowed).toBe(true);
  });
});

const slack = { botToken: "xoxb-test", signingSecret: "test-signing-secret" };

describe("Slack runtime", () => {
  it("requires a chat model", async () => {
    await expect(
      createXbotSlackRuntime({ config: { storage: { url: ":memory:" }, x: { mode: "mock" } }, slack }),
    ).rejects.toThrow(/chat model/);
  });

  it("adds the Slack channel to the same research agent and isolates Slack research in its own tenant", async () => {
    const chat = createMockModel({ version: "v2", mockText: "ok" });
    const runtime = await createXbotSlackRuntime({
      config: { storage: { url: ":memory:" }, x: { mode: "mock" }, models: { chat: chat as never } },
      slack,
    });
    expect(runtime.agent?.id).toBe(RESEARCH_AGENT_ID);
    expect(runtime.info.tenantId).toBe("slack");
    await runtime.close();
  });

  it("serves only the Slack webhook route", async () => {
    const chat = createMockModel({ version: "v2", mockText: "ok" });
    const server = await startXbotSlackServer({
      port: 0,
      hostname: "127.0.0.1",
      config: { storage: { url: ":memory:" }, x: { mode: "mock" }, models: { chat: chat as never } },
      env: { SLACK_BOT_TOKEN: slack.botToken, SLACK_SIGNING_SECRET: slack.signingSecret },
    });
    try {
      expect((await server.app.request("/api/agents")).status).toBe(404);
      expect((await server.app.request("/api/workflows")).status).toBe(404);
      expect((await server.app.request("/healthz")).status).toBe(200);
      const hook = await server.app.request(slackWebhookPath(RESEARCH_AGENT_ID), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "event_callback" }),
      });
      // Reaches Mastra's channel handler, which rejects the unsigned request.
      expect(hook.status).not.toBe(404);
      expect(hook.status).toBeGreaterThanOrEqual(400);
    } finally {
      await server.close();
    }
  });
});
