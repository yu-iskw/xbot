import type { AddressInfo } from "node:net";
import { RequestContext } from "@mastra/core/request-context";
import { MCPClient } from "@mastra/mcp";
import { createXbotRuntime } from "@yu-iskw/xbot-core";
import { describe, expect, it } from "vitest";
import { createXbotMcpServer, parseMcpTokens, startMcpHttp } from "../src/index";

const runtimeFor = () => createXbotRuntime({ storage: { url: ":memory:" }, x: { mode: "mock" } });

function tenantContext(tenantId: string) {
  const rc = new RequestContext();
  rc.set("authInfo", { extra: { tenantId } });
  return rc;
}

describe("xbot MCP server", () => {
  it("exposes exactly the six documented tools", async () => {
    const runtime = await runtimeFor();
    const server = createXbotMcpServer(runtime);
    const { tools } = await server.getToolListInfo();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "xbot_discover_topics",
        "xbot_get_post",
        "xbot_get_report",
        "xbot_research",
        "xbot_search_history",
        "xbot_search_posts",
      ].sort(),
    );
    await runtime.close();
  });

  it("runs research through the shared runtime and scopes history by authenticated tenant", async () => {
    const runtime = await runtimeFor();
    const server = createXbotMcpServer(runtime);
    const res = await server.executeTool(
      "xbot_research",
      { query: "Mastra" },
      { requestContext: tenantContext("acme") },
    );
    expect(res.status).toBe("completed");
    const report = (res as { output: { id: string; sources: unknown[] } }).output;
    expect(report.sources.length).toBeGreaterThan(0);

    const mine = await server.executeTool(
      "xbot_get_report",
      { id: report.id },
      { requestContext: tenantContext("acme") },
    );
    expect((mine as { output: { found: boolean } }).output.found).toBe(true);
    const theirs = await server.executeTool(
      "xbot_get_report",
      { id: report.id },
      { requestContext: tenantContext("other") },
    );
    expect((theirs as { output: { found: boolean } }).output.found).toBe(false);
    const run = (await runtime.store.listRuns("acme"))[0];
    expect(run?.trigger).toBe("mcp");
    await runtime.close();
  });

  it("serves authenticated Streamable HTTP and rejects unauthenticated callers", async () => {
    expect(() => parseMcpTokens("short:t")).toThrow(/16 characters/);
    const runtime = await runtimeFor();
    const server = createXbotMcpServer(runtime);
    const token = "mcp-token-0123456789abcdef";
    const http = await startMcpHttp(server, { port: 0, tokens: { [token]: "default" } });
    const { port } = http.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/mcp`;
    try {
      const anon = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(anon.status).toBe(401);

      const client = new MCPClient({
        servers: {
          xbot: { url: new URL(url), requestInit: { headers: { authorization: `Bearer ${token}` } } },
        },
      });
      try {
        const tools = await client.listTools();
        expect(Object.keys(tools).some((k) => k.endsWith("xbot_search_posts"))).toBe(true);
      } finally {
        await client.disconnect();
      }
    } finally {
      await new Promise((r) => http.close(r));
      await runtime.close();
    }
  });
});
